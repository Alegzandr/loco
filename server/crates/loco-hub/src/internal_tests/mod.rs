//! The hub's white-box tests: they reach the table's fields directly. The
//! socket-level tests live in `tests/`.

mod bot_finish_internal;
mod botcatch_internal;
mod botrecover_internal;
mod bottiming_internal;
mod catch_afk_internal;
mod converter;
mod gameplay_internal;
mod lifecycle;
mod match_history_internal;
mod suspect;
mod table_internal;
