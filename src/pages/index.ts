// The regift page: a link comes in (Web Share Target query, or pasted), the
// media comes out (share sheet, or a download). The page owns the states the
// core cannot resolve by itself — a share link that needs the browser, a post
// the page's courier cannot read (the assisted step for Reddit; the file routes
// for Instagram), a source that needs a sign-in, a post with no media — and turns
// each into words and one next action.
import { mountShell, el } from '../nav';
import { registerServiceWorker } from '../sw-register';
import { INBOX_CACHE, shareInboxKey } from '../sw-nav';
import { log } from '../log';
import { sharedUrl, sharedPostJson } from '../core/share-in';
import { creditLine, embeddedCredit } from '../core/credit';
import { tagImage } from '../core/tag';
import { mp4Info } from '../core/mp4-info';
import { clipFilename, clipLength, formatTime, gifPlan, moveEnd, moveStart, wholeClip, type Clip } from '../core/clip';
import { readAny, regiftVideo, fromReddit, NeedsBrowserError, type Stage } from '../core/pipeline';
import { isInstagramEmbedUrl } from '../core/readers/instagram';
import { CourierBlockedError } from '../core/ports';
import { NeedsSignInError } from '../core/sources';
import { UnsupportedMediaError } from '../core/readers/tumblr';
import { parsePostListing, PostParseError } from '../core/reddit/post';
import type { MediaItem, Post } from '../core/post';
import { webCourier } from '../adapters/web/web-courier';
import { ffmpegTools } from '../adapters/web/ffmpeg';
import { webShareOut, saveFile } from '../adapters/web/share-out';

const { muxer, clipper } = ffmpegTools(new URL('vendor/ffmpeg/', location.href));

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
  field.append(el('span', 'field-label', 'Link to a post — Reddit, Bluesky, Mastodon, Tumblr, Instagram'));
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
      // Re-measured 2026-09-16: i.redd.it sends no access-control-allow-origin at
      // all, while v.redd.it sends `*` — so this fetch can never succeed from any
      // page, and the words point at the route that does work (share the picture
      // itself: the OS hands the bytes over and nothing is fetched).
      const redditImage = post.source === 'reddit' && post.items.some((it) => it.kind === 'file');
      line.textContent = redditImage
        ? "Reddit's image host will not let a page read the file — i.redd.it sends no CORS header at all, while their video host does, which is why video works here. Open the picture in Reddit, tap Share, and pick regift: the file itself comes across."
        : `Could not get the media: ${err instanceof Error ? err.message : String(err)}`;
      line.setAttribute('data-tone', 'error');
      line.setAttribute('data-testid', 'media-error');
      return;
    }
    bar.remove();
    deliver(files, post, line);
  }

  /**
   * Step 3 for files that are already in hand, however they got here — fetched
   * from a post, or handed over by the OS through the share sheet. A share with
   * no link behind it has NO post, and then there is no credit to offer: no
   * Copy-credit button, no credit line, rather than a line that says nothing.
   */
  function deliver(files: readonly File[], post: Post | null, line: HTMLElement): void {
    const total = files.reduce((n, f) => n + f.size, 0);
    line.textContent = files.length === 1 ? `${files[0]?.name ?? ''} · ${(total / 1024 / 1024).toFixed(1)} MB` : `${files.length} files · ${(total / 1024 / 1024).toFixed(1)} MB`;
    const actions = el('div', 'actions');
    if (webShareOut.canShareFiles()) {
      actions.append(
        button(files.length === 1 ? 'Share…' : `Share all ${files.length}…`, 'btn btn-primary', 'share', () => {
          navigator.share({ files: [...files], title: files[0]?.name ?? 'regift' }).catch((err: unknown) => log.warn('share dismissed', err));
        }),
      );
    }
    const creditStr = post ? creditLine(post) : null;
    if (creditStr !== null) {
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
    }
    s3.body.append(actions);
    for (const [i, file] of files.entries()) {
      const row = el('div', 'result');
      row.setAttribute('data-testid', 'result');
      const view = preview(file);
      row.append(view, button(files.length === 1 ? 'Save' : `Save ${i + 1}`, 'btn btn-secondary', i === 0 ? 'save' : `save-${i + 1}`, () => saveFile(file)));
      if (view instanceof HTMLVideoElement) row.append(trimmer(file, view, post));
      s3.body.append(row);
    }
    if (creditStr !== null) {
      const creditText = el('p', 'credit', creditStr);
      creditText.setAttribute('data-testid', 'credit-line');
      s3.body.append(creditText);
    }
    s3.setState('done');
  }

  /**
   * Cut a span out of a video that is already here, as an mp4 or a GIF. Two
   * range inputs share one rail — native inputs, so the keyboard and a screen
   * reader each get a real "Clip start" and "Clip end" slider — and the preview
   * seeks to whichever handle moved, so the person sees the frame they chose.
   * The bytes are held for the encode: a GIF or mp4 is made from the file itself.
   */
  function trimmer(file: File, video: HTMLVideoElement, post: Post | null): HTMLElement {
    const box = el('fieldset', 'trim');
    box.setAttribute('data-testid', 'trim');
    box.append(el('legend', undefined, 'Cut a clip'));
    const rail = el('div', 'range2');
    const fill = el('div', 'range2-fill');
    const handle = (label: string, testid: string): HTMLInputElement => {
      const r = el('input');
      r.type = 'range';
      r.min = '0';
      r.step = '0.1';
      r.disabled = true;
      r.setAttribute('aria-label', label);
      r.setAttribute('data-testid', testid);
      return r;
    };
    const from = handle('Clip start', 'trim-start');
    const to = handle('Clip end', 'trim-end');
    rail.append(fill, from, to);
    const readout = el('p', 'mono trim-readout', 'Reading the video length…');
    readout.setAttribute('data-testid', 'trim-readout');
    const play = button('Play the clip', 'btn btn-secondary', 'trim-play', () => {
      video.currentTime = clip.start;
      void video.play().catch((err: unknown) => log.warn('preview would not play', err));
    });
    const asMp4 = button('Clip as MP4', 'btn btn-secondary', 'clip-mp4', () => void make('mp4'));
    const asGif = button('Clip as GIF', 'btn btn-primary', 'clip-gif', () => void make('gif'));
    const controls = [play, asMp4, asGif];
    for (const b of controls) b.disabled = true;
    const actions = el('div', 'actions');
    actions.append(play, asMp4, asGif);
    const out = el('div');
    box.append(rail, readout, actions, out);

    let duration = 0;
    let size = { width: 0, height: 0 };
    let clip: Clip = wholeClip(0);
    const plan = () => gifPlan(size, clipLength(clip));
    const render = (): void => {
      from.value = String(clip.start);
      to.value = String(clip.end);
      from.setAttribute('aria-valuetext', formatTime(clip.start));
      to.setAttribute('aria-valuetext', formatTime(clip.end));
      // CSSOM, not a style attribute: CSP style-src 'self' allows this.
      rail.style.setProperty('--from', String(clip.start / duration));
      rail.style.setProperty('--to', String(clip.end / duration));
      // Handles can meet; the one nearer its own end of the rail goes on top so
      // the other is never buried under it.
      rail.toggleAttribute('data-start-on-top', clip.start > duration / 2);
      const g = plan();
      readout.textContent = `${formatTime(clip.start)} → ${formatTime(clip.end)} · ${clipLength(clip).toFixed(1)} s\nGIF ${g.width}×${g.height}, ${g.fps} fps`;
    };
    const ready = (info: { duration: number; width: number; height: number }): void => {
      duration = info.duration;
      size = { width: info.width, height: info.height };
      clip = wholeClip(duration);
      for (const r of [from, to]) {
        r.max = String(duration);
        r.disabled = false;
      }
      for (const b of controls) b.disabled = false;
      render();
    };
    // The length comes from the container, so a video this browser cannot decode
    // (no preview) can still be cut; the <video> is the fallback for non-mp4s.
    const fromPlayer = (): void => {
      if (Number.isFinite(video.duration) && video.duration > 0) ready({ duration: video.duration, width: video.videoWidth, height: video.videoHeight });
      else readout.textContent = 'This video does not say how long it is, so it cannot be cut here.';
    };
    const bytes = file.arrayBuffer().then((b) => new Uint8Array(b));
    void bytes.then((b) => {
      const info = mp4Info(b);
      if (info && info.duration > 0) ready(info);
      else if (video.readyState >= HTMLMediaElement.HAVE_METADATA) fromPlayer();
      else {
        video.addEventListener('loadedmetadata', fromPlayer, { once: true });
        video.addEventListener('error', fromPlayer, { once: true });
      }
    });

    from.addEventListener('input', () => {
      clip = moveStart(clip, Number(from.value));
      video.pause();
      video.currentTime = clip.start;
      render();
    });
    to.addEventListener('input', () => {
      clip = moveEnd(clip, Number(to.value), duration);
      video.pause();
      video.currentTime = clip.end;
      render();
    });
    // Playing stops at the end handle, so "Play the clip" plays only the clip.
    video.addEventListener('timeupdate', () => {
      if (!video.paused && clip.end < duration && video.currentTime >= clip.end) video.pause();
    });

    const make = async (kind: 'mp4' | 'gif'): Promise<void> => {
      for (const b of controls) b.disabled = true;
      from.disabled = to.disabled = true;
      const span = clip;
      const line = status(out, kind === 'gif' ? 'Making the GIF on your device…' : 'Cutting the clip on your device…');
      const bar = el('progress');
      bar.max = 1;
      bar.value = 0;
      out.append(bar);
      const onProgress = (r: number): void => {
        bar.value = r;
      };
      try {
        const input = await bytes;
        let made: Uint8Array;
        if (kind === 'gif') {
          made = await clipper.gif(input, span, plan(), onProgress);
          // The credit rides in the GIF's comment block, like a fetched GIF's.
          if (post) made = tagImage(made, 'image/gif', embeddedCredit(post));
        } else {
          made = await clipper.mp4(input, span, onProgress);
        }
        const name = clipFilename(file.name, span, kind);
        const clipFile = new File([made as BlobPart], name, { type: kind === 'gif' ? 'image/gif' : 'video/mp4' });
        line.textContent = `${name} · ${(clipFile.size / 1024 / 1024).toFixed(1)} MB`;
        const row = el('div', 'result');
        row.setAttribute('data-testid', 'clip-result');
        const done = el('div', 'actions');
        if (webShareOut.canShareFiles()) {
          done.append(
            button('Share…', 'btn btn-primary', 'clip-share', () => {
              webShareOut.share(clipFile).catch((err: unknown) => log.warn('share dismissed', err));
            }),
          );
        }
        done.append(button('Save', 'btn btn-secondary', 'clip-save', () => saveFile(clipFile)));
        row.append(preview(clipFile), done);
        out.append(row);
      } catch (err) {
        log.error('clip failed', err);
        line.textContent = `Could not make the clip: ${err instanceof Error ? err.message : String(err)}`;
        line.setAttribute('data-tone', 'error');
      } finally {
        bar.remove();
        for (const b of controls) b.disabled = false;
        from.disabled = to.disabled = false;
      }
    };
    return box;
  }

  /**
   * The credit, written into a file regift did NOT fetch — same rules as
   * fileFor: EXIF/iTXt/comment block for pictures, container tags for mp4. It
   * degrades to the file as it came on any error, because a tagging failure
   * must never cost the file itself.
   */
  async function tagged(file: File, post: Post): Promise<File> {
    const credit = embeddedCredit(post);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (file.type.startsWith('image/')) {
        return new File([tagImage(bytes, file.type, credit) as BlobPart], file.name, { type: file.type });
      }
      if (file.type === 'video/mp4') {
        const tags = { title: post.title ?? credit.description, artist: credit.author, comment: credit.description };
        return new File([(await muxer.tag(bytes, tags)) as BlobPart], file.name, { type: file.type });
      }
    } catch (err) {
      log.warn('credit embedding failed; keeping the shared file as it came', err);
    }
    return file;
  }

  /** The filename the worker parked with the bytes (percent-encoded: header
   *  values are latin-1, filenames are not). */
  function parkedName(res: Response): string {
    const raw = res.headers.get('x-regift-filename') ?? '';
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }

  /**
   * Collect the files the worker parked for this share (src/sw-nav.ts). TAKEN,
   * not borrowed: the inbox is emptied here, so a reload of the landing address
   * cannot re-deliver a share that has already been handled.
   */
  async function takeSharedMedia(count: number): Promise<File[]> {
    const files: File[] = [];
    try {
      const cache = await caches.open(INBOX_CACHE);
      for (let i = 0; i < count; i++) {
        const res = await cache.match(shareInboxKey(location.href, i));
        if (!res) continue;
        const blob = await res.blob();
        const type = res.headers.get('content-type') ?? blob.type;
        files.push(new File([blob], parkedName(res) || `regift-${i + 1}`, { type }));
      }
    } catch (err) {
      log.warn('could not collect the shared files', err);
    } finally {
      // Emptied even if collecting went wrong, so a half-read share is not
      // handed over twice.
      await caches.delete(INBOX_CACHE).catch((err: unknown) => log.warn('could not empty the share inbox', err));
    }
    return files;
  }

  /**
   * A share that carried FILES. The bytes are already here — the OS handed them
   * over, nothing was fetched, no origin was crossed — so this is step 3 with
   * step 2 reduced to the credit. If a link came along too, it is read for that
   * credit; if that read is refused, the files ship uncredited rather than not
   * at all.
   */
  async function produceShared(count: number, link: string | null): Promise<void> {
    s3.setState('active');
    const line = status(s3.body, 'Taking the shared file…');
    const files = await takeSharedMedia(count);
    if (files.length === 0) {
      line.textContent = 'Nothing usable arrived with that share — a share is delivered once, so a reload cannot show it again. Share the picture to regift once more.';
      line.setAttribute('data-tone', 'error');
      line.setAttribute('data-testid', 'media-error');
      return;
    }
    let post: Post | null = null;
    if (link) {
      s2.setState('active');
      try {
        post = await readAny(link, webCourier);
      } catch (err) {
        log.warn('shared media: the link that came with it could not be read', err);
      }
    }
    if (post) {
      s2.body.append(credit(post));
    } else {
      status(
        s2.body,
        link
          ? 'Could not read that post for a credit line — the picture itself came through the share sheet, so it is here anyway.'
          : 'This file came straight through the share sheet, so there is no post to read — and no credit line.',
      );
    }
    s2.setState('done');
    // `const` so the narrowing survives into the closure below.
    const credited = post;
    deliver(credited ? await Promise.all(files.map((f) => tagged(f, credited))) : files, credited, line);
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

  function instagramBlocked(embedUrl: string): void {
    // Measured 2026-09-23: www.instagram.com sends no CORS header, and the post
    // arrives as HTML, not a script — so there is no Reddit-style trick and no
    // JSON a person could paste. The reader is done and waits for the native
    // courier (TODO.md §1); until then the words point at the two routes that
    // hand the FILE over, which crosses no origin at all.
    const hint = el('div', 'hint');
    hint.setAttribute('data-testid', 'instagram-blocked');
    hint.append(
      document.createTextNode(
        'A page cannot read Instagram: www.instagram.com sends no CORS header, and the post is a web page, not data — so regift cannot fetch this by itself yet (its Android app will). Two ways that work today, both handing regift the video file rather than the link:',
      ),
    );
    const ways = el('ol');
    ways.append(
      el('li', undefined, 'In the Instagram app, on the reel, tap Share, then Download (offered when the poster allows saving). Then share the saved video to regift.'),
      el('li', undefined, 'Or open the post’s embed page (the button), long-press the video and save it, then share that file to regift.'),
    );
    hint.append(ways);
    const open = openLink(embedUrl, 'Open the embed page');
    open.setAttribute('data-testid', 'open-instagram-embed');
    s2.body.append(hint, open);
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
      if (isInstagramEmbedUrl(err.url)) instagramBlocked(err.url);
      else assisted(err.url);
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

  // A file share (POST, parked by the worker) beats a link or post data in the
  // same arrival: the bytes are already here, so nothing needs reading.
  const sharedCount = Number(params.get('shared-media') ?? '');
  if (Number.isInteger(sharedCount) && sharedCount > 0) {
    log.info('share target arrival: files', sharedCount);
    void produceShared(sharedCount, arrived);
  } else if (arrivedJson !== null) {
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
