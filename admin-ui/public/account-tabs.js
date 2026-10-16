// Switching views changes visibility only. Each feature owns its existing state/lifetime.
export function attachAccountTabs(){
  const root=document.getElementById('sns-accounts');if(!root)return;
  const tabs=[...root.querySelectorAll('[role="tab"]')];
  const panels=tabs.map(tab=>document.getElementById(tab.getAttribute('aria-controls')));
  function activate(index,focus=false){
    tabs.forEach((tab,i)=>{
      const selected=i===index;
      tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;
      // Keep focus out of a panel when a fragment link hides it.
      if(!selected&&panels[i].contains(document.activeElement))focus=true;
      panels[i].hidden=!selected;
    });
    if(focus)tabs[index].focus();
  }
  function fromFragment(scroll=false){
    const index=panels.findIndex(panel=>'#'+panel.id===location.hash);
    if(index<0)return;
    activate(index);
    if(scroll){panels[index].scrollIntoView({block:'start'});panels[index].focus({preventScroll:true});}
  }
  tabs.forEach((tab,index)=>{
    tab.addEventListener('click',()=>activate(index));
    tab.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();
      const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
      activate(next,true);
    });
  });
  activate(0);fromFragment();
  window.addEventListener('hashchange',()=>fromFragment(true));
}
