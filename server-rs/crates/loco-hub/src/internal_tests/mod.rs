//! The white-box half of `server/hub/`'s tests (Go's `package hub` files),
//! one module per Go file. They reach the table's fields directly, the way
//! the Go ones did; the socket-level tests live in `tests/`.

mod bot_finish_internal;
mod botcatch_internal;
mod botrecover_internal;
mod bottiming_internal;
mod catch_afk_internal;
mod converter;
mod gameplay_internal;
mod match_history_internal;
mod suspect;
mod table_internal;
