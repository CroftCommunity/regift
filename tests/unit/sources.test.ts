import { describe, it, expect } from 'vitest';
import { classifyLink } from '../../src/core/sources';

// One classifier for every source. Hosts are arbitrary for the fediverse, so
// Mastodon and Pixelfed are recognised by their path shapes.
describe('classifyLink', () => {
  it('reddit links keep their existing classification', () => {
    expect(classifyLink('https://www.reddit.com/r/a/comments/1abc/t/')).toEqual({
      source: 'reddit',
      link: { kind: 'post', canonical: 'https://www.reddit.com/r/a/comments/1abc/t/' },
    });
    expect(classifyLink('https://v.redd.it/abc123')).toEqual({ source: 'reddit', link: { kind: 'video', videoId: 'abc123' } });
  });

  it('a bsky.app post, by handle or by DID', () => {
    expect(classifyLink('https://bsky.app/profile/rainmaker1973-m.bsky.social/post/3muciddrju72p')).toEqual({
      source: 'bluesky',
      actor: 'rainmaker1973-m.bsky.social',
      rkey: '3muciddrju72p',
    });
    expect(classifyLink('https://bsky.app/profile/did:plc:47im5i5ptau2br4rh7lp2ryr/post/3muciddrju72p?x=1')).toEqual({
      source: 'bluesky',
      actor: 'did:plc:47im5i5ptau2br4rh7lp2ryr',
      rkey: '3muciddrju72p',
    });
  });

  it('a Mastodon status in its three URL shapes', () => {
    expect(classifyLink('https://mastodon.social/@Mastodon/116929144390213579')).toEqual({ source: 'mastodon', host: 'mastodon.social', id: '116929144390213579' });
    expect(classifyLink('https://hachyderm.io/@someone@other.example/123')).toEqual({ source: 'mastodon', host: 'hachyderm.io', id: '123' });
    expect(classifyLink('https://mastodon.social/users/Mastodon/statuses/116929144390213579')).toEqual({ source: 'mastodon', host: 'mastodon.social', id: '116929144390213579' });
  });

  it('a Tumblr post from the share link or the blog domain', () => {
    expect(classifyLink('https://www.tumblr.com/ariaiscursed/826326755263578112?source=share')).toEqual({ source: 'tumblr', blog: 'ariaiscursed', id: '826326755263578112' });
    expect(classifyLink('https://npr.tumblr.com/post/190671199343/some-slug')).toEqual({ source: 'tumblr', blog: 'npr', id: '190671199343' });
    expect(classifyLink('https://www.tumblr.com/ariaiscursed/826326755263578112/slug-here')).toEqual({ source: 'tumblr', blog: 'ariaiscursed', id: '826326755263578112' });
  });

  it('a Pixelfed post by its /p/ shape', () => {
    expect(classifyLink('https://gram.social/p/chase523/98647664694091234')).toEqual({ source: 'pixelfed', host: 'gram.social', user: 'chase523', id: '98647664694091234' });
  });

  it('anything else is unknown', () => {
    expect(classifyLink('https://example.com/watch?v=1')).toEqual({ source: 'unknown', url: 'https://example.com/watch?v=1' });
    expect(classifyLink('https://bsky.app/profile/someone')).toEqual({ source: 'unknown', url: 'https://bsky.app/profile/someone' });
  });
});
