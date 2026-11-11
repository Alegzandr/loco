//! The domain's tests, one module per subject. In-crate rather than under
//! `tests/` because they read crate-private state (`deal_round`,
//! `catch_offer_key`, the room's source).

mod support;

mod audit_fixes_test;
mod bot_interrupt_test;
mod bot_test;
mod card_test;
mod catch_window_test;
mod deck_test;
mod draw_exhaustion_test;
mod forfeit_test;
mod loco_finish_test;
mod maps_test;
mod match_format_test;
mod nickname_test;
mod retire_test;
mod rng_test;
mod room_test;
mod room_test_part2;
mod rules_test;
mod screen_test;
mod state_mismatch_test;

mod api_test;
mod proptests;
mod scripted_round;
mod serde_test;
