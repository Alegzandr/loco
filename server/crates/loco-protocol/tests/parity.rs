//! The parity guard: the JSON this crate writes is the wire contract, frame
//! for frame.
//!
//! `fixtures/server.jsonl` and `fixtures/client.jsonl` are golden frames
//! (outbound and inbound respectively), real traffic captured while a whole
//! hub suite ran, one per distinct shape (`tools/protocol/sample-frames.mjs`;
//! the procedure is in `docs/protocol.md`). They are the contract the client
//! is built against. Each one is read into the Rust type and written back, and
//! must come out equal to the frame: same keys, same values, the same zeros
//! written and the same empties left out.
//!
//! Equal as JSON values, not as byte strings: key order is not part of the
//! contract, and no reader depends on it.

use loco_protocol::{ClientMsg, ServerMsg};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;
use std::collections::BTreeSet;

const SERVER: &str = include_str!("fixtures/server.jsonl");
const CLIENT: &str = include_str!("fixtures/client.jsonl");

/// How a fixture is held to the Rust types.
struct Rules {
    /// `type`s the server refuses as unknown. Their frames must not read.
    unknown_types: &'static [&'static str],
    /// Keys a frame may lose on the way back: fields the message's own handler
    /// never reads. Every field is accepted on every message, so a test client
    /// sending `room_code` with `add_bot` is answered as if it had not; serde
    /// ignores the stray and does not write it back.
    envelope_strays: &'static [&'static str],
}

const SERVER_RULES: Rules = Rules {
    unknown_types: &[],
    envelope_strays: &[],
};

/// Every field a client frame may carry on any message: the strays a frame
/// may lose when its message does not read them.
const CLIENT_RULES: Rules = Rules {
    unknown_types: &["unknown_msg_type"],
    envelope_strays: &[
        "nickname",
        "room_code",
        "session_token",
        "card",
        "chosen_color",
        "chosen_player",
        "play_cards",
        "declare_loco",
        "target_index",
        "match_format",
        "max_players",
        "streamer_mode",
        "emote",
        "debug",
    ],
};

fn round_trip<T: DeserializeOwned + Serialize>(
    name: &str,
    fixture: &str,
    rules: &Rules,
) -> BTreeSet<String> {
    let mut types = BTreeSet::new();
    let mut failures = Vec::new();
    for (n, line) in fixture
        .lines()
        .enumerate()
        .filter(|(_, l)| !l.trim().is_empty())
    {
        let mut original: Value = serde_json::from_str(line)
            .unwrap_or_else(|e| panic!("{name}:{}: not JSON: {e}", n + 1));
        let ty = original["type"].as_str().unwrap_or("?").to_owned();
        let read = serde_json::from_value::<T>(original.clone());
        if rules.unknown_types.contains(&ty.as_str()) {
            if read.is_ok() {
                failures.push(format!(
                    "{name}:{}: an unknown type was read\n  {line}",
                    n + 1
                ));
            }
            continue;
        }
        types.insert(ty);
        let msg = match read {
            Ok(m) => m,
            Err(e) => {
                failures.push(format!("{name}:{}: does not read: {e}\n  {line}", n + 1));
                continue;
            }
        };
        let back = serde_json::to_value(&msg).expect("a message always serializes");
        if let (Value::Object(orig), Value::Object(written)) = (&mut original, &back) {
            orig.retain(|k, _| {
                written.contains_key(k) || !rules.envelope_strays.contains(&k.as_str())
            });
        }
        if back != original {
            failures.push(format!(
                "{name}:{}: written back differently\n  want: {original}\n  got:  {back}",
                n + 1
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "{} frame(s) broke parity:\n{}",
        failures.len(),
        failures.join("\n")
    );
    types
}

#[test]
fn every_golden_server_frame_is_written_back_unchanged() {
    let seen = round_trip::<ServerMsg>("server.jsonl", SERVER, &SERVER_RULES);
    // Every message type is covered, so a variant cannot be wrong unseen.
    let missing: Vec<_> = ServerMsg::TYPES
        .iter()
        .filter(|t| !seen.contains(**t))
        .collect();
    assert!(
        missing.is_empty(),
        "no golden frame covers {missing:?}: recapture the fixture"
    );
}

#[test]
fn every_golden_client_frame_is_written_back_unchanged() {
    // Coverage is not asserted here: these frames are what a test suite sent,
    // and a test client sends the messages it is testing, not every one.
    round_trip::<ClientMsg>("client.jsonl", CLIENT, &CLIENT_RULES);
}

/// The two always-written zeros, stated directly rather than left to whatever
/// the capture happened to contain.
#[test]
fn turn_and_drawn_count_are_written_on_every_message() {
    let mut msg: ServerMsg = serde_json::from_str(r#"{"type":"kicked"}"#).unwrap();
    msg.stamp(1_700_000_000_000);
    let v = serde_json::to_value(&msg).unwrap();
    assert_eq!(
        v,
        serde_json::json!({"type": "kicked", "server_now": 1_700_000_000_000_i64, "turn": 0, "drawn_count": 0})
    );

    // A message that owns `turn` writes its own, once, and still gets the
    // other zero.
    let msg: ServerMsg = serde_json::from_str(r#"{"type":"turn_changed","turn":2}"#).unwrap();
    let text = serde_json::to_string(&msg).unwrap();
    assert_eq!(text.matches("\"turn\"").count(), 1, "{text}");
    let v: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(v["turn"], 2);
    assert_eq!(v["drawn_count"], 0);
}

/// "A zero is a value": a seat 0, a pending draw of 0 and a shut window are
/// written, because the field is an `Option` and `Some(0)` is not `None`.
#[test]
fn a_zero_behind_an_option_is_written() {
    let json = r#"{"type":"card_drawn","player_index":0,"drawn_count":0,"turn":0,"pending_draw":0,"has_drawn":false,"interrupt_open":false}"#;
    let msg: ServerMsg = serde_json::from_str(json).unwrap();
    let v = serde_json::to_value(&msg).unwrap();
    for key in [
        "player_index",
        "drawn_count",
        "turn",
        "pending_draw",
        "has_drawn",
        "interrupt_open",
    ] {
        assert!(v.get(key).is_some(), "{key} was dropped: {v}");
    }
}
