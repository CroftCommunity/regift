import { describe, it, expect } from 'vitest';
import { sharedMedia, type SharedFile } from '../../src/core/share-in';
import { isShareTarget, shareInboxKey, shareTargetLanding, SHARE_TARGET_PATH } from '../../src/sw-nav';

// A FILE share, not a link share. Measured 2026-09-16 (curl, Origin set to the
// deploy origin): i.redd.it, preview.redd.it and external-preview.redd.it send
// NO access-control-allow-origin at all (preview.* also 403s a hotlink), while
// v.redd.it sends `access-control-allow-origin: *` and answers an OPTIONS
// preflight — same CDN (`server: snooserv`), opposite policy. So no page on any
// origin can fetch a Reddit picture; the way in is for the OS to hand the bytes
// over, which is a POST share target. These are the pure parts of that route.

const file = (name: string, type: string): SharedFile => ({ name, type });

describe('sharedMedia: which shared files are media, and what they are called', () => {
  it('keeps images and video, in the order they arrived', () => {
    const picked = sharedMedia([file('a.jpg', 'image/jpeg'), file('b.mp4', 'video/mp4'), file('c.png', 'image/png')]);
    expect(picked.map((m) => m.filename)).toEqual(['a.jpg', 'b.mp4', 'c.png']);
    expect(picked.map((m) => m.mime)).toEqual(['image/jpeg', 'video/mp4', 'image/png']);
  });

  it('hands back the file itself, so the caller can read its bytes', () => {
    const one = file('a.jpg', 'image/jpeg');
    expect(sharedMedia([one])[0]?.file).toBe(one);
  });

  // Android is inconsistent about the type it attaches: the Reddit app sends
  // image/jpeg, some galleries send application/octet-stream or nothing at all.
  it('falls back to the extension when the OS sends application/octet-stream', () => {
    expect(sharedMedia([file('cat.jpg', 'application/octet-stream')])).toEqual([
      { file: file('cat.jpg', 'application/octet-stream'), mime: 'image/jpeg', filename: 'cat.jpg' },
    ]);
  });

  it('falls back to the extension when the OS sends no type at all', () => {
    expect(sharedMedia([file('clip.mp4', '')]).map((m) => m.mime)).toEqual(['video/mp4']);
  });

  it('trusts a declared media type over the extension', () => {
    expect(sharedMedia([file('screenshot.jpg', 'image/png')]).map((m) => m.mime)).toEqual(['image/png']);
  });

  it('reads a type that carries parameters', () => {
    expect(sharedMedia([file('a.bin', 'image/jpeg; charset=binary')]).map((m) => m.mime)).toEqual(['image/jpeg']);
  });

  it('drops what is not media, and never guesses', () => {
    expect(sharedMedia([file('notes.txt', 'text/plain'), file('post.pdf', 'application/pdf')])).toEqual([]);
    // Unnamed AND untyped: nothing to go on, so it is dropped rather than guessed.
    expect(sharedMedia([file('', ''), file('mystery', 'application/octet-stream')])).toEqual([]);
  });

  it('numbers unnamed files from 1, with the extension its type implies', () => {
    const picked = sharedMedia([file('', 'image/jpeg'), file('kept.png', 'image/png'), file('', 'video/mp4')]);
    expect(picked.map((m) => m.filename)).toEqual(['regift-1.jpg', 'kept.png', 'regift-2.mp4']);
  });

  it('is empty for an empty share', () => {
    expect(sharedMedia([])).toEqual([]);
  });
});

describe('isShareTarget: the one POST the worker answers itself', () => {
  const req = { method: 'POST', sameOrigin: true, path: `/${SHARE_TARGET_PATH}` };

  it('matches the share route at the deploy root', () => {
    expect(isShareTarget(req)).toBe(true);
  });

  it('matches it under a subpath deploy (PR preview, project page)', () => {
    expect(isShareTarget({ ...req, path: '/pr-preview/pr-1/share-target' })).toBe(true);
  });

  it('never takes a GET — those go to the strategy dispatch as before', () => {
    expect(isShareTarget({ ...req, method: 'GET' })).toBe(false);
  });

  it('never takes another path, even a POST', () => {
    expect(isShareTarget({ ...req, path: '/index.html' })).toBe(false);
    expect(isShareTarget({ ...req, path: '/share-target-x' })).toBe(false);
  });

  it('never takes a cross-origin POST', () => {
    expect(isShareTarget({ ...req, sameOrigin: false })).toBe(false);
  });
});

describe('shareTargetLanding: where the worker sends the person afterwards', () => {
  it('carries the count when files came', () => {
    expect(shareTargetLanding({}, 2)).toBe('index.html?shared-media=2');
  });

  it('keeps a link-only share exactly as the GET target used to deliver it', () => {
    expect(shareTargetLanding({ text: 'look https://www.reddit.com/r/x/comments/1abc/t/' }, 0)).toBe(
      'index.html?text=look+https%3A%2F%2Fwww.reddit.com%2Fr%2Fx%2Fcomments%2F1abc%2Ft%2F',
    );
  });

  // A share can carry BOTH the picture and the link it came from — the link is
  // what becomes the credit, so neither may be dropped.
  it('carries both the files and the link that came with them', () => {
    expect(shareTargetLanding({ title: 'Dad jokes', url: 'https://www.reddit.com/r/x/comments/1abc/t/' }, 1)).toBe(
      'index.html?shared-media=1&title=Dad+jokes&url=https%3A%2F%2Fwww.reddit.com%2Fr%2Fx%2Fcomments%2F1abc%2Ft%2F',
    );
  });

  it('ignores empty, null and absent fields', () => {
    expect(shareTargetLanding({ title: '', text: null, url: undefined }, 0)).toBe('index.html');
  });
});

describe('shareInboxKey: the worker parks, the page collects', () => {
  it('derives the same key from the worker and from the landing page', () => {
    const fromWorker = shareInboxKey('https://croftcommunity.github.io/regift/sw.js', 0);
    const fromPage = shareInboxKey('https://croftcommunity.github.io/regift/index.html?shared-media=2', 0);
    expect(fromWorker).toBe('https://croftcommunity.github.io/regift/share-inbox/0');
    expect(fromPage).toBe(fromWorker);
  });

  it('numbers each file in the share', () => {
    expect(shareInboxKey('https://example.test/app/sw.js', 3)).toBe('https://example.test/app/share-inbox/3');
  });
});
