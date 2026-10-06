const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {error} = require('./errors.cjs');
const ID = /^[a-f0-9-]{36}$/;

class Store {
  constructor(settings) { this.settings = settings; this.root = settings.dataDir; this.tail = Promise.resolve(); this.initPromise = null; }
  async init() {
    this.settings.requireStorage();
    if (!this.initPromise) this.initPromise = this.initialize().catch(e => { this.initPromise = null; throw e; });
    return this.initPromise;
  }
  async initialize() {
    await fs.mkdir(this.root, {recursive:true, mode:0o700});
    if ((await fs.lstat(this.root)).isSymbolicLink()) throw error(503, 'storage_unavailable');
    for (const name of ['originals','converted']) {
      const dir = path.join(this.root, name); await fs.mkdir(dir, {recursive:true,mode:0o700});
      if ((await fs.lstat(dir)).isSymbolicLink()) throw error(503, 'storage_unavailable');
    }
    try { this.state = JSON.parse(await fs.readFile(path.join(this.root,'journal.json'),'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw error(503,'storage_unavailable'); this.state = {version:1,media:{},jobs:{}}; }
    if (this.state.version !== 1 || !this.state.media || !this.state.jobs) throw error(503,'storage_unavailable');
    // Never replay an interrupted publication automatically after a restart.
    for (const job of Object.values(this.state.jobs)) if (['converting','queued','publishing'].includes(job.status)) {
      job.status = job.publicationAttempted ? 'unknown' : 'failed'; job.error = job.publicationAttempted ? 'check_channel_before_retry' : 'interrupted'; job.updatedAt = new Date().toISOString();
    }
    await this.save();
  }
  async save() {
    const temp = path.join(this.root, crypto.randomUUID()+'.tmp');
    const handle = await fs.open(temp,'wx',0o600);
    try { await handle.writeFile(JSON.stringify(this.state)); await handle.sync(); } finally { await handle.close(); }
    // Windows can briefly lock the destination after a read. Keep the old journal
    // intact and retry the same atomic replacement; never unlink it to recover.
    for(let attempt=0;;attempt++){
      try{await fs.rename(temp,path.join(this.root,'journal.json'));break;}
      catch(e){if(process.platform!=='win32'||!['EPERM','EACCES','EBUSY'].includes(e.code)||attempt>=9)throw e;await new Promise(resolve=>setTimeout(resolve,(attempt+1)*10));}
    }
  }
  async transaction(fn) {
    await this.init();
    const operation = this.tail.then(async () => { const value = await fn(this.state); await this.save(); return value; });
    this.tail = operation.catch(()=>{}); return operation;
  }
  file(id, converted = false) { if (!ID.test(id)) throw error(404,'not_found'); return path.join(this.root,converted ? 'converted' : 'originals',id); }
  async usedBytes() {
    await this.init(); let bytes=0;
    for (const dir of ['originals','converted']) for (const entry of await fs.readdir(path.join(this.root,dir),{withFileTypes:true})) {
      if (!entry.isFile()) throw error(503,'storage_unavailable'); bytes += (await fs.stat(path.join(this.root,dir,entry.name))).size;
    }
    return bytes;
  }
  async media(id) { await this.init(); const item=this.state.media[id]; if (!item) throw error(404,'not_found'); return item; }
  async job(id) { await this.init(); const item=this.state.jobs[id]; if (!item) throw error(404,'not_found'); return item; }
}
module.exports = {Store, ID};
