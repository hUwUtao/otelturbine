import { describe, it, expect } from 'bun:test';
import { encodeWriteRequest } from '../proto/writeRequest.ts';
import type { WriteRequest, TimeSeries } from '../types/prometheus.ts';

describe('protobuf encoding', () => {
  it('encodes an empty WriteRequest', () => {
    const req: WriteRequest = { timeseries: [] };
    const encoded = encodeWriteRequest(req);
    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(encoded.length).toBe(0);
  });

  it('encodes a single TimeSeries with one label and one sample', () => {
    const req: WriteRequest = {
      timeseries: [
        {
          labels: [
            { name: '__name__', value: 'test_metric' },
          ],
          samples: [
            { value: 42.0, timestamp: 1000n },
          ],
        },
      ],
    };
    const encoded = encodeWriteRequest(req);
    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(encoded.length).toBeGreaterThan(0);
    // Field tag 0x0A = timeseries field 1
    expect(encoded[0]).toBe(0x0a);
  });

  it('produces non-zero output for valid series', () => {
    const ts: TimeSeries = {
      labels: [
        { name: '__name__', value: 'http_requests_total' },
        { name: 'method', value: 'GET' },
        { name: 'status', value: '200' },
      ],
      samples: [
        { value: 1234.5, timestamp: 1700000000000n },
      ],
    };
    const encoded = encodeWriteRequest({ timeseries: [ts] });
    expect(encoded.length).toBeGreaterThan(20);
  });

  it('double value is encoded as 8 bytes LE', () => {
    // Encode a known double: 1.0
    const req: WriteRequest = {
      timeseries: [
        {
          labels: [{ name: 'n', value: 'v' }],
          samples: [{ value: 1.0, timestamp: 0n }],
        },
      ],
    };
    const encoded = encodeWriteRequest(req);
    // Find the double bytes for 1.0: 3F F0 00 00 00 00 00 00 in BE, reversed for LE
    const buf = Buffer.from(encoded);
    // Search for 0x3F 0xF0 sequence (last 6 bytes would be 00s)
    let found = false;
    for (let i = 0; i < buf.length - 7; i++) {
      if (buf[i + 7] === 0x3f && buf[i + 6] === 0xf0) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it('encodes multiple time series', () => {
    const series: TimeSeries[] = Array.from({ length: 5 }, (_, i) => ({
      labels: [{ name: '__name__', value: `metric_${i}` }],
      samples: [{ value: i * 10.0, timestamp: BigInt(i * 1000) }],
    }));
    const encoded = encodeWriteRequest({ timeseries: series });
    expect(encoded.length).toBeGreaterThan(0);
    // Should have 5 repeated field 1 entries (each starting with 0x0A)
    let count = 0;
    // Count top-level 0x0A bytes (approximation)
    let i = 0;
    while (i < encoded.length) {
      const tag = encoded[i]!;
      i++;
      if (tag === 0x0a) {
        count++;
        // Read length varint
        let len = 0;
        let shift = 0;
        while (i < encoded.length) {
          const b = encoded[i++]!;
          len |= (b & 0x7f) << shift;
          shift += 7;
          if ((b & 0x80) === 0) break;
        }
        i += len;
      }
    }
    expect(count).toBe(5);
  });
});
