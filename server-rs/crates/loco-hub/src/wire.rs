//! The wire, as much of it as the foundation needs before `loco-protocol` lands.
//!
//! TODO(after loco-protocol merges): delete this file. `ClientMsg` becomes
//! `loco_protocol::ClientMsg`, `ServerMsg` becomes `loco_protocol::ServerMsg`
//! (which implements [`Outgoing`] by setting its `server_now`), and the five
//! constructors below become its variants. Nothing outside this file builds a
//! message by hand, so the swap is this file and the `use` lines.

use serde::{Deserialize, Serialize};

pub use loco_twitch::LiveStream;

/// What a client sent. The real enum is tagged on `type`; until it exists the
/// tag is kept and everything else is left as the client wrote it.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct ClientMsg {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(flatten)]
    pub fields: serde_json::Map<String, serde_json::Value>,
}

/// A message on its way out. Every one carries `server_now`, stamped where it
/// is marshalled (`Client::send`, `Hub::broadcast`): every deadline on the wire
/// is an absolute server instant and the client needs the clock to read it.
pub trait Outgoing: Serialize {
    fn stamp(&mut self, server_now_ms: i64);
}

/// The server's half, reduced to what the foundation sends.
#[derive(Clone, Debug, Default, Serialize, PartialEq)]
pub struct ServerMsg {
    #[serde(rename = "type")]
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub players_online: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub live_streams: Option<Vec<LiveStream>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latencies: Option<Vec<LatencyEntry>>,
    #[serde(skip_serializing_if = "is_zero")]
    pub server_now: i64,
}

fn is_zero(v: &i64) -> bool {
    *v == 0
}

impl Outgoing for ServerMsg {
    fn stamp(&mut self, server_now_ms: i64) {
        self.server_now = server_now_ms;
    }
}

/// One seat's measured round trip.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct LatencyEntry {
    pub player_index: usize,
    /// -1 while nothing has been measured.
    pub rtt_ms: i32,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub bot: bool,
}

impl ServerMsg {
    fn of(kind: &'static str) -> ServerMsg {
        ServerMsg {
            kind,
            ..Default::default()
        }
    }

    /// A refusal. Only `Client::send_error` builds one: it is the funnel the
    /// AFK counter's refusal check counts.
    pub(crate) fn error(msg: &str) -> ServerMsg {
        ServerMsg {
            error: Some(msg.to_owned()),
            ..ServerMsg::of("error")
        }
    }

    pub fn players_online(n: usize) -> ServerMsg {
        ServerMsg {
            players_online: Some(n as i64),
            ..ServerMsg::of("players_online")
        }
    }

    pub fn live_streams(list: Vec<LiveStream>) -> ServerMsg {
        ServerMsg {
            live_streams: Some(list),
            ..ServerMsg::of("live_streams")
        }
    }

    pub fn latency(entries: Vec<LatencyEntry>) -> ServerMsg {
        ServerMsg {
            latencies: Some(entries),
            ..ServerMsg::of("latency")
        }
    }

    pub fn server_updating() -> ServerMsg {
        ServerMsg::of("server_updating")
    }

    pub fn matchmaking_cancelled() -> ServerMsg {
        ServerMsg::of("matchmaking_cancelled")
    }
}

/// Unix milliseconds now: what `server_now` carries.
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
