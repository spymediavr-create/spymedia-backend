import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {config} from '../backend/config.cjs';
import {Store} from '../backend/store.cjs';
import {Candidates} from '../backend/candidates.cjs';
import {CURRENT_PROVINCES,LEGACY_AREAS,REGION_GROUPS,REGION_OPTIONS,normalizeRegionFilter,matchesRegion,externalRegionTerms} from '../public/candidate-regions.js';
import {externalSearchUrl} from '../public/candidates-ui.js';

test('options cover the familiar 17 regions, current official 16, six broad groups and two existing localities',()=>{
  assert.deepEqual(LEGACY_AREAS.map(area=>area.name),['서울특별시','부산광역시','대구광역시','인천광역시','광주광역시','대전광역시','울산광역시','세종특별자치시','경기도','강원특별자치도','충청북도','충청남도','전북특별자치도','전라남도','경상북도','경상남도','제주특별자치도']);
  assert.equal(CURRENT_PROVINCES.length,16);assert.ok(CURRENT_PROVINCES.some(area=>area.name==='전남광주통합특별시'));
  assert.deepEqual(REGION_GROUPS.map(group=>group.name),['수도권','강원권','충청도','전라도','경상도','제주권']);
  assert.equal(REGION_OPTIONS.length,27);assert.equal(new Set(REGION_OPTIONS).size,27);
  for(const label of ['전국','시흥','영흥도',...LEGACY_AREAS.map(a=>a.name),...CURRENT_PROVINCES.map(a=>a.name)])assert.ok(REGION_OPTIONS.includes(label),label);
});

test('nationwide is absence of a region restriction and includes records with no known region',()=>{
  for(const region of ['',undefined,'합성 지역','전국','충청남도','서울'])for(const filter of ['','전국',' 전국 '])assert.equal(matchesRegion(region,filter),true);
  assert.equal(normalizeRegionFilter(' 전국 '),'');
  for(const filter of ['충청도','수도권','서울특별시','제주도','영흥도'])for(const region of ['',undefined,'미입력','전국','알 수 없음'])assert.equal(matchesRegion(region,filter),false,JSON.stringify({region,filter}));
});

test('official names and all supported short/previous names match in either direction without rewriting data',()=>{
  for(const area of [...LEGACY_AREAS,CURRENT_PROVINCES.at(-1)])for(const alias of area.aliases){
    assert.equal(matchesRegion(alias,area.name),true,alias);
    assert.equal(matchesRegion(area.name,alias),true,alias);
    assert.equal(matchesRegion(area.name+' 합성구',alias),true,alias);
  }
  assert.equal(matchesRegion('강원도 춘천시','강원특별자치도'),true);
  assert.equal(matchesRegion('전라북도 전주시','전북특별자치도'),true);
  assert.equal(matchesRegion('전라북도전주시','전북특별자치도'),true);
  assert.equal(matchesRegion('인천광역시중구','수도권'),true);
  assert.equal(matchesRegion('경기도광주시','전라도'),false);
  assert.equal(matchesRegion('경기장','수도권'),false);
  assert.equal(matchesRegion('충남 천안시','충청북도'),false);
  assert.equal(matchesRegion('경기도 광주시','광주광역시'),false);
  assert.equal(matchesRegion('경기도 광주','전라도'),false);
  assert.equal(matchesRegion('광주시','전라도'),false);
});

test('broad groups match their explicit child regions or group labels, while broad records do not imply a child location',()=>{
  for(const group of REGION_GROUPS){
    for(const alias of group.aliases){
      assert.equal(matchesRegion(group.name,alias),true);
      for(const area of [...LEGACY_AREAS,CURRENT_PROVINCES.at(-1)])assert.equal(matchesRegion(area.name,alias),group.members.includes(area.id),`${alias}: ${area.name}`);
    }
  }
  assert.equal(matchesRegion('충청권','충남'),false);
  assert.equal(matchesRegion('호남권','전북'),false);
  assert.equal(matchesRegion('영남','경상남도'),false);
  assert.equal(matchesRegion('충북, 대전','충청도'),true);
  assert.equal(matchesRegion('전남광주통합특별시','전라도'),true);
  assert.equal(matchesRegion('전라남도','전남광주통합특별시'),true);
  assert.equal(matchesRegion('광주광역시','전남광주통합특별시'),true);
  assert.equal(matchesRegion('전남광주통합특별시','광주광역시'),false);
  assert.equal(matchesRegion('전남광주통합특별시','전라남도'),false);
});

test('existing localities have bounded parent mappings; arbitrary cities and free text stay explicit',()=>{
  assert.equal(matchesRegion('시흥시 장현동','시흥'),true);
  assert.equal(matchesRegion('시흥','경기도'),true);
  assert.equal(matchesRegion('시흥','수도권'),true);
  assert.equal(matchesRegion('영흥도','인천광역시'),true);
  assert.equal(matchesRegion('영흥도','수도권'),true);
  assert.equal(matchesRegion('인천광역시','영흥도'),false);
  assert.equal(matchesRegion('경기도','시흥'),false);
  assert.equal(matchesRegion('천안시','충청도'),false);
  assert.equal(matchesRegion('남구','전라도'),false);
  assert.equal(matchesRegion('합성 지역 원문','합성'),true);
  assert.equal(matchesRegion('제주도 / 서울','수도권'),true);
});

test('external search omits nationwide, expands groups with OR and encodes all user text under a fixed engine',()=>{
  for(const region of ['전국',' 전국 ',''])assert.equal(new URL(externalSearchUrl('instagram','여행사',region)).searchParams.get('q'),'여행사 site:instagram.com');
  for(const region of ['충청도','전라도','경상도','수도권','제주권']){
    const url=new URL(externalSearchUrl('x','여행사 & 드론 + #촬영',region));
    assert.equal(url.origin,'https://www.google.com');assert.equal(url.hash,'');assert.equal([...url.searchParams].length,1);
    assert.ok(url.searchParams.get('q').includes(externalRegionTerms(region)));assert.ok(externalRegionTerms(region).includes(' OR '));assert.ok(url.searchParams.get('q').endsWith('site:x.com'));
  }
  assert.match(externalRegionTerms('충청도'),/충북 OR 충남 OR 대전 OR 세종/);
  assert.match(externalRegionTerms('강원도'),/강원특별자치도/);
  assert.match(externalRegionTerms('전라북도'),/전북특별자치도/);
  assert.match(externalRegionTerms('제주도'),/제주특별자치도/);
  const free=new URL(externalSearchUrl('blog','건설','자유 & + #지역'));
  assert.equal(free.searchParams.get('q'),'건설 자유 & + #지역 site:blog.naver.com');assert.equal(free.hash,'');
});

test('old journal strings, selected states and other fields survive combined region search and restart',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'spymedia-region-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const settings=config({SNS_DATA_DIR:dir,SNS_STORAGE_PERSISTENCE:'confirmed',SNS_SINGLE_INSTANCE:'confirmed'}),store=new Store(settings),candidates=new Candidates(store);
  const records=[];
  for(const [index,region]of ['전라북도 전주시','전북특별자치도','강원도 춘천시','강원특별자치도','충청북도 청주시','대전','시흥','영흥도','', '합성 자유 지역','전남광주통합특별시'].entries())records.push(await candidates.create({platform:index===1?'facebook':'instagram',accountName:'합성 여행사 '+index,profileUrl:(index===1?'https://facebook.com/':'https://instagram.com/')+'regionfixture'+index,industry:'여행사',region,note:'보존할 메모'}));
  await candidates.update(records[0].id,{revision:1,selected:true,status:'done'});
  const before=await fs.readFile(path.join(dir,'journal.json'),'utf8');
  assert.equal((await candidates.list({region:'전국'})).total,10);
  assert.equal((await candidates.list({region:'전북특별자치도',industry:'여행사',q:'전라북도',status:'done'})).items[0].id,records[0].id);
  assert.equal((await candidates.list({region:'강원특별자치도',q:'강원도'})).total,2);
  assert.equal((await candidates.list({region:'충청도'})).total,2);
  assert.equal((await candidates.list({region:'전라도'})).total,2);
  assert.equal((await candidates.list({region:'수도권'})).total,2);
  assert.equal((await candidates.list({platform:'facebook',region:'전라도'})).total,1);
  assert.equal(await fs.readFile(path.join(dir,'journal.json'),'utf8'),before);
  const restart=new Candidates(new Store(settings)),all=(await restart.list({region:'전국',limit:50})).items;
  assert.equal(all.find(item=>item.id===records[0].id).region,'전라북도 전주시');
  assert.equal(all.find(item=>item.id===records[0].id).selected,true);assert.equal(all.find(item=>item.id===records[0].id).status,'done');
  assert.equal(all.find(item=>item.id===records[8].id).region,'');
});
