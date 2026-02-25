import { describe, it, expect } from 'bun:test';
import { encodeVarint, writeVarint, varintSize } from '../util/varint.ts';

describe('varint encoding', () => {
  it('encodes 0', () => {
    expect(encodeVarint(0n)).toEqual(new Uint8Array([0x00]));
  });

  it('encodes 1', () => {
    expect(encodeVarint(1n)).toEqual(new Uint8Array([0x01]));
  });

  it('encodes 127 as single byte', () => {
    expect(encodeVarint(127n)).toEqual(new Uint8Array([0x7f]));
  });

  it('encodes 128 as two bytes', () => {
    expect(encodeVarint(128n)).toEqual(new Uint8Array([0x80, 0x01]));
  });

  it('encodes 300', () => {
    // 300 = 0x12C → varint: 0xAC 0x02
    expect(encodeVarint(300n)).toEqual(new Uint8Array([0xac, 0x02]));
  });

  it('encodes large value (2^32)', () => {
    const val = 4294967296n; // 2^32
    const encoded = encodeVarint(val);
    // Decode manually to verify
    let result = 0n;
    let shift = 0n;
    for (const byte of encoded) {
      result |= BigInt(byte & 0x7f) << shift;
      shift += 7n;
    }
    expect(result).toBe(val);
  });

  it('varintSize matches encodeVarint length', () => {
    const testValues = [0n, 1n, 127n, 128n, 300n, 16383n, 16384n, 2097151n, 2097152n];
    for (const v of testValues) {
      expect(varintSize(v)).toBe(encodeVarint(v).length);
    }
  });

  it('writeVarint writes correctly', () => {
    const buf = new Uint8Array(10);
    const written = writeVarint(buf, 0, 300n);
    expect(written).toBe(2);
    expect(buf[0]).toBe(0xac);
    expect(buf[1]).toBe(0x02);
  });
});
