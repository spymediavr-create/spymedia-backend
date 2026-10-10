# Browser Reels preparation

The Instagram card can prepare a selected MP4/MOV locally before the existing explicit upload step. Dropping a file starts preparation after the preview metadata check; using the file picker leaves preparation to the explicit button. No new endpoint accepts media for server-side conversion. The server remains responsible for verifying/storing uploads and the existing separately confirmed publishing workflow.

The on-demand single-threaded FFmpeg WebAssembly worker is served from the existing authenticated host. No CDN, token, new service, cross-origin isolation, or SharedArrayBuffer is required. Videos stay in the browser until the user chooses **영상 검사·저장**. A prepared copy can also be downloaded to the PC.

Video uses stream copy. Audio is copied if already compliant, otherwise converted to AAC 120 kbps (48 kHz/mono or stereo as required). Edit lists and MP4 header placement are checked, along with codec, dimensions, duration, frame rate, audio, stream preservation and timing. Unsupported video transformations require a fresh export from the editor; the browser does not crop, resize or re-encode video.

The first run loads roughly 31 MiB of Wasm. Browser memory and processing speed vary; large videos can fail and produce an actionable error. Cancellation terminates the dedicated worker and releases prepared files. No preparation action creates or publishes an Instagram job.

## Dependencies and deployment

- `@ffmpeg/ffmpeg` **0.12.15**, MIT: https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v12.15/packages/ffmpeg
- `@ffmpeg/core` **0.12.10**, GPL-2.0-or-later: https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v12.15/packages/core
- Matching upstream release, source archives and build recipes: https://github.com/ffmpegwasm/ffmpeg.wasm/releases/tag/v12.15
- Upstream license notices: https://github.com/ffmpegwasm/ffmpeg.wasm/blob/v12.15/LICENSE
- Official usage/API: https://ffmpegwasm.netlify.app/docs/getting-started/usage/

Exact package versions are listed in root `package.json`. Render's existing `npm install` supplies assets; no generated Wasm binary is committed. `server-core.cjs` allows only named runtime files. Anonymous runtime requests are rejected. The worker's CSP allows only same-origin scripts/connections and Wasm compilation; the administrator document retains its strict script policy without JavaScript eval.

Unit tests: `node --test admin-ui/tests/*.test.mjs`.
Real-browser validation: `admin-ui/scripts/reel-preparation-browser-test.mjs`, using local fixtures/temporary storage, disabled providers, and the existing backend validator. No real public posting is performed by the tests.
