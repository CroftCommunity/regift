// A Mastodon status through /api/v1/statuses/:id — public and CORS-open on
// Mastodon by default, as are the media files it names (measured 2026-08-30).
import type { Courier } from '../ports';
import { extensionFor, mimeFromUrl, stripHtml, type MediaItem, type Post } from '../post';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null;
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export async function readMastodon(link: { readonly host: string; readonly id: string }, courier: Courier): Promise<Post> {
  const status = JSON.parse(await courier.text(`https://${link.host}/api/v1/statuses/${link.id}`)) as unknown;
  if (!isObj(status) || !Array.isArray(status['media_attachments'])) throw new Error('mastodon: not a status');
  const account = isObj(status['account']) ? status['account'] : {};
  const acct = str(account['acct']);
  const attachments = (status['media_attachments'] as unknown[]).filter(isObj);
  const many = attachments.length > 1;
  const items: MediaItem[] = attachments.flatMap((a, i): MediaItem[] => {
    const url = str(a['url']);
    if (!url) return [];
    const mime = mimeFromUrl(url);
    return [{ kind: 'file', url, mime, filename: `regift-mastodon-${link.id}${many ? `-${i + 1}` : ''}.${extensionFor(mime)}` }];
  });
  const content = str(status['content']) ?? '';
  return {
    source: 'mastodon',
    title: content ? stripHtml(content) : null,
    author: acct ? (acct.includes('@') ? acct : `${acct}@${link.host}`) : null,
    where: link.host,
    permalink: str(status['url']) ?? `https://${link.host}/@${acct ?? ''}/${link.id}`,
    items,
  };
}
