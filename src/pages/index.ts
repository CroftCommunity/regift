// The regift page: a link comes in (Web Share Target query, or pasted), the
// media comes out (share sheet, or a download). The page owns the states the
// core cannot resolve by itself — a share link that needs the browser, a post
// the page's courier cannot read (the assisted step), a source that needs a
// sign-in, a post with no media — and turns each into words and one next action.
import { mountShell, el } from '../nav';
import { registerServiceWorker } from '../sw-register';
import { log } from '../log';
import { sharedUrl, sharedPostJson } from '../core/share-in';
import { creditLine, embeddedCredit } from '../core/credit';
import { tagImage } from '../core/tag';
import { readAny, regiftVideo, fromReddit, NeedsBrowserError, type Stage } from '../core/pipeline';
import { CourierBlockedError } from '../core/ports';
import { NeedsSignInError } from '../core/sources';
import { UnsupportedMediaError } from '../core/readers/tumblr';
import { parsePostListing, PostParseError } from '../core/reddit/post';
import type { MediaItem, Post } from '../core/post';
import { webCourier } from '../adapters/web/web-courier';
import { ffmpegMuxer } from '../adapters/web/ffmpeg-muxer';
import { webShareOut, saveFile } from '../adapters/web/share-out';

const muxer = ffmpegMuxer(new URL('vendor/ffmpeg/', location.href));

const STAGE_WORDS: Record<Stage, string> = {
  manifest: 'Reading the track list…',
  video: 'Fetching the video track…',
  audio: 'Fetching the audio track…',
  mux: 'Joining video and audio on your device…',
  done: 'Done.',
};

function step(title: string): { root: HTMLElement; body: HTMLElement; setState(s: 'idle' | 'active' | 'done'): void } {
  const root = el('section', 'step');
  root.setAttribute('data-state', 'idle');
  const body = el('div');
  root.append(el('h2', undefined, title), body);
  return { root, body, setState: (s) => root.setAttribute('data-state', s) };
}

function status(parent: HTMLElement, text: string, tone: 'info' | 'error' = 'info'): HTMLElement {
  const p = el('p', 'status', text);
  p.setAttribute('role', 'status');
  p.setAttribute('data-tone', tone);
  parent.append(p);
  return p;
}

function credit(post: Post): HTMLElement {
  const p = el('p', 'credit');
  p.setAttribute('data-testid', 'credit');
  const line = creditLine(post).replace(/ — .*$/, '');
  const title = post.title && post.title.length > 140 ? `${post.title.slice(0, 137)}…` : post.title;
  const who = line.replace(/^via /, '');
  p.textContent = title ? `${title} — ${who}` : post.author || post.where ? who : 'Direct video link';
  if (post.permalink) {
    const a = el('a', undefined, 'source');
    a.href = post.permalink;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    p.append(document.createTextNode(' · '), a);
  }
  return p;
}

function openLink(href: string, label: string): HTMLAnchorElement {
  const a = el('a', 'btn btn-secondary', label);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

function button(label: string, className: string, testid: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', className, label);
  b.type = 'button';
  b.setAttribute('data-testid', testid);
  b.addEventListener('click', onClick);
  return b;
}

/** Standalone = launched from the home screen; only then does the share target exist. */
function isInstalled(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches;
  } catch {
    return false;
  }
}

function content(): HTMLElement {
  const root = el('div');
  root.append(el('h1', undefined, 'Share a post in, get the media out'));

  // --- Step 1: the link ---
  const s1 = step('1. The post');
  const field = el('label', 'field');
  field.append(el('span', 'field-label', 'Link to a post — Reddit, Bluesky, Mastodon, Tumblr'));
  const input = el('input');
  input.type = 'url';
  input.name = 'url';
  input.placeholder = 'https://…';
  input.setAttribute('data-testid', 'url');
  field.append(input);
  const quality = el('label', 'field');
  quality.append(el('span', 'field-label', 'Quality (Reddit video)'));
  const qualitySelect = el('select');
  qualitySelect.name = 'quality';
  qualitySelect.setAttribute('data-testid', 'quality');
  for (const [value, label] of [
    ['', 'Best available'],
    ['720', 'Up to 720p (smaller file)'],
    ['480', 'Up to 480p (smallest)'],
  ] as const) {
    const opt = el('option', undefined, label);
    opt.value = value;
    qualitySelect.append(opt);
  }
  quality.append(qualitySelect);
  const maxHeight = (): number | undefined => (qualitySelect.value ? Number(qualitySelect.value) : undefined);
  const go = button('Get the media', 'btn btn-primary', 'go', () => onGo());
  // One tap purges everything — a half-done fetch, the loaded core, blob previews,
  // and the share-target query — by reloading the page at its clean address.
  const startOver = button('Start over', 'btn btn-secondary', 'reset', () => location.replace(location.pathname));
  const buttons = el('div', 'actions');
  buttons.append(go, startOver);
  s1.body.append(field, quality, buttons);
  s1.setState('active');

  const s2 = step('2. Reading the post');
  const s3 = step('3. The media');
  root.append(s1.root, s2.root, s3.root);

  const reset = (): void => {
    s2.body.replaceChildren();
    s3.body.replaceChildren();
    s2.setState('idle');
    s3.setState('idle');
  };

  async function fileFor(post: Post, item: MediaItem, line: HTMLElement, bar: HTMLProgressElement): Promise<File> {
    const credit = embeddedCredit(post);
    const tags = { title: post.title ?? credit.description, artist: credit.author, comment: credit.description };
    if (item.kind === 'reddit-video') {
      const cap = maxHeight();
      const out = await regiftVideo({
        videoId: item.videoId,
        courier: webCourier,
        muxer,
        tags,
        ...(cap === undefined ? {} : { maxHeight: cap }),
        onStage: (stage) => {
          line.textContent = STAGE_WORDS[stage];
          bar.value = 0;
        },
        onProgress: (_stage, ratio) => {
          bar.value = ratio;
        },
      });
      return new File([out.bytes as BlobPart], out.filename, { type: 'video/mp4' });
    }
    line.textContent = `Fetching ${item.filename}…`;
    let bytes = await webCourier.bytes(item.url, (loaded, total) => {
      bar.value = total ? loaded / total : 0;
    });
    // The credit rides inside the file. Cosmetic: a tagging failure must not
    // cost the file itself, so it degrades to the untagged bytes with a warning.
    try {
      if (item.mime.startsWith('image/')) bytes = tagImage(bytes, item.mime, credit);
      else if (item.mime === 'video/mp4') {
        line.textContent = 'Writing the credit into the file…';
        bytes = await muxer.tag(bytes, tags);
      }
    } catch (err) {
      log.warn('credit embedding failed; keeping the untagged file', err);
    }
    return new File([bytes as BlobPart], item.filename, { type: item.mime });
  }

  function preview(file: File): HTMLElement {
    const src = URL.createObjectURL(file);
    if (file.type.startsWith('video/')) {
      const v = el('video', 'preview');
      v.controls = true;
      v.playsInline = true;
      v.src = src;
      v.setAttribute('data-testid', 'preview');
      return v;
    }
    const img = el('img', 'preview');
    img.src = src;
    img.alt = file.name;
    img.setAttribute('data-testid', 'preview');
    return img;
  }

  async function produce(post: Post): Promise<void> {
    if (post.items.length === 0) {
      status(s2.body, 'This post has no video or images that regift can fetch.', 'error');
      return;
    }
    s2.body.append(credit(post));
    s2.setState('done');
    s3.setState('active');
    const line = status(s3.body, 'Starting…');
    const bar = el('progress');
    bar.max = 1;
    bar.value = 0;
    s3.body.append(bar);
    const files: File[] = [];
    try {
      for (const [i, item] of post.items.entries()) {
        if (post.items.length > 1) line.textContent = `${i + 1} of ${post.items.length}…`;
        files.push(await fileFor(post, item, line, bar));
      }
    } catch (err) {
      log.error('regift failed', err);
      bar.remove();
      // Reddit's image hosts were not confirmed CORS-open when this shipped (2026-08-30);
      // if the fetch is refused, say what that means rather than showing "Failed to fetch".
      const redditImage = post.source === 'reddit' && post.items.some((it) => it.kind === 'file');
      line.textContent = redditImage
        ? "Reddit's image host refused this page. Pictures from Reddit need the regift app (coming); video works today."
        : `Could not get the media: ${err instanceof Error ? err.message : String(err)}`;
      line.setAttribute('data-tone', 'error');
      line.setAttribute('data-testid', 'media-error');
      return;
    }
    bar.remove();
    const total = files.reduce((n, f) => n + f.size, 0);
    line.textContent = files.length === 1 ? `${files[0]?.name ?? ''} · ${(total / 1024 / 1024).toFixed(1)} MB` : `${files.length} files · ${(total / 1024 / 1024).toFixed(1)} MB`;
    const actions = el('div', 'actions');
    if (webShareOut.canShareFiles()) {
      actions.append(
        button(files.length === 1 ? 'Share…' : `Share all ${files.length}…`, 'btn btn-primary', 'share', () => {
          navigator.share({ files, title: files[0]?.name ?? 'regift' }).catch((err: unknown) => log.warn('share dismissed', err));
        }),
      );
    }
    const creditStr = creditLine(post);
    const copy = button('Copy credit', 'btn btn-secondary', 'copy-credit', () => {
      navigator.clipboard.writeText(creditStr).then(
        () => {
          copy.textContent = 'Credit copied';
        },
        (err: unknown) => log.warn('clipboard refused', err),
      );
    });
    copy.title = creditStr;
    actions.append(copy);
    s3.body.append(actions);
    for (const [i, file] of files.entries()) {
      const row = el('div', 'result');
      row.setAttribute('data-testid', 'result');
      row.append(preview(file), button(files.length === 1 ? 'Save' : `Save ${i + 1}`, 'btn btn-secondary', i === 0 ? 'save' : `save-${i + 1}`, () => saveFile(file)));
      s3.body.append(row);
    }
    const creditText = el('p', 'credit', creditStr);
    creditText.setAttribute('data-testid', 'credit-line');
    s3.body.append(creditText);
    s3.setState('done');
  }

  function assisted(jsonUrl: string): void {
    // The page could not read reddit.com (no cookies for the JSONP read, or
    // third-party cookies blocked); the person's browser can. Ask for the one read
    // the browser must do, and take the result as a share or a paste.
    const hint = el('div', 'hint');
    hint.setAttribute('data-testid', 'assisted');
    hint.append(
      document.createTextNode(
        'regift could not read this post by itself (your browser is not signed in to Reddit, or it blocks third-party cookies). Your browser can still reach it. Quickest way:',
      ),
    );
    const quick = el('ol');
    quick.append(
      el('li', undefined, 'Open the post on old Reddit (the first button).'),
      el('li', undefined, 'Long-press the post title, choose Share link, and pick regift.'),
    );
    const slow = el('p', undefined, 'Or, for a credit line too: open the post data (the second button), select all, then share the selection to regift — or copy it and paste it below.');
    hint.append(quick, slow);
    const oldReddit = openLink(jsonUrl.replace('https://www.reddit.com/', 'https://old.reddit.com/').replace(/\.json\?.*$/, ''), 'Open on old Reddit');
    oldReddit.setAttribute('data-testid', 'open-old-reddit');
    const open = openLink(jsonUrl, 'Open the post data');
    open.setAttribute('data-testid', 'open-json');
    const pasteField = el('label', 'field');
    pasteField.append(el('span', 'field-label', 'Paste the post data'));
    const ta = el('textarea');
    ta.name = 'post-json';
    ta.setAttribute('data-testid', 'post-json');
    pasteField.append(ta);
    const err = status(s2.body, '');
    err.hidden = true;
    const use = button('Use it', 'btn btn-primary', 'use-json', () => {
      try {
        const post = fromReddit(parsePostListing(JSON.parse(ta.value) as unknown));
        err.hidden = true;
        s2.body.replaceChildren();
        void produce(post);
      } catch (e) {
        err.hidden = false;
        err.setAttribute('data-tone', 'error');
        err.textContent =
          e instanceof PostParseError
            ? 'That does not look like the post data. Copy everything on the page that opened.'
            : 'That is not valid JSON. Select all, then copy — partial text will not parse.';
      }
    });
    s2.body.append(hint, oldReddit, open, pasteField, use, err);
  }

  function onRefused(err: unknown): void {
    if (err instanceof NeedsBrowserError) {
      const hint = el('div', 'hint');
      hint.setAttribute('data-testid', 'needs-browser');
      hint.append(
        document.createTextNode(
          "That is a link from Reddit's share button, which only a browser can follow. Open it, then share the post to regift from Chrome's own menu (⋮ → Share) — that sends the real post address and regift goes straight through.",
        ),
      );
      hint.append(el('p', undefined, "Next time: on the post, use Chrome's ⋮ → Share instead of the share button on the page, and this step disappears."));
      s2.body.append(hint, openLink(err.url, 'Open the post'));
      return;
    }
    if (err instanceof CourierBlockedError) {
      assisted(err.url);
      return;
    }
    if (err instanceof NeedsSignInError) {
      const hint = el('div', 'hint');
      hint.setAttribute('data-testid', 'needs-sign-in');
      hint.textContent = `${err.source} only shows posts to signed-in members, and this page has no sign-in. regift cannot read it yet.`;
      s2.body.append(hint);
      return;
    }
    if (err instanceof UnsupportedMediaError) {
      status(s2.body, err.message, 'error');
      return;
    }
    log.error('read post failed', err);
    status(s2.body, err instanceof Error ? err.message : String(err), 'error');
  }

  function onGo(): void {
    reset();
    const pastedJson = sharedPostJson({ text: input.value });
    if (pastedJson !== null) {
      try {
        void produce(fromReddit(parsePostListing(pastedJson)));
      } catch (e) {
        status(s2.body, e instanceof PostParseError ? 'That does not look like post data.' : String(e), 'error');
      }
      return;
    }
    const url = sharedUrl({ url: input.value });
    if (!url) {
      status(s2.body, 'Paste a link first.', 'error');
      return;
    }
    s2.setState('active');
    void readAny(url, webCourier).then(produce, onRefused);
  }

  const params = new URLSearchParams(location.search);
  const shared = { url: params.get('url'), text: params.get('text'), title: params.get('title') };
  const arrivedJson = sharedPostJson(shared);
  const arrived = arrivedJson === null ? sharedUrl(shared) : null;
  if (arrived) {
    input.value = arrived;
    log.info('share target arrival', arrived);
  }

  if (!isInstalled()) {
    const hint = el(
      'p',
      'hint',
      'Tip: install regift from Chrome (menu → Install app) and it appears in the Android share sheet, so you can share a post straight to it. Other browsers (Brave, Firefox, Samsung) add a shortcut only, which never registers a share target.',
    );
    hint.setAttribute('data-testid', 'install-hint');
    root.append(hint);
  }

  if (arrivedJson !== null) {
    try {
      const post = fromReddit(parsePostListing(arrivedJson));
      if (post.permalink) input.value = post.permalink;
      log.info('share target arrival: post data');
      void produce(post);
    } catch (e) {
      log.warn('shared text looked like JSON but is not a post listing', e);
      status(s2.body, 'The shared text is not Reddit post data. Select all of the post-data page, then share it.', 'error');
    }
  }

  return root;
}

const app = document.getElementById('app');
if (!app) throw new Error('index: #app not found');
mountShell(app, content());
registerServiceWorker();
log.info('shell mounted', 'index');
