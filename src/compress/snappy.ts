import { compressSync, uncompressSync } from 'snappy';

export function snappyCompress(data: Uint8Array): Uint8Array {
  return compressSync(data);
}

export function snappyUncompress(data: Uint8Array): Uint8Array {
  return uncompressSync(data, { asBuffer: true }) as Buffer;
}
