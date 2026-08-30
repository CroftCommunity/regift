// The attribution line for the post you make next. Cross-posting with credit is
// the product's framing, so the credit is an output of the pipeline, not an
// afterthought — and it never prints "null" for a part it does not know.
import type { RedditPost } from './reddit/post';

export function creditLine(post: RedditPost): string {
  const who = post.author ? `u/${post.author}` : null;
  const where = post.subreddit ? `r/${post.subreddit}` : 'Reddit';
  const head = who ? `via ${who} on ${where}` : `via ${where}`;
  return post.permalink ? `${head} — ${post.permalink}` : head;
}
