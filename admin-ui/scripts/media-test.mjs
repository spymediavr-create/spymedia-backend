import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {config} from '../backend/config.cjs';
import {Store} from '../backend/store.cjs';
import {Media,run} from '../backend/media.cjs';

const dir=await fs.mkdtemp(path.join(os.tmpdir(),'spymedia-encode-test-'));
const settings=config({...process.env,SNS_DATA_DIR:dir,SNS_STORAGE_PERSISTENCE:'confirmed',SNS_SINGLE_INSTANCE:'confirmed'});
const store=new Store(settings),media=new Media(settings,store);
let checks=0;
try {
  assert.equal(await media.tools(),true,'Configure FFMPEG_PATH and FFPROBE_PATH for this explicit encoder test.');
  const video=path.join(dir,'fixture.mp4');
  await run(settings.ffmpeg,['-nostdin','-v','error','-f','lavfi','-i','testsrc2=size=640x360:rate=30','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','3','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-f','mp4',video],60000);
  const png=path.join(dir,'fixture.png');
  await run(settings.ffmpeg,['-nostdin','-v','error','-i',video,'-frames:v','1',png],60000);
  async function upload(file,type) {
    const bytes=await fs.readFile(file),req=Readable.from([bytes]);req.headers={'content-type':type,'content-length':String(bytes.length),'x-upload-name':encodeURIComponent(path.basename(file))};return media.upload(req);
  }
  const imageItem=await upload(png,'image/png'),videoItem=await upload(video,'video/mp4');checks+=2;
  for(const channel of ['instagram','facebook','x','youtube']) {
    const encoded=await media.convert(videoItem,channel);assert.equal(encoded.type,'video/mp4');assert.ok(encoded.duration>=2.9&&encoded.duration<=3.2);assert.equal(encoded.width%2,0);assert.equal(encoded.height%2,0);
    if(channel==='instagram'){assert.equal(encoded.width,1080);assert.equal(encoded.height,1920);}else{assert.ok(encoded.width<=1920&&encoded.height<=1080);}
    checks++;console.log('PASS video conversion '+channel);
  }
  for(const channel of ['instagram','facebook','x']) {
    const encoded=await media.convert(imageItem,channel);assert.equal(encoded.type,'image/jpeg');if(channel==='instagram'){assert.equal(encoded.width,1080);assert.equal(encoded.height,1350);}
    checks++;console.log('PASS image conversion '+channel);
  }
  const blogImage=await media.convert({...videoItem,kind:'image'},'blog');assert.equal(blogImage.type,'image/jpeg');assert.equal(blogImage.duration,0);checks++;console.log('PASS blog image preparation from video');
  console.log('PASS real encoder checks: '+checks+'; synthetic local media only; no SNS requests');
}finally{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));await fs.rm(dir,{recursive:true,force:true});}
