/**
 * LEB128 varint encoding for protobuf wire format.
 */

/** Write a varint for a non-negative JS number (no BigInt overhead). */
export function writeIntVarint(buf: Uint8Array, offset: number, value: number): number {
  let i = offset;
  while (value > 0x7f) {
    buf[i++] = (value & 0x7f) | 0x80;
    value >>>= 7;
  }
  buf[i++] = value;
  return i - offset;
}

/** Byte length of a non-negative JS number varint. */
export function intVarintSize(n: number): number {
  if (n < 0x80) return 1;
  if (n < 0x4000) return 2;
  if (n < 0x200000) return 3;
  if (n < 0x10000000) return 4;
  return 5; // up to ~4 GB, sufficient for proto field sizes
}

/**
 * LEB128 varint encoding for protobuf wire format.
 * Encodes a BigInt as a variable-length integer into a Uint8Array.
 */
export function encodeVarint(value: bigint): Uint8Array {
  if (value < 0n) {
    // For negative numbers, encode as 64-bit two's complement (10 bytes)
    value = BigInt.asUintN(64, value);
  }

  const bytes: number[] = [];
  do {
    let byte = Number(value & 0x7fn);
    value >>= 7n;
    if (value !== 0n) {
      byte |= 0x80;
    }
    bytes.push(byte);
  } while (value !== 0n);

  return new Uint8Array(bytes);
}

/**
 * Write a varint into a pre-allocated buffer at the given offset.
 * Returns the number of bytes written.
 */
export function writeVarint(buf: Uint8Array, offset: number, value: bigint): number {
  if (value < 0n) {
    value = BigInt.asUintN(64, value);
  }
  let i = offset;
  do {
    let byte = Number(value & 0x7fn);
    value >>= 7n;
    if (value !== 0n) {
      byte |= 0x80;
    }
    buf[i++] = byte;
  } while (value !== 0n);
  return i - offset;
}

/**
 * Calculate the byte length of a varint encoding without allocating.
 */
export function varintSize(value: bigint): number {
  if (value < 0n) value = BigInt.asUintN(64, value);
  if (value === 0n) return 1;
  let size = 0;
  while (value > 0n) {
    size++;
    value >>= 7n;
  }
  return size;
}
