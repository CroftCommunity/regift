import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

// The whole loop, hermetic: the share sheet delivers a link as a query string
// (Web Share Target, GET), the page reads the DASH manifest and tracks from
// v.redd.it (routed to fixtures here), muxes them with the vendored ffmpeg.wasm
// — the real one, in the real browser — and the Save button yields a file that
// carries both a video and an audio track. A real Reddit post is never touched.

const fixture = (rel: string): Buffer => readFileSync(new URL(`../fixtures/${rel}`, import.meta.url));
const MANIFEST = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static">
  <Period>
    <AdaptationSet contentType="video">
      <Representation bandwidth="100000" codecs="avc1.42c00d" height="160" id="1" mimeType="video/mp4" width="90">
        <BaseURL>CMAF_160.mp4</BaseURL>
      </Representation>
      <Representation bandwidth="900000" codecs="avc1.42c00d" height="1280" id="3" mimeType="video/mp4" width="720">
        <BaseURL>CMAF_720.mp4</BaseURL>
      </Representation>
    </AdaptationSet>
    <AdaptationSet contentType="audio">
      <Representation audioSamplingRate="48000" bandwidth="64000" codecs="mp4a.40.2" id="2" mimeType="audio/mp4">
        <BaseURL>CMAF_AUDIO_64.mp4</BaseURL>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;

async function routeVredd(page: Page, videoId: string): Promise<string[]> {
  const hits: string[] = [];
  await page.route(`https://v.redd.it/${videoId}/**`, (route) => {
    const url = route.request().url();
    hits.push(url);
    const cors = { 'access-control-allow-origin': '*' };
    if (url.endsWith('DASHPlaylist.mpd')) return route.fulfill({ status: 200, headers: cors, contentType: 'application/dash+xml', body: MANIFEST });
    if (url.endsWith('CMAF_160.mp4') || url.endsWith('CMAF_720.mp4')) return route.fulfill({ status: 200, headers: cors, contentType: 'video/mp4', body: fixture('media/video.mp4') });
    if (url.endsWith('CMAF_AUDIO_64.mp4')) return route.fulfill({ status: 200, headers: cors, contentType: 'video/mp4', body: fixture('media/audio.mp4') });
    return route.fulfill({ status: 404, headers: cors, body: 'nope' });
  });
  return hits;
}

const POST_URL = 'https://www.reddit.com/r/GuysBeingDudes/comments/1vys36f/dad_jokes/';
const postListing = (videoId: string): string => fixture('reddit/post-video.json').toString('utf8').replace(/blke7z3ttolh1/g, videoId);

/** reddit.com answers the JSONP read (as a signed-in browser sees it), or refuses it. */
async function routeReddit(page: Page, answer: { readonly videoId: string } | 'refuse'): Promise<string[]> {
  const hits: string[] = [];
  await page.route('https://www.reddit.com/**', (route) => {
    const url = route.request().url();
    hits.push(url);
    const cb = new URL(url).searchParams.get('jsonp');
    if (answer === 'refuse' || !cb) return route.fulfill({ status: 403, contentType: 'text/html', body: 'blocked' });
    return route.fulfill({ status: 200, contentType: 'application/javascript', body: `${cb}(${postListing(answer.videoId)})` });
  });
  return hits;
}

/** Top-level box types in an ISO BMFF buffer, plus the handler types inside moov. */
function boxes(buf: Buffer): { top: string[]; handlers: string[] } {
  const top: string[] = [];
  let i = 0;
  while (i + 8 <= buf.length) {
    const size = buf.readUInt32BE(i);
    top.push(buf.toString('latin1', i + 4, i + 8));
    if (size < 8) break;
    i += size;
  }
  const handlers = [...buf.toString('latin1').matchAll(/hdlr\0\0\0\0\0\0\0\0(vide|soun)/g)].map((m) => m[1] ?? '');
  return { top, handlers };
}

test('a direct video link arriving via the share target becomes a muxed mp4 with sound', async ({ page }) => {
  test.setTimeout(120_000); // the 31 MB core loads once per browser context
  const hits = await routeVredd(page, 'testvid01');
  await page.goto('/index.html?url=https%3A%2F%2Fv.redd.it%2Ftestvid01');
  await expect(page.getByTestId('url')).toHaveValue('https://v.redd.it/testvid01');

  await page.getByTestId('go').click();
  await expect(page.getByTestId('credit')).toHaveText('Direct video link');
  await expect(page.getByTestId('save')).toBeVisible({ timeout: 90_000 });
  expect(hits.map((h) => h.split('/').pop())).toEqual(['DASHPlaylist.mpd', 'CMAF_720.mp4', 'CMAF_AUDIO_64.mp4']);

  const download = page.waitForEvent('download');
  await page.getByTestId('save').click();
  const path = await (await download).path();
  const out = readFileSync(path);
  expect(out.length).toBeGreaterThan(fixture('media/video.mp4').length);
  const { top, handlers } = boxes(out);
  expect(top[0]).toBe('ftyp');
  expect(top).toContain('moov');
  expect(handlers.sort()).toEqual(['soun', 'vide']);
  // The credit rides in the container tags (©cmt via ffmpeg -metadata).
  expect(out.toString('latin1')).toContain('via Reddit');
  await expect(page.getByTestId('preview')).toBeVisible();
});

test('a post link is read by JSONP with no user step when the browser has Reddit cookies', async ({ page }) => {
  test.setTimeout(120_000);
  const reddit = await routeReddit(page, { videoId: 'testvid03' });
  const hits = await routeVredd(page, 'testvid03');
  await page.goto('/index.html?url=' + encodeURIComponent(POST_URL + '?share_id=x&utm_source=share'));
  await page.getByTestId('go').click();
  await expect(page.getByTestId('credit')).toContainText('Dad jokes — u/someredditor on r/GuysBeingDudes');
  expect(reddit).toEqual([POST_URL + '.json?limit=0&raw_json=1&jsonp=__regift_jsonp_1']);
  await expect(page.getByTestId('save')).toBeVisible({ timeout: 90_000 });
  expect(hits.length).toBe(3);
  await expect(page.getByTestId('credit-line')).toHaveText('via u/someredditor on r/GuysBeingDudes — ' + POST_URL);
});

test('the quality cap picks a smaller track', async ({ page }) => {
  test.setTimeout(120_000);
  const hits = await routeVredd(page, 'testvid04');
  await page.goto('/index.html?url=https%3A%2F%2Fv.redd.it%2Ftestvid04');
  await page.getByTestId('quality').selectOption('480');
  await page.getByTestId('go').click();
  await expect(page.getByTestId('save')).toBeVisible({ timeout: 90_000 });
  expect(hits.map((h) => h.split('/').pop())).toEqual(['DASHPlaylist.mpd', 'CMAF_160.mp4', 'CMAF_AUDIO_64.mp4']);
});

test('post data shared as text (select all → Share → regift) proceeds by itself', async ({ page }) => {
  test.setTimeout(120_000);
  await routeVredd(page, 'testvid05');
  await page.goto('/index.html?text=' + encodeURIComponent(postListing('testvid05')));
  await expect(page.getByTestId('credit')).toContainText('Dad jokes');
  await expect(page.getByTestId('url')).toHaveValue(POST_URL);
  await expect(page.getByTestId('save')).toBeVisible({ timeout: 90_000 });
});

test('when Reddit refuses the JSONP read, the assisted step is offered and pasted post data completes the loop', async ({ page }) => {
  test.setTimeout(120_000);
  const postJson = postListing('testvid02');
  await routeReddit(page, 'refuse');
  const hits = await routeVredd(page, 'testvid02');
  await page.goto('/index.html?text=' + encodeURIComponent('look https://www.reddit.com/r/GuysBeingDudes/comments/1vys36f/dad_jokes/?share_id=x'));
  await page.getByTestId('go').click();

  const assisted = page.getByTestId('assisted');
  await expect(assisted).toBeVisible();
  await expect(page.getByTestId('open-old-reddit')).toHaveAttribute('href', 'https://old.reddit.com/r/GuysBeingDudes/comments/1vys36f/dad_jokes/');
  await expect(page.getByTestId('open-json')).toHaveAttribute(
    'href',
    'https://www.reddit.com/r/GuysBeingDudes/comments/1vys36f/dad_jokes/.json?limit=0&raw_json=1',
  );

  // A partial paste is refused with words, not a stack trace.
  await page.getByTestId('post-json').fill(postJson.slice(0, 200));
  await page.getByTestId('use-json').click();
  await expect(page.getByRole('status').filter({ hasText: /not valid JSON/ })).toBeVisible();

  await page.getByTestId('post-json').fill(postJson);
  await page.getByTestId('use-json').click();
  await expect(page.getByTestId('credit')).toContainText('Dad jokes — u/someredditor on r/GuysBeingDudes');
  await expect(page.getByTestId('save')).toBeVisible({ timeout: 90_000 });
  expect(hits.length).toBe(3);
});

test('a /s/ share link is handed to the browser with the reason', async ({ page }) => {
  await page.goto('/index.html?url=' + encodeURIComponent('https://www.reddit.com/r/GuysBeingDudes/s/NqVUzmSB0S'));
  await page.getByTestId('go').click();
  await expect(page.getByTestId('needs-browser')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the post' })).toHaveAttribute('href', 'https://www.reddit.com/r/GuysBeingDudes/s/NqVUzmSB0S');
});

test('a text post says it has no media', async ({ page }) => {
  await routeReddit(page, 'refuse');
  await page.goto('/index.html?url=' + encodeURIComponent('https://www.reddit.com/r/AskReddit/comments/1txt001/what_is_a_good_question/'));
  await page.getByTestId('go').click();
  await page.getByTestId('post-json').fill(fixture('reddit/post-text.json').toString('utf8'));
  await page.getByTestId('use-json').click();
  await expect(page.getByRole('status').filter({ hasText: /no video or images/ })).toBeVisible();
});

test('a gallery becomes three image files from i.redd.it, in order', async ({ page }) => {
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const reads: string[] = [];
  await page.route('https://i.redd.it/**', (route) => {
    reads.push(route.request().url());
    return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'image/png', body: PNG });
  });
  await page.goto('/index.html?text=' + encodeURIComponent(fixture('reddit/post-gallery.json').toString('utf8')));
  await expect(page.getByTestId('save-3')).toBeVisible();
  expect(reads).toEqual(['https://i.redd.it/aaa111.jpg', 'https://i.redd.it/bbb222.png', 'https://i.redd.it/ccc333.gif']);
  await expect(page.getByTestId('credit')).toContainText('Three views — u/galleryposter on r/pics');
});

test('when i.redd.it refuses the page, the words point at the share route that works', async ({ page }) => {
  await page.route('https://i.redd.it/**', (route) => route.abort('failed'));
  await page.goto('/index.html?text=' + encodeURIComponent(fixture('reddit/post-image.json').toString('utf8')));
  await expect(page.getByTestId('media-error')).toContainText('sends no CORS header at all');
  await expect(page.getByTestId('media-error')).toContainText('tap Share, and pick regift');
});

test('an empty link is refused before anything runs', async ({ page }) => {
  await page.goto('/index.html');
  await page.getByTestId('go').click();
  await expect(page.getByRole('status').filter({ hasText: 'Paste a link first.' })).toBeVisible();
});

test('in a browser tab, the page says to install for the share sheet', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.getByTestId('install-hint')).toBeVisible();
});

test('Start over purges a try in progress and the shared query in one tap', async ({ page }) => {
  await page.route('https://www.reddit.com/**', (route) => route.fulfill({ status: 403, body: 'blocked' }));
  await page.goto('/index.html?url=' + encodeURIComponent(POST_URL));
  await page.getByTestId('go').click();
  await expect(page.getByTestId('assisted')).toBeVisible();
  await page.getByTestId('reset').click();
  await expect(page).toHaveURL(/\/index\.html$/);
  await expect(page.getByTestId('url')).toHaveValue('');
  await expect(page.getByTestId('assisted')).toHaveCount(0);
});

// --- The POST file share target -------------------------------------------
//
// Share the PICTURE, not the link. Measured 2026-09-16 (curl, Origin set to the
// deploy origin): i.redd.it, preview.redd.it and external-preview.redd.it send
// NO access-control-allow-origin header, while v.redd.it sends `*` and answers
// an OPTIONS preflight — so no page anywhere can fetch a Reddit picture, and
// the only way in is the OS handing the bytes over. That share is a POST, no
// static host answers a POST, so the service worker is the endpoint.
//
// Playwright cannot raise the Android share sheet, so these drive the worker
// directly: register it, wait for it to control the page, then POST the form it
// would receive and follow the redirect it answers with.
test.describe('the share target receives files', () => {
  // The rest of the suite blocks workers (they bypass page.route fixtures);
  // here the worker IS the code under test.
  test.use({ serviceWorkers: 'allow' });

  const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

  /** Load the page and wait until its worker is installed AND controlling. */
  async function controlled(page: Page): Promise<void> {
    await page.goto('/index.html');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 30_000 });
  }

  /** POST the share the OS would post, and return where the worker sent us. */
  async function postShare(
    page: Page,
    files: readonly { readonly name: string; readonly type: string; readonly b64?: string }[],
    fields: Readonly<Record<string, string>> = {},
  ): Promise<string> {
    return page.evaluate(
      async ([files, fields]) => {
        const form = new FormData();
        for (const [key, value] of Object.entries(fields as Record<string, string>)) form.append(key, value);
        for (const f of files as { name: string; type: string; b64?: string }[]) {
          const bytes = Uint8Array.from(atob(f.b64 ?? 'cmVnaWZ0'), (c) => c.charCodeAt(0));
          form.append('media', new File([bytes], f.name, { type: f.type }));
        }
        const res = await fetch('share-target', { method: 'POST', body: form });
        return res.url;
      },
      [files, fields] as const,
    );
  }

  test('a shared picture is delivered with nothing leaving the origin', async ({ page }) => {
    await controlled(page);
    const outside: string[] = [];
    page.on('request', (req) => {
      const url = req.url();
      // A blob: preview URL is the page reading its own file, not a network read.
      if (/^https?:\/\//.test(url) && !url.includes('localhost')) outside.push(url);
    });

    const landing = await postShare(page, [{ name: 'reddit-cat.png', type: 'image/png', b64: PNG_B64 }]);
    expect(new URL(landing).search).toBe('?shared-media=1');

    await page.goto(landing);
    await expect(page.getByTestId('save')).toBeVisible();
    await expect(page.getByTestId('result')).toHaveCount(1);
    await expect(page.getByRole('status').filter({ hasText: 'reddit-cat.png' })).toBeVisible();
    // No post behind the file, so nothing pretends there is a credit.
    await expect(page.getByTestId('credit-line')).toHaveCount(0);
    await expect(page.getByTestId('copy-credit')).toHaveCount(0);
    expect(outside).toEqual([]);
  });

  test('a mixed share keeps the media in order and drops what is not media', async ({ page }) => {
    await controlled(page);
    const landing = await postShare(page, [
      { name: 'first.png', type: 'image/png', b64: PNG_B64 },
      { name: 'notes.txt', type: 'text/plain' },
      { name: 'second.mp4', type: 'video/mp4' },
    ]);
    expect(new URL(landing).search).toBe('?shared-media=2');

    await page.goto(landing);
    await expect(page.getByTestId('save-2')).toBeVisible();
    await expect(page.getByTestId('result')).toHaveCount(2);
    await expect(page.getByTestId('result').nth(0).locator('img.preview')).toHaveAttribute('alt', 'first.png');
    await expect(page.getByTestId('result').nth(1).locator('video.preview')).toHaveCount(1);
  });

  test('a file-less share still arrives as a link, exactly as before', async ({ page }) => {
    await controlled(page);
    const landing = await postShare(page, [], { url: 'https://v.redd.it/testvid09' });
    expect(new URL(landing).search).toBe('?url=https%3A%2F%2Fv.redd.it%2Ftestvid09');

    await page.goto(landing);
    await expect(page.getByTestId('url')).toHaveValue('https://v.redd.it/testvid09');
    await expect(page.getByTestId('result')).toHaveCount(0);
  });

  // A share can carry BOTH the picture and the link it came from; the link is
  // what becomes the credit, and the credit is written into the file itself.
  test('a picture shared with its link is credited from the post', async ({ page }) => {
    await controlled(page);
    await routeReddit(page, { videoId: 'testvid08' });
    const landing = await postShare(page, [{ name: 'dad-jokes.png', type: 'image/png', b64: PNG_B64 }], { url: POST_URL });
    expect(new URL(landing).search).toBe('?shared-media=1&url=' + encodeURIComponent(POST_URL));

    await page.goto(landing);
    await expect(page.getByTestId('credit')).toContainText('Dad jokes — u/someredditor on r/GuysBeingDudes');
    await expect(page.getByTestId('credit-line')).toHaveText('via u/someredditor on r/GuysBeingDudes — ' + POST_URL);
    const download = page.waitForEvent('download');
    await page.getByTestId('save').click();
    const out = readFileSync(await (await download).path());
    // The credit rides inside the file (PNG iTXt), in a file regift never fetched.
    expect(out.toString('latin1')).toContain('via u/someredditor on r/GuysBeingDudes');
  });

  test('a refused read costs the credit, not the file', async ({ page }) => {
    await controlled(page);
    await routeReddit(page, 'refuse');
    const landing = await postShare(page, [{ name: 'orphan.png', type: 'image/png', b64: PNG_B64 }], { url: POST_URL });

    await page.goto(landing);
    await expect(page.getByTestId('save')).toBeVisible();
    await expect(page.getByTestId('credit-line')).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: 'Could not read that post for a credit line' })).toBeVisible();
  });

  test('a handled share is taken, not borrowed — a reload does not re-deliver it', async ({ page }) => {
    await controlled(page);
    const landing = await postShare(page, [{ name: 'once.png', type: 'image/png', b64: PNG_B64 }]);
    await page.goto(landing);
    await expect(page.getByTestId('save')).toBeVisible();

    await page.reload();
    await expect(page.getByTestId('media-error')).toContainText('a share is delivered once');
    await expect(page.getByTestId('result')).toHaveCount(0);
  });
});
