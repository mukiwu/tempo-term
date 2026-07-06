//! Protobuf wire reader for parsing trajectory binary data.
//!
//! This is a minimal, best-effort decoder for the protobuf wire format
//! (no schema, no external crate). It only needs to pull known field
//! numbers out of a byte blob, so it does not validate messages: any
//! decode error simply stops parsing early and returns the fields
//! collected so far.

/// A decoded protobuf field value, keyed by wire type.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProtoValue {
    /// Wire type 0.
    Varint(u64),
    /// Wire type 1.
    Fixed64(u64),
    /// Wire type 2 (length-delimited: bytes, strings, embedded messages).
    Bytes(Vec<u8>),
    /// Wire type 5.
    Fixed32(u32),
}

/// Reads a single wire-format varint starting at `pos`.
///
/// Returns the decoded value and the position just past it, or `None`
/// if the varint runs past the end of the buffer or exceeds 10 bytes
/// (the max length for a 64-bit varint).
fn read_varint(buf: &[u8], pos: usize) -> Option<(u64, usize)> {
    let mut result: u64 = 0;
    let mut shift: u32 = 0;
    let mut i = pos;
    loop {
        if i >= buf.len() || shift >= 70 {
            return None;
        }
        let byte = buf[i];
        i += 1;
        result |= ((byte & 0x7f) as u64) << shift;
        if byte & 0x80 == 0 {
            return Some((result, i));
        }
        shift += 7;
    }
}

/// Parses a buffer of consecutive protobuf fields into a flat list of
/// `(field_number, value)` pairs, in encounter order.
///
/// Best-effort: stops as soon as it hits a malformed tag, an unknown/
/// unsupported wire type (3, 4, 6, 7), an overlong varint, or a
/// length-delimited field whose length runs past the end of `buf`. In
/// every such case, the fields decoded up to that point are returned
/// rather than panicking or erroring out.
pub fn parse_fields(buf: &[u8]) -> Vec<(u32, ProtoValue)> {
    let mut fields = Vec::new();
    let mut pos = 0;

    while pos < buf.len() {
        let (tag, next_pos) = match read_varint(buf, pos) {
            Some(v) => v,
            None => break,
        };
        pos = next_pos;

        let field_no = (tag >> 3) as u32;
        let wire_type = tag & 0x7;

        match wire_type {
            0 => {
                let (value, next_pos) = match read_varint(buf, pos) {
                    Some(v) => v,
                    None => break,
                };
                pos = next_pos;
                fields.push((field_no, ProtoValue::Varint(value)));
            }
            1 => {
                if pos + 8 > buf.len() {
                    break;
                }
                let bytes: [u8; 8] = buf[pos..pos + 8].try_into().unwrap();
                pos += 8;
                fields.push((field_no, ProtoValue::Fixed64(u64::from_le_bytes(bytes))));
            }
            2 => {
                let (len, next_pos) = match read_varint(buf, pos) {
                    Some(v) => v,
                    None => break,
                };
                pos = next_pos;
                let len = len as usize;
                if pos + len > buf.len() {
                    break;
                }
                let data = buf[pos..pos + len].to_vec();
                pos += len;
                fields.push((field_no, ProtoValue::Bytes(data)));
            }
            5 => {
                if pos + 4 > buf.len() {
                    break;
                }
                let bytes: [u8; 4] = buf[pos..pos + 4].try_into().unwrap();
                pos += 4;
                fields.push((field_no, ProtoValue::Fixed32(u32::from_le_bytes(bytes))));
            }
            _ => break, // wire types 3/4 (group markers) and 6/7 (invalid): stop.
        }
    }

    fields
}

/// Returns the raw bytes of the first `Bytes` field matching `field_no`.
pub fn first_bytes<'a>(fields: &'a [(u32, ProtoValue)], field_no: u32) -> Option<&'a [u8]> {
    fields.iter().find_map(|(no, value)| {
        if *no != field_no {
            return None;
        }
        match value {
            ProtoValue::Bytes(data) => Some(data.as_slice()),
            _ => None,
        }
    })
}

/// Returns the value of the first `Varint` field matching `field_no`.
pub fn first_varint(fields: &[(u32, ProtoValue)], field_no: u32) -> Option<u64> {
    fields.iter().find_map(|(no, value)| {
        if *no != field_no {
            return None;
        }
        match value {
            ProtoValue::Varint(v) => Some(*v),
            _ => None,
        }
    })
}

/// Decodes a nested `google.protobuf.Timestamp`-shaped message stored as
/// the `Bytes` field `field_no` (seconds in sub-field 1, nanos in
/// sub-field 2), returning the value in milliseconds since epoch.
pub fn timestamp_ms(fields: &[(u32, ProtoValue)], field_no: u32) -> Option<i64> {
    let ts_bytes = first_bytes(fields, field_no)?;
    let ts_fields = parse_fields(ts_bytes);
    let seconds = first_varint(&ts_fields, 1)? as i64;
    let nanos = first_varint(&ts_fields, 2).unwrap_or(0) as i64;
    Some(seconds * 1000 + nanos / 1_000_000)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Test-only encoder helpers (wire format: tag = field_no << 3 | wire_type).
    fn varint(mut v: u64, out: &mut Vec<u8>) {
        loop {
            let byte = (v & 0x7f) as u8;
            v >>= 7;
            if v == 0 { out.push(byte); break; }
            out.push(byte | 0x80);
        }
    }
    fn field_varint(no: u32, v: u64, out: &mut Vec<u8>) {
        varint(((no as u64) << 3) | 0, out);
        varint(v, out);
    }
    fn field_bytes(no: u32, data: &[u8], out: &mut Vec<u8>) {
        varint(((no as u64) << 3) | 2, out);
        varint(data.len() as u64, out);
        out.extend_from_slice(data);
    }

    #[test]
    fn parses_varint_and_length_delimited_fields() {
        let mut buf = Vec::new();
        field_varint(3, 150, &mut buf);
        field_bytes(17, b"hello", &mut buf);
        let fields = parse_fields(&buf);
        assert_eq!(first_varint(&fields, 3), Some(150));
        assert_eq!(first_bytes(&fields, 17), Some(&b"hello"[..]));
    }

    #[test]
    fn decodes_a_nested_timestamp() {
        let mut ts = Vec::new();
        field_varint(1, 1_751_760_000, &mut ts); // seconds
        field_varint(2, 500_000_000, &mut ts);   // nanos
        let mut buf = Vec::new();
        field_bytes(5, &ts, &mut buf);
        let fields = parse_fields(&buf);
        assert_eq!(timestamp_ms(&fields, 5), Some(1_751_760_000_500));
    }

    #[test]
    fn malformed_input_yields_partial_fields_not_panic() {
        let mut buf = Vec::new();
        field_varint(1, 7, &mut buf);
        buf.extend_from_slice(&[0xff, 0xff]); // truncated garbage tail
        let fields = parse_fields(&buf);
        assert_eq!(first_varint(&fields, 1), Some(7));
    }

    #[test]
    fn skips_fixed32_and_fixed64_without_losing_position() {
        let mut buf = Vec::new();
        varint((2 << 3) | 1, &mut buf); buf.extend_from_slice(&8u64.to_le_bytes());
        varint((4 << 3) | 5, &mut buf); buf.extend_from_slice(&9u32.to_le_bytes());
        field_varint(6, 1, &mut buf);
        let fields = parse_fields(&buf);
        assert_eq!(first_varint(&fields, 6), Some(1));
    }
}
