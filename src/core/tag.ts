// The credit travels inside the file. Pure byte-level writers, one per
// container, each inserting the smallest standard metadata block a viewer will
// read: EXIF (JPEG APP1, WebP EXIF chunk), iTXt (PNG), a Comment Extension
// (GIF). Nothing here decodes pixels; each writer splices around the image data
// and the tests re-parse the result with an independent walk of the container.
//
// What survives where: photo libraries (Google Photos included) show EXIF/XMP
// description and author; social platforms strip metadata on upload, so the
// visible credit on a repost still comes from the Copy-credit line.

export interface Credit {
  readonly description: string;
  readonly author: string;
  readonly source: string;
}

const enc = new TextEncoder();
const ascii = (s: string): Uint8Array => enc.encode(s);

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const u16le = (n: number): Uint8Array => new Uint8Array([n & 0xff, (n >> 8) & 0xff]);
const u32le = (n: number): Uint8Array => new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]);
const u32be = (n: number): Uint8Array => new Uint8Array([(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
const u24le = (n: number): Uint8Array => new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff]);

/** EXIF strings must fit a JPEG segment: keep each value comfortably short. */
const clip = (s: string, max = 2000): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/**
 * A little-endian TIFF with IFD0 holding ImageDescription (0x010E), Artist
 * (0x013B) and Copyright (0x8298) as ASCII (UTF-8 bytes; readers cope).
 */
export function exifTiff(credit: Credit): Uint8Array {
  const fields: [number, Uint8Array][] = [
    [0x010e, ascii(`${clip(credit.description)}\0`)],
    [0x013b, ascii(`${clip(credit.author)}\0`)],
    [0x8298, ascii(`${clip(credit.source)}\0`)],
  ];
  const header = concat(ascii('II'), u16le(42), u32le(8));
  const ifdSize = 2 + fields.length * 12 + 4;
  let dataOffset = 8 + ifdSize;
  const entries: Uint8Array[] = [];
  const data: Uint8Array[] = [];
  for (const [tag, value] of fields) {
    const entry = concat(u16le(tag), u16le(2), u32le(value.length));
    if (value.length <= 4) {
      const inline = new Uint8Array(4);
      inline.set(value);
      entries.push(concat(entry, inline));
    } else {
      entries.push(concat(entry, u32le(dataOffset)));
      data.push(value);
      dataOffset += value.length;
    }
  }
  return concat(header, u16le(fields.length), ...entries, u32le(0), ...data);
}

const xml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function xmpPacket(credit: Credit): Uint8Array {
  const body =
    `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
    `<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">` +
    `<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${xml(credit.description)}</rdf:li></rdf:Alt></dc:description>` +
    `<dc:creator><rdf:Seq><rdf:li>${xml(credit.author)}</rdf:li></rdf:Seq></dc:creator>` +
    `<dc:source>${xml(credit.source)}</dc:source>` +
    `</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
  return ascii(body);
}

function jpegApp1(payload: Uint8Array): Uint8Array {
  const len = payload.length + 2;
  return concat(new Uint8Array([0xff, 0xe1, (len >> 8) & 0xff, len & 0xff]), payload);
}

function tagJpeg(bytes: Uint8Array, credit: Credit): Uint8Array {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
  // Does an APP1 Exif segment already exist? Walk the leading segments.
  let i = 2;
  let hasExif = false;
  while (i + 4 <= bytes.length && bytes[i] === 0xff && bytes[i + 1] !== 0xda) {
    const marker = bytes[i + 1] ?? 0;
    const len = ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0);
    if (marker === 0xe1 && String.fromCharCode(...bytes.subarray(i + 4, i + 8)) === 'Exif') hasExif = true;
    i += 2 + len;
  }
  // A fresh Exif block goes right after SOI; an XMP packet goes after the
  // existing leading APPn segments (the conventional order: Exif first, XMP after).
  const segment = hasExif ? jpegApp1(concat(ascii('http://ns.adobe.com/xap/1.0/\0'), xmpPacket(credit))) : jpegApp1(concat(ascii('Exif\0\0'), exifTiff(credit)));
  const at = hasExif ? i : 2;
  return concat(bytes.subarray(0, at), segment, bytes.subarray(at));
}

// CRC-32 (IEEE), as PNG requires over chunk type + data.
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = ascii(type);
  return concat(u32be(data.length), typeBytes, data, u32be(crc32(concat(typeBytes, data))));
}

function tagPng(bytes: Uint8Array, credit: Credit): Uint8Array {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!sig.every((b, i) => bytes[i] === b)) return bytes;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ihdrEnd = 8 + 12 + dv.getUint32(8);
  // iTXt: keyword \0 compression-flag(0) compression-method(0) language \0 translated-keyword \0 text (UTF-8)
  const itxt = (keyword: string, text: string): Uint8Array => pngChunk('iTXt', concat(ascii(`${keyword}\0`), new Uint8Array([0, 0]), ascii('\0\0'), ascii(text)));
  return concat(bytes.subarray(0, ihdrEnd), itxt('Description', credit.description), itxt('Author', credit.author), itxt('Source', credit.source), bytes.subarray(ihdrEnd));
}

function tagGif(bytes: Uint8Array, credit: Credit): Uint8Array {
  if (String.fromCharCode(...bytes.subarray(0, 3)) !== 'GIF') return bytes;
  const flags = bytes[10] ?? 0;
  const tableSize = flags & 0x80 ? 3 * (1 << ((flags & 0x07) + 1)) : 0;
  const at = 13 + tableSize;
  const text = ascii([credit.description, credit.author, credit.source].join('\n'));
  const blocks: Uint8Array[] = [];
  for (let i = 0; i < text.length; i += 255) {
    const part = text.subarray(i, i + 255);
    blocks.push(new Uint8Array([part.length]), part);
  }
  return concat(bytes.subarray(0, at), new Uint8Array([0x21, 0xfe]), ...blocks, new Uint8Array([0]), bytes.subarray(at));
}

/** Canvas size of a simple (non-VP8X) WebP from its first bitstream chunk. */
function webpSize(type: string, data: Uint8Array): { w: number; h: number } | null {
  if (type === 'VP8L' && data[0] === 0x2f) {
    const bits = (data[1] ?? 0) | ((data[2] ?? 0) << 8) | ((data[3] ?? 0) << 16) | ((data[4] ?? 0) << 24);
    return { w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (type === 'VP8 ' && data[3] === 0x9d && data[4] === 0x01 && data[5] === 0x2a) {
    return { w: ((data[6] ?? 0) | ((data[7] ?? 0) << 8)) & 0x3fff, h: ((data[8] ?? 0) | ((data[9] ?? 0) << 8)) & 0x3fff };
  }
  return null;
}

function riffChunk(type: string, data: Uint8Array): Uint8Array {
  return concat(ascii(type), u32le(data.length), data, data.length % 2 ? new Uint8Array([0]) : new Uint8Array(0));
}

function tagWebp(bytes: Uint8Array, credit: Credit): Uint8Array {
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'RIFF' || String.fromCharCode(...bytes.subarray(8, 12)) !== 'WEBP') return bytes;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const firstType = String.fromCharCode(...bytes.subarray(12, 16));
  const firstLen = dv.getUint32(16, true);
  const exif = riffChunk('EXIF', exifTiff(credit));
  let body: Uint8Array;
  if (firstType === 'VP8X') {
    const head = new Uint8Array(bytes.subarray(12, 12 + 8 + 10));
    head[8] = (head[8] ?? 0) | 0x08;
    body = concat(head, bytes.subarray(12 + 18), exif);
  } else {
    const size = webpSize(firstType, bytes.subarray(20, 20 + firstLen));
    if (!size) return bytes;
    const vp8x = riffChunk('VP8X', concat(new Uint8Array([0x08, 0, 0, 0]), u24le(size.w - 1), u24le(size.h - 1)));
    body = concat(vp8x, bytes.subarray(12), exif);
  }
  return concat(ascii('RIFF'), u32le(4 + body.length), ascii('WEBP'), body);
}

/** Embed the credit; an unknown type comes back untouched (same object). */
export function tagImage(bytes: Uint8Array, mime: string, credit: Credit): Uint8Array {
  switch (mime) {
    case 'image/jpeg':
      return tagJpeg(bytes, credit);
    case 'image/png':
      return tagPng(bytes, credit);
    case 'image/gif':
      return tagGif(bytes, credit);
    case 'image/webp':
      return tagWebp(bytes, credit);
    default:
      return bytes;
  }
}
