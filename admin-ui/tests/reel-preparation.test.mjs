import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_REEL_BYTES, readContainerInfo, metadataFromProbe, validateVideo, audioCompliant,
  validatePreparedMetadata, validateTiming, preparationArgs, validateSourceFile, prepareReel } from '../public/reel-preparation.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { validateReelMetadata } = require('../backend/reels.cjs');

function box(type, ...parts) {
  const bytes = Buffer.concat(parts), head = Buffer.alloc(8);
  head.writeUInt32BE(bytes.length + 8); head.write(type, 4); return Buffer.concat([head, bytes]);
}
function edit({ rate = 0x10000, entries = [0], version = 0 } = {}) {
  const b = Buffer.alloc(8 + entries.length * (version ? 20 : 12));
  b.writeUInt8(version); b.writeUInt32BE(entries.length, 4);
  entries.forEach((start, i) => {
    const at = 8 + i * (version ? 20 : 12);
    if (version) { b.writeBigUInt64BE(5000n, at); b.writeBigInt64BE(BigInt(start), at + 8); b.writeUInt32BE(rate, at + 16); }
    else { b.writeUInt32BE(5000, at); b.writeInt32BE(start, at + 4); b.writeUInt32BE(rate, at + 8); }
  });
  return box('edts', box('elst', b));
}
function media({ fast = true, edits, fragmented = false } = {}) {
  const moov = box('moov', box('trak', ...(edits ? [edit(edits)] : []))), mdat = box('mdat', Buffer.alloc(16));
  return new File([box('ftyp', Buffer.from('isom')), ...(fast ? [moov, mdat] : [mdat, moov]), ...(fragmented ? [box('moof')] : [])], '서울 & 촬영.MOV', { type: 'video/quicktime' });
}
function probe({ audio = true, bitrate = '96000', videoOverrides = {}, audioOverrides = {} } = {}) {
  return { format: { duration: '5.000', bit_rate: '2096000' }, streams: [
    { codec_type: 'video', codec_name: 'h264', width: 1280, height: 720, avg_frame_rate: '30/1', bit_rate: '2000000',
      pix_fmt: 'yuv420p', field_order: 'progressive', start_time: '0', duration: '5.000', nb_frames: '150', ...videoOverrides },
    ...(audio ? [{ codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2, bit_rate: bitrate, start_time: '0', duration: '5.000', ...audioOverrides }] : [])
  ] };
}
function info(options = {}) { return metadataFromProbe(probe(options), { fastStart: true, hasEditList: false, complexEditList: false }, 1000); }
function coded(code) { return e => e.code === code && e.message.length > 4; }

test('source validation accepts MP4/MOV local files; rejects URL, MIME mismatch, empty and oversized input', () => {
  validateSourceFile(media());
  assert.throws(() => validateSourceFile('https://youtube.com/watch?v=abc'), coded('prep_file_type'));
  const fake = { name: 'movie.mp4', type: '', arrayBuffer() {}, slice() {}, size: 1 };
  validateSourceFile(fake);
  for (const size of [0, MAX_REEL_BYTES + 1, NaN]) assert.throws(() => validateSourceFile({ ...fake, size }), coded('prep_file_size'));
  assert.throws(() => validateSourceFile({ ...fake, type: 'text/html' }), coded('prep_file_type'));
});

test('bounded BMFF parser recognizes edit lists and faststart without reading mdat payload', async () => {
  const original = media({ fast: false, edits: { entries: [0] } });
  const reads = [];
  const input = { size: original.size, slice(start, end) { reads.push([start, end]); return original.slice(start, end); } };
  assert.deepEqual(await readContainerInfo(input), { fastStart: false, hasEditList: true, complexEditList: false });
  assert.ok(reads.every(([start, end]) => end - start <= 20));
  assert.deepEqual(await readContainerInfo(media()), { fastStart: true, hasEditList: false, complexEditList: false });
});

test('ordinary 64-bit edit entries accepted, complex/repeated/reordered/rate lists rejected', async () => {
  for (const entries of [[0], [-1, 1024]]) {
    assert.equal((await readContainerInfo(media({ edits: { entries, version: 1 } }))).complexEditList, false);
  }
  for (const edits of [{ entries: [0, 2] }, { entries: [0, 2, 3] }, { entries: [-1] }, { entries: [-2] }, { rate: 0x20000 }]) {
    assert.equal((await readContainerInfo(media({ edits }))).complexEditList, true);
  }
  assert.equal((await readContainerInfo(media({ fragmented: true }))).complexEditList, true);
});

test('truncated, overflowed and non-media containers are rejected', async () => {
  await assert.rejects(readContainerInfo(new Blob([Buffer.from('garbage')])), coded('prep_container'));
  const broken = Buffer.alloc(16); broken.writeUInt32BE(1000); broken.write('ftyp', 4);
  await assert.rejects(readContainerInfo(new Blob([broken])), coded('prep_container'));
  const huge = Buffer.alloc(16); huge.writeUInt32BE(1); huge.write('ftyp', 4); huge.writeBigUInt64BE(2n ** 63n, 8);
  await assert.rejects(readContainerInfo(new Blob([huge])), coded('prep_container'));
});

test('metadata defaults do not accidentally treat missing numeric fields as zero', () => {
  assert.ok(Number.isNaN(info({ videoOverrides: { start_time: undefined } }).videoStart));
  assert.ok(Number.isNaN(info({ bitrate: undefined, audioOverrides: { bit_rate: undefined } }).audioBitrate));
});

test('unsupported video is rejected instead of downscaling, rotating or reencoding', () => {
  for (const [change, code] of [
    [{ width: 3840 }, 'prep_dimensions'], [{ duration: 901 }, 'prep_duration'], [{ videoCodec: 'vp9' }, 'prep_video_codec'],
    [{ frameRate: 120 }, 'prep_frame_rate'], [{ videoBitrate: 26_000_000 }, 'prep_video_bitrate'],
    [{ pixelFormat: 'yuv420p10le' }, 'prep_pixel_format'], [{ colorTransfer: 'smpte2084' }, 'prep_pixel_format'],
    [{ fieldOrder: 'tt' }, 'prep_interlaced'], [{ rotation: 90 }, 'prep_rotation'], [{ complexEditList: true }, 'prep_complex_edits']
  ]) assert.throws(() => validateVideo({ ...info(), ...change }), coded(code));
  validateVideo(info({ audio: false }));
});

test('stream multiplicity is rejected and data streams do not alter selected video/audio', () => {
  const d = probe(); d.streams.push({ codec_type: 'data' }); metadataFromProbe(d, {}, 100);
  d.streams.push({ ...d.streams[0] }); assert.throws(() => metadataFromProbe(d, {}, 100), coded('prep_streams'));
  const subtitles = probe(); subtitles.streams.push({ codec_type: 'subtitle' });
  assert.throws(() => metadataFromProbe(subtitles, {}, 100), coded('prep_streams'));
});

test('video always stream copies; only noncompliant audio encodes AAC120k', () => {
  const good = preparationArgs(info()), high = preparationArgs(info({ bitrate: '317000', audioOverrides: { sample_rate: '96000', channels: 6 } }));
  assert.equal(good[good.indexOf('-c:v') + 1], 'copy'); assert.equal(good[good.indexOf('-c:a') + 1], 'copy');
  assert.equal(high[high.indexOf('-c:v') + 1], 'copy'); assert.equal(high[high.indexOf('-c:a') + 1], 'aac');
  assert.equal(high[high.indexOf('-b:a') + 1], '120k'); assert.equal(high[high.indexOf('-ar') + 1], '48000');
  assert.equal(high[high.indexOf('-ac') + 1], '2'); assert.equal(high.includes('-vf'), false);
  assert.ok(good.includes('+faststart')); assert.equal(good[good.indexOf('-use_editlist') + 1], '0');
  assert.equal(preparationArgs(info({ audio: false })).includes('0:a:0?'), true);
  assert.equal(audioCompliant(info({ bitrate: '128001' })), false);
});

test('final rules mirror server validator and timing accepts AAC priming but rejects sync/lost frames', () => {
  const good = validatePreparedMetadata(info()); validateReelMetadata(good);
  validateTiming(good, { ...good, duration: 5.022, videoStart: .022, audioStart: 0, audioDuration: 5.022 });
  validateTiming({ ...good, frameRate: 29.97002997, duration: 131.6315, videoDuration: 131.6315 },
    { ...good, frameRate: 29.96517356, duration: 131.652833, videoDuration: 131.652833, videoStart: .021333 });
  for (const change of [{ videoFrames: 149 }, { audioStart: .3 }, { duration: 4 }, { audioCodec: null }, { videoStart: NaN }])
    assert.throws(() => validateTiming(good, { ...good, ...change }), coded('prep_timing'));
  assert.throws(() => validatePreparedMetadata({ ...good, hasEditList: true }), coded('prep_output_layout'));
  assert.throws(() => validatePreparedMetadata({ ...good, audioBitrate: 130000 }), coded('prep_output_audio'));
});

class FakeEngine {
  constructor({ source = probe(), output = probe(), failExec = false, mismatchedHash = false, hangLoad = false, probeCode = 0 } = {}) {
    Object.assign(this, { source, output, failExec, mismatchedHash, hangLoad, probeCode });
    this.commands = []; this.terminated = 0; this.files = new Map();
  }
  on() {}
  async load(config) { this.config = config; if (this.hangLoad) return new Promise(() => {}); }
  async writeFile(name, data) { this.files.set(name, data); }
  async ffprobe(args) { const out = args.at(-1); this.files.set(out, JSON.stringify(out === 'source.json' ? this.source : this.output)); return this.probeCode; }
  async exec(args) {
    this.commands.push(args); if (this.failExec) return 1;
    if (args.includes('streamhash')) this.files.set(args.at(-1), '0,v,SHA256=' + (this.mismatchedHash && args.at(-1) === 'prepared.sha256' ? 'b' : 'a').repeat(64) + '\n');
    else this.files.set('prepared.mp4', new Uint8Array(await media().arrayBuffer()));
    return 0;
  }
  async readFile(name) { return this.files.get(name); }
  terminate() { this.terminated++; }
}

test('end-to-end local coordinator creates File, checks hashes, reports progress and frees worker', async () => {
  const engine = new FakeEngine({ source: probe({ bitrate: '317000' }), output: probe({ bitrate: '120000' }) }), progress = [];
  const result = await prepareReel(media({ edits: {} }), { engineFactory: async () => engine, onProgress: item => progress.push(item) });
  assert.equal(result.file.name, '서울 & 촬영_instagram.mp4'); assert.equal(result.file.type, 'video/mp4');
  assert.equal(result.changedAudio, true); assert.equal(result.warnings.length, 1); assert.equal(engine.terminated, 1);
  assert.equal(progress.at(-1).stage, 'complete'); assert.equal(progress.at(-1).progress, 1);
  assert.ok(engine.config.coreURL.endsWith('/vendor/ffmpeg-core/ffmpeg-core.js'));
  assert.equal(engine.commands.length, 3); validateReelMetadata(result.metadata);
});

test('failed conversion and unequal video data leave original intact and permit retry', async () => {
  const input = media(), bytes = await input.arrayBuffer();
  for (const [settings, code] of [[{ failExec: true }, 'prep_conversion'], [{ mismatchedHash: true }, 'prep_video_integrity']]) {
    const engine = new FakeEngine(settings);
    await assert.rejects(prepareReel(input, { engineFactory: async () => engine }), coded(code));
    assert.equal(engine.terminated, 1); assert.deepEqual(await input.arrayBuffer(), bytes);
  }
  const engine = new FakeEngine(); await prepareReel(input, { engineFactory: async () => engine });
  assert.equal(engine.terminated, 1);
});

test('pinned WASM ffprobe success sentinel needs fresh valid error-free JSON; reported errors still fail', async () => {
  const sentinel = new FakeEngine({ probeCode: -1 });
  await prepareReel(media(), { engineFactory: async () => sentinel });
  for (const settings of [{ probeCode: 1 }, { probeCode: -1, source: { error: { code: -1, string: 'invalid input' } } }, { probeCode: -1, source: { streams: [], format: {} } }]) {
    await assert.rejects(prepareReel(media(), { engineFactory: async () => new FakeEngine(settings) }), e => ['prep_probe', 'prep_streams'].includes(e.code));
  }
});

test('cancel during load terminates worker, rejects concurrent prepare, and next attempt succeeds', async () => {
  const controller = new AbortController(), engine = new FakeEngine({ hangLoad: true });
  const running = prepareReel(media(), { signal: controller.signal, engineFactory: async () => engine });
  await new Promise(resolve => setTimeout(resolve, 0));
  await assert.rejects(prepareReel(media(), { engineFactory: async () => new FakeEngine() }), coded('prep_busy'));
  controller.abort(); await assert.rejects(running, e => e.name === 'AbortError'); assert.equal(engine.terminated, 1);
  await prepareReel(media(), { engineFactory: async () => new FakeEngine() });
});

test('already-aborted request starts no engine', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  await assert.rejects(prepareReel(media(), { signal: controller.signal, engineFactory() { calls++; } }), e => e.name === 'AbortError');
  assert.equal(calls, 0);
});
