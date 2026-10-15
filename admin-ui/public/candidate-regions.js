// Shared by the administrator UI and authenticated server search. Stored text stays unchanged.
// Current names: https://www.mois.go.kr/frt/sub/a04/localGovernment/screen.do
// Keep the familiar 17-area names for existing records, alongside the current merged name.
const province = (id,name,aliases) => ({id,name,aliases:[name,...aliases]});
export const LEGACY_AREAS = [
  province('seoul','서울특별시',['서울','서울시']),
  province('busan','부산광역시',['부산','부산시']),
  province('daegu','대구광역시',['대구','대구시']),
  province('incheon','인천광역시',['인천','인천시']),
  province('gwangju','광주광역시',['광주']),
  province('daejeon','대전광역시',['대전','대전시']),
  province('ulsan','울산광역시',['울산','울산시']),
  province('sejong','세종특별자치시',['세종','세종시']),
  province('gyeonggi','경기도',['경기']),
  province('gangwon','강원특별자치도',['강원','강원도']),
  province('chungbuk','충청북도',['충북']),
  province('chungnam','충청남도',['충남']),
  province('jeonbuk','전북특별자치도',['전북','전라북도']),
  province('jeonnam','전라남도',['전남']),
  province('gyeongbuk','경상북도',['경북']),
  province('gyeongnam','경상남도',['경남']),
  province('jeju','제주특별자치도',['제주','제주도'])
];
const merged = province('jeonnam-gwangju','전남광주통합특별시',['전남광주','광주전남','광주전남통합특별시']);
export const CURRENT_PROVINCES = [...LEGACY_AREAS.filter(area=>!['gwangju','jeonnam'].includes(area.id)),merged];
const provinces = [...LEGACY_AREAS,merged];
export const REGION_GROUPS = [
  {id:'capital',name:'수도권',aliases:['수도권'],members:['seoul','incheon','gyeonggi'],search:['수도권','서울','인천','경기']},
  {id:'gangwon-area',name:'강원권',aliases:['강원권'],members:['gangwon'],search:['강원','강원도','강원특별자치도']},
  {id:'chungcheong',name:'충청도',aliases:['충청도','충청','충청권'],members:['daejeon','sejong','chungbuk','chungnam'],search:['충청','충북','충남','대전','세종']},
  {id:'jeolla',name:'전라도',aliases:['전라도','전라','전라권','호남','호남권'],members:['gwangju','jeonbuk','jeonnam','jeonnam-gwangju'],search:['전라','전북','전남','광주','전남광주통합특별시']},
  {id:'gyeongsang',name:'경상도',aliases:['경상도','경상','경상권','영남','영남권'],members:['busan','daegu','ulsan','gyeongbuk','gyeongnam'],search:['경상','경북','경남','부산','대구','울산']},
  {id:'jeju-area',name:'제주권',aliases:['제주권'],members:['jeju'],search:['제주','제주도','제주특별자치도']}
];
// Only the two previously offered localities have an explicit parent mapping.
// Do not infer a province from arbitrary city/district names or from other candidate fields.
const localities = [
  {id:'siheung',name:'시흥',aliases:['시흥','시흥시'],parent:'gyeonggi'},
  {id:'yeongheung',name:'영흥도',aliases:['영흥도'],parent:'incheon'}
];
export const REGION_OPTIONS = ['전국',...REGION_GROUPS.map(area=>area.name),...CURRENT_PROVINCES.map(area=>area.name),'광주광역시','전라남도',...localities.map(area=>area.name)];
const clean = value => typeof value==='string' ? value.normalize('NFKC').trim().toLocaleLowerCase('ko').replace(/\s+/g,' ') : '';
const entries = [...provinces,...REGION_GROUPS,...localities];
const aliases = new Map(entries.flatMap(area=>area.aliases.map(alias=>[clean(alias),area])));
const sortedAliases=[...aliases].sort((a,b)=>b[0].length-a[0].length);
function tokenArea(token){
  if(aliases.has(token))return aliases.get(token);
  // Accept explicit, unspaced addresses such as 전라북도전주시, not arbitrary word prefixes.
  return sortedAliases.find(([alias])=>token.startsWith(alias)&&/^[가-힣0-9]+(?:시|군|구|읍|면|동|리)$/u.test(token.slice(alias.length)))?.[1];
}
export function normalizeRegionFilter(value) { const input=clean(value);return input==='전국'?'':input; }
function markers(value) {
  const tokens=clean(value).split(/[\s,/·|;()[\]{}:]+/u).filter(Boolean), found=new Set();
  for(const token of tokens){
    const area=tokenArea(token);
    // 경기 광주 is not the legacy 광주광역시. 광주시 alone is deliberately ambiguous.
    if(area?.id==='gwangju'&&tokens.some(part=>['경기','경기도','광주시'].includes(part)))continue;
    if(area){found.add(area.id);if(area.parent)found.add(area.parent);}
  }
  return found;
}
export function matchesRegion(stored,filter) {
  const query=normalizeRegionFilter(filter);
  if(!query)return true; // Includes empty region records, without assigning them a location.
  const source=clean(stored);
  if(!source)return false;
  const area=aliases.get(query);
  if(!area)return source.includes(query); // Preserve free-text partial search.
  const found=markers(source);
  if(area.members)return found.has(area.id)||area.members.some(id=>found.has(id));
  if(area.id===merged.id)return found.has(merged.id)||found.has('gwangju')||found.has('jeonnam');
  return found.has(area.id);
}
export function matchesRegionKeyword(stored,query) {
  return aliases.has(clean(query)) && matchesRegion(stored,query);
}
export function externalRegionTerms(value) {
  const query=normalizeRegionFilter(value);
  if(!query)return '';
  const area=aliases.get(query);
  if(!area)return typeof value==='string'?value.trim():'';
  const terms=area.search||area.aliases;
  return terms.length===1?terms[0]:'('+terms.join(' OR ')+')';
}
