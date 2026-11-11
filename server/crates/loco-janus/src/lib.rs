//! The gateway every third-party call leaves through.
//!
//! This crate holds no API's secret and knows no API's address: it puts two
//! headers on a request and sends it to Janus, which adds the secret on the way
//! out. See `JANUS.md` at the repository root.
//!
//! What it deliberately does not contain is a cache, a retry loop, a backoff, a
//! circuit breaker or a token store. Janus does all five for every caller, and
//! `JANUS.md` names them one by one as things not to build here. A second layer
//! of any of them would not be redundancy, it would be two policies disagreeing
//! about the same upstream.
//!
//! Port of `server/janus/client.go`.

use std::time::{Duration, SystemTime};

/// Above the 30s Janus waits upstream, as `JANUS.md` requires: a client that
/// gives up first turns the gateway's own timeout, which comes back as a
/// readable 502, into a cancelled request nobody can explain. It is long
/// because nothing on the event loop ever waits on it; every caller here is a
/// poller on its own task.
pub const CLIENT_TIMEOUT: Duration = Duration::from_secs(40);

/// What a call may decode when the caller names no bound of its own.
pub const DEFAULT_LIMIT: usize = 1 << 20;

/// `X-Janus-Identity: app`: this service asking for an API's own public data.
/// Always stated rather than left off (`JANUS.md`, "Two identities").
pub const IDENTITY_APP: &str = "app";
/// `X-Janus-Identity: account`: data belonging to the person who connected
/// their account. Nothing in this game has one, so nothing here sends it.
pub const IDENTITY_ACCOUNT: &str = "account";

/// What the environment says about the gateway. All three are required;
/// `api_key` is the secret and never appears in a file of this repository.
#[derive(Clone, Default, PartialEq, Eq)]
pub struct Config {
    pub base_url: String,
    pub app_id: String,
    pub api_key: String,
}

impl std::fmt::Debug for Config {
    // The key is never printed, not even into a test failure.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Config")
            .field("base_url", &self.base_url)
            .field("app_id", &self.app_id)
            .field(
                "api_key",
                &if self.api_key.is_empty() { "" } else { "<set>" },
            )
            .finish()
    }
}

impl Config {
    /// Whether the gateway can be called at all. A missing key is how a feature
    /// stays switched off; a key with no URL or no application id is a typo in
    /// an env file, and the caller says so rather than trying.
    pub fn valid(&self) -> bool {
        !self.base_url.is_empty() && !self.app_id.is_empty() && !self.api_key.is_empty()
    }
}

/// One call to one API, addressed the way `JANUS.md` describes: the path after
/// the slug is forwarded as is.
#[derive(Clone, Debug, Default)]
pub struct Request {
    /// The API, e.g. `twitch-helix`.
    pub slug: String,
    /// Forwarded unchanged, leading slash included.
    pub path: String,
    /// Unchanged. Encoded sorted by key, like Go's `url.Values.Encode`.
    pub query: Vec<(String, String)>,
    /// Bounds what a third party can make this process decode. Per call because
    /// a JSON list and a preview image are not the same size, and the honest
    /// bound is the one the caller can state. Zero means [`DEFAULT_LIMIT`].
    pub limit: usize,
}

/// What came back, plus the headers worth keeping.
#[derive(Clone, Debug, Default)]
pub struct Response {
    pub status: u16,
    pub content_type: String,
    pub body: Vec<u8>,
    /// `X-Janus-Cache` (HIT, MISS, STALE…). On a HIT the freshness of this data
    /// is the gateway's, not the poll period of whoever asked for it.
    pub cache: String,
    /// `X-Janus-Correlation-Id`, logged beside our own errors.
    pub correlation: String,
    /// Set on a 429 and the only pacing signal honoured here.
    pub retry_after: Duration,
}

/// Janus refusing, recognised by its media type rather than by its status: a
/// 404 carrying problem+json means there is no API at that slug, while a 404
/// carrying anything else means the API itself has no such resource.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GatewayError {
    pub status: u16,
    pub code: String,
    pub detail: String,
    pub correlation: String,
    pub retry_after: Duration,
}

/// The API itself answering with something that is not a 2xx. It is an error
/// and never an empty result: an outage that reads as "nobody is live" is the
/// silent version of the bug.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UpstreamError {
    pub status: u16,
    pub correlation: String,
    pub retry_after: Duration,
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("janus refused status={} code={} detail={:?} correlation={}", .0.status, .0.code, .0.detail, .0.correlation)]
    Gateway(GatewayError),
    #[error("upstream api status={} correlation={}", .0.status, .0.correlation)]
    Upstream(UpstreamError),
    /// Refused here rather than by the gateway: Janus answers 400 to a dot
    /// segment, a double slash or an encoded separator, and spending a call to
    /// be told so is a call spent against a quota shared with everything else.
    #[error("janus: path may not contain a dot segment, // or an encoded separator")]
    BadPath,
    /// The gateway was never configured. It exists so a caller cannot
    /// half-start: a feature with no key does not run.
    #[error("janus: not configured")]
    NotConfigured,
    #[error("janus transport: {0}")]
    Transport(#[from] reqwest::Error),
}

impl Error {
    /// The pause a 429 asked for, from either refusal, or zero.
    pub fn retry_after(&self) -> Duration {
        match self {
            Error::Gateway(g) => g.retry_after,
            Error::Upstream(u) => u.retry_after,
            _ => Duration::ZERO,
        }
    }
}

/// One client for this service, with both headers set here and never at a call
/// site (`JANUS.md`).
#[derive(Clone)]
pub struct Client {
    cfg: Config,
    http: reqwest::Client,
}

impl std::fmt::Debug for Client {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Client").field("cfg", &self.cfg).finish()
    }
}

/// TLS on ring with the bundled Mozilla roots: no process-wide provider, no
/// dependence on the image's certificate store (distroless carries one, but
/// the binary does not need it), and no aws-lc-rs, whose C build the musl
/// builder is not equipped for.
fn tls_config() -> rustls::ClientConfig {
    let roots = rustls::RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    rustls::ClientConfig::builder_with_provider(std::sync::Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    // Only fails on a provider with no cipher suite, which ring is not.
    .expect("ring supports the default protocol versions")
    .with_root_certificates(roots)
    .with_no_client_auth()
}

impl Client {
    /// Builds the one client. Callers keep it for the life of the process.
    pub fn new(cfg: Config) -> Self {
        let http = reqwest::Client::builder()
            .tls_backend_preconfigured(tls_config())
            .timeout(CLIENT_TIMEOUT)
            .connect_timeout(Duration::from_secs(5))
            .pool_max_idle_per_host(2)
            .build()
            // Only fails when the TLS backend cannot initialise, which is a
            // broken build rather than a runtime condition.
            .expect("building the janus http client");
        Client { cfg, http }
    }

    pub fn config(&self) -> &Config {
        &self.cfg
    }

    /// Sends one GET.
    ///
    /// Only GET, because that is all this service asks of anyone and because
    /// `JANUS.md` is explicit that POST and PATCH are not retried by the
    /// gateway: a method this crate does not offer cannot be retried by
    /// mistake.
    pub async fn get(&self, req: &Request) -> Result<Response, Error> {
        if !self.cfg.valid() {
            return Err(Error::NotConfigured);
        }
        check_path(&req.path)?;

        let mut addr = format!(
            "{}/gateway/{}{}",
            self.cfg.base_url.trim_end_matches('/'),
            req.slug,
            req.path
        );
        if !req.query.is_empty() {
            addr.push('?');
            addr.push_str(&encode_query(&req.query));
        }

        // The two headers, plus the identity. Nothing else: Janus strips
        // Authorization and cookies, and sending an API's own key is exactly
        // what this gateway exists to make unnecessary.
        let mut resp = self
            .http
            .get(addr)
            .header("X-Janus-Application-Id", &self.cfg.app_id)
            .header("X-Janus-Api-Key", &self.cfg.api_key)
            .header("X-Janus-Identity", IDENTITY_APP)
            .send()
            .await?;

        let header = |name: &str| {
            resp.headers()
                .get(name)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("")
                .to_owned()
        };
        let status = resp.status().as_u16();
        let content_type = header("Content-Type");
        let cache = header("X-Janus-Cache");
        let correlation = header("X-Janus-Correlation-Id");
        let retry_after = parse_retry_after(&header("Retry-After"), SystemTime::now());

        let limit = if req.limit == 0 {
            DEFAULT_LIMIT
        } else {
            req.limit
        };
        let mut body = Vec::new();
        while body.len() < limit {
            match resp.chunk().await? {
                Some(chunk) => {
                    let room = limit - body.len();
                    body.extend_from_slice(&chunk[..chunk.len().min(room)]);
                }
                None => break,
            }
        }

        let out = Response {
            status,
            content_type,
            body,
            cache,
            correlation,
            retry_after,
        };

        if is_problem(&out.content_type) {
            return Err(Error::Gateway(gateway_error(&out)));
        }
        if !(200..=299).contains(&status) {
            return Err(Error::Upstream(UpstreamError {
                status,
                correlation: out.correlation,
                retry_after: out.retry_after,
            }));
        }
        Ok(out)
    }
}

/// The whole of "who answered". A media type of `application/problem+json`
/// means the gateway; anything else means the API.
fn is_problem(ct: &str) -> bool {
    ct.trim()
        .to_ascii_lowercase()
        .starts_with("application/problem+json")
}

fn gateway_error(r: &Response) -> GatewayError {
    #[derive(serde::Deserialize, Default)]
    #[serde(default)]
    struct Problem {
        code: String,
        detail: String,
        title: String,
    }
    let p: Problem = serde_json::from_slice(&r.body).unwrap_or_default();
    let detail = if p.detail.is_empty() {
        p.title
    } else {
        p.detail
    };
    GatewayError {
        status: r.status,
        code: p.code,
        detail,
        correlation: r.correlation.clone(),
        retry_after: r.retry_after,
    }
}

/// Refuses the three shapes `JANUS.md` says the gateway answers 400 to.
pub fn check_path(p: &str) -> Result<(), Error> {
    if !p.is_empty() && !p.starts_with('/') {
        return Err(Error::BadPath);
    }
    if p.contains("//") || p.to_ascii_lowercase().contains("%2f") {
        return Err(Error::BadPath);
    }
    if p.split('/').any(|seg| seg == "." || seg == "..") {
        return Err(Error::BadPath);
    }
    Ok(())
}

/// Reads the header in both spellings the RFC allows. A value that is neither
/// is no pause rather than a guessed one.
pub fn parse_retry_after(raw: &str, now: SystemTime) -> Duration {
    let raw = raw.trim();
    if raw.is_empty() {
        return Duration::ZERO;
    }
    if let Ok(secs) = raw.parse::<i64>() {
        return if secs <= 0 {
            Duration::ZERO
        } else {
            Duration::from_secs(secs.unsigned_abs())
        };
    }
    if let Ok(when) = httpdate::parse_http_date(raw) {
        return when.duration_since(now).unwrap_or(Duration::ZERO);
    }
    Duration::ZERO
}

/// `url.Values.Encode`: sorted by key, `application/x-www-form-urlencoded`.
fn encode_query(q: &[(String, String)]) -> String {
    let mut pairs: Vec<&(String, String)> = q.iter().collect();
    pairs.sort_by(|a, b| a.0.cmp(&b.0));
    pairs
        .iter()
        .map(|(k, v)| format!("{}={}", escape(k), escape(v)))
        .collect::<Vec<_>>()
        .join("&")
}

fn escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests;
