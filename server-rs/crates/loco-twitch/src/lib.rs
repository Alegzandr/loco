//! Who is streaming this game right now, asked through the gateway.
//!
//! This crate holds no Twitch credential and knows no Twitch address beyond the
//! one the CDN hands back: everything leaves through Janus, which owns the
//! secret and the OAuth2 token (`JANUS.md`). It never imports `loco-hub` — the
//! only way anything here reaches the event loop is the publish callback
//! [`Poller::run`] is given. See `docs/notes/live.md`.
//!
//! Port of `server/twitch/`, one module per Go file.

pub mod config;
pub mod helix;
pub mod poller;
pub mod thumbs;

pub use config::{
    Config, LIVE_MAX_AGE, LIVE_POLL_PERIOD, LIVE_THUMB_TTL, config_from_env, parse_go_duration,
};
pub use helix::LIVE_PAGE_MAX;
pub use poller::{PollState, Poller, Screen, Stats};
pub use thumbs::{THUMB_PREFIX, serve_json, serve_thumb};

use serde::{Deserialize, Serialize};

/// One channel streaming this game, as this server saw it at the last poll.
///
/// TODO(after loco-protocol merges): this is `protocol.LiveStreamDTO`, defined
/// here only because the protocol crate is being written in parallel. Replace it
/// with `loco_protocol::LiveStreamDto` (same fields, same JSON) and delete this.
///
/// Nothing in it is ours: the name is written by a stranger and every row is
/// screened before it gets here. There is deliberately no title field.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct LiveStream {
    /// The channel's URL segment, guaranteed `^[A-Za-z0-9_]{1,25}$`.
    pub login: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub lang: String,
    /// No omitempty: zero viewers is a channel that is live.
    pub viewers: i64,
    /// A path on THIS origin (`/live-thumb/<key>`), never a Twitch URL.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub thumb: String,
}

#[cfg(test)]
mod tests;
