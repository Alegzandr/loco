//! The two draws the domain makes, written here rather than taken from `rand`.
//!
//! `rand` with its default features pulls `getrandom`, which does not build for
//! `wasm32-unknown-unknown`, and the crate needs nothing from it but a uniform
//! index and a shuffle. Owning both also pins the sequence a seed produces: a
//! dependency bump can never change which cards a seeded room deals, so the
//! `insta` snapshot of a scripted round stays a statement about the rules.

use rand_core::Rng;

/// A uniform index in `0..n`, without modulo bias. `n` must be positive.
pub(crate) fn below<R: Rng + ?Sized>(rng: &mut R, n: usize) -> usize {
    assert!(n > 0, "below(0) has no answer");
    let n = n as u64;
    // The largest multiple of n that fits: values at or above it are redrawn,
    // so every residue is equally likely.
    let zone = u64::MAX - (u64::MAX % n);
    loop {
        let v = rng.next_u64();
        if v < zone {
            return (v % n) as usize;
        }
    }
}

/// Fisher–Yates, in place.
pub(crate) fn shuffle<T, R: Rng + ?Sized>(rng: &mut R, items: &mut [T]) {
    for i in (1..items.len()).rev() {
        let j = below(rng, i + 1);
        items.swap(i, j);
    }
}

/// True with probability `percent / 100`.
pub(crate) fn chance<R: Rng + ?Sized>(rng: &mut R, percent: usize) -> bool {
    below(rng, 100) < percent
}
