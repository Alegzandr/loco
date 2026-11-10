//! The wire, as the hub uses it: `loco-protocol`'s two enums, the stamp, and
//! builders for the messages the hub itself writes.
//!
//! Every message carries `server_now`, stamped where it is marshalled
//! ([`crate::Client::send`], [`crate::Table::broadcast_all`]): every deadline
//! on the wire is an absolute server instant and the client needs the clock
//! to read it.

pub use loco_protocol::{
    ClientMsg, LatencyEntryDTO as LatencyEntry, LiveStreamDTO as LiveStream, ServerMsg,
};

use loco_protocol::{EmptyMsg, ErrorMsg, LatencyMsg, LiveStreamsMsg, PlayersOnlineMsg};

/// A message on its way out, stamped where it is marshalled.
pub trait Outgoing: serde::Serialize {
    fn stamp_now(&mut self, server_now_ms: i64);
}

impl Outgoing for ServerMsg {
    fn stamp_now(&mut self, server_now_ms: i64) {
        self.stamp(server_now_ms);
    }
}

/// Unix milliseconds now: what `server_now` carries.
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// The messages the hub writes on its own account.
pub mod msg {
    use super::*;

    /// A refusal. Only `Client::send_error` builds one: it is the funnel the
    /// AFK counter's refusal check counts.
    pub(crate) fn error(text: &str) -> ServerMsg {
        ServerMsg::Error(ErrorMsg {
            error: text.to_owned(),
            ..Default::default()
        })
    }

    pub fn players_online(n: usize) -> ServerMsg {
        ServerMsg::PlayersOnline(PlayersOnlineMsg {
            players_online: Some(n as i32),
            ..Default::default()
        })
    }

    pub fn live_streams(list: Vec<LiveStream>) -> ServerMsg {
        ServerMsg::LiveStreams(LiveStreamsMsg {
            live_streams: Some(list),
            ..Default::default()
        })
    }

    pub fn latency(entries: Vec<LatencyEntry>) -> ServerMsg {
        ServerMsg::Latency(LatencyMsg {
            latencies: entries,
            ..Default::default()
        })
    }

    pub fn server_updating() -> ServerMsg {
        ServerMsg::ServerUpdating(EmptyMsg::default())
    }

    pub fn matchmaking_cancelled() -> ServerMsg {
        ServerMsg::MatchmakingCancelled(EmptyMsg::default())
    }
}

/// Decodes a client frame, or names the refusal Go would have answered it
/// with. Decoding is stricter than Go's was — an unknown `type` fails here
/// rather than in the dispatch switch — so the two refusals are told apart by
/// what failed: a type this server does not know is `unknown message type`,
/// exactly Go's string; anything else that does not decode is `invalid message
/// format`. Either way it is one `send_error`, counted as a refusal.
pub fn decode_client(data: &[u8]) -> Result<ClientMsg, &'static str> {
    match serde_json::from_slice::<ClientMsg>(data) {
        Ok(m) => Ok(m),
        Err(e) => {
            let typ = serde_json::from_slice::<serde_json::Value>(data)
                .ok()
                .and_then(|v| v.get("type").and_then(|t| t.as_str()).map(str::to_owned));
            match typ {
                Some(t) if e.to_string().contains(&format!("unknown variant `{t}`")) => {
                    Err("unknown message type")
                }
                _ => Err("invalid message format"),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_decode_failure_is_refused_with_go_s_words() {
        assert_eq!(
            decode_client(b"{not json").unwrap_err(),
            "invalid message format"
        );
        assert_eq!(
            decode_client(br#"{"type":"nope"}"#).unwrap_err(),
            "unknown message type"
        );
        assert_eq!(
            decode_client(br#"{"no":"type"}"#).unwrap_err(),
            "invalid message format"
        );
        assert!(decode_client(br#"{"type":"draw_card"}"#).is_ok());
    }

    #[test]
    fn the_hub_s_own_messages_keep_their_wire_shape() {
        let mut m = msg::players_online(3);
        m.stamp_now(42);
        assert_eq!(
            serde_json::to_value(&m).unwrap(),
            serde_json::json!({"type": "players_online", "players_online": 3, "server_now": 42, "turn": 0, "drawn_count": 0})
        );
    }
}
