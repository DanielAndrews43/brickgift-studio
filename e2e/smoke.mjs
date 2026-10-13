// End-to-end smoke test: loads the sample set, builds the booklet and packaging, exports the wanted list.
// Run after `npm run build`: `npm run e2e`. Needs network access to the LDraw parts library.
import { chromium } from 'playwright';
import { preview } from 'vite';
import assert from 'node:assert/strict';

const server = await preview({ preview: { port: 4317, strictPort: true } });
const url = 'http://localhost:4317/';
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  proxy,
});
const errors = [];
try {
  const page = await (await browser.newContext({ ignoreHTTPSErrors: !!proxy, acceptDownloads: true })).newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForSelector('#proj-select option', { state: 'attached' });
  // Bring-your-own concept image: no API key involved.
  await page.fill('#f-idea', 'A riding paddock with a white horse');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAFElEQVR4nGM8ISfHAANMDEgANwcANHYBDK9qubUAAAAASUVORK5CYII=', 'base64');
  await page.setInputFiles('#f-img', { name: 'concept.png', mimeType: 'image/png', buffer: png });
  await page.waitForSelector('#concepts figure');
  assert.equal(await page.locator('#concepts figure').count(), 1);
  await page.click('[data-tab=model]');
  await page.selectOption('#sample', 'riding-paddock.mpd');
  await page.waitForSelector('#model-warn .ok, #model-warn .warn', { timeout: 120000 });
  assert.equal(await page.textContent('#model-warn'), 'All parts and colours check out.', 'model warnings');
  assert.match(await page.textContent('#model-stats'), /71pieces/);
  await page.waitForSelector('#builder:not([hidden])', { timeout: 120000 });
  assert.match(await page.textContent('#b-count'), /^71 of 71 pieces/);

  await page.click('[data-tab=book]');
  await page.click('#gen-book');
  await page.waitForFunction(() => /pages|Error/.test(document.querySelector('#book-status').textContent), null, { timeout: 300000 });
  assert.match(await page.textContent('#book-status'), /^\d+ pages$/);

  await page.click('[data-tab=buy]');
  const dl = page.waitForEvent('download');
  await page.click('#dl-xml');
  const xml = await (await (await dl).createReadStream()).toArray().then((c) => Buffer.concat(c).toString());
  assert.equal((xml.match(/<ITEM>/g) || []).length, 32);

  await page.click('[data-tab=pack]');
  await page.click('#gen-pack');
  await page.waitForFunction(() => !document.querySelector('#print-pack').disabled, null, { timeout: 120000 });
  assert.equal(await page.locator('#pack .pg').count(), 3);
  assert.deepEqual(errors, []);
  console.log('e2e smoke test passed');
} finally {
  await browser.close();
  server.httpServer.close();
}
