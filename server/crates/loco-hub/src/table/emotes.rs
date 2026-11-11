//! The three fixed things a player can say, on the game-over screen and
//! nowhere else. Port of `server/hub/emotes.go`.
//!
//! Closed and server-side: an unknown emote never decodes (`wire.rs` answers
//! it with Go's "unknown emote"), nothing is kept anywhere, and a bot neither
//! sends nor is the reason for one. No free text anywhere in this game.

use crate::net::client::Client;
use crate::table::Table;
use loco_game::Status;
use loco_protocol::{Emote, EmoteMsg, ServerMsg};
use std::sync::Arc;

impl Table {
    pub(crate) fn handle_send_emote(&mut self, c: &Arc<Client>, emote: Option<Emote>) {
        if self.room.status != Status::Finished {
            c.refuse(crate::table::refusal::Refusal::EmotesAtEndOnly);
            return;
        }
        let Some(emote) = emote else {
            c.refuse(crate::table::refusal::Refusal::UnknownEmote);
            c.note_suspect("unknown emote");
            return;
        };
        let seat = c.player_id();
        if self.is_bot(seat) {
            return;
        }
        self.broadcast_all(ServerMsg::Emote(EmoteMsg {
            player_index: Some(seat as i32),
            emote: Some(emote),
            ..Default::default()
        }));
    }
}
