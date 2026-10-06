const path = require('node:path');
const {error} = require('./errors.cjs');

function config(env = process.env) {
  const origin = env.PUBLIC_ORIGIN || '';
  const production = env.NODE_ENV === 'production' || !!env.RENDER;
  let validOrigin = false;
  try { const u = new URL(origin); validOrigin = u.origin === origin && !u.username && !u.password && (u.protocol === 'https:' || !production && ['localhost','127.0.0.1'].includes(u.hostname)); } catch {}
  const dataDir = env.SNS_DATA_DIR || '';
  const repository = path.resolve(__dirname, '../..');
  const relative = dataDir ? path.relative(repository, path.resolve(dataDir)) : '';
  const outsideRepository = !!relative && (relative.startsWith('..' + path.sep) || path.isAbsolute(relative));
  const storageConfigured = !!dataDir && path.isAbsolute(dataDir) && outsideRepository && env.SNS_STORAGE_PERSISTENCE === 'confirmed' && env.SNS_SINGLE_INSTANCE === 'confirmed';
  return {
    env, production, origin: validOrigin ? origin : '', dataDir, storageConfigured,
    ffmpeg: env.FFMPEG_PATH || 'ffmpeg', ffprobe: env.FFPROBE_PATH || 'ffprobe',
    maxStorageBytes: Math.min(20 * 1024 ** 3, Math.max(1024 ** 3, Number(env.SNS_MAX_STORAGE_BYTES) || 2 * 1024 ** 3)),
    mediaKey: /^[a-f0-9]{64,128}$/i.test(env.MEDIA_SIGNING_KEY || '') ? env.MEDIA_SIGNING_KEY : '',
    publishingEnabled: env.SNS_PUBLISH_ENABLED === 'true',
    legacyPreparationEnabled: env.SNS_LEGACY_PREPARATION_ENABLED === 'true',
    requireStorage() { if (!storageConfigured) throw error(503, 'storage_unavailable'); }
  };
}
module.exports = {config};
