import { describe, it, expect } from 'vitest';
import { crc32 as zlibCrc32 } from 'node:zlib';
import { tagImage, exifTiff, type Credit } from '../../src/core/tag';

// The credit travels inside the file: EXIF for JPEG and WebP, iTXt for PNG, a
// comment block for GIF. Each test re-parses the bytes it produced with an
// independent walk of the container, so a writer that lies about a length or a
// CRC fails here rather than in a viewer.

const CREDIT: Credit = {
  description: 'Dad jokes — via u/someredditor on r/GuysBeingDudes',
  author: 'u/someredditor',
  source: 'https://www.reddit.com/r/GuysBeingDudes/comments/1vys36f/dad_jokes/',
};
const b64 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'base64'));
// The smallest valid files of each kind (1×1).
const JPEG = b64('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=');
const PNG = b64('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==');
const GIF = b64('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');
const WEBP = b64('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==');

const ascii = (u: Uint8Array, start: number, end: number): string => Buffer.from(u.subarray(start, end)).toString('latin1');

/** Every JPEG segment as [marker, payload]. */
function jpegSegments(u: Uint8Array): { marker: number; payload: Uint8Array }[] {
  expect(u[0]).toBe(0xff);
  expect(u[1]).toBe(0xd8);
  const out: { marker: number; payload: Uint8Array }[] = [];
  let i = 2;
  while (i < u.length && u[i] === 0xff) {
    const marker = u[i + 1] ?? 0;
    if (marker === 0xda) break; // start of scan: entropy data follows
    const len = ((u[i + 2] ?? 0) << 8) | (u[i + 3] ?? 0);
    out.push({ marker, payload: u.subarray(i + 4, i + 2 + len) });
    i += 2 + len;
  }
  return out;
}

/** ASCII tag values out of a little-endian TIFF: tag → string. */
function tiffStrings(t: Uint8Array): Record<number, string> {
  const dv = new DataView(t.buffer, t.byteOffset, t.byteLength);
  expect(ascii(t, 0, 2)).toBe('II');
  expect(dv.getUint16(2, true)).toBe(42);
  const ifd = dv.getUint32(4, true);
  const n = dv.getUint16(ifd, true);
  const out: Record<number, string> = {};
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + k * 12;
    const tag = dv.getUint16(e, true);
    const type = dv.getUint16(e + 2, true);
    const count = dv.getUint32(e + 4, true);
    const off = count <= 4 ? e + 8 : dv.getUint32(e + 8, true);
    if (type === 2) out[tag] = Buffer.from(t.subarray(off, off + count - 1)).toString('utf8');
  }
  return out;
}

describe('exifTiff', () => {
  it('writes ImageDescription, Artist and Copyright as a valid little-endian TIFF', () => {
    const strings = tiffStrings(exifTiff(CREDIT));
    expect(strings[0x010e]).toBe(CREDIT.description);
    expect(strings[0x013b]).toBe(CREDIT.author);
    expect(strings[0x8298]).toBe(CREDIT.source);
  });
});

describe('tagImage', () => {
  it('JPEG: an APP1 Exif segment right after SOI, the image data untouched', () => {
    const out = tagImage(JPEG, 'image/jpeg', CREDIT);
    const segs = jpegSegments(out);
    expect(segs[0]?.marker).toBe(0xe1);
    expect(ascii(segs[0]?.payload ?? new Uint8Array(), 0, 6)).toBe('Exif\0\0');
    expect(tiffStrings((segs[0]?.payload ?? new Uint8Array()).subarray(6))[0x010e]).toBe(CREDIT.description);
    // Everything after the inserted segment is the original file minus its SOI.
    const insertedLen = 2 + 2 + (segs[0]?.payload.length ?? 0);
    expect(Buffer.from(out.subarray(2 + insertedLen)).equals(Buffer.from(JPEG.subarray(2)))).toBe(true);
  });

  it('JPEG that already carries Exif keeps it and gains an XMP packet instead', () => {
    const once = tagImage(JPEG, 'image/jpeg', CREDIT);
    const twice = tagImage(once, 'image/jpeg', { ...CREDIT, description: 'second' });
    const app1 = jpegSegments(twice).filter((s) => s.marker === 0xe1);
    expect(app1.length).toBe(2);
    expect(ascii(app1[1]?.payload ?? new Uint8Array(), 0, 29)).toBe('http://ns.adobe.com/xap/1.0/\0');
    expect(Buffer.from(app1[1]?.payload ?? new Uint8Array()).toString('utf8')).toContain('<dc:description>');
    expect(Buffer.from(app1[1]?.payload ?? new Uint8Array()).toString('utf8')).toContain('second');
  });

  it('PNG: iTXt chunks after IHDR with correct lengths and CRCs', () => {
    const out = tagImage(PNG, 'image/png', CREDIT);
    expect(Buffer.from(out.subarray(0, 8)).equals(Buffer.from(PNG.subarray(0, 8)))).toBe(true);
    const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
    const chunks: { type: string; data: Uint8Array; crc: number }[] = [];
    let i = 8;
    while (i < out.length) {
      const len = dv.getUint32(i);
      const type = ascii(out, i + 4, i + 8);
      chunks.push({ type, data: out.subarray(i + 8, i + 8 + len), crc: dv.getUint32(i + 8 + len) });
      i += 12 + len;
    }
    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'iTXt', 'iTXt', 'iTXt', 'IDAT', 'IEND']);
    const texts = chunks.filter((c) => c.type === 'iTXt').map((c) => Buffer.from(c.data).toString('utf8'));
    expect(texts[0]).toBe(`Description\0\0\0\0\0${CREDIT.description}`);
    expect(texts[1]).toBe(`Author\0\0\0\0\0${CREDIT.author}`);
    expect(texts[2]).toBe(`Source\0\0\0\0\0${CREDIT.source}`);
    // CRC covers type + data; recompute independently (zlib's crc32 over the same bytes).
    for (const c of chunks) expect(c.crc).toBe(zlibCrc32(Buffer.concat([Buffer.from(c.type, 'latin1'), Buffer.from(c.data)])) >>> 0);
  });

  it('GIF: a Comment Extension before the first image descriptor', () => {
    const out = tagImage(GIF, 'image/gif', CREDIT);
    expect(ascii(out, 0, 6)).toBe('GIF89a');
    // Header 6 + LSD 7 + global colour table (2 entries × 3) = 19; the comment goes there.
    expect(out[19]).toBe(0x21);
    expect(out[20]).toBe(0xfe);
    const len = out[21] ?? 0;
    expect(Buffer.from(out.subarray(22, 22 + len)).toString('utf8')).toBe(`${CREDIT.description}\n${CREDIT.author}\n${CREDIT.source}`);
    expect(out[22 + len]).toBe(0);
    expect(Buffer.from(out.subarray(23 + len)).equals(Buffer.from(GIF.subarray(19)))).toBe(true);
  });

  it('WebP: a simple VP8L file is promoted to VP8X with the EXIF flag and an EXIF chunk', () => {
    const out = tagImage(WEBP, 'image/webp', CREDIT);
    const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
    expect(ascii(out, 0, 4)).toBe('RIFF');
    expect(dv.getUint32(4, true)).toBe(out.length - 8);
    expect(ascii(out, 8, 12)).toBe('WEBP');
    expect(ascii(out, 12, 16)).toBe('VP8X');
    expect(dv.getUint32(16, true)).toBe(10);
    expect((out[20] ?? 0) & 0x08).toBe(0x08); // EXIF flag
    const w = 1 + ((out[24] ?? 0) | ((out[25] ?? 0) << 8) | ((out[26] ?? 0) << 16));
    const h = 1 + ((out[27] ?? 0) | ((out[28] ?? 0) << 8) | ((out[29] ?? 0) << 16));
    expect([w, h]).toEqual([1, 1]);
    // Walk chunks: VP8X, VP8L (the original), EXIF.
    const types: string[] = [];
    let i = 12;
    let exif: Uint8Array | null = null;
    while (i < out.length) {
      const type = ascii(out, i, i + 4);
      const len = dv.getUint32(i + 4, true);
      types.push(type);
      if (type === 'EXIF') exif = out.subarray(i + 8, i + 8 + len);
      i += 8 + len + (len % 2);
    }
    expect(types).toEqual(['VP8X', 'VP8L', 'EXIF']);
    expect(tiffStrings(exif ?? new Uint8Array())[0x013b]).toBe(CREDIT.author);
  });

  it('an unknown image type is returned untouched', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(tagImage(bytes, 'image/bmp', CREDIT)).toBe(bytes);
  });
});
