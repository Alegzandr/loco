//! The socket edge: the upgrade and its admission checks, the extractor that
//! decides a peer's network, the per-socket pumps and rate limit, and the wire
//! encoding. Nothing here knows the rules of the game.

pub mod client;
pub mod privacy;
pub mod serve;
pub mod wire;
