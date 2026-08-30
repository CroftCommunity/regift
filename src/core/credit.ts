// The attribution line for the post you make next. Cross-posting with credit is
// the product's framing, so the credit is an output of the pipeline, not an
// afterthought — and it never prints "null" for a part it does not know.
import type { Post, Source } from './post';
import type { Credit } from './tag';

const PLATFORM: Record<Source, string> = { reddit: 'Reddit', bluesky: 'Bluesky', mastodon: 'Mastodon', tumblr: 'Tumblr', pixelfed: 'Pixelfed' };

function person(post: Post): string | null {
  if (!post.author) return null;
  switch (post.source) {
    case 'reddit':
      return `u/${post.author}`;
    case 'bluesky':
    case 'mastodon':
    case 'pixelfed':
      return `@${post.author}`;
    case 'tumblr':
      return post.author;
  }
}

export function creditLine(post: Post): string {
  const who = person(post);
  const where = post.where ?? PLATFORM[post.source];
  const head = who ? `via ${who} on ${where}` : `via ${where}`;
  return post.permalink ? `${head} — ${post.permalink}` : head;
}

/** What goes inside the file (src/core/tag.ts, and the mp4 tags). */
export function embeddedCredit(post: Post): Credit {
  const who = person(post) ?? '';
  const line = creditLine(post);
  return {
    description: post.title ? `${post.title} — ${line}` : line,
    author: who,
    source: post.permalink ?? '',
  };
}
