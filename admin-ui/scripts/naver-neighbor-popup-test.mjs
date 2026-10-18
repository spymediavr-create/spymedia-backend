import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {inspectNaverDialog} from '../../browser-tools/naver-neighbor/dom-agent.mjs';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium'});
const origin='https://blog.naver.com',targetId='wherechoice',targetUrl=origin+'/'+targetId,targetName='어디가까';
const firstUrl=origin+'/BuddyAdd.naver?blogId='+targetId+'&trackingCode=fixture';
const laterUrl=origin+'/BuddyAdd.naver';
const capturedGroupHtml=await readFile(new URL('../tests/fixtures/naver-neighbor/group-popup.html',import.meta.url),'utf8');
const capturedChoiceHtml=await readFile(new URL('../tests/fixtures/naver-neighbor/choice-popup.html',import.meta.url),'utf8');
const capturedName='테스트블로그';
let allowedUrl='',html='',cases=0,blockedRequests=0;

// Native-control fixtures retain screenshot-derived choice/result coverage.
// Separate first-choice and custom-group fixtures use sanitized user HTML.
// Both run offline with synthetic event handlers: no form POST or real add.
function fixture({stage='choice',name=targetName,heading='이웃추가',ordinary=true,mutual=false,
  hiddenOrdinary=false,disabledOrdinary=false,extraRadio=false,duplicateNext=false,
  disabledNext=false,hiddenNext=false,groupName='광고업체',selected='새그룹',duplicateGroup=false,
  disabledGroup=false,hiddenGroup=false,disabledOption=false,customGroup=false,
  extraSelect=false,login=false,challenge=false,extraDialog=false,successText,
  hiddenSuccess=false,decoy=false}={}){
  const next=`<button type="button" data-action="next" ${disabledNext?'disabled':''} ${hiddenNext?'hidden':''} onclick="this.dataset.clicks=String(Number(this.dataset.clicks||0)+1)">다음</button>`;
  const option=(name,disabled=false)=>`<option ${name===selected?'selected':''} ${disabled?'disabled':''}>${name}</option>`;
  const select=`<select aria-label="이웃 그룹" data-group ${disabledGroup?'disabled':''} ${hiddenGroup?'hidden':''} onchange="this.dataset.changes=String(Number(this.dataset.changes||0)+1)">${option('새그룹')}${option(groupName,disabledOption)}${duplicateGroup?option(groupName):''}</select>`;
  const body=stage==='choice'?`<div class="box"><span class="target">${name}</span>님을 <label ${hiddenOrdinary?'hidden':''}><input type="radio" name="relation" value="ordinary" ${ordinary?'checked':''} ${disabledOrdinary?'disabled':''}>이웃</label> <label><input type="radio" name="relation" value="mutual" ${mutual?'checked':''}>서로이웃</label>으로 추가합니다.${extraRadio?'<label><input type="radio" name="other">이웃</label>':''}</div>`:
    stage==='group'?`<div class="box"><p><span class="target">${name}</span>님을 추가할 그룹을 선택해주세요.</p>${customGroup?`<div role="combobox" aria-label="이웃 그룹" tabindex="0">${selected}</div><div role="listbox"><div role="option">광고업체</div></div>`:select}${extraSelect?select:''}<button type="button" data-action="create" onclick="this.dataset.clicks='1'">+ 그룹추가</button></div>`:
    `<div class="box" ${hiddenSuccess?'hidden':''}><p>${successText??`${name}님의 블로그를 이웃으로 추가하였습니다.`}</p><p>${name}님은 가까운 이웃이 아직 없습니다.</p></div>`;
  return `<!doctype html><meta charset="utf-8"><style>body{font:16px sans-serif;padding:28px}label,button,select{display:inline-block;margin:8px}.box{border:1px solid #ddd;padding:18px}button{padding:10px}select{width:260px}</style><h2>${heading}</h2>${body}${stage==='result'?'<button type="button" data-action="close" onclick="this.dataset.clicks=\'1\'">닫기</button>':`<button type="button" data-action="cancel" onclick="this.dataset.clicks='1'">취소</button>${next}${duplicateNext?next:''}`}<p>이웃과 서로이웃은 무엇인가요?</p>${login?'<a href="https://nid.naver.com/nidlogin.login">로그인</a><input type="password">':''}${challenge?'<div role="alert">보안 인증이 필요합니다.</div>':''}${extraDialog?'<div role="dialog">다른 설정을 확인하세요.</div>':''}${decoy?'<div hidden><button data-action="decoy" onclick="this.dataset.clicks=\'1\'">다음</button><select><option>광고업체</option></select></div>':''}`;
}

try{
  const context=await browser.newContext({viewport:{width:900,height:700}}),page=await context.newPage();
  await context.route('**/*',route=>{
    if(route.request().isNavigationRequest()&&route.request().url()===allowedUrl.split('#')[0])return route.fulfill({status:200,contentType:'text/html',body:html});
    blockedRequests++;return route.abort();
  });
  const load=async(options={},url=(options.stage==='group'||options.stage==='result')?laterUrl:firstUrl)=>{html=fixture(options);allowedUrl=new URL(url).href;await page.goto(allowedUrl);};
  const inspect=(stage='choice',mode='inspect',extra={})=>page.evaluate(inspectNaverDialog,{targetUrl,targetName,stage,mode,groupName:'광고업체',...extra});
  const unchanged=async()=>{assert.equal(await page.locator('[data-clicks]').count(),0,'No control may be clicked during a refused/read-only operation');assert.equal(await page.locator('[data-changes]').count(),0,'No group change may occur during a refused/read-only operation');};
  const refuse=async(options={},stage=options.stage||'choice',mode=stage==='choice'?'next':stage==='group'?'submit':'inspect',url,extra={})=>{
    await load(options,url);const result=await inspect(stage,mode,extra);assert.equal(result.ok,false,JSON.stringify({options,stage,mode,url,extra,result}));await unchanged();cases++;
  };

  await load();assert.equal((await inspect()).state,'choice');await unchanged();
  assert.equal((await inspect('choice','next')).state,'advanced');assert.equal(await page.locator('[data-action="next"][data-clicks="1"]').count(),1);assert.equal(await page.locator('[data-action="cancel"][data-clicks]').count(),0);cases++;
  await load({stage:'group'});assert.equal((await inspect('group')).state,'group');await unchanged();
  assert.equal((await inspect('group','select')).state,'selected');assert.equal(await page.locator('select').inputValue(),'광고업체');assert.equal(await page.locator('[data-clicks]').count(),0);
  assert.equal((await inspect('group','submit')).state,'submitted');assert.equal(await page.locator('[data-action="next"][data-clicks="1"]').count(),1);assert.equal(await page.locator('[data-action="create"][data-clicks]').count(),0);cases++;
  await load({stage:'result'});assert.equal((await inspect('result')).state,'added');await unchanged();cases++;
  await load({decoy:true});assert.equal((await inspect()).state,'choice');assert.equal((await inspect('choice','next')).state,'advanced');assert.equal(await page.locator('[data-action="decoy"][data-clicks]').count(),0);cases++;

  for(const options of [{ordinary:false},{ordinary:false,mutual:true}]){
    await load(options);assert.equal((await inspect('choice','next')).state,'advanced');
    assert.equal(await page.locator('input[value="ordinary"]').isChecked(),true);assert.equal(await page.locator('input[value="mutual"]').isChecked(),false);assert.equal(await page.locator('[data-action="next"][data-clicks="1"]').count(),1);cases++;
  }
  for(const options of [{name:'다른블로그'},{name:'다른'+targetName},{heading:'서로이웃 신청'},{hiddenOrdinary:true},{disabledOrdinary:true},{extraRadio:true},{duplicateNext:true},{disabledNext:true},{hiddenNext:true},{login:true},{challenge:true},{extraDialog:true}])await refuse(options);
  for(const url of [laterUrl,origin+'/BuddyAdd.naver?blogId=another_blog',origin+'/BuddyAdd.naver?blogId='+targetId+'&blogId='+targetId,origin+'/BuddyAdd.naver?blogId='+targetId+'#other','https://m.blog.naver.com/BuddyAdd.naver?blogId='+targetId,'https://blog.naver.com.evil.invalid/BuddyAdd.naver?blogId='+targetId,origin+'/Other.naver?blogId='+targetId])await refuse({},'choice','next',url);
  for(const extra of [{targetUrl:origin+'/spymedia'},{targetUrl:targetUrl+'/123'},{targetUrl:targetUrl+'?x=1'},{targetName:''},{targetName:'다른블로그'},{groupName:'새그룹'},{stage:'unknown'},{mode:'unknown'}])await refuse({},'choice','next',undefined,extra);
  for(const options of [{name:'다른블로그'},{name:'다른'+targetName},{groupName:'기본그룹'},{duplicateGroup:true},{disabledGroup:true},{hiddenGroup:true},{disabledOption:true},{customGroup:true},{extraSelect:true},{duplicateNext:true},{disabledNext:true},{hiddenNext:true},{login:true},{challenge:true},{extraDialog:true}])await refuse({stage:'group',...options},'group','select');
  await refuse({stage:'group'},'group','submit'); // Never submit the default group.
  await refuse({stage:'group',selected:'광고업체',name:'다른블로그'},'group','submit');
  await refuse({stage:'group',selected:'광고업체'},'group','submit',origin+'/BuddyAdd.naver?blogId=another_blog');
  for(const options of [{name:'다른블로그'},{name:'다른'+targetName},{hiddenSuccess:true},{successText:`${targetName}님의 블로그를 서로이웃으로 추가하였습니다.`},{successText:'이웃추가가 완료되지 않았습니다.'},{successText:`${targetName}님의 블로그를 이웃으로 추가하였습니다. 다른블로그님의 블로그를 이웃으로 추가하였습니다.`},{login:true},{challenge:true},{extraDialog:true}])await refuse({stage:'result',...options},'result','inspect');
  await refuse({stage:'group'},'result','inspect');await refuse({stage:'choice'},'group','submit');
  await refuse({stage:'result'},'choice','next');
  for(const stage of ['choice','group','result']){
    await load({stage,name:'다른블로그'});
    await page.evaluate(({stage,name})=>{
      const decoy=document.createElement('p');decoy.setAttribute('aria-hidden','true');
      decoy.textContent=stage==='choice'?name+'님을 이웃 서로이웃으로 추가합니다.':stage==='group'?name+'님을 추가할 그룹을 선택해주세요.':name+'님의 블로그를 이웃으로 추가하였습니다.';
      document.body.append(decoy);
    },{stage,name:targetName});
    assert.equal((await inspect(stage,stage==='choice'?'next':stage==='group'?'select':'inspect')).ok,false);await unchanged();cases++;
  }

  // The final submission revalidates the selected group and target name.
  await load({stage:'group'});assert.equal((await inspect('group','select')).state,'selected');await page.locator('select').selectOption({label:'새그룹'});await page.locator('select').evaluate(n=>{delete n.dataset.changes;});assert.equal((await inspect('group','submit')).ok,false);await unchanged();cases++;
  await load({stage:'group',selected:'광고업체'});assert.equal((await inspect('group')).state,'group');await page.locator('.target').evaluate(n=>{n.textContent='바뀐블로그';});assert.equal((await inspect('group','submit')).ok,false);await unchanged();cases++;

  const loadCapturedChoice=async({relation='ordinary',ignoreSelection=false,changeTarget=false,replaceNext=false,disableNext=false}={})=>{
    html=capturedChoiceHtml;allowedUrl=firstUrl;await page.goto(allowedUrl);
    await page.evaluate(({relation,ignoreSelection,changeTarget,replaceNext,disableNext})=>{
      const ordinary=document.querySelector('#buddy_add'),mutual=document.querySelector('#each_buddy_add');
      const count=node=>node.dataset.clicks=String(Number(node.dataset.clicks||0)+1);
      const updatePresentation=()=>{
        ordinary.parentElement.classList.toggle('checked',ordinary.checked);
        mutual.parentElement.classList.toggle('checked',mutual.checked);
      };
      ordinary.checked=relation==='ordinary';mutual.checked=relation==='mutual';updatePresentation();
      for(const radio of [ordinary,mutual]){
        radio.addEventListener('click',()=>count(radio));
        radio.addEventListener('change',()=>{
          if(ignoreSelection){mutual.checked=true;ordinary.checked=false;}
          if(changeTarget)document.querySelector('.name_buddy').textContent='바뀐블로그';
          if(replaceNext){const next=document.querySelector('._buddyAddNext');next.replaceWith(next.cloneNode(true));}
          if(disableNext)document.querySelector('._buddyAddNext').setAttribute('aria-disabled','true');
          updatePresentation();
        });
      }
      for(const label of document.querySelectorAll('label[for]'))label.addEventListener('click',()=>count(label));
      for(const control of document.querySelectorAll('._buddyAddNext,.button_cancel'))control.addEventListener('click',event=>{event.preventDefault();count(control);});
      document.querySelector('form').addEventListener('submit',event=>{event.preventDefault();document.body.dataset.forbiddenSubmit='true';});
    },{relation,ignoreSelection,changeTarget,replaceNext,disableNext});
  };
  const capturedChoiceInspect=(mode='inspect',extra={})=>inspect('choice',mode,{targetName:capturedName,...extra});
  const noChoiceSubmission=async()=>{
    assert.equal(await page.locator('._buddyAddNext[data-clicks],.button_cancel[data-clicks],[data-forbidden-submit]').count(),0);
  };

  // Exact supplied first-step markup contains a newline between the mutual
  // radio's label and the separate suffix span. The 0.1.1 text-node matcher
  // failed this real shape even though rendered text looked unbroken.
  await loadCapturedChoice();
  assert.equal(await page.locator('script,link,input[type="hidden"]').count(),0);
  assert.equal(await page.locator('.text_addbuddy').isVisible(),true);
  assert.equal(await page.locator('.text_bothbuddy').isVisible(),false);
  assert.deepEqual(await page.locator('#buddy_add').evaluate(node=>({width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height,clip:getComputedStyle(node).clip})),{width:1,height:1,clip:'rect(0px, 0px, 0px, 0px)'});
  assert.equal((await capturedChoiceInspect()).state,'choice');await unchanged();
  assert.equal((await capturedChoiceInspect('next')).state,'advanced');
  assert.equal(await page.locator('._buddyAddNext[data-clicks="1"]').count(),1);
  assert.equal(await page.locator('#buddy_add').isChecked(),true);assert.equal(await page.locator('#each_buddy_add').isChecked(),false);cases++;
  await loadCapturedChoice();await page.locator('.name_buddy').evaluate(node=>node.textContent='테스트 블로그');
  assert.equal((await capturedChoiceInspect('next',{targetName:'테스트 블로그'})).state,'advanced');
  assert.equal(await page.locator('._buddyAddNext[data-clicks="1"]').count(),1);cases++;

  // The alternate visible suffix describes a request. It must first switch
  // to ordinary neighbor and confirm that switch, never submit mutual mode.
  for(const relation of ['mutual']){
    await loadCapturedChoice({relation});assert.equal((await capturedChoiceInspect()).state,'choice');await unchanged();
    assert.equal((await capturedChoiceInspect('next')).state,'advanced');
    assert.equal(await page.locator('#buddy_add').isChecked(),true);assert.equal(await page.locator('#each_buddy_add').isChecked(),false);
    assert.equal(await page.locator('.text_addbuddy').isVisible(),true);assert.equal(await page.locator('.text_bothbuddy').isVisible(),false);
    assert.equal(await page.locator('label[for="buddy_add"][data-clicks="1"]').count(),1,'Click the rendered ordinary label, not the clipped input');
    assert.equal(await page.locator('._buddyAddNext[data-clicks="1"]').count(),1);cases++;
  }
  const refuseCapturedChoice=async(mutator,options={})=>{
    await loadCapturedChoice(options);await page.evaluate(mutator);
    assert.equal((await capturedChoiceInspect('next')).ok,false,String(mutator));await unchanged();await noChoiceSubmission();cases++;
  };
  for(const mutate of [
    ()=>document.querySelector('.name_buddy').textContent='다른테스트블로그',
    ()=>document.querySelector('.name_buddy').setAttribute('aria-hidden','true'),
    ()=>{document.querySelector('.name_buddy').textContent='다른블로그';document.querySelector('.text_bothbuddy').textContent='테스트블로그님을 이웃 서로이웃으로 추가합니다.';},
    ()=>document.querySelector('.text_bothbuddy').style.display='inline',
    ()=>document.querySelector('.text_addbuddy').style.display='none',
    ()=>document.querySelector('#buddy_add').disabled=true,
    ()=>document.querySelector('#buddy_add').classList.add('disabled'),
    ()=>document.querySelector('#buddy_add').style.display='none',
    ()=>document.querySelector('label[for="buddy_add"]').hidden=true,
    ()=>document.querySelector('label[for="buddy_add"]').parentElement.append(document.querySelector('label[for="buddy_add"]').cloneNode(true)),
    ()=>document.querySelector('label[for="buddy_add"]').textContent='서로이웃',
    ()=>document.querySelector('label[for="each_buddy_add"]').textContent='이웃',
    ()=>document.querySelector('.radio_addbuddy').append(document.querySelector('#buddy_add').cloneNode(true)),
    ()=>document.querySelector('.text_buddy_add').parentElement.append(document.querySelector('.text_buddy_add').cloneNode(true)),
    ()=>document.querySelector('._buddyAddNext').parentElement.append(document.querySelector('._buddyAddNext').cloneNode(true)),
    ()=>document.querySelector('._buddyAddNext').setAttribute('aria-disabled','true')
  ])await refuseCapturedChoice(mutate);
  await loadCapturedChoice({relation:'none'});assert.equal((await capturedChoiceInspect('next')).ok,false);await unchanged();await noChoiceSubmission();cases++;
  for(const options of [{relation:'mutual',ignoreSelection:true},{relation:'mutual',changeTarget:true},{relation:'mutual',replaceNext:true},{relation:'mutual',disableNext:true}]){
    await loadCapturedChoice(options);assert.equal((await capturedChoiceInspect('next')).ok,false);await noChoiceSubmission();cases++;
  }

  const loadCaptured=async(options={},url=laterUrl)=>{
    html=capturedGroupHtml;allowedUrl=new URL(url).href;await page.goto(allowedUrl);
    await page.evaluate(options=>{
      const trigger=document.querySelector('._selectedGroup'),menu=document.querySelector('._groupList'),display=document.querySelector('._selectedGroupName');
      const count=node=>node.dataset.clicks=String(Number(node.dataset.clicks||0)+1);
      const open=()=>{trigger.setAttribute('aria-expanded','true');menu.setAttribute('aria-hidden','false');menu.classList.add('on');};
      const close=()=>{trigger.setAttribute('aria-expanded','false');menu.setAttribute('aria-hidden','true');menu.classList.remove('on');};
      document.querySelector('form').addEventListener('submit',event=>{event.preventDefault();document.body.dataset.forbiddenSubmit='true';});
      trigger.addEventListener('click',event=>{
        event.preventDefault();count(trigger);
        if(options.noOpen)return;
        if(options.openDelay)setTimeout(open,options.openDelay);else open();
      });
      for(const option of menu.querySelectorAll('._selectGroup'))option.addEventListener('click',event=>{
        event.preventDefault();count(option);
        const applySelection=()=>{
          if(options.updateAria!==false){for(const other of menu.querySelectorAll('._selectGroup'))other.setAttribute('aria-selected','false');option.setAttribute('aria-selected','true');}
          if(options.updateDisplay!==false)display.textContent=option.textContent;
          if(options.closeAfterSelect!==false)close();
        };
        if(options.selectDelay)setTimeout(applySelection,options.selectDelay);else applySelection();
      });
      for(const control of document.querySelectorAll('._addBuddy,._addNewGroupForm,.button_cancel'))control.addEventListener('click',event=>{event.preventDefault();count(control);});
    },options);
  };
  const capturedInspect=(mode='inspect',extra={})=>inspect('group',mode,{targetName:capturedName,...extra});
  const noCapturedSubmission=async()=>{
    assert.equal(await page.locator('._addBuddy[data-clicks],._addNewGroupForm[data-clicks],.button_cancel[data-clicks]').count(),0,'Never submit/cancel/create a group on an ambiguous popup');
    assert.equal(await page.locator('[data-forbidden-submit]').count(),0,'No real form submission');
  };
  const openCaptured=async()=>{
    assert.equal((await capturedInspect()).kind,'custom');
    assert.equal((await capturedInspect('expand')).state,'expanded');
    assert.equal(await page.locator('._selectedGroup').getAttribute('aria-expanded'),'true');
    assert.equal(await page.locator('._groupList').getAttribute('aria-hidden'),'false');
  };

  // Reproduces the 0.1.0 incompatibility: the rendered heading is aria-hidden,
  // and the supplied popup has NO native select. Its menu is currently hidden.
  await loadCaptured();
  assert.equal(await page.locator('h1.title[aria-hidden="true"]').isVisible(),true);
  assert.equal(await page.locator('select,input[type="hidden"],script,link').count(),0);
  assert.equal(await page.locator('._groupList').isVisible(),false);
  assert.equal((await capturedInspect()).kind,'custom');await unchanged();
  assert.equal((await capturedInspect('select')).ok,false);await unchanged();
  assert.equal((await capturedInspect('submit')).ok,false);await unchanged();
  await openCaptured();assert.equal((await capturedInspect('select')).state,'selected');
  assert.equal(await page.locator('._selectedGroupName').innerText(),'광고업체');
  assert.equal(await page.locator('._selectedGroup').getAttribute('aria-expanded'),'false');
  assert.equal(await page.locator('._groupList').getAttribute('aria-hidden'),'true');
  assert.equal(await page.locator('._selectGroup[data-clicks="1"]').count(),1);
  assert.equal(await page.locator('._selectedGroup[data-clicks="1"]').count(),1);
  await noCapturedSubmission();
  assert.equal((await capturedInspect('submit')).state,'submitted');
  assert.equal(await page.locator('._addBuddy[data-clicks="1"]').count(),1);
  assert.equal(await page.locator('._addNewGroupForm[data-clicks]').count(),0);cases++;

  // Expanding an already open dropdown is idempotent, never toggles it closed.
  await loadCaptured();await openCaptured();
  assert.equal((await capturedInspect('expand')).state,'expanded');
  assert.equal(await page.locator('._selectedGroup[data-clicks="1"]').count(),1);await noCapturedSubmission();cases++;

  // Hidden form state is deliberately irrelevant. Reading a hidden value or
  // hidden option label after collapse throws, while visible UI remains usable.
  await loadCaptured();
  await page.evaluate(()=>{
    const bait=document.createElement('input');bait.type='hidden';bait.name='groupId';
    Object.defineProperty(bait,'value',{get(){throw new Error('Forbidden hidden-value read');}});
    const original=bait.getAttribute.bind(bait);bait.getAttribute=key=>{if(key==='value')throw new Error('Forbidden hidden-attribute read');return original(key);};
    document.querySelector('form').append(bait);
  });
  await openCaptured();assert.equal((await capturedInspect('select')).state,'selected');
  await page.locator('._groupList').evaluate(menu=>{
    for(const node of menu.querySelectorAll('._selectGroup')){
      Object.defineProperty(node,'textContent',{get(){throw new Error('Forbidden collapsed-option read');}});
      Object.defineProperty(node,'innerText',{get(){throw new Error('Forbidden collapsed-option read');}});
    }
  });
  assert.equal((await capturedInspect('submit')).state,'submitted');cases++;

  const capturedRefuse=async(mutator,mode='inspect',options={},extra={})=>{
    await loadCaptured(options);if(mutator)await page.evaluate(mutator);
    const result=await capturedInspect(mode,extra);assert.equal(result.ok,false,JSON.stringify({mode,options,extra,result}));
    await unchanged();await noCapturedSubmission();cases++;
  };
  for(const mutate of [
    ()=>document.querySelector('.name_buddy').textContent='다른블로그',
    ()=>document.querySelector('.name_buddy').textContent='다른테스트블로그',
    ()=>{document.querySelector('.name_buddy').textContent='다른블로그';document.body.insertAdjacentHTML('beforeend','<p aria-hidden="true">테스트블로그님을 추가할 그룹을 선택해주세요.</p>');},
    ()=>document.querySelector('.popup_heading').style.display='none',
    ()=>document.querySelector('.popup_heading').setAttribute('aria-hidden','true'),
    ()=>document.querySelector('.popup_heading').setAttribute('inert',''),
    ()=>document.querySelector('h1.title').style.visibility='hidden',
    ()=>document.querySelector('.popup_heading').append(document.querySelector('h1.title').cloneNode(true)),
    ()=>{document.querySelector('h1.title').remove();document.querySelector('.popup_heading').insertAdjacentHTML('beforeend','<h2 aria-hidden="true">이웃추가</h2>');},
    ()=>{document.querySelector('h1.title').remove();document.body.insertAdjacentHTML('afterbegin','<h1 class="title" aria-hidden="true">이웃추가</h1>');},
    ()=>document.body.insertAdjacentHTML('afterbegin','<h2>이웃추가</h2>'),
    ()=>document.querySelector('._selectedGroup').parentElement.append(document.querySelector('._selectedGroup').cloneNode(true)),
    ()=>document.querySelector('._groupList').parentElement.append(document.querySelector('._groupList').cloneNode(true)),
    ()=>document.querySelector('._selectedGroup').setAttribute('aria-disabled','true'),
    ()=>document.querySelector('._selectedGroup').removeAttribute('aria-expanded'),
    ()=>document.querySelector('._groupList').removeAttribute('aria-hidden'),
    ()=>document.querySelector('._newGroup').style.display='block',
    ()=>document.querySelector('._addBuddy').parentElement.append(document.querySelector('._addBuddy').cloneNode(true)),
    ()=>document.querySelector('._addBuddy').setAttribute('aria-disabled','true'),
    ()=>document.querySelector('._addBuddy').setAttribute('aria-hidden','true')
  ])await capturedRefuse(mutate,'expand');
  await capturedRefuse(null,'expand',{}, {targetName:'다른블로그'});
  await capturedRefuse(null,'expand',{}, {groupName:'광고'});
  await loadCaptured({},origin+'/BuddyAdd.naver?blogId=another_blog');assert.equal((await capturedInspect('expand')).ok,false);await unchanged();cases++;

  // Once the menu is actually exposed, exact visible option identity matters.
  // Repeated non-target labels such as six 새그룹 entries are valid in real HTML.
  for(const mutate of [
    ()=>{const menu=document.querySelector('._groupList'),option=[...menu.children].find(n=>n.textContent==='광고업체');menu.append(option.cloneNode(true));},
    ()=>[...document.querySelectorAll('._selectGroup')].find(n=>n.textContent==='광고업체').hidden=true,
    ()=>[...document.querySelectorAll('._selectGroup')].find(n=>n.textContent==='광고업체').setAttribute('aria-disabled','true'),
    ()=>[...document.querySelectorAll('._selectGroup')].find(n=>n.textContent==='광고업체').textContent='광고',
    ()=>document.querySelector('._selectedGroupName').textContent='광고업체',
    ()=>document.querySelectorAll('._selectGroup')[1].setAttribute('aria-selected','true'),
    ()=>document.querySelectorAll('._selectGroup')[0].setAttribute('aria-selected','false'),
    ()=>document.querySelector('._selectedGroup').setAttribute('aria-expanded','false'),
    ()=>document.querySelector('.name_buddy').textContent='다른블로그',
    ()=>{[...document.querySelectorAll('._selectGroup')].find(n=>n.textContent==='광고업체').remove();document.body.insertAdjacentHTML('beforeend','<a class="_selectGroup" href="#" aria-selected="false">광고업체</a>');}
  ]){
    await loadCaptured();await openCaptured();await page.evaluate(mutate);
    assert.equal((await capturedInspect('select')).ok,false);assert.equal(await page.locator('._selectGroup[data-clicks]').count(),0);
    await noCapturedSubmission();cases++;
  }

  // A click with no confirmed visible selection must not be submitted or retried.
  for(const options of [{updateDisplay:false},{closeAfterSelect:false}]){
    await loadCaptured(options);await openCaptured();assert.equal((await capturedInspect('select')).state,'selected');
    assert.equal((await capturedInspect()).selected,false);
    assert.equal((await capturedInspect('submit')).ok,false);assert.equal(await page.locator('._selectGroup[data-clicks="1"]').count(),1);
    await noCapturedSubmission();cases++;
  }
  await loadCaptured();await openCaptured();assert.equal((await capturedInspect('select')).state,'selected');
  await page.locator('._selectedGroupName').evaluate(node=>node.textContent='새그룹');
  assert.equal((await capturedInspect('submit')).ok,false);await noCapturedSubmission();cases++;

  // Delayed opening must never allow clicking a concealed option or final next.
  await loadCaptured({openDelay:500});await capturedInspect('expand');
  assert.equal((await capturedInspect('select')).ok,false);assert.equal(await page.locator('._selectGroup[data-clicks]').count(),0);await noCapturedSubmission();
  await page.waitForFunction(()=>document.querySelector('._groupList').getAttribute('aria-hidden')==='false');
  assert.equal((await capturedInspect('select')).state,'selected');assert.equal((await capturedInspect('submit')).state,'submitted');
  assert.equal(await page.locator('._selectedGroup[data-clicks="1"]').count(),1);cases++;
  await loadCaptured({noOpen:true});await capturedInspect('expand');
  assert.equal((await capturedInspect('select')).ok,false);assert.equal((await capturedInspect('submit')).ok,false);await noCapturedSubmission();cases++;
  await loadCaptured({selectDelay:500});await openCaptured();assert.equal((await capturedInspect('select')).state,'selected');
  assert.equal((await capturedInspect()).selected,false);assert.equal((await capturedInspect('submit')).ok,false);await noCapturedSubmission();
  await page.waitForFunction(()=>document.querySelector('._selectedGroupName').textContent==='광고업체'&&document.querySelector('._groupList').getAttribute('aria-hidden')==='true');
  assert.equal((await capturedInspect()).selected,true);assert.equal((await capturedInspect('submit')).state,'submitted');
  assert.equal(await page.locator('._selectGroup[data-clicks="1"]').count(),1);cases++;

  console.log(`PASS ${cases} offline Chromium Naver popup fixtures: user-HTML choice/clipped-radio labels and custom group dropdown, screenshot-derived native/result controls, visible aria-hidden heading exception, exact existing 광고업체 selection, hidden state ignored, one final submit, explicit success, and refusal on target/group/heading/control ambiguity. Blocked non-fixture requests: ${blockedRequests}. Live Naver requests, form submissions and neighbor additions: 0.`);
}finally{await browser.close();}
