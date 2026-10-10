// Browser-only MP4 preparation against the real local administrator and WASM.
// Uses isolated local storage, blocks all external requests, and never posts.
// REAL_REEL_FILE may point at an original that contains an edit list/high audio
// bitrate. The original is read only; all output lives under ignored test-results.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash, randomBytes, scryptSync} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {config} from '../backend/config.cjs';
import {Service} from '../backend/service.cjs';
import {createAdminHandler} from '../server-core.cjs';
import {inspectReel, validateReelMetadata} from '../backend/reels.cjs';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const exec = promisify(execFile);
const tools = fileURLToPath(new URL('../../../sns-test-tools/ffmpeg/ffmpeg-9.0.2-essentials_build/bin/', import.meta.url));
const ffmpeg = process.env.FFMPEG_PATH || path.join(tools, 'ffmpeg.exe');
const ffprobe = process.env.FFPROBE_PATH || path.join(tools, 'ffprobe.exe');
const output = fileURLToPath(new URL('../test-results/reel-preparation/', import.meta.url));
const fixtures = path.join(output, 'fixtures');
await fs.mkdir(fixtures, {recursive: true});
const native = async args => (await exec(ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', ...args], {timeout: 120000, maxBuffer: 4 * 1024 * 1024})).stdout;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = async file => sha256(await fs.readFile(file));
const streamDigest = (file, kind) => native(['-i', file, '-map', `0:${kind}:0`, '-c', 'copy', '-f', 'streamhash', '-hash', 'sha256', '-']);
const frameCount = async file => Number((await exec(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=nb_frames', '-of', 'default=noprint_wrappers=1:nokey=1', file], {timeout: 30000})).stdout.trim());
const metadata = async file => {
  const info = await inspectReel({ffprobe}, file);
  return {kind: 'video', type: 'video/mp4', size: (await fs.stat(file)).size, ...info};
};
const compliant = path.join(fixtures, 'compliant-96k.mp4');
const invalid4k = path.join(fixtures, 'too-wide-4k.mp4');
const fallbackOriginal = path.join(fixtures, 'needs-preparation.mp4');
await native(['-y', '-f', 'lavfi', '-i', 'color=c=0x13334a:s=360x640:r=30:d=4.2', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=4.2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-movflags', '+faststart', '-use_editlist', '0', compliant]);
await native(['-y', '-f', 'lavfi', '-i', 'color=c=0x12384a:s=3840x2160:r=30:d=3.2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', '-use_editlist', '0', invalid4k]);
if (!process.env.REAL_REEL_FILE) {
  await native(['-y', '-f', 'lavfi', '-i', 'color=c=0x14314d:s=1280x720:r=30000/1001:d=6', '-f', 'lavfi', '-i', 'sine=frequency=800:sample_rate=48000:duration=6', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '320k', '-ac', '2', '-use_editlist', '1', fallbackOriginal]);
}
const original = path.resolve(process.env.REAL_REEL_FILE || fallbackOriginal);
const originalHash = await digest(original), originalInfo = await metadata(original);
const originalVideoHash = await streamDigest(original, 'v');
const compliantInfo = validateReelMetadata(await metadata(compliant));
const compliantVideoHash = await streamDigest(compliant, 'v'), compliantAudioHash = await streamDigest(compliant, 'a');
assert.equal(originalInfo.hasEditList, true, 'The repair test source must contain an MP4 edit list');
assert.ok(originalInfo.audioBitrate > 128000, 'The repair test source must need audio preparation');

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spymedia-browser-preparation-'));
const settings = config({SNS_DATA_DIR: dir, SNS_STORAGE_PERSISTENCE: 'confirmed', SNS_SINGLE_INSTANCE: 'confirmed', FFPROBE_PATH: ffprobe, FFMPEG_PATH: 'must-never-run-server-ffmpeg', PUBLIC_ORIGIN: 'http://127.0.0.1', SNS_PUBLISH_ENABLED: 'false'});
let conversions = 0, providerCalls = 0;
const service = new Service({settings,
  media: {tools: () => {conversions++; throw Error('No server transcoder permitted');}, convert: () => {conversions++; throw Error('No server transcoder permitted');}},
  connectors: {availability: () => ({instagram: false, facebook: false, x: false}), publish: () => {providerCalls++; throw Error('No provider calls permitted');}}
});
const password = randomBytes(24).toString('hex'), salt = randomBytes(16);
const handler = createAdminHandler({mode: 'authenticated', username: 'synthetic', passwordHash: `${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`, secureCookie: false, service});
const writes = [], external = [], errors = [], checks = [], browserDiagnostics = [];
const pass = text => {checks.push(text); console.log('PASS ' + text);};
const server = http.createServer((req, res) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) writes.push({method: req.method, path: req.url});
  handler(req, res).then(done => {if (!done) {res.writeHead(404); res.end();}}).catch(e => {errors.push(e.message); if (!res.headersSent) res.writeHead(500); res.end();});
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
settings.origin = origin;
let browser, preparedInfo;
try {
  browser = await chromium.launch({headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? {executablePath: process.env.CHROMIUM_EXECUTABLE} : {})});
  const context = await browser.newContext({viewport: {width: 1440, height: 1100}, acceptDownloads: true});
  context.setDefaultTimeout(30000);
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith('blob:') || url.startsWith('data:') || new URL(url).origin === origin) return route.continue();
    external.push(url); return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', message => {
    if (message.type() === 'error') browserDiagnostics.push(message.text());
    if (message.text().startsWith('PREPARATION ')) console.log(message.text());
  });
  await page.goto(origin + '/admin/login');
  await page.locator('#login-id').fill('synthetic');
  await page.locator('#login-password').fill(password);
  await page.locator('#login-submit').click();
  await page.waitForURL(origin + '/admin');
  await page.locator('[name=ig-kind][value=reel]').check();
  await page.waitForFunction(() => document.getElementById('reels-send-note').textContent.includes('Instagram 인증 설정'));
  await page.evaluate(() => {
    let previous = '';
    const label = document.getElementById('reels-local-progress-label');
    new MutationObserver(() => {
      const text = label.textContent;
      if (text && text !== previous) {console.log('PREPARATION ' + text); previous = text;}
    }).observe(label, {subtree: true, childList: true, characterData: true});
  });
  const noSideEffects = () => {
    assert.deepEqual(writes.filter(w => w.path !== '/api/admin/login'), []);
    assert.equal(Object.keys(service.store.state.media || {}).length, 0);
    assert.equal(Object.keys(service.store.state.jobs || {}).length, 0);
    assert.equal(conversions, 0); assert.equal(providerCalls, 0);
  };
  const choose = async file => {
    await page.locator('#reels-file').setInputFiles(file);
    await page.waitForFunction(() => {
      const video = document.getElementById('reels-preview');
      return video.videoWidth > 0 && video.readyState >= 1;
    });
  };
  const ready = () => page.waitForFunction(() => !document.getElementById('reels-make-ready').disabled);
  const finish = async () => {
    await page.waitForFunction(() => {
      const anchor = document.getElementById('reels-download');
      const result = document.getElementById('reels-local-result');
      return (anchor && !anchor.hidden && !!anchor.getAttribute('href') && document.getElementById('reels-local-cancel').hidden)
        || (result.classList.contains('reels-error') && result.textContent);
    }, null, {timeout: 600000});
    const result = await page.locator('#reels-local-result').textContent();
    assert.equal(await page.locator('#reels-local-result').evaluate(node => node.classList.contains('reels-error')), false,
      `Browser preparation failed: ${result}\n${browserDiagnostics.slice(-12).join('\n')}`);
  };
  const saveDownload = async file => {
    const download = page.waitForEvent('download');
    await page.locator('#reels-download').click();
    const item = await download;
    assert.match(item.suggestedFilename(), /\.mp4$/i);
    await item.saveAs(file);
    return file;
  };

  await choose(original); await ready();
  assert.equal(await page.locator('#reels-download').isVisible(), false);
  noSideEffects(); pass('Selecting the original only previews locally and sends no media, jobs, or provider request');
  await page.locator('#reels-make-ready').click();
  await page.locator('#reels-local-cancel').waitFor({state: 'visible'});
  assert.equal(await page.locator('#reels-upload').isDisabled(), true);
  assert.equal(await page.locator('#reels-prepare').isDisabled(), true);
  await page.locator('#reels-local-cancel').click(); await ready();
  assert.equal(await page.locator('#reels-download').isVisible(), false);
  assert.match(await page.locator('#reels-local-result').textContent(), /취소/);
  assert.match(await page.locator('#reels-feedback').textContent(), /취소/);
  assert.match(await page.locator('#reels-file-info').textContent(), new RegExp(path.basename(original).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  noSideEffects(); pass('Cancelling browser preparation keeps the original, produces no stale download, and enables retry');

  await page.locator('#reels-make-ready').click();
  await page.locator('#reels-local-cancel').waitFor({state: 'visible'});
  await page.waitForFunction(() => {
    const text = document.getElementById('reels-local-progress-label').textContent;
    return text.includes('음성만 AAC') || text.includes('브라우저에서 게시용')
      || document.getElementById('reels-local-result').classList.contains('reels-error');
  }, null, {timeout: 180000});
  assert.equal(await page.locator('#reels-local-result').evaluate(node => node.classList.contains('reels-error')), false,
    'Worker must begin processing before the stale-selection cancellation test: ' + await page.locator('#reels-local-result').textContent());
  await choose(compliant); await ready();
  assert.equal(await page.locator('#reels-local-cancel').isVisible(), false);
  assert.equal(await page.locator('#reels-download').isVisible(), false);
  assert.match(await page.locator('#reels-file-info').textContent(), /compliant-96k\.mp4/);
  noSideEffects(); pass('Selecting another file cancels the prior task without replacing the new preview or selection');

  await page.locator('#reels-make-ready').click(); await finish();
  const compliantCopy = await saveDownload(path.join(output, 'compliant-browser-prepared.mp4'));
  const compliantCopyInfo = validateReelMetadata(await metadata(compliantCopy));
  assert.equal(await streamDigest(compliantCopy, 'v'), compliantVideoHash);
  assert.equal(await streamDigest(compliantCopy, 'a'), compliantAudioHash);
  assert.equal(compliantCopyInfo.width, compliantInfo.width);
  assert.equal(compliantCopyInfo.height, compliantInfo.height);
  assert.match(await page.locator('#reels-file-info').textContent(), /360 × 640px/);
  noSideEffects(); pass('Real WASM preparation preserves both compressed video and audio streams for an already compliant source');
  await page.locator('#reels-original').click(); await ready();
  assert.equal(await page.locator('#reels-download').isVisible(), false);
  assert.match(await page.locator('#reels-file-info').textContent(), /compliant-96k\.mp4/);
  noSideEffects(); pass('Restore-original clears the generated download and returns the original preview without uploading');

  await page.locator('#reels-drop').evaluate((drop, bytes) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], 'dragged-compliant.mp4', {type: 'video/mp4'}));
    drop.dispatchEvent(new DragEvent('drop', {dataTransfer: transfer, bubbles: true, cancelable: true}));
  }, [...await fs.readFile(compliant)]);
  await finish();
  assert.match(await page.locator('#reels-file-info').textContent(), /dragged-compliant_instagram\.mp4/);
  noSideEffects(); pass('Dropping a real video starts local preparation automatically without a button click or any upload');

  await choose(invalid4k);
  await page.waitForFunction(() => document.getElementById('reels-local-check').textContent.includes('1920'));
  assert.equal(await page.locator('#reels-make-ready').isDisabled(), true);
  assert.equal(await page.locator('#reels-upload').isDisabled(), true);
  const directRejection = await page.evaluate(async () => {
    const {prepareReel} = await import('/admin-assets/reel-preparation.js');
    try {await prepareReel(document.getElementById('reels-file').files[0]); return null;}
    catch (error) {return {name: error.name, code: error.code, message: error.message};}
  });
  assert.ok(directRejection); assert.match(directRejection.message, /1920|크기|해상도/);
  noSideEffects(); pass('A 4K-wide source is rejected by the UI and real engine without video resizing or upload');

  await choose(original); await ready();
  await page.locator('#reels-make-ready').click(); await finish();
  const repaired = await saveDownload(path.join(output, 'original-browser-prepared.mp4'));
  preparedInfo = validateReelMetadata(await metadata(repaired));
  assert.equal(preparedInfo.hasEditList, false); assert.equal(preparedInfo.fastStart, true);
  assert.equal(preparedInfo.width, originalInfo.width); assert.equal(preparedInfo.height, originalInfo.height);
  // Removing AAC priming/edit-list timestamps may slightly alter avg_frame_rate
  // without changing a single video packet. Verify frame count and payload hash.
  assert.ok(Math.abs(preparedInfo.frameRate - originalInfo.frameRate) < .02);
  assert.equal(await frameCount(repaired), await frameCount(original));
  assert.ok(Math.abs(preparedInfo.duration - originalInfo.duration) < .15);
  assert.ok(preparedInfo.audioBitrate <= 128000);
  assert.equal(await streamDigest(repaired, 'v'), originalVideoHash);
  assert.equal(await digest(original), originalHash);
  await native(['-i', repaired, '-f', 'null', '-']);
  assert.match(await page.locator('#reels-local-result').textContent(), /음성|오디오/);
  noSideEffects(); pass('The real original becomes a valid fast-start/edit-list-free MP4: video bytes unchanged, only audio adjusted, full decode succeeds, source untouched');
  await page.locator('#reels-preview').evaluate(async video => {video.muted = true; await video.play();});
  await page.waitForFunction(() => document.getElementById('reels-preview').currentTime > .1);
  await page.locator('#reels-preview').evaluate(video => video.pause());
  await page.locator('#instagram-reels').screenshot({path: path.join(output, 'desktop.png')});
  await page.setViewportSize({width: 390, height: 844});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.locator('#instagram-reels').screenshot({path: path.join(output, 'mobile.png')});
  await page.setViewportSize({width: 1440, height: 1100});
  noSideEffects(); pass('Prepared playback works and the integrated controls fit desktop and 390px mobile');

  assert.equal(await page.locator('#reels-upload').isEnabled(), true);
  await page.locator('#reels-upload').click();
  await page.waitForFunction(() => document.getElementById('reels-media-status').textContent.includes('서버 검사 완료'), null, {timeout: 60000});
  const stored = Object.values(service.store.state.media);
  assert.equal(stored.length, 1); assert.equal(stored[0].sha256, await digest(repaired));
  assert.equal(stored[0].size, preparedInfo.size);
  assert.deepEqual(await fs.readFile(service.store.file(stored[0].id)), await fs.readFile(repaired));
  assert.deepEqual(writes.filter(w => w.path !== '/api/admin/login'), [{method: 'POST', path: '/api/admin/reels'}]);
  assert.equal(Object.keys(service.store.state.jobs).length, 0);
  assert.equal(providerCalls, 0); assert.equal(conversions, 0);
  assert.equal(await page.locator('#reels-send').isDisabled(), true);
  assert.deepEqual(external, []); assert.deepEqual(errors, []);
  assert.equal(await digest(original), originalHash);
  pass('Only the explicit upload sends the completed bytes to local server validation; no server conversion, saved job, or public post occurs');
  const report = {result: 'PASS', checks, sourceName: path.basename(original), originalSha256: originalHash, originalBytes: (await fs.stat(original)).size, prepared: preparedInfo, compressedVideoIdentical: true, compliantAudioIdentical: true, originalUnchanged: true, serverConversions: conversions, providerCalls, externalRequests: external, uploads: 1};
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
  await fs.rm(dir, {recursive: true, force: true});
}
