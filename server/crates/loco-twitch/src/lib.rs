//! Who is streaming this game right now, asked through the gateway.
//!
//! This crate holds no Twitch credential and knows no Twitch address beyond the
//! one the CDN hands back: everything leaves through Janus, which owns the
//! secret and the OAuth2 token (`JANUS.md`). It never imports `loco-hub` — the
//! only way anything here reaches the event loop is the publish callback
//! [`Poller::run`] is given. See `docs/notes/live.md`.

pub mod config;
pub mod helix;
pub mod poller;
pub mod thumbs;

pub use config::{
    Config, LIVE_MAX_AGE, LIVE_POLL_PERIOD, LIVE_THUMB_TTL, config_from_env, parse_duration,
};
pub use helix::LIVE_PAGE_MAX;
pub use poller::{PollState, Poller, Screen, Stats};
pub use thumbs::{THUMB_PREFIX, serve_json, serve_thumb};

/// One channel streaming this game, as the protocol carries it.
pub use loco_protocol::LiveStreamDTO as LiveStream;

#[cfg(test)]
mod tests;
