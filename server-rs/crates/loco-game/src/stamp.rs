//! Instants on the wire of the drain snapshot.
//!
//! The domain keeps time as Unix milliseconds, but the snapshot is Go's
//! `json.Marshal(game.Room)`, where every `time.Time` is an RFC 3339 string and
//! the zero time (`0001-01-01T00:00:00Z`) means "never". These helpers write
//! and read that shape so a snapshot written by either server restores on the
//! other: `None` is the zero time, `Some(ms)` an instant, written in UTC with
//! the fraction trimmed the way Go's `RFC3339Nano` trims it. A Go instant with
//! sub-millisecond digits is truncated to the millisecond on the way in.

use crate::Millis;
use serde::{Deserialize, Deserializer, Serializer, de::Error as _};

/// Go's zero `time.Time`, as it marshals.
pub const GO_ZERO_TIME: &str = "0001-01-01T00:00:00Z";

const MS_PER_DAY: i64 = 86_400_000;

/// Days since 1970-01-01 for a proleptic Gregorian date (Howard Hinnant).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// An instant as Go's `RFC3339Nano` writes it in UTC.
pub fn format_rfc3339(ms: Millis) -> String {
    let days = ms.div_euclid(MS_PER_DAY);
    let rem = ms.rem_euclid(MS_PER_DAY);
    let (y, mo, d) = civil_from_days(days);
    let (h, mi, s, frac) = (
        rem / 3_600_000,
        rem / 60_000 % 60,
        rem / 1000 % 60,
        rem % 1000,
    );
    let mut out = format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}");
    if frac != 0 {
        let f = format!("{frac:03}");
        out.push('.');
        out.push_str(f.trim_end_matches('0'));
    }
    out.push('Z');
    out
}

fn num(s: &str) -> Option<i64> {
    if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    s.parse().ok()
}

/// Parses an RFC 3339 instant (any offset, any fraction) to Unix
/// milliseconds, truncating below the millisecond.
pub fn parse_rfc3339(s: &str) -> Option<Millis> {
    let b = s.as_bytes();
    if b.len() < 20 || b[4] != b'-' || b[7] != b'-' || !matches!(b[10], b'T' | b't') {
        return None;
    }
    if b[13] != b':' || b[16] != b':' {
        return None;
    }
    let y = num(&s[0..4])?;
    let mo = num(&s[5..7])?;
    let d = num(&s[8..10])?;
    let h = num(&s[11..13])?;
    let mi = num(&s[14..16])?;
    let sec = num(&s[17..19])?;
    let mut rest = &s[19..];
    let mut frac_ms = 0i64;
    if let Some(r) = rest.strip_prefix('.') {
        let end = r.find(|c: char| !c.is_ascii_digit()).unwrap_or(r.len());
        if end == 0 {
            return None;
        }
        let digits = &r[..end];
        let mut padded = String::from(&digits[..digits.len().min(3)]);
        while padded.len() < 3 {
            padded.push('0');
        }
        frac_ms = num(&padded)?;
        rest = &r[end..];
    }
    let offset_ms = match rest {
        "Z" | "z" => 0,
        _ => {
            let rb = rest.as_bytes();
            if rb.len() != 6 || rb[3] != b':' {
                return None;
            }
            let sign = match rb[0] {
                b'+' => 1,
                b'-' => -1,
                _ => return None,
            };
            sign * (num(&rest[1..3])? * 3_600_000 + num(&rest[4..6])? * 60_000)
        }
    };
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || h > 23 || mi > 59 || sec > 60 {
        return None;
    }
    let days = days_from_civil(y, mo, d);
    Some(days * MS_PER_DAY + h * 3_600_000 + mi * 60_000 + sec * 1000 + frac_ms - offset_ms)
}

/// Go's zero time, in milliseconds. Anything at or before it reads as "never".
pub const GO_ZERO_MS: Millis = -62_135_596_800_000;

fn to_opt(ms: Millis) -> Option<Millis> {
    if ms <= GO_ZERO_MS { None } else { Some(ms) }
}

fn parse_opt<E: serde::de::Error>(s: &str) -> Result<Option<Millis>, E> {
    parse_rfc3339(s)
        .map(to_opt)
        .ok_or_else(|| E::custom(format!("invalid RFC 3339 instant: {s}")))
}

/// `Option<Millis>` as a Go `time.Time`.
pub mod opt {
    use super::*;

    pub fn serialize<S: Serializer>(v: &Option<Millis>, s: S) -> Result<S::Ok, S::Error> {
        match v {
            Some(ms) => s.serialize_str(&format_rfc3339(*ms)),
            None => s.serialize_str(GO_ZERO_TIME),
        }
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Millis>, D::Error> {
        let s = Option::<String>::deserialize(d)?;
        match s {
            None => Ok(None),
            Some(s) => parse_opt(&s),
        }
    }
}

/// `Millis` as a Go `time.Time` that is always set.
pub mod req {
    use super::*;

    pub fn serialize<S: Serializer>(v: &Millis, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&format_rfc3339(*v))
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Millis, D::Error> {
        let s = String::deserialize(d)?;
        parse_rfc3339(&s).ok_or_else(|| D::Error::custom(format!("invalid RFC 3339 instant: {s}")))
    }
}

/// `Vec<Option<Millis>>` as a Go `[]time.Time` (null reads as empty).
pub mod opt_vec {
    use super::*;
    use serde::ser::SerializeSeq;

    pub fn serialize<S: Serializer>(v: &[Option<Millis>], s: S) -> Result<S::Ok, S::Error> {
        let mut seq = s.serialize_seq(Some(v.len()))?;
        for t in v {
            match t {
                Some(ms) => seq.serialize_element(&format_rfc3339(*ms))?,
                None => seq.serialize_element(GO_ZERO_TIME)?,
            }
        }
        seq.end()
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<Option<Millis>>, D::Error> {
        let v = Option::<Vec<String>>::deserialize(d)?.unwrap_or_default();
        v.iter().map(|s| parse_opt(s)).collect()
    }
}

/// A Go slice that may be `null`: read as empty, written as an array.
pub mod nullable {
    use serde::{Deserialize, Deserializer};

    pub fn deserialize<'de, D, T>(d: D) -> Result<Vec<T>, D::Error>
    where
        D: Deserializer<'de>,
        T: Deserialize<'de>,
    {
        Ok(Option::<Vec<T>>::deserialize(d)?.unwrap_or_default())
    }
}

/// A Go slice the room leaves `nil` until a match starts: read `null` as
/// empty, write empty as `null`, so a lobby's snapshot keeps Go's shape.
pub mod nil_when_empty {
    use serde::{Serialize, Serializer};

    pub fn serialize<S: Serializer, T: Serialize>(v: &[T], s: S) -> Result<S::Ok, S::Error> {
        if v.is_empty() {
            s.serialize_none()
        } else {
            v.serialize(s)
        }
    }

    pub use super::nullable::deserialize;
}

#[cfg(test)]
mod unit {
    use super::*;

    #[test]
    fn round_trips_instants() {
        for ms in [0, 1, 999, 1_700_000_000_123, 1_700_000_000_120, -1] {
            assert_eq!(parse_rfc3339(&format_rfc3339(ms)), Some(ms), "{ms}");
        }
        assert_eq!(format_rfc3339(1_700_000_000_120), "2023-11-14T22:13:20.12Z");
        assert_eq!(parse_rfc3339(GO_ZERO_TIME), Some(GO_ZERO_MS));
        assert_eq!(
            parse_rfc3339("2023-11-14T23:13:20.123456789+01:00"),
            Some(1_700_000_000_123)
        );
    }
}
