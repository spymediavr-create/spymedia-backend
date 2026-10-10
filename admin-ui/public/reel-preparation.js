// Local-only media preparation. Source bytes stay in this browser's worker;
// uploading and publishing remain separate, explicit administrator actions.
export const MAX_REEL_BYTES = 300_000_000;
const COMMAND_TIMEOUT = 600_000;
let active = false;

function fail(code, message) { const e = new Error(message); e.code = code; throw e; }
function aborted() { return new DOMException('게시용 사본 만들기를 취소했습니다.', 'AbortError'); }
function checkAbort(signal) { if (signal?.aborted) throw aborted(); }
function number(value) { return value === undefined || value === null || value === '' ? NaN : Number(value); }
function rate(value) { const [n, d = '1'] = String(value || '').split('/'); return number(n) / number(d); }

export function canPrepareReel() {
  return typeof Worker === 'function' && typeof WebAssembly === 'object' && typeof File === 'function'
    && globalThis.isSecureContext !== false;
}

export function validateSourceFile(file) {
  if (!file || typeof file.arrayBuffer !== 'function' || typeof file.slice !== 'function'
      || !/\.(mp4|mov)$/i.test(file.name || '') || !['', 'video/mp4', 'video/quicktime'].includes(file.type || ''))
    fail('prep_file_type', 'MP4 또는 MOV 원본 영상 파일을 선택해 주세요. 유튜브 주소는 사용할 수 없습니다.');
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_REEL_BYTES)
    fail('prep_file_size', '300MB 이하의 영상만 정리할 수 있습니다. 프리미어에서 더 작은 MP4로 내보내 주세요.');
}

// Inspect bounded BMFF headers without reading the potentially large mdat payload.
export async function readContainerInfo(file, signal) {
  let count = 0, moov = -1, mdat = -1, ftyp = false, hasEditList = false, complexEditList = false;
  const invalid = () => fail('prep_container', 'MP4/MOV 파일 구조를 읽지 못했습니다. 원본을 다시 내보내 주세요.');
  async function read(start, length) {
    checkAbort(signal);
    if (length < 0 || start < 0 || start + length > file.size) invalid();
    const buffer = await file.slice(start, start + length).arrayBuffer();
    if (buffer.byteLength !== length) invalid();
    return new DataView(buffer);
  }
  async function edit(start, end) {
    if (end - start < 8) invalid();
    const header = await read(start, 8), version = header.getUint8(0), entries = header.getUint32(4);
    if (version !== 0 && version !== 1) invalid();
    const step = version === 1 ? 20 : 12;
    if (entries === 0 || entries * step > end - start - 8) invalid();
    if (entries > 2) { complexEditList = true; return; }
    let mediaEntries = 0;
    for (let i = 0; i < entries; i++) {
      const data = await read(start + 8 + i * step, step);
      const mediaTime = version === 1 ? data.getBigInt64(8) : BigInt(data.getInt32(4));
      if (data.getUint32(step - 4) !== 0x00010000 || mediaTime < -1n) complexEditList = true;
      if (mediaTime >= 0n) mediaEntries++;
      else if (i !== 0 || entries !== 2) complexEditList = true;
    }
    if (mediaEntries !== 1) complexEditList = true;
  }
  async function boxes(start, end, depth) {
    if (depth > 8) invalid();
    for (let offset = start; offset < end;) {
      checkAbort(signal);
      if (++count > 10000 || end - offset < 8) invalid();
      const head = await read(offset, Math.min(16, end - offset));
      let length = head.getUint32(0), headerSize = 8;
      const type = String.fromCharCode(...new Uint8Array(head.buffer, 4, 4));
      if (length === 1) {
        if (head.byteLength < 16) invalid();
        const wide = head.getBigUint64(8); if (wide > BigInt(Number.MAX_SAFE_INTEGER)) invalid();
        length = Number(wide); headerSize = 16;
      } else if (length === 0) length = end - offset;
      if (length < headerSize || offset + length > end) invalid();
      if (depth === 0) {
        if (type === 'ftyp') ftyp = true;
        if (type === 'moov') { if (moov !== -1) invalid(); moov = offset; }
        if (type === 'mdat' && mdat === -1) mdat = offset;
        // Fragmented sources require different timing handling and are not remuxed silently.
        if (type === 'moof') complexEditList = true;
      }
      if (type === 'elst') { hasEditList = true; await edit(offset + headerSize, offset + length); }
      if (['moov', 'trak', 'edts'].includes(type)) await boxes(offset + headerSize, offset + length, depth + 1);
      offset += length;
    }
  }
  await boxes(0, file.size, 0);
  if (!ftyp || moov === -1 || mdat === -1) invalid();
  return { fastStart: moov < mdat, hasEditList, complexEditList };
}

export function metadataFromProbe(data, layout, size) {
  const streams = Array.isArray(data?.streams) ? data.streams : [];
  const videos = streams.filter(s => s.codec_type === 'video'), audios = streams.filter(s => s.codec_type === 'audio');
  if (videos.length !== 1 || audios.length > 1 || streams.some(s => !['video', 'audio', 'data'].includes(s.codec_type)))
    fail('prep_streams', '영상 1개와 음성 1개 이하로 구성된 MP4가 필요합니다. 프리미어에서 다시 내보내 주세요.');
  const v = videos[0], a = audios[0], rotation = (v.side_data_list || []).find(s => s.rotation !== undefined);
  return {
    kind: 'video', type: 'video/mp4', size, width: number(v.width), height: number(v.height),
    duration: number(data.format?.duration ?? v.duration), videoCodec: v.codec_name,
    frameRate: rate(v.avg_frame_rate), videoBitrate: number(v.bit_rate ?? data.format?.bit_rate),
    pixelFormat: v.pix_fmt, fieldOrder: v.field_order,
    rotation: number(rotation?.rotation ?? v.tags?.rotate ?? 0),
    colorTransfer: v.color_transfer || '',
    audioCodec: a ? a.codec_name || 'unknown' : null, audioBitrate: a ? number(a.bit_rate) : 0,
    audioSampleRate: a ? number(a.sample_rate) : 0, audioChannels: a ? number(a.channels) : 0,
    videoStart: number(v.start_time), videoDuration: number(v.duration), videoFrames: number(v.nb_frames),
    audioStart: a ? number(a.start_time) : 0, audioDuration: a ? number(a.duration) : 0,
    ...layout
  };
}

export function validateVideo(m) {
  if (!Number.isInteger(m.width) || m.width < 1 || m.width > 1920 || !Number.isInteger(m.height) || m.height < 1 || m.height > 8192)
    fail('prep_dimensions', '영상 가로 크기는 1920px 이하여야 합니다. 프리미어에서 크기를 줄여 내보내 주세요.');
  if (!Number.isFinite(m.duration) || m.duration < 3 || m.duration > 900)
    fail('prep_duration', '영상 길이는 3초 이상 15분 이하여야 합니다.');
  if (!['h264', 'hevc'].includes(m.videoCodec)) fail('prep_video_codec', '영상 코덱은 H.264 또는 HEVC여야 합니다. 프리미어에서 H.264 MP4로 내보내 주세요.');
  if (!Number.isFinite(m.frameRate) || m.frameRate < 23 || m.frameRate > 60) fail('prep_frame_rate', '영상 프레임 속도는 23~60fps여야 합니다.');
  if (!Number.isFinite(m.videoBitrate) || m.videoBitrate <= 0 || m.videoBitrate > 25_000_000)
    fail('prep_video_bitrate', '영상 비트레이트는 25Mbps 이하여야 합니다. 프리미어 내보내기 설정을 확인해 주세요.');
  if (!['yuv420p', 'yuvj420p'].includes(m.pixelFormat) || ['smpte2084', 'arib-std-b67'].includes(m.colorTransfer))
    fail('prep_pixel_format', 'HDR·10비트 영상은 여기서 자동 변환하지 않습니다. SDR·8비트 4:2:0 MP4로 내보내 주세요.');
  if (!['progressive', 'unknown'].includes(m.fieldOrder)) fail('prep_interlaced', '프로그레시브 영상으로 내보내 주세요. 인터레이스 영상은 자동 변환하지 않습니다.');
  if (m.rotation !== 0) fail('prep_rotation', '회전 정보가 있는 영상입니다. 편집 프로그램에서 방향을 적용한 MP4로 내보내 주세요.');
  if (m.complexEditList) fail('prep_complex_edits', '반복·속도 변경 등 복잡한 재생 정보가 있어 자동 정리를 중단했습니다. 프리미어에서 새 MP4로 내보내 주세요.');
  return m;
}

export function audioCompliant(m) {
  return m.audioCodec === null || (m.audioCodec === 'aac' && Number.isFinite(m.audioBitrate)
    && m.audioBitrate > 0 && m.audioBitrate <= 128_000 && Number.isInteger(m.audioSampleRate)
    && m.audioSampleRate > 0 && m.audioSampleRate <= 48000 && [1, 2].includes(m.audioChannels));
}

export function validatePreparedMetadata(m) {
  validateVideo(m);
  if (!Number.isSafeInteger(m.size) || m.size < 1 || m.size > MAX_REEL_BYTES) fail('prep_output_size', '게시용 사본이 300MB를 넘어 저장하지 않았습니다. 더 작은 원본으로 다시 시도해 주세요.');
  if (!m.fastStart || m.hasEditList) fail('prep_output_layout', '게시용 MP4 구조 검사를 통과하지 못했습니다. 원본은 변경되지 않았습니다.');
  if (!audioCompliant(m)) fail('prep_output_audio', '음성 규격 검사를 통과하지 못했습니다. 원본은 변경되지 않았습니다.');
  return m;
}

export function validateTiming(before, after) {
  const bad = () => fail('prep_timing', '정리 과정에서 영상·음성 타이밍 차이가 감지되어 사본을 저장하지 않았습니다. 프리미어에서 새 MP4로 내보내 주세요.');
  if (before.videoCodec !== after.videoCodec || before.width !== after.width || before.height !== after.height) bad();
  // avg_frame_rate is duration-derived, so removal of AAC priming/edit metadata
  // can slightly change it even when every encoded video packet is unchanged.
  // Frame counts, duration/sync bounds and the packet hash establish preservation;
  // validateVideo still independently enforces the output's 23–60fps limit.
  if (Number.isFinite(before.videoFrames) && Number.isFinite(after.videoFrames) && before.videoFrames !== after.videoFrames) bad();
  // MP4 audio priming/B-frame timestamps may change by a few milliseconds during
  // a remux. Larger timing changes are rejected rather than silently changing sync.
  for (const key of ['duration', 'videoDuration']) {
    if (!Number.isFinite(before[key]) || !Number.isFinite(after[key]) || Math.abs(before[key] - after[key]) > .15) bad();
  }
  if (!Number.isFinite(before.videoStart) || !Number.isFinite(after.videoStart) || Math.abs(before.videoStart - after.videoStart) > .15) bad();
  if ((before.audioCodec === null) !== (after.audioCodec === null)) bad();
  if (before.audioCodec !== null) {
    if (![before.audioStart, after.audioStart, before.audioDuration, after.audioDuration].every(Number.isFinite)) bad();
    if (Math.abs(before.audioDuration - after.audioDuration) > .15
        || Math.abs((before.audioStart - before.videoStart) - (after.audioStart - after.videoStart)) > .1) bad();
  }
}

function inputArgs(name) {
  return ['-v', 'error', '-max_alloc', '67108864', '-protocol_whitelist', 'file', '-format_whitelist', 'mov',
    '-f', 'mov', '-enable_drefs', '0', '-probesize', '8388608', '-analyzeduration', '5000000', '-noautorotate', '-i', name];
}

export function preparationArgs(source, input = 'source.mp4', output = 'prepared.mp4') {
  const args = [...inputArgs(input), '-map', '0:v:0', '-map', '0:a:0?', '-map_metadata', '-1', '-map_chapters', '-1', '-sn', '-dn', '-c:v', 'copy'];
  if (!audioCompliant(source)) {
    args.push('-c:a', 'aac', '-b:a', '120k');
    if (!Number.isInteger(source.audioSampleRate) || source.audioSampleRate < 1 || source.audioSampleRate > 48000) args.push('-ar', '48000');
    if (![1, 2].includes(source.audioChannels)) args.push('-ac', '2');
  } else args.push('-c:a', 'copy');
  return [...args, '-movflags', '+faststart', '-use_editlist', '0', '-fs', String(MAX_REEL_BYTES + 1), '-f', 'mp4', output];
}

async function defaultEngineFactory() {
  const { FFmpeg } = await import('./vendor/ffmpeg/index.js');
  return new FFmpeg();
}

export async function prepareReel(file, { onProgress = () => {}, signal, engineFactory = defaultEngineFactory } = {}) {
  validateSourceFile(file); checkAbort(signal);
  if (active) fail('prep_busy', '다른 영상 정리가 진행 중입니다. 완료 또는 취소 후 다시 시도해 주세요.');
  active = true;
  let engine, stage = 'loading', sourceDuration = 0, terminated = false;
  const terminate = () => { terminated = true; try { engine?.terminate(); } catch {} };
  const abort = () => terminate();
  const report = (next, progress, message) => { stage = next; onProgress({ stage, progress, message }); };
  // A wall-clock deadline also handles failed worker startup and an unresponsive
  // WebAssembly worker. The library's command timeout alone cannot cover those.
  async function bounded(operation, timeout = 60_000) {
    checkAbort(signal);
    let timer, abortListener;
    const interruption = new Promise((_, reject) => {
      timer = setTimeout(() => { terminate(); const e = new Error('브라우저 처리가 오래 걸려 중단했습니다. 다시 시도하거나 PC용 도구를 이용해 주세요.'); e.code = 'prep_timeout'; reject(e); }, timeout);
      abortListener = () => reject(aborted()); signal?.addEventListener('abort', abortListener, { once: true });
    });
    try { return await Promise.race([operation(), interruption]); }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abortListener); }
  }
  signal?.addEventListener('abort', abort, { once: true });
  try {
    report('loading', 0, '게시용 정리 도구를 불러옵니다. 첫 실행에는 시간이 걸릴 수 있습니다.');
    engine = await bounded(() => engineFactory()); checkAbort(signal);
    engine.on('progress', ({ time }) => {
      if (stage === 'preparing' && sourceDuration > 0) {
        const progress = Math.min(.94, .2 + .62 * Math.max(0, Math.min(1, Number(time) / 1_000_000 / sourceDuration)));
        report('preparing', progress, '브라우저에서 게시용 사본을 만들고 있습니다.');
      }
    });
    await bounded(() => engine.load({
      coreURL: new URL('./vendor/ffmpeg-core/ffmpeg-core.js', import.meta.url).href,
      wasmURL: new URL('./vendor/ffmpeg-core/ffmpeg-core.wasm', import.meta.url).href
    }, { signal }), 120_000);
    checkAbort(signal);
    report('inspecting', .1, '원본의 영상·음성 규격과 편집 목록을 확인합니다.');
    const sourceLayout = await readContainerInfo(file, signal);
    const sourceBytes = new Uint8Array(await bounded(() => file.arrayBuffer()));
    checkAbort(signal);
    await bounded(() => engine.writeFile('source.mp4', sourceBytes, { signal }));
    async function probe(name, size, layout, reportName) {
      const result = await bounded(() => engine.ffprobe(['-v', 'error', '-max_alloc', '67108864', '-protocol_whitelist', 'file',
        '-format_whitelist', 'mov', '-f', 'mov', '-enable_drefs', '0', '-probesize', '8388608', '-analyzeduration', '5000000',
        '-show_error', '-show_streams', '-show_format', '-of', 'json', name, '-o', reportName], 60_000, { signal }));
      // The pinned @ffmpeg/core 0.12.10 ffprobe emits a complete report on
      // success but leaves Module.ret at its -1 sentinel. Accept that sentinel
      // only with a fresh, parseable, error-free report and validated streams.
      if (result !== 0 && result !== -1) fail('prep_probe', '영상 정보를 읽지 못했습니다. 프리미어에서 새 MP4로 내보내 주세요.');
      const text = await bounded(() => engine.readFile(reportName, 'utf8', { signal }));
      let data; try { data = JSON.parse(text); } catch { fail('prep_probe', '영상 검사 결과를 읽지 못했습니다.'); }
      if (!data || data.error || !data.format || !Array.isArray(data.streams)) fail('prep_probe', '영상 정보를 읽지 못했습니다. 프리미어에서 새 MP4로 내보내 주세요.');
      return metadataFromProbe(data, layout, size);
    }
    const source = validateVideo(await probe('source.mp4', file.size, sourceLayout, 'source.json'));
    sourceDuration = source.duration;
    const changedAudio = !audioCompliant(source);
    report('preparing', .2, changedAudio ? '영상 화질을 유지하고 음성만 AAC 120kbps로 조정합니다.' : '영상·음성을 재압축하지 않고 MP4 구조를 정리합니다.');
    const result = await bounded(() => engine.exec(preparationArgs(source), COMMAND_TIMEOUT, { signal }), COMMAND_TIMEOUT + 5000);
    if (result !== 0) fail('prep_conversion', '게시용 사본을 만들지 못했습니다. 메모리가 부족하면 다른 탭을 닫고 다시 시도해 주세요. 원본은 변경되지 않았습니다.');
    report('verifying', .84, '게시용 파일의 규격과 영상·음성 타이밍을 확인합니다.');
    const outputBytes = await bounded(() => engine.readFile('prepared.mp4', 'binary', { signal }));
    if (!(outputBytes instanceof Uint8Array) || outputBytes.length > MAX_REEL_BYTES || outputBytes.length < 1)
      fail('prep_output_size', '게시용 파일 크기가 규격을 벗어나 사본을 저장하지 않았습니다.');
    const outputBlob = new Blob([outputBytes], { type: 'video/mp4' });
    const outputLayout = await readContainerInfo(outputBlob, signal);
    const metadata = validatePreparedMetadata(await probe('prepared.mp4', outputBytes.length, outputLayout, 'prepared.json'));
    validateTiming(source, metadata);
    report('verifying', .91, '영상 데이터가 원본과 같은지 확인합니다.');
    async function videoHash(name, output) {
      const code = await bounded(() => engine.exec([...inputArgs(name), '-map', '0:v:0', '-c:v', 'copy', '-f', 'streamhash', '-hash', 'sha256', output], 120_000, { signal }), 125_000);
      if (code !== 0) fail('prep_video_integrity', '영상 원본 보존 검사를 완료하지 못했습니다.');
      const text = await bounded(() => engine.readFile(output, 'utf8', { signal }));
      const match = String(text).match(/^0,v,SHA256=([0-9a-f]{64})\s*$/im);
      if (!match) fail('prep_video_integrity', '영상 원본 보존 검사를 완료하지 못했습니다.');
      return match[1].toLowerCase();
    }
    if (await videoHash('source.mp4', 'source.sha256') !== await videoHash('prepared.mp4', 'prepared.sha256'))
      fail('prep_video_integrity', '영상 데이터가 원본과 달라 사본을 저장하지 않았습니다.');
    checkAbort(signal);
    const name = String(file.name).replace(/\.(mp4|mov)$/i, '').replace(/[\u0000-\u001f\u007f/\\]/g, '_').slice(0, 160) + '_instagram.mp4';
    const prepared = new File([outputBlob], name, { type: 'video/mp4', lastModified: Date.now() });
    const warnings = Math.abs(metadata.width / metadata.height - 9 / 16) > .01
      ? ['현재 화면 비율을 유지했습니다. 릴스 전체 화면에는 9:16 세로 영상을 권장합니다.'] : [];
    report('complete', 1, '게시용 사본을 만들었습니다. 미리보기 확인 후 영상 검사·저장을 눌러 주세요.');
    return { file: prepared, metadata, changedAudio, warnings };
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw aborted();
    if (error?.code?.startsWith('prep_')) throw error;
    fail('prep_browser', '브라우저에서 영상 정리를 완료하지 못했습니다. 최신 Chrome·Edge에서 다른 탭을 닫고 다시 시도하거나 PC용 도구를 이용해 주세요.');
  } finally {
    signal?.removeEventListener('abort', abort);
    if (!terminated) terminate();
    active = false;
  }
}
