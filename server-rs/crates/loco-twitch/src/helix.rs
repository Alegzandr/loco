//! The Helix half: resolving the category, asking who is live, and screening
//! what a stranger wrote before a player is shown it. Port of
//! `server/twitch/helix.go`.

use crate::LiveStream;
use crate::poller::Poller;
use loco_janus::Request;
use serde::Deserialize;

/// What is asked of the API. Helix already returns the list ordered by viewer
/// count, biggest first, so nothing here or on the client ever re-sorts.
pub const HELIX_FIRST: usize = 12;

/// What `/live.json` carries. Twelve is also what the preview cache will hold.
pub const LIVE_PAGE_MAX: usize = 12;

/// Bounds what a third party can make this process decode. A twelve-entry
/// stream list is a few kilobytes.
pub const HELIX_BODY_MAX: usize = 256 << 10;

/// The alphabet of a Twitch login. A row outside it is dropped rather than
/// escaped, which is what makes the outgoing link safe to assemble on the
/// client: nothing reaching `twitch.tv/<login>` can carry a slash, a question
/// mark or a scheme. ASCII digits only, so the guarantee the DTO documents
/// (`^[A-Za-z0-9_]{1,25}$`) is the one enforced.
pub fn login_ok(s: &str) -> bool {
    !s.is_empty() && s.len() <= 25 && s.chars().all(|r| r == '_' || r.is_ascii_alphanumeric())
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(default)]
pub struct HelixStream {
    pub user_login: String,
    pub user_name: String,
    pub viewer_count: i64,
    pub thumbnail_url: String,
    pub language: String,
}

#[derive(Debug)]
pub enum HelixError {
    Janus(loco_janus::Error),
    Decode(String),
    NoGameId,
    NoCategory,
}

impl std::fmt::Display for HelixError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            HelixError::Janus(e) => write!(f, "{e}"),
            HelixError::Decode(e) => write!(f, "decoding the answer: {e}"),
            HelixError::NoGameId => write!(f, "refusing to poll with no game id"),
            HelixError::NoCategory => {
                write!(f, "no Twitch category matched: pin LOCO_TWITCH_GAME_ID")
            }
        }
    }
}

impl HelixError {
    pub fn retry_after(&self) -> std::time::Duration {
        match self {
            HelixError::Janus(e) => e.retry_after(),
            _ => std::time::Duration::ZERO,
        }
    }
}

impl Poller {
    /// The category's Twitch id, and an empty answer is a hard stop rather than
    /// a shrug: `GET /streams` with no `game_id` returns the whole of Twitch,
    /// so a lookup that finds nothing switches the feature off.
    pub(crate) async fn resolve_game_id(&self) -> Result<String, HelixError> {
        if !self.cfg.game_id.is_empty() {
            return Ok(self.cfg.game_id.clone());
        }
        let mut tries = Vec::new();
        if !self.cfg.igdb_id.is_empty() {
            tries.push(("igdb_id", self.cfg.igdb_id.clone()));
        }
        if !self.cfg.game_name.is_empty() {
            tries.push(("name", self.cfg.game_name.clone()));
        }

        #[derive(Deserialize, Default)]
        #[serde(default)]
        struct Game {
            id: String,
        }
        #[derive(Deserialize, Default)]
        #[serde(default)]
        struct Games {
            data: Vec<Game>,
        }

        let mut last = None;
        for (k, v) in tries {
            let req = Request {
                slug: self.cfg.helix_slug.clone(),
                path: "/games".into(),
                query: vec![(k.into(), v)],
                limit: HELIX_BODY_MAX,
            };
            let resp = match self.janus.get(&req).await {
                Ok(r) => r,
                Err(e) => {
                    last = Some(HelixError::Janus(e));
                    continue;
                }
            };
            match serde_json::from_slice::<Games>(&resp.body) {
                Ok(g) => {
                    if let Some(first) = g.data.first().filter(|g| !g.id.is_empty()) {
                        return Ok(first.id.clone());
                    }
                }
                Err(e) => last = Some(HelixError::Decode(e.to_string())),
            }
        }
        Err(last.unwrap_or(HelixError::NoCategory))
    }

    /// The channels live in the category right now, and the gateway's cache
    /// verdict on that answer.
    pub(crate) async fn fetch_streams(
        &self,
        game_id: &str,
    ) -> Result<(Vec<HelixStream>, String), HelixError> {
        if game_id.is_empty() {
            // Belt and braces over resolve_game_id: this query without a game
            // id is a request for every live channel on Twitch.
            return Err(HelixError::NoGameId);
        }
        let req = Request {
            slug: self.cfg.helix_slug.clone(),
            path: "/streams".into(),
            query: vec![
                ("game_id".into(), game_id.into()),
                ("type".into(), "live".into()),
                ("first".into(), HELIX_FIRST.to_string()),
            ],
            limit: HELIX_BODY_MAX,
        };
        let resp = self.janus.get(&req).await.map_err(HelixError::Janus)?;
        #[derive(Deserialize, Default)]
        #[serde(default)]
        struct Streams {
            data: Vec<HelixStream>,
        }
        let payload: Streams = serde_json::from_slice(&resp.body)
            .map_err(|e| HelixError::Decode(format!("the stream list: {e}")))?;
        Ok((payload.data, resp.cache))
    }

    /// Turns what Twitch said into what a player may be shown.
    ///
    /// It runs on the poller's task rather than on the event loop: this is text
    /// written by strangers. A dropped row is never logged with the text that
    /// caused it; the counter says how many went.
    pub(crate) fn screen(&self, input: &[HelixStream]) -> (Vec<LiveStream>, usize) {
        let mut out = Vec::new();
        let mut dropped = 0;
        for s in input {
            if out.len() >= LIVE_PAGE_MAX {
                break;
            }
            let login = &s.user_login;
            if !login_ok(login) {
                dropped += 1;
                continue;
            }
            if self.cfg.blocked.contains(&login.to_lowercase()) {
                dropped += 1;
                continue;
            }
            let mut name = clean_name(&s.user_name);
            if name.is_empty() {
                name = login.clone();
            }
            // The name is the link, so there is nothing left to show once it is
            // refused: the row goes rather than being masked. Both spellings are
            // asked, because a display name and a login differ by more than
            // case on a channel not written in Latin script.
            if self.screen_name(login) || self.screen_name(&name) {
                dropped += 1;
                continue;
            }
            // NOTICE.md: nothing in the client renders the word UNO, and a
            // channel name is the one string here this game does not write.
            if mentions_uno(login) || mentions_uno(&name) {
                dropped += 1;
                continue;
            }
            out.push(LiveStream {
                login: login.clone(),
                name,
                lang: clean_lang(&s.language),
                viewers: i32::try_from(s.viewer_count).unwrap_or(i32::MAX),
                thumb: String::new(), // filled in by the thumbnail pass, when there is one
            });
        }
        (out, dropped)
    }

    fn screen_name(&self, s: &str) -> bool {
        self.blocked.as_ref().is_some_and(|f| f(s))
    }
}

/// Strips what a display name has no business carrying onto a home screen:
/// control characters, line breaks, and the bidi overrides that flip the text
/// around them.
pub fn clean_name(s: &str) -> String {
    let kept: String = s
        .chars()
        .filter(|&r| {
            !(r.is_control()
                || ('\u{202A}'..='\u{202E}').contains(&r)
                || ('\u{2066}'..='\u{2069}').contains(&r))
        })
        .collect();
    kept.trim().chars().take(25).collect()
}

/// Keeps a BCP-47 tag only if it looks like one. Presentation only.
pub fn clean_lang(s: &str) -> String {
    let s = s.trim().to_lowercase();
    if s.len() < 2 || s.len() > 5 || !s.chars().all(|r| r == '-' || r.is_ascii_lowercase()) {
        return String::new();
    }
    s
}

/// Whether a name carries the mark as a word of its own. A whole token, not a
/// substring: "unopar" and "Unolingo" are words that are not the mark.
pub fn mentions_uno(s: &str) -> bool {
    s.to_lowercase()
        .split(|r: char| !r.is_alphabetic() && !r.is_numeric())
        .any(|tok| tok == "uno")
}
