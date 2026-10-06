const {ID}=require('./store.cjs');
const {error}=require('./errors.cjs');
const PROTECTED=new Set(['converting','queued','publishing','unknown']);
function selection(kind,ids) {
  if(!['media','jobs'].includes(kind)||!Array.isArray(ids)||!ids.length||ids.length>50||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!ID.test(id)))throw error(400,'invalid_catalog_selection');
}
class Catalog {
  constructor(store,jobs) {this.store=store;this.jobs=jobs;}
  mediaView(item) {
    const references=Object.values(this.store.state.jobs).filter(job=>(job.mediaIds||[]).includes(item.id));
    return {id:item.id,name:item.name||null,kind:item.kind,type:item.type,size:item.size,createdAt:item.createdAt,trashedAt:item.trashedAt||null,canTrash:!item.trashedAt&&!references.some(job=>PROTECTED.has(job.status)),relatedJobs:references.length,download:'/api/admin/media/'+item.id};
  }
  async list({kind='media',bin='active',offset=0,limit=20}={}) {
    if(!['media','jobs'].includes(kind)||!['active','trash'].includes(bin)||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>50)throw error(400,'invalid_catalog_query');
    await this.store.init();
    const records=Object.values(this.store.state[kind]).filter(item=>!!item.trashedAt===(bin==='trash')).sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||'')||(a.id||'').localeCompare(b.id||''));
    return {kind,bin,total:records.length,offset,limit,items:records.slice(offset,offset+limit).map(item=>kind==='media'?this.mediaView(item):this.jobs.view(item))};
  }
  async change(kind,ids,restore=false) {
    selection(kind,ids);
    await this.store.transaction(state=>{
      const records=ids.map(id=>{const item=state[kind][id];if(!item)throw error(404,'not_found');return item;});
      if(!restore){
        const blocked=kind==='jobs'?records.some(job=>PROTECTED.has(job.status)):Object.values(state.jobs).some(job=>PROTECTED.has(job.status)&&(job.mediaIds||[]).some(id=>ids.includes(id)));
        if(blocked)throw error(409,'content_in_use');
      }
      const timestamp=new Date().toISOString();
      for(const item of records){if(restore)item.trashedAt=null;else if(!item.trashedAt)item.trashedAt=timestamp;}
    });
    return {changed:ids.length,kind,restored:restore};
  }
}
module.exports={Catalog,PROTECTED};
