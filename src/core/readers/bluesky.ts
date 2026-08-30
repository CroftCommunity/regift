// A Bluesky post through public, CORS-open endpoints (measured 2026-08-30): the
// AppView for the post, plc.directory (or did:web) for the PDS, and the PDS
// getBlob for the ORIGINAL bytes — the file the person uploaded, already muxed.
// cdn.bsky.app sends no CORS, so images come from the PDS the same way.
import type { Courier } from '../ports';
import { extensionFor, type MediaItem, type Post } from '../post';

const APPVIEW = 'https://public.api.bsky.app/xrpc';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null;
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

async function json(courier: Courier, url: string): Promise<unknown> {
  return JSON.parse(await courier.text(url)) as unknown;
}

async function resolveDid(actor: string, courier: Courier): Promise<string> {
  if (actor.startsWith('did:')) return actor;
  const r = await json(courier, `${APPVIEW}/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(actor)}`);
  const did = isObj(r) ? str(r['did']) : null;
  if (!did) throw new Error(`bluesky: could not resolve ${actor}`);
  return did;
}

async function pdsFor(did: string, courier: Courier): Promise<string> {
  const docUrl = did.startsWith('did:web:')
    ? `https://${did.slice('did:web:'.length)}/.well-known/did.json`
    : `https://plc.directory/${encodeURIComponent(did)}`;
  const doc = await json(courier, docUrl);
  const services = isObj(doc) && Array.isArray(doc['service']) ? (doc['service'] as unknown[]) : [];
  for (const s of services) {
    if (isObj(s) && s['id'] === '#atproto_pds' && typeof s['serviceEndpoint'] === 'string') return s['serviceEndpoint'];
  }
  throw new Error(`bluesky: no PDS in the DID document for ${did}`);
}

const blobUrl = (pds: string, did: string, cid: string): string =>
  `${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`;

function blobRef(v: unknown): { cid: string; mime: string } | null {
  if (!isObj(v) || !isObj(v['ref'])) return null;
  const cid = str(v['ref']['$link']);
  return cid ? { cid, mime: str(v['mimeType']) ?? 'application/octet-stream' } : null;
}

/** The media blobs in a record's embed (video, images, or either wrapped with a quote). */
function embedBlobs(embed: unknown): { cid: string; mime: string }[] {
  if (!isObj(embed)) return [];
  const type = str(embed['$type']) ?? '';
  if (type === 'app.bsky.embed.recordWithMedia') return embedBlobs(embed['media']);
  if (type === 'app.bsky.embed.video') {
    const b = blobRef(embed['video']);
    return b ? [b] : [];
  }
  if (type === 'app.bsky.embed.images' && Array.isArray(embed['images'])) {
    return (embed['images'] as unknown[]).map((i) => (isObj(i) ? blobRef(i['image']) : null)).filter((b): b is { cid: string; mime: string } => b !== null);
  }
  return [];
}

export async function readBluesky(link: { readonly actor: string; readonly rkey: string }, courier: Courier): Promise<Post> {
  const did = await resolveDid(link.actor, courier);
  const uri = `at://${did}/app.bsky.feed.post/${link.rkey}`;
  const thread = await json(courier, `${APPVIEW}/app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}&depth=0`);
  const post = isObj(thread) && isObj(thread['thread']) && isObj(thread['thread']['post']) ? thread['thread']['post'] : null;
  if (!post) throw new Error('bluesky: not a post thread');
  const record = isObj(post['record']) ? post['record'] : {};
  const author = isObj(post['author']) ? post['author'] : {};
  const handle = str(author['handle']) ?? link.actor;
  const blobs = embedBlobs(record['embed']);
  const pds = blobs.length > 0 ? await pdsFor(did, courier) : '';
  const many = blobs.length > 1;
  const items: MediaItem[] = blobs.map((b, i) => ({
    kind: 'file',
    url: blobUrl(pds, did, b.cid),
    mime: b.mime,
    filename: `regift-bluesky-${link.rkey}${many ? `-${i + 1}` : ''}.${extensionFor(b.mime)}`,
  }));
  return {
    source: 'bluesky',
    title: str(record['text']),
    author: handle,
    where: null,
    permalink: `https://bsky.app/profile/${handle}/post/${link.rkey}`,
    items,
  };
}
