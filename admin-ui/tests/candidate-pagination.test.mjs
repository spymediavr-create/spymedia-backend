import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {config} from '../backend/config.cjs';
import {Store} from '../backend/store.cjs';
import {Candidates} from '../backend/candidates.cjs';
import {PAGE_SIZE,candidatePageInfo,candidatePageNumbers} from '../public/candidate-pagination.js';

test('ten-item page counts and last pages cover zero, one, ten, eleven, twenty and twenty-one items',()=>{
  assert.equal(PAGE_SIZE,10);
  for(const [total,totalPages]of [[0,0],[1,1],[10,1],[11,2],[20,2],[21,3]]){
    assert.deepEqual(candidatePageInfo(total),{totalPages,currentPage:totalPages?1:0});
    assert.deepEqual(candidatePageNumbers(totalPages?1:0,totalPages),Array.from({length:totalPages},(_,i)=>i+1));
    if(totalPages)assert.equal(candidatePageInfo(total,(totalPages-1)*10).currentPage,totalPages);
  }
  assert.equal(candidatePageInfo(11,20).currentPage,2);
});

test('many pages show endpoints, current neighbours and ellipses within seven slots',()=>{
  assert.deepEqual(candidatePageNumbers(1,200),[1,2,3,4,'…',200]);
  assert.deepEqual(candidatePageNumbers(100,200),[1,'…',99,100,101,'…',200]);
  assert.deepEqual(candidatePageNumbers(200,200),[1,'…',197,198,199,200]);
  for(let current=1;current<=200;current++){
    const numbers=candidatePageNumbers(current,200);
    assert.ok(numbers.length<=7);assert.ok(numbers.includes(current));assert.equal(numbers[0],1);assert.equal(numbers.at(-1),200);
  }
});

test('default ten-item API pages, filtered ranges and persisted selections survive page changes and restart',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'spymedia-pagination-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const settings=config({SNS_DATA_DIR:dir,SNS_STORAGE_PERSISTENCE:'confirmed',SNS_SINGLE_INSTANCE:'confirmed'}),store=new Store(settings),candidates=new Candidates(store);
  const ids=[];
  for(let index=0;index<=21;index++){
    if([0,1,10,11,20,21].includes(index)){
      const page=await candidates.list();assert.equal(page.total,index);assert.equal(page.limit,10);assert.equal(page.items.length,Math.min(index,10));
      const last=await candidates.list({offset:index?Math.floor((index-1)/10)*10:0});assert.equal(last.items.length,index?((index-1)%10)+1:0);
    }
    if(index===21)break;
    ids.push((await candidates.create({platform:'instagram',accountName:'page '+index,profileUrl:'https://instagram.com/pagination_'+index+'/',region:index<11?'제주도':'충남',industry:'여행사'})).id);
  }
  const first=await candidates.list(),firstIds=first.items.map(({id,revision})=>({id,revision}));
  await candidates.batch({items:firstIds,changes:{selected:true}});
  assert.equal((await candidates.list({offset:10})).items.length,10);assert.equal((await candidates.list({offset:20})).items.length,1);
  const second=await candidates.list({offset:10}),one=second.items[0];await candidates.update(one.id,{revision:one.revision,selected:true});
  assert.ok((await candidates.list()).items.every(item=>item.selected));assert.equal((await candidates.list()).selectedCount,11);
  const filtered=await candidates.list({region:'제주특별자치도'});assert.equal(filtered.total,11);assert.equal(filtered.items.length,10);assert.equal((await candidates.list({region:'제주도',offset:10})).items.length,1);
  const before=await fs.readFile(path.join(dir,'journal.json'),'utf8');
  const restarted=new Candidates(new Store(settings));assert.equal((await restarted.list()).selectedCount,11);
  assert.equal(await fs.readFile(path.join(dir,'journal.json'),'utf8'),before);
});
