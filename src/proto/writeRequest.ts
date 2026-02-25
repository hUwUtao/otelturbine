/**
 * Two-pass protobuf encoder for Prometheus WriteRequest.
 *
 * Pass 1 — size calculation: walks the structure using integer math and
 *   Buffer.byteLength (native, non-allocating) to compute the exact total
 *   byte count. No heap allocations.
 *
 * Pass 2 — single-allocation write: allocates exactly one Uint8Array, then
 *   writes every field directly into it using TextEncoder.encodeInto() and
 *   writeIntVarint(). Zero intermediate buffers, zero copies.
 *
 * Proto schema:
 *   message Label       { string name = 1; string value = 2; }
 *   message Sample      { double value = 1; int64 timestamp = 2; }
 *   message TimeSeries  { repeated Label labels = 1; repeated Sample samples = 2; }
 *   message WriteRequest { repeated TimeSeries timeseries = 1; }
 */

import type { WriteRequest, TimeSeries, Label, Sample } from '../types/prometheus.ts';
import { writeIntVarint, intVarintSize, writeVarint, varintSize } from '../util/varint.ts';

const ENC = new TextEncoder();

// ─── Size calculation (pass 1) ──────────────────────────────────────────────

function tsSize(ts: bigint): number {
  // Fast path: timestamps in ms since epoch fit in JS safe integer range
  return ts <= 9_007_199_254_740_991n ? intVarintSize(Number(ts)) : varintSize(ts);
}

function labelMsgSize(l: Label): number {
  const nl = Buffer.byteLength(l.name);
  const vl = Buffer.byteLength(l.value);
  // tag(1) + varint(nl) + nl  +  tag(1) + varint(vl) + vl
  return 1 + intVarintSize(nl) + nl + 1 + intVarintSize(vl) + vl;
}

function sampleMsgSize(s: Sample): number {
  // field1 double: tag(1) + 8 bytes
  // field2 timestamp: tag(1) + varint(ts)
  return 9 + 1 + tsSize(s.timestamp);
}

function timeSeriesMsgSize(ts: TimeSeries): number {
  let size = 0;
  for (const l of ts.labels) {
    const lms = labelMsgSize(l);
    size += 1 + intVarintSize(lms) + lms;
  }
  for (const s of ts.samples) {
    const sms = sampleMsgSize(s);
    size += 1 + intVarintSize(sms) + sms;
  }
  return size;
}

function computeTotalSize(req: WriteRequest): number {
  let size = 0;
  for (const ts of req.timeseries) {
    const tsms = timeSeriesMsgSize(ts);
    size += 1 + intVarintSize(tsms) + tsms;
  }
  return size;
}

// ─── Write pass (pass 2) ────────────────────────────────────────────────────

function writeLabel(buf: Uint8Array, off: number, l: Label): number {
  buf[off++] = 0x0a; // field 1 (name), LEN
  const nl = Buffer.byteLength(l.name);
  off += writeIntVarint(buf, off, nl);
  ENC.encodeInto(l.name, buf.subarray(off));
  off += nl;

  buf[off++] = 0x12; // field 2 (value), LEN
  const vl = Buffer.byteLength(l.value);
  off += writeIntVarint(buf, off, vl);
  ENC.encodeInto(l.value, buf.subarray(off));
  off += vl;

  return off;
}

function writeSample(buf: Uint8Array, view: DataView, off: number, s: Sample): number {
  buf[off++] = 0x09; // field 1 (value), 64-bit fixed
  view.setFloat64(off, s.value, true /* LE */);
  off += 8;

  buf[off++] = 0x10; // field 2 (timestamp), varint
  const ts = s.timestamp;
  if (ts <= 9_007_199_254_740_991n) {
    off += writeIntVarint(buf, off, Number(ts));
  } else {
    off += writeVarint(buf, off, ts);
  }
  return off;
}

function writeTimeSeries(buf: Uint8Array, view: DataView, off: number, ts: TimeSeries): number {
  for (const l of ts.labels) {
    buf[off++] = 0x0a; // field 1 (labels), LEN
    const lms = labelMsgSize(l);
    off += writeIntVarint(buf, off, lms);
    off = writeLabel(buf, off, l);
  }
  for (const s of ts.samples) {
    buf[off++] = 0x12; // field 2 (samples), LEN
    const sms = sampleMsgSize(s);
    off += writeIntVarint(buf, off, sms);
    off = writeSample(buf, view, off, s);
  }
  return off;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function encodeWriteRequest(req: WriteRequest): Uint8Array {
  if (req.timeseries.length === 0) return new Uint8Array(0);

  const totalSize = computeTotalSize(req);
  const buf = new Uint8Array(totalSize);
  const view = new DataView(buf.buffer); // one DataView for the entire buffer

  let off = 0;
  for (const ts of req.timeseries) {
    buf[off++] = 0x0a; // field 1 (timeseries), LEN
    const tsms = timeSeriesMsgSize(ts);
    off += writeIntVarint(buf, off, tsms);
    off = writeTimeSeries(buf, view, off, ts);
  }

  return buf;
}
