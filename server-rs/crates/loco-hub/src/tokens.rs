//! Room codes and session tokens. Both come from the operating system's
//! generator and neither has a fallback: the code is the only thing guarding a
//! private table and the token the only proof behind a seat reclaim. Port of
//! `server/hub/tokens.go`.

use rand::TryRngCore;
use rand::rngs::OsRng;
use subtle::ConstantTimeEq;

/// The 32 characters a table code is drawn from: no `0`/`O`, no `1`/`I`.
/// Identical to Go's, which `client/src/components/tableCodeRules.ts` mirrors.
pub const ROOM_CODE_ALPHABET: &[u8; 32] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/// How many characters a table code has.
pub const ROOM_CODE_LEN: usize = 6;

/// Fills `buf` from the OS. There is no weaker fallback, and there must not be
/// one: a token degraded to a predictable source on an error path would turn
/// the one authentication check in the game into a guessable number. An OS that
/// cannot produce entropy is a server that cannot issue a trustworthy token,
/// and panicking is the correct outcome — the job's `catch_unwind` turns it
/// into a refused message rather than a dead process.
fn os_fill(buf: &mut [u8]) {
    OsRng
        .try_fill_bytes(buf)
        .expect("the operating system's random source failed");
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// A cryptographically random 32-hex-character token.
pub fn generate_session_token() -> String {
    let mut b = [0u8; 16];
    os_fill(&mut b);
    hex(&b)
}

/// A short (8-hex-character) tag for log correlation. Not used for security;
/// uniqueness within a server lifetime is sufficient.
pub fn generate_conn_id() -> String {
    let mut b = [0u8; 4];
    os_fill(&mut b);
    hex(&b)
}

/// A uniformly distributed index in `[0, n)`. The mask-and-retry keeps the
/// distribution flat for any `n`; for the 32-character alphabet the mask is
/// exact and nothing is ever redrawn.
pub fn rand_index(n: usize) -> usize {
    if n <= 1 {
        return 0;
    }
    let mask = n.next_power_of_two() - 1;
    loop {
        let mut b = [0u8; 1];
        os_fill(&mut b);
        let v = usize::from(b[0]) & mask;
        if v < n {
            return v;
        }
    }
}

/// A 6-character code no live table holds. `taken` is asked about every draw.
pub fn generate_code(taken: impl Fn(&str) -> bool) -> String {
    loop {
        let code: String = (0..ROOM_CODE_LEN)
            .map(|_| char::from(ROOM_CODE_ALPHABET[rand_index(ROOM_CODE_ALPHABET.len())]))
            .collect();
        if !taken(&code) {
            return code;
        }
    }
}

/// Whether `token` matches what was stored for a seat. Constant time, not
/// `==`: this is the only identity check the game has, and an equality that
/// returns on the first differing byte is the kind of thing only ever noticed
/// after it matters. An empty value on either side never matches.
pub fn tokens_match(stored: Option<&str>, token: &str) -> bool {
    match stored {
        Some(s) if !s.is_empty() && !token.is_empty() => {
            bool::from(s.as_bytes().ct_eq(token.as_bytes()))
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn a_session_token_is_128_bits_of_hex() {
        let t = generate_session_token();
        assert_eq!(t.len(), 32);
        assert!(
            t.bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        );
        assert_ne!(t, generate_session_token(), "two tokens were the same");
    }

    #[test]
    fn a_conn_id_is_eight_hex_characters() {
        let c = generate_conn_id();
        assert_eq!(c.len(), 8);
        assert!(c.bytes().all(|b| b.is_ascii_hexdigit()));
    }

    #[test]
    fn a_room_code_is_six_characters_of_the_alphabet() {
        for _ in 0..200 {
            let code = generate_code(|_| false);
            assert_eq!(code.len(), ROOM_CODE_LEN);
            assert!(
                code.bytes().all(|b| ROOM_CODE_ALPHABET.contains(&b)),
                "{code}"
            );
        }
    }

    // The alphabet is the one the client validates against and the one every
    // printed code has used since the Go server. Changing it is a protocol
    // change, not a tidy-up.
    #[test]
    fn the_alphabet_is_the_go_one() {
        assert_eq!(ROOM_CODE_ALPHABET, b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789");
        let unique: HashSet<_> = ROOM_CODE_ALPHABET.iter().collect();
        assert_eq!(unique.len(), 32);
    }

    #[test]
    fn a_code_already_taken_is_never_handed_out() {
        let first = generate_code(|_| false);
        let second = generate_code(|c| c == first);
        assert_ne!(first, second);
    }

    // Every letter is reachable and none is favoured beyond noise: a skewed draw
    // narrows the space a sweep has to search.
    #[test]
    fn rand_index_covers_the_whole_range() {
        let mut seen = [0usize; 32];
        for _ in 0..32 * 200 {
            seen[rand_index(32)] += 1;
        }
        assert!(seen.iter().all(|&n| n > 100), "a skewed draw: {seen:?}");
        for n in [1, 2, 3, 7, 33] {
            for _ in 0..100 {
                assert!(rand_index(n) < n);
            }
        }
    }

    #[test]
    fn tokens_match_only_on_an_exact_non_empty_value() {
        assert!(tokens_match(Some("abc"), "abc"));
        assert!(!tokens_match(Some("abc"), "abd"));
        assert!(!tokens_match(Some("abc"), "ab"));
        assert!(!tokens_match(Some(""), ""));
        assert!(!tokens_match(None, "abc"));
        assert!(!tokens_match(Some("abc"), ""));
    }
}
