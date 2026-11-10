//! What the environment says about this feature. Port of `server/twitch/config.go`.

use std::collections::HashSet;
use std::time::Duration;

/// The gateway slug the API is registered under. The path after it is
/// forwarded as is, and the registered base address already ends in `/helix`
/// — so the endpoint here is `/streams`, not `/helix/streams`. Confirmed
/// against the live gateway, not assumed.
pub const DEFAULT_HELIX_SLUG: &str = "twitch-helix";

/// What the category is called on Twitch. Only used when no game id was
/// pinned, and the id is what production runs on.
pub const DEFAULT_GAME_NAME: &str = "LOCO!";

/// The freshness of the list, not a rate. The Helix quota (800 points a minute,
/// one per `/streams`) does not constrain it; what a latency-first server should
/// pay for a list nobody plays with does. See `docs/notes/live.md`.
pub const LIVE_POLL_PERIOD: Duration = Duration::from_secs(60);

/// When the last good answer stops being true. Past it an empty list is
/// published rather than the last one known: a stale list is wrong in the only
/// direction that costs anything.
pub const LIVE_MAX_AGE: Duration = Duration::from_secs(10 * 60);

/// How long a preview is kept before it is fetched again. Twitch regenerates
/// them every few minutes, so asking more often buys a picture that has not
/// changed.
pub const LIVE_THUMB_TTL: Duration = Duration::from_secs(5 * 60);

/// The only host a preview may come from. Checked rather than followed.
pub const THUMB_HOST: &str = "static-cdn.jtvnw.net";

#[derive(Clone, Debug)]
pub struct Config {
    pub janus: loco_janus::Config,
    /// The two gateway slugs. `cdn_slug` is empty until the preview CDN is
    /// registered in Janus, and an empty one is not an error: the rows are
    /// listed without their pictures.
    pub helix_slug: String,
    pub cdn_slug: String,
    /// Pinned in production. Resolving by name can resolve to nothing, and a
    /// poll with no game id would ask Helix about the whole of Twitch.
    pub game_id: String,
    pub igdb_id: String,
    pub game_name: String,
    pub poll: Duration,
    /// The manual list of logins, lowercased: the operational escape hatch,
    /// needed because nothing screens the *contents* of a preview image.
    pub blocked: HashSet<String>,
}

/// Reads the environment and says whether the feature runs. A pure function
/// over an injected `getenv`. Three outcomes:
///   - no gateway key at all: off, silently (local dev and the E2E suite);
///   - a key with no URL or no application id: off, with a WARN (a typo);
///   - everything present: on.
pub fn config_from_env(getenv: &dyn Fn(&str) -> String) -> Option<Config> {
    let get = |k: &str| getenv(k).trim().to_owned();
    let key = get("JANUS_API_KEY");
    let base = get("JANUS_URL");
    let app = get("JANUS_APPLICATION_ID");

    if key.is_empty() {
        return None;
    }
    if base.is_empty() || app.is_empty() {
        tracing::warn!(
            "twitch live is off: JANUS_API_KEY is set but JANUS_URL or JANUS_APPLICATION_ID is empty"
        );
        return None;
    }

    Some(Config {
        janus: loco_janus::Config {
            base_url: base,
            app_id: app,
            api_key: key,
        },
        helix_slug: or(get("LOCO_TWITCH_SLUG"), DEFAULT_HELIX_SLUG),
        cdn_slug: get("LOCO_TWITCH_CDN_SLUG"),
        game_id: get("LOCO_TWITCH_GAME_ID"),
        igdb_id: get("LOCO_TWITCH_IGDB_ID"),
        game_name: or(get("LOCO_TWITCH_GAME_NAME"), DEFAULT_GAME_NAME),
        poll: poll_period(&getenv("LOCO_TWITCH_POLL")),
        blocked: parse_blocklist(&getenv("LOCO_TWITCH_BLOCKLIST")),
    })
}

/// Parses `LOCO_TWITCH_POLL`. A malformed value leaves the shipped default
/// rather than falling back to zero: a typo must not turn a poll into a spin.
pub fn poll_period(raw: &str) -> Duration {
    let raw = raw.trim();
    if raw.is_empty() {
        return LIVE_POLL_PERIOD;
    }
    match parse_go_duration(raw) {
        Some(d) if d >= Duration::from_secs(1) => d,
        _ => {
            tracing::warn!(
                "LOCO_TWITCH_POLL={raw:?} is not a duration of at least 1s, using {}s",
                LIVE_POLL_PERIOD.as_secs()
            );
            LIVE_POLL_PERIOD
        }
    }
}

fn parse_blocklist(raw: &str) -> HashSet<String> {
    raw.split(',')
        .map(|e| e.trim().to_lowercase())
        .filter(|e| !e.is_empty())
        .collect()
}

fn or(v: String, fallback: &str) -> String {
    if v.is_empty() { fallback.to_owned() } else { v }
}

/// Go's `time.ParseDuration`, for the positive values an env file carries:
/// `90s`, `1m30s`, `1.5h`, `250ms`. A negative or malformed value is `None`.
/// Its twin is `loco_hub::env::parse_go_duration`; the two crates share no
/// dependency to put it in, and this one may not import the hub.
pub fn parse_go_duration(s: &str) -> Option<Duration> {
    let mut rest = s.strip_prefix('+').unwrap_or(s);
    if rest.starts_with('-') {
        return None;
    }
    if rest == "0" {
        return Some(Duration::ZERO);
    }
    if rest.is_empty() {
        return None;
    }
    let mut total = 0f64;
    while !rest.is_empty() {
        let num_end = rest
            .find(|c: char| !(c.is_ascii_digit() || c == '.'))
            .unwrap_or(rest.len());
        if num_end == 0 {
            return None;
        }
        let value: f64 = rest[..num_end].parse().ok()?;
        rest = &rest[num_end..];
        let unit_end = rest
            .find(|c: char| c.is_ascii_digit() || c == '.')
            .unwrap_or(rest.len());
        let scale = match &rest[..unit_end] {
            "ns" => 1e-9,
            "us" | "µs" | "μs" => 1e-6,
            "ms" => 1e-3,
            "s" => 1.0,
            "m" => 60.0,
            "h" => 3600.0,
            _ => return None,
        };
        rest = &rest[unit_end..];
        total += value * scale;
    }
    Some(Duration::from_secs_f64(total))
}
