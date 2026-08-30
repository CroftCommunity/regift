// The regift page: a link comes in (Web Share Target query, or pasted), the
// video comes out (share sheet, or a download). The page owns the three
// states the core cannot resolve by itself — a share link that needs the
// browser, a post the page's courier cannot read (the assisted step), and a
// post with no video — and turns each into words and one next action.
import { mountShell, el } from '../nav';
import { registerServiceWorker } from '../sw-register';
import { log } from '../log';
import { sharedUrl } from '../core/share-in';
import { readPost, regiftVideo, NeedsBrowserError, type Stage } from '../core/pipeline';
import { CourierBlockedError } from '../core/ports';
import { parsePostListing, PostParseError, type RedditPost } from '../core/reddit/post';
import { fetchCourier } from '../adapters/web/fetch-courier';
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

function credit(post: RedditPost): HTMLElement {
  const p = el('p', 'credit');
  p.setAttribute('data-testid', 'credit');
  const who = [post.author ? `u/${post.author}` : null, post.subreddit ? `r/${post.subreddit}` : null]
    .filter((s) => s !== null)
    .join(' in ');
  p.textContent = post.title ? `${post.title} — ${who}` : who || 'Direct video link';
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

function content(): HTMLElement {
  const root = el('div');
  root.append(el('h1', undefined, 'Share a post in, get the video out'));

  // --- Step 1: the link ---
  const s1 = step('1. The post');
  const field = el('label', 'field');
  field.append(el('span', 'field-label', 'Link to a Reddit post or video'));
  const input = el('input');
  input.type = 'url';
  input.name = 'url';
  input.placeholder = 'https://www.reddit.com/r/…/comments/…';
  input.setAttribute('data-testid', 'url');
  field.append(input);
  const go = el('button', 'btn btn-primary', 'Get the video');
  go.type = 'button';
  go.setAttribute('data-testid', 'go');
  s1.body.append(field, go);
  s1.setState('active');

  // --- Step 2: reaching the post ---
  const s2 = step('2. Reading the post');
  // --- Step 3: the file ---
  const s3 = step('3. The video');

  root.append(s1.root, s2.root, s3.root);

  const params = new URLSearchParams(location.search);
  const arrived = sharedUrl({ url: params.get('url'), text: params.get('text'), title: params.get('title') });
  if (arrived) {
    input.value = arrived;
    log.info('share target arrival', arrived);
  }

  const reset = (): void => {
    s2.body.replaceChildren();
    s3.body.replaceChildren();
    s2.setState('idle');
    s3.setState('idle');
  };

  async function produce(post: RedditPost): Promise<void> {
    if (!post.video) {
      status(s2.body, 'This post has no video. regift handles video posts for now.', 'error');
      return;
    }
    s2.body.append(credit(post));
    s2.setState('done');
    s3.setState('active');
    const line = status(s3.body, STAGE_WORDS.manifest);
    const bar = el('progress');
    bar.max = 1;
    bar.value = 0;
    s3.body.append(bar);
    try {
      const out = await regiftVideo({
        videoId: post.video.id,
        courier: fetchCourier,
        muxer,
        onStage: (stage) => {
          line.textContent = STAGE_WORDS[stage];
          bar.value = 0;
        },
        onProgress: (_stage, ratio) => {
          bar.value = ratio;
        },
      });
      bar.remove();
      const file = new File([out.bytes as BlobPart], out.filename, { type: 'video/mp4' });
      line.textContent = `${out.filename} · ${(file.size / 1024 / 1024).toFixed(1)} MB`;
      const preview = el('video', 'preview');
      preview.controls = true;
      preview.playsInline = true;
      preview.src = URL.createObjectURL(file);
      preview.setAttribute('data-testid', 'preview');
      const actions = el('div', 'actions');
      if (webShareOut.canShareFiles()) {
        const share = el('button', 'btn btn-primary', 'Share…');
        share.type = 'button';
        share.setAttribute('data-testid', 'share');
        share.addEventListener('click', () => {
          webShareOut.share(file).catch((err: unknown) => log.warn('share dismissed', err));
        });
        actions.append(share);
      }
      const save = el('button', 'btn btn-secondary', 'Save');
      save.type = 'button';
      save.setAttribute('data-testid', 'save');
      save.addEventListener('click', () => saveFile(file));
      actions.append(save);
      s3.body.append(preview, actions);
      s3.setState('done');
    } catch (err) {
      log.error('regift failed', err);
      bar.remove();
      line.textContent = `Could not get the video: ${err instanceof Error ? err.message : String(err)}`;
      line.setAttribute('data-tone', 'error');
    }
  }

  function assisted(jsonUrl: string): void {
    // The page cannot read reddit.com (no CORS); the person's browser can. Ask
    // for the one read the browser must do, and take the result as a paste.
    const hint = el('div', 'hint');
    hint.setAttribute('data-testid', 'assisted');
    hint.append(
      document.createTextNode(
        'This page cannot read Reddit directly, but your browser can. One copy and paste bridges the gap:',
      ),
    );
    const steps = el('ol');
    steps.append(
      el('li', undefined, 'Open the post data in a new tab (the button below).'),
      el('li', undefined, 'Select all of the text there and copy it.'),
      el('li', undefined, 'Come back and paste it here.'),
    );
    hint.append(steps);
    const open = openLink(jsonUrl, 'Open the post data');
    open.setAttribute('data-testid', 'open-json');
    const field = el('label', 'field');
    field.append(el('span', 'field-label', 'Paste the post data'));
    const ta = el('textarea');
    ta.name = 'post-json';
    ta.setAttribute('data-testid', 'post-json');
    field.append(ta);
    const use = el('button', 'btn btn-primary', 'Use it');
    use.type = 'button';
    use.setAttribute('data-testid', 'use-json');
    const err = status(s2.body, '');
    err.hidden = true;
    use.addEventListener('click', () => {
      try {
        const post = parsePostListing(JSON.parse(ta.value) as unknown);
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
    s2.body.append(hint, open, field, use, err);
  }

  go.addEventListener('click', () => {
    reset();
    const url = sharedUrl({ url: input.value });
    if (!url) {
      status(s2.body, 'Paste a link first.', 'error');
      return;
    }
    s2.setState('active');
    void readPost(url, fetchCourier).then(produce, (err: unknown) => {
      if (err instanceof NeedsBrowserError) {
        const hint = el('div', 'hint');
        hint.setAttribute('data-testid', 'needs-browser');
        hint.append(
          document.createTextNode(
            "That is a share link, which only a browser can follow. Open it, then share the post from your browser's own menu (not the share button on the page) back to regift.",
          ),
        );
        s2.body.append(hint, openLink(err.url, 'Open the post'));
        return;
      }
      if (err instanceof CourierBlockedError) {
        assisted(err.url);
        return;
      }
      log.error('read post failed', err);
      status(s2.body, err instanceof Error ? err.message : String(err), 'error');
    });
  });

  return root;
}

const app = document.getElementById('app');
if (!app) throw new Error('index: #app not found');
mountShell(app, content());
registerServiceWorker();
log.info('shell mounted', 'index');
