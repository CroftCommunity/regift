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
  await expect(page.getByTestId('preview')).toBeVisible();
});

test('a post link is read by JSONP with no user step when the browser has Reddit cookies', async ({ page }) => {
  test.setTimeout(120_000);
  const reddit = await routeReddit(page, { videoId: 'testvid03' });
  const hits = await routeVredd(page, 'testvid03');
  await page.goto('/index.html?url=' + encodeURIComponent(POST_URL + '?share_id=x&utm_source=share'));
  await page.getByTestId('go').click();
  await expect(page.getByTestId('credit')).toContainText('Dad jokes — u/someredditor in r/GuysBeingDudes');
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
  await expect(page.getByTestId('credit')).toContainText('Dad jokes — u/someredditor in r/GuysBeingDudes');
  await expect(page.getByTestId('save')).toBeVisible({ timeout: 90_000 });
  expect(hits.length).toBe(3);
});

test('a /s/ share link is handed to the browser with the reason', async ({ page }) => {
  await page.goto('/index.html?url=' + encodeURIComponent('https://www.reddit.com/r/GuysBeingDudes/s/NqVUzmSB0S'));
  await page.getByTestId('go').click();
  await expect(page.getByTestId('needs-browser')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the post' })).toHaveAttribute('href', 'https://www.reddit.com/r/GuysBeingDudes/s/NqVUzmSB0S');
});

test('a post with no video says so', async ({ page }) => {
  await routeReddit(page, 'refuse');
  await page.goto('/index.html?url=' + encodeURIComponent('https://www.reddit.com/r/pics/comments/1photo1/a_photo/'));
  await page.getByTestId('go').click();
  await page.getByTestId('post-json').fill(fixture('reddit/post-image.json').toString('utf8'));
  await page.getByTestId('use-json').click();
  await expect(page.getByRole('status').filter({ hasText: /no video/ })).toBeVisible();
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
