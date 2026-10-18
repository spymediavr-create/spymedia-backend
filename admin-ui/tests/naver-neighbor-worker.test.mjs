import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {EphemeralJobs,isAdminUrl,ACTOR,ACTOR_NAME,SOURCE,NAVER_ORIGIN,validateAdminCommand} from '../../browser-tools/naver-neighbor/core.mjs';

const adminOrigin='https://spymedia-backend.onrender.com',target=NAVER_ORIGIN+'/wherechoice',second=NAVER_ORIGIN+'/reviewed_travel';
const requestId='admin-naver-worker-fixture',targetName='어디가까',actorLabel='스파이미디어 내정보 보기';
const prep=(extra={})=>({source:SOURCE,type:'PREPARE',requestId,platform:'blog',expectedAccount:ACTOR,profiles:[target],expiresAt:300000,control:'admin',...extra});
const source=(await fs.readFile(new URL('../../browser-tools/naver-neighbor/background.mjs',import.meta.url),'utf8')).replace(/^import .*?;\r?\n/gm,'');

// The fake Chrome implementation is completely in memory. It invokes no actual
// browser API, network request, account page, popup or neighbor action.
async function mockBrowser(options={}){
  let now=1000,nextTab=3,actorChecks=0,hook=null;
  const tabs=new Map([[1,{id:1,url:adminOrigin+'/admin',status:'complete',documentId:'admin-1'}],[2,{id:2,url:adminOrigin+'/admin',status:'complete',documentId:'admin-2'}]]);
  const events={},calls=[],navigations=[],removed=[],waits=[];
  const dialogStates=new Map(),dialogSelected=new Map(),dialogExpanded=new Map(),pendingExpand=new Map(),pendingSelect=new Map(),generations=new Map();
  const model={tabs,events,calls,navigations,removed,dialogStates,dialogSelected,dialogExpanded,advanceDocument:id=>{
    generations.set(id,(generations.get(id)||0)+1);tabs.get(id).documentId=`document-${id}-${generations.get(id)}`;
  },actorChecks:()=>actorChecks};
  const addTab=attrs=>{const tab={id:nextTab++,status:'complete',...attrs};tabs.set(tab.id,tab);model.advanceDocument(tab.id);events.created?.(tab);return tab;};
  const chrome={runtime:{onMessage:{addListener:fn=>events.message=fn}},tabs:{
    create:async attrs=>{const tab=addTab(attrs);navigations.push({kind:'create',id:tab.id,...attrs});return tab;},
    update:async(id,attrs)=>{Object.assign(tabs.get(id),attrs);model.advanceDocument(id);navigations.push({kind:'update',id,...attrs});events.updated?.(id,{url:attrs.url});return tabs.get(id);},
    get:async id=>{if(!tabs.has(id))throw Error('Tab closed');return tabs.get(id);},
    remove:async id=>{removed.push(id);tabs.delete(id);events.removed?.(id);},
    onCreated:{addListener:fn=>events.created=fn},onRemoved:{addListener:fn=>events.removed=fn},onUpdated:{addListener:fn=>events.updated=fn}
  },scripting:{executeScript:async({target:surface,func,args})=>{
    assert.equal(surface.allFrames,undefined,'An action must never broadcast into all frames');
    if(surface.documentIds){assert.equal(surface.documentIds.length,1);assert.equal(surface.frameIds,undefined);if(surface.documentIds[0]!==tabs.get(surface.tabId)?.documentId)throw Error('Stale document');}
    else assert.deepEqual(Array.from(surface.frameIds),[0]);
    const input=args[0],call={func:func.name,...input,tabId:surface.tabId,url:tabs.get(surface.tabId)?.url,pinned:Boolean(surface.documentIds)};calls.push(call);
    if(hook)await hook(call,model);
    if(surface.documentIds&&surface.documentIds[0]!==tabs.get(surface.tabId)?.documentId)throw Error('Stale document before execution');
    const executedDocumentId=tabs.get(surface.tabId)?.documentId;
    let result;
    if(func.name==='resolveNaverContent'){
      result={ok:true,url:NAVER_ORIGIN+'/PostList.naver?blogId='+new URL(input.targetUrl).pathname.slice(1)};
    }else if(func.name==='inspectNaverPage'){
      const id=new URL(input.targetUrl).pathname.slice(1);
      if(input.mode==='actor'){actorChecks++;result={ok:true,state:'actor_verified',actorId:ACTOR,actorLabel};}
      else if(input.mode==='inspect')result={ok:true,state:options.existing?.includes(input.targetUrl)?'existing':'add',targetId:id,targetName};
      else if(input.mode==='open'){
        result={ok:true,state:options.existingOnOpen?'existing':'opened',targetId:id,targetName};
        if(!options.existingOnOpen&&!options.noPopup){
          for(let n=0;n<(options.popupCount||1);n++){
            const popup=addTab({url:options.popupUrl||NAVER_ORIGIN+'/BuddyAdd.naver?blogId='+id,openerTabId:options.foreignOpener?999:surface.tabId});
            dialogStates.set(popup.id,'choice');
          }
        }
      }else throw Error('Unexpected profile mode');
    }else if(func.name==='inspectNaverDialog'){
      const phase=dialogStates.get(surface.tabId);
      if(input.stage!==phase)result={ok:false,code:'ambiguous_dialog'};
      else if(input.mode==='inspect'){
        for(const [pending,finish]of [[pendingExpand,()=>dialogExpanded.set(surface.tabId,true)],[pendingSelect,()=>{dialogExpanded.set(surface.tabId,false);dialogSelected.set(surface.tabId,'광고업체');}]]){
          if(pending.has(surface.tabId)){
            const remaining=pending.get(surface.tabId)-1;pending.set(surface.tabId,remaining);
            if(remaining<=0){pending.delete(surface.tabId);finish();}
          }
        }
        result=phase==='group'?{ok:true,state:'group',kind:options.custom?'custom':'native',expanded:dialogExpanded.get(surface.tabId)===true,selected:dialogSelected.get(surface.tabId)==='광고업체'}:{ok:true,state:phase==='result'?'added':phase};
      }
      else if(input.mode==='next'){
        assert.equal(phase,'choice');result={ok:true,state:'advanced'};
        tabs.get(surface.tabId).url=NAVER_ORIGIN+'/BuddyAdd.naver';dialogStates.set(surface.tabId,'group');model.advanceDocument(surface.tabId);
      }else if(input.mode==='expand'){
        assert.equal(phase,'group');assert.equal(options.custom,true);
        pendingExpand.set(surface.tabId,options.expandDelay||1);result={ok:true,state:'expanded'};
      }else if(input.mode==='select'){
        assert.equal(phase,'group');assert.equal(input.groupName,'광고업체');
        if(options.custom)assert.equal(dialogExpanded.get(surface.tabId),true,'Custom option cannot be clicked before visible expansion');
        pendingSelect.set(surface.tabId,options.selectDelay||1);result={ok:true,state:'selected'};
      }else if(input.mode==='submit'){
        assert.equal(phase,'group');assert.equal(dialogSelected.get(surface.tabId),'광고업체');result={ok:true,state:'submitted'};
        dialogStates.set(surface.tabId,'result');model.advanceDocument(surface.tabId);
      }else throw Error('Unexpected dialog mode');
    }else throw Error('Unexpected injection function');
    if(options.resultFor)result=await options.resultFor(call,result,model);
    const record={frameId:0,documentId:executedDocumentId,result};
    if(options.recordFor)return options.recordFor(call,record,model);
    return [record];
  }}};
  class MemoryJobs extends EphemeralJobs{constructor(){super({now:()=>now,token:()=> 'ephemeral-naver-worker-fixture'});}}
  vm.runInNewContext(source,{EphemeralJobs:MemoryJobs,isAdminUrl,ACTOR,ACTOR_NAME,SOURCE,NAVER_ORIGIN,validateAdminCommand,
    resolveNaverContent:function resolveNaverContent(){},inspectNaverPage:function inspectNaverPage(){},inspectNaverDialog:function inspectNaverDialog(){},
    chrome,URL,Date:{now:()=>now},setTimeout:(fn,ms)=>{waits.push(ms);queueMicrotask(()=>{now+=ms;fn();});}});
  const send=(message,tabId=1,extra={})=>new Promise(resolve=>events.message({kind:'ADMIN_MESSAGE',message},{tab:tabs.get(tabId),frameId:0,url:tabs.get(tabId)?.url,...extra},resolve));
  const command=(type,extra={},tabId=1)=>send({source:SOURCE,type,requestId,...extra},tabId);
  const begin=async(profiles=[target])=>{assert.equal((await send(prep({profiles}))).ok,true);assert.equal((await command('START',{confirmed:true})).ok,true);};
  return {...model,send,command,begin,waits,addTab,setHook:fn=>hook=fn,setNow:n=>now=n,now:()=>now};
}
const mutations=b=>b.calls.filter(c=>c.func==='inspectNaverDialog'&&['next','expand','select','submit'].includes(c.mode));
const submissions=b=>b.calls.filter(c=>c.func==='inspectNaverDialog'&&c.mode==='submit');

test('Naver worker binds admin-only jobs and performs one ordered ordinary-neighbor flow in the 광고업체 group',async()=>{
  const b=await mockBrowser();assert.equal((await b.command('PING')).ok,true);
  const prepared=await b.send(prep());assert.equal(prepared.ok,true);assert.equal(b.calls.length,0);
  assert.deepEqual(Object.keys(prepared.job).sort(),['expectedAccount','expectedName','profiles','expiresAt','index','started','running','terminalError','results'].sort());
  assert.equal((await b.command('STEP',{index:0})).code,'not_confirmed');await b.command('START',{confirmed:true});
  const result=await b.command('STEP',{index:0});assert.equal(result.ok,true);assert.equal(result.job.results[0].state,'added');assert.equal(result.job.running,false);
  assert.deepEqual(mutations(b).map(c=>[c.stage,c.mode]),[['choice','next'],['group','select'],['group','submit']]);assert.ok(mutations(b).every(c=>c.pinned));
  assert.equal(b.actorChecks(),2,'Actor must be verified before the target and immediately before submit');
  assert.equal(submissions(b).length,1);assert.equal(b.removed.length,1);assert.ok(b.navigations.every(n=>n.active===false));
  assert.equal((await b.command('STEP',{index:0})).code,'not_confirmed');assert.equal(submissions(b).length,1);
});

test('existing neighbors and a relationship completed before opening are skipped without popup submission',async()=>{
  for(const options of [{existing:[target]},{existingOnOpen:true}]){
    const b=await mockBrowser(options);await b.begin();const result=await b.command('STEP',{index:0});
    assert.equal(result.job.results[0].state,'existing');assert.equal(mutations(b).length,0);assert.equal(b.removed.length,0);
  }
});

test('every selected blog rechecks the actor and only exact reviewed targets receive actions',async()=>{
  const b=await mockBrowser();await b.begin([target,second]);
  for(const index of [0,1])assert.equal((await b.command('STEP',{index})).job.results[index].state,'added');
  assert.equal(b.actorChecks(),4);assert.deepEqual(b.calls.filter(c=>c.mode==='open').map(c=>c.targetUrl),[target,second]);
  assert.deepEqual(submissions(b).map(c=>c.targetUrl),[target,second]);assert.equal(b.removed.length,2);
});

test('wrong actor or login/challenge evidence prevents target navigation and mutation',async()=>{
  for(const evidence of [{ok:false,code:'login_required'},{ok:false,code:'challenge'},{ok:true,state:'actor_verified',actorId:'other',actorLabel},{ok:true,state:'actor_verified',actorId:ACTOR,actorLabel:''},{ok:true,state:'add',actorId:ACTOR,actorLabel}]){
    const b=await mockBrowser({resultFor:(c,r)=>c.mode==='actor'?evidence:r});await b.begin();assert.equal((await b.command('STEP',{index:0})).ok,false);
    assert.equal(b.calls.some(c=>c.targetUrl===target),false);assert.equal(mutations(b).length,0);
  }
});

test('wrong content frame and ambiguous execution records cannot authorize a popup',async()=>{
  for(const options of [
    {resultFor:(c,r)=>c.func==='resolveNaverContent'?{ok:true,url:NAVER_ORIGIN+'/PostList.naver?blogId=wrong'}:r},
    {resultFor:(c,r)=>c.func==='resolveNaverContent'?{ok:true,url:'https://evil.invalid/PostList.naver?blogId=spymedia'}:r},
    {recordFor:(c,r)=>[{...r,frameId:1}]},
    {recordFor:(c,r)=>[r,r]}
  ]){
    const b=await mockBrowser(options);await b.begin();assert.equal((await b.command('STEP',{index:0})).ok,false);assert.equal(b.calls.some(c=>c.mode==='open'),false);assert.equal(mutations(b).length,0);
  }
});

test('only one newly opened popup with the target ID and correct opener is eligible',async()=>{
  for(const options of [{noPopup:true},{foreignOpener:true},{popupCount:2},{popupUrl:NAVER_ORIGIN+'/BuddyAdd.naver?blogId=wrong'},{popupUrl:NAVER_ORIGIN+'/BuddyAdd.naver'},{popupUrl:NAVER_ORIGIN+'/BuddyAdd.naver?blogId=wherechoice&blogId=wherechoice'},{popupUrl:'https://evil.invalid/BuddyAdd.naver?blogId=wherechoice'}]){
    const b=await mockBrowser(options);await b.begin();assert.equal((await b.command('STEP',{index:0})).ok,false,JSON.stringify(options));assert.equal(mutations(b).length,0);assert.equal(b.removed.length,0);
  }
  const b=await mockBrowser({noPopup:true});b.addTab({url:NAVER_ORIGIN+'/BuddyAdd.naver?blogId=wherechoice',openerTabId:4});await b.begin();assert.equal((await b.command('STEP',{index:0})).ok,false);assert.equal(mutations(b).length,0);
});

test('missing or ambiguous 광고업체 groups halt before group selection and final submit',async()=>{
  for(const code of ['group_missing','group_ambiguous','challenge','login_required','wrong_profile']){
    const b=await mockBrowser({resultFor:(c,r)=>c.func==='inspectNaverDialog'&&c.stage==='group'?{ok:false,code}:r});await b.begin();
    assert.equal((await b.command('STEP',{index:0})).code,code);assert.deepEqual(mutations(b).map(c=>c.mode),['next']);
    assert.equal((await b.command('STEP',{index:0})).code,'not_confirmed');
  }
});

test('a changed actor immediately before submit stops after selection without adding',async()=>{
  const b=await mockBrowser({resultFor:(c,r,m)=>c.mode==='actor'&&m.actorChecks()===2?{...r,actorLabel:'다른 계정'}:r});await b.begin();
  assert.equal((await b.command('STEP',{index:0})).code,'account_mismatch');assert.deepEqual(mutations(b).map(c=>c.mode),['next','select']);assert.equal(submissions(b).length,0);
});

test('document pinning prevents submitting a popup document changed during actor revalidation',async()=>{
  const b=await mockBrowser();await b.begin();b.setHook((c,m)=>{if(c.mode==='actor'&&m.actorChecks()===1){for(const [id,phase]of m.dialogStates)if(phase==='group')m.advanceDocument(id);}});
  assert.equal((await b.command('STEP',{index:0})).ok,false);assert.equal(submissions(b).length,0);assert.equal((await b.command('STEP',{index:0})).code,'not_confirmed');
});

test('post-submit uncertainty is terminal and preserves earlier confirmed existing results',async()=>{
  const b=await mockBrowser({existing:[target],resultFor:(c,r)=>c.func==='inspectNaverDialog'&&c.stage==='result'?{ok:false,code:'uncertain'}:r});await b.begin([target,second]);
  assert.equal((await b.command('STEP',{index:0})).job.results[0].state,'existing');assert.equal((await b.command('STEP',{index:1})).code,'result_unconfirmed');
  const state=(await b.command('STATUS')).job;assert.equal(state.running,false);assert.equal(state.index,1);assert.equal(state.results.length,1);assert.equal(state.terminalError,'result_unconfirmed');
  assert.equal(submissions(b).length,1);assert.equal((await b.command('START',{confirmed:true})).code,'not_confirmed');assert.equal((await b.command('STEP',{index:1})).code,'not_confirmed');assert.equal(submissions(b).length,1);assert.equal(b.removed.length,0);
});

test('closing a popup is not success and login/restriction/target errors never retry the final submit',async()=>{
  for(const code of ['login_required','challenge','wrong_profile','group_ambiguous']){
    const b=await mockBrowser({resultFor:(c,r)=>c.func==='inspectNaverDialog'&&c.stage==='result'?{ok:false,code}:r});await b.begin();assert.equal((await b.command('STEP',{index:0})).code,code);assert.equal(submissions(b).length,1);assert.equal((await b.command('STATUS')).job.results.length,0);
  }
  const b=await mockBrowser();await b.begin();b.setHook((c,m)=>{if(c.func==='inspectNaverDialog'&&c.stage==='result'){m.tabs.delete(c.tabId);m.events.removed(c.tabId);}});
  assert.equal((await b.command('STEP',{index:0})).ok,false);assert.equal(submissions(b).length,1);assert.equal((await b.command('STATUS')).code,'job_lost');
});

test('admin ownership, strict sender and concurrent starts/steps prevent duplicate additions',async()=>{
  const b=await mockBrowser();await b.send(prep());assert.equal((await b.send(prep({requestId:'another-fixture'}),2)).code,'job_exists');
  assert.equal((await b.command('START',{confirmed:true},2)).code,'job_lost');assert.equal((await b.send({source:SOURCE,type:'STATUS',requestId},1,{frameId:1})).code,'invalid_message');
  assert.equal((await b.send({source:SOURCE,type:'STATUS',requestId},1,{url:adminOrigin+'/admin/login'})).code,'invalid_message');
  const starts=await Promise.all([b.command('START',{confirmed:true}),b.command('START',{confirmed:true})]);assert.equal(starts.filter(r=>r.ok).length,1);
  const steps=await Promise.all([b.command('STEP',{index:0}),b.command('STEP',{index:0})]);assert.equal(steps.filter(r=>r.ok).length,1);assert.equal(submissions(b).length,1);
});

test('expiry, explicit cancellation and admin departure prevent further actions',async()=>{
  const expired=await mockBrowser();await expired.begin();expired.setNow(300001);assert.equal((await expired.command('STEP',{index:0})).code,'job_lost');assert.equal(expired.calls.length,0);
  const cancel=await mockBrowser();await cancel.begin();cancel.setHook(async c=>{if(c.func==='inspectNaverPage'&&c.mode==='inspect')await cancel.command('CANCEL');});assert.equal((await cancel.command('STEP',{index:0})).code,'job_lost');assert.equal(mutations(cancel).length,0);
  const left=await mockBrowser();await left.begin();left.events.updated(1,{url:adminOrigin+'/admin/login'});assert.equal((await left.command('STATUS')).code,'job_lost');
  const closed=await mockBrowser();await closed.begin();closed.events.removed(1);assert.equal((await closed.command('STATUS')).code,'job_lost');
});

test('custom dropdown waits for observed expansion and selection without repeating any clicks',async()=>{
  const b=await mockBrowser({custom:true,expandDelay:4,selectDelay:5});await b.begin();
  const result=await b.command('STEP',{index:0});assert.equal(result.ok,true);assert.equal(result.job.results[0].state,'added');
  assert.deepEqual(mutations(b).map(c=>c.mode),['next','expand','select','submit']);
  assert.ok(mutations(b).every(c=>c.pinned));
  const groupReads=b.calls.filter(c=>c.stage==='group'&&c.mode==='inspect');
  assert.equal(groupReads.length,10);assert.ok(groupReads.slice(1).every(c=>c.pinned));assert.equal(submissions(b).length,1);
});

test('a custom dropdown that never settles stops without repeated clicks or final submit',async()=>{
  for(const options of [{custom:true,expandDelay:100},{custom:true,selectDelay:100}]){
    const b=await mockBrowser(options);await b.begin();assert.equal((await b.command('STEP',{index:0})).code,'group_unrecognized');
    assert.deepEqual(mutations(b).map(c=>c.mode),options.expandDelay?['next','expand']:['next','expand','select']);
    assert.equal(submissions(b).length,0);assert.equal((await b.command('STEP',{index:0})).code,'not_confirmed');
  }
});

test('document replacement during dropdown waits cannot authorize selecting or submitting',async()=>{
  for(const action of ['expand','select']){
    const b=await mockBrowser({custom:true});await b.begin();let dispatched=false;
    b.setHook((c,m)=>{
      if(c.mode===action)dispatched=true;
      else if(dispatched&&c.mode==='inspect'&&c.stage==='group')m.advanceDocument(c.tabId);
    });
    assert.equal((await b.command('STEP',{index:0})).ok,false);assert.equal(submissions(b).length,0);
    assert.equal(mutations(b).filter(c=>c.mode===action).length,1);
  }
});

test('popup and recognition failures name the failed stage without claiming approval pending',async()=>{
  for(const [options,code]of [
    [{noPopup:true},'popup_not_found'],[{popupCount:2},'popup_binding'],
    [{resultFor:(c,r)=>c.stage==='choice'?{ok:false,code:'ambiguous_dialog'}:r},'choice_unrecognized'],
    [{resultFor:(c,r)=>c.stage==='group'?{ok:false,code:'ambiguous_dialog'}:r},'group_unrecognized']
  ]){
    const b=await mockBrowser(options);await b.begin();assert.equal((await b.command('STEP',{index:0})).code,code);
    const job=(await b.command('STATUS')).job;assert.equal(job.terminalError,code);assert.equal(job.results.length,0);assert.equal(submissions(b).length,0);
  }
});
