//! The preview cache: fetched on a timer, kept in memory, served from this
//! origin under a key we mint.

use crate::LiveStream;
use crate::config::{LIVE_THUMB_TTL, THUMB_HOST};
use crate::helix::{HelixStream, LIVE_PAGE_MAX};
use crate::poller::{Poller, Snapshot};
use axum::body::Body;
use axum::http::{StatusCode, header};
use axum::response::Response;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::time::Instant;

/// One per row on the page, and no more.
pub const MAX_THUMBS: usize = LIVE_PAGE_MAX;

/// A 440x248 preview weighs 25 to 45 kB. Anything past this is abandoned
/// rather than truncated — the row stays, without a picture.
pub const MAX_THUMB_BYTES: usize = 80 << 10;

const THUMB_WIDTH: &str = "440";
const THUMB_HEIGHT: &str = "248";

/// The path previews are served under, on this origin. The page and the strip
/// only ever see a path, never a Twitch URL: `img-src` is `'self'`.
pub const THUMB_PREFIX: &str = "/live-thumb/";

#[derive(Clone, Debug)]
pub struct Thumb {
    pub bytes: Vec<u8>,
    pub ctype: &'static str,
    pub etag: String,
    pub fetched: Instant,
}

fn hex16(bytes: &[u8]) -> String {
    let sum = Sha256::digest(bytes);
    sum.iter().take(8).map(|b| format!("{b:02x}")).collect()
}

/// Opaque and ours, and the whole of the access control on the preview route:
/// the map is written from the last poll's answers, so only a URL Twitch
/// returned to us can be in it. Nothing a visitor sends chooses a URL.
pub fn thumb_key(raw_url: &str) -> String {
    hex16(raw_url.as_bytes())
}

/// Turns a Twitch thumbnail URL into the path to ask the CDN slug for, and
/// refuses anything not on the host previews come from.
pub fn thumb_path(raw_url: &str) -> Option<String> {
    let sized = raw_url
        .replace("{width}", THUMB_WIDTH)
        .replace("{height}", THUMB_HEIGHT);
    let rest = sized.strip_prefix("https://")?;
    let (host, path) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, ""),
    };
    // A fragment is never sent: it is dropped here.
    let path = path.split('#').next().unwrap_or("");
    if host != THUMB_HOST || path.is_empty() || path.starts_with('?') {
        return None;
    }
    Some(path.to_owned())
}

/// Reads the magic bytes. A preview that is not a picture is not served at
/// all, whatever the response called itself.
pub fn image_type(b: &[u8]) -> Option<&'static str> {
    if b.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if b.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        Some("image/png")
    } else {
        None
    }
}

impl Poller {
    /// Fetches what the rows point at, reusing anything the previous snapshot
    /// already holds and has not outlived. An empty CDN slug is not an error:
    /// the rows simply keep an empty thumb.
    pub(crate) async fn with_thumbs(
        &self,
        mut rows: Vec<LiveStream>,
        raw: &[HelixStream],
        prev: Option<&Snapshot>,
    ) -> (Vec<LiveStream>, HashMap<String, Thumb>) {
        let mut out = HashMap::new();
        if self.cfg.cdn_slug.is_empty() {
            return (rows, out);
        }
        // The screened rows are a subset of what Helix sent, so the URL for a
        // row is looked up by login rather than by position.
        let urls: HashMap<String, &str> = raw
            .iter()
            .map(|s| (s.user_login.to_lowercase(), s.thumbnail_url.as_str()))
            .collect();

        for row in rows.iter_mut() {
            if out.len() >= MAX_THUMBS {
                break;
            }
            let Some(raw_url) = urls
                .get(&row.login.to_lowercase())
                .filter(|u| !u.is_empty())
            else {
                continue;
            };
            let key = thumb_key(raw_url);

            if let Some(have) = prev.and_then(|p| p.thumbs.get(&key))
                && have.fetched.elapsed() < LIVE_THUMB_TTL
            {
                out.insert(key.clone(), have.clone());
                row.thumb = format!("{THUMB_PREFIX}{key}");
                continue;
            }

            let Some(path) = thumb_path(raw_url) else {
                continue;
            };
            match self.fetch_thumb(&path).await {
                Some(t) => {
                    out.insert(key.clone(), t);
                    row.thumb = format!("{THUMB_PREFIX}{key}");
                }
                None => {
                    // A missing picture is a row without one: not worth failing
                    // a poll over, and not worth a log line per channel.
                    self.thumb_errors.fetch_add(1, Ordering::Relaxed);
                }
            }
        }
        (rows, out)
    }

    async fn fetch_thumb(&self, path: &str) -> Option<Thumb> {
        // The path may carry the URL's own query, raw, forwarded as is: Janus
        // passes it on unchanged.
        let resp = self
            .janus
            .get(&loco_janus::Request {
                slug: self.cfg.cdn_slug.clone(),
                path: path.to_owned(),
                query: Vec::new(),
                // One over, so an oversized image is seen rather than trimmed.
                limit: MAX_THUMB_BYTES + 1,
            })
            .await
            .ok()?;
        if resp.body.len() > MAX_THUMB_BYTES {
            return None;
        }
        // Ours, written from the magic bytes. The upstream Content-Type is
        // never copied: this origin serves it, so this origin says what it is.
        let ctype = image_type(&resp.body)?;
        Some(Thumb {
            etag: format!("\"{}\"", hex16(&resp.body)),
            bytes: resp.body,
            ctype,
            fetched: Instant::now(),
        })
    }
}

/// Answers one preview, from memory, on an ordinary HTTP task: the event loop
/// is never touched and no page load waits on the gateway. `path` is the whole
/// request path; nil-safe like every other method a server without a gateway
/// key still answers.
pub fn serve_thumb(p: Option<&Poller>, path: &str, if_none_match: Option<&str>) -> Response {
    let key = path.strip_prefix(THUMB_PREFIX).unwrap_or("");
    let snap = p.and_then(|p| p.current());
    let thumb = match snap.as_ref() {
        Some(s) if !key.is_empty() && !key.contains('/') => s.thumbs.get(key),
        _ => None,
    };
    let Some(t) = thumb else {
        return status(StatusCode::NOT_FOUND);
    };
    // The URL is stable per channel while the picture behind it changes every
    // poll, so the ETag is computed over the bytes and not over the key.
    if let Some(m) = if_none_match
        && !m.is_empty()
        && m.contains(&t.etag)
    {
        return Response::builder()
            .status(StatusCode::NOT_MODIFIED)
            .header(header::ETAG, &t.etag)
            .body(Body::empty())
            .expect("static headers");
    }
    Response::builder()
        .header(header::CONTENT_TYPE, t.ctype)
        .header(header::ETAG, &t.etag)
        .header(
            header::CACHE_CONTROL,
            "public, max-age=60, stale-while-revalidate=120",
        )
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .body(Body::from(t.bytes.clone()))
        .expect("static headers")
}

/// What the content page reads. The game does not: it is told over the socket
/// it already holds.
pub fn serve_json(p: Option<&Poller>) -> Response {
    let body = match p {
        Some(p) => p.live_json(),
        None => crate::poller::encode_live(&[], 0),
    };
    Response::builder()
        .header(header::CONTENT_TYPE, "application/json; charset=utf-8")
        .header(header::CACHE_CONTROL, "public, max-age=30")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .body(Body::from(body))
        .expect("static headers")
}

fn status(code: StatusCode) -> Response {
    Response::builder()
        .status(code)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .body(Body::from("404 page not found\n"))
        .expect("static headers")
}
