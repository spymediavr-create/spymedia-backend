const USERS={instagram:/^[a-z0-9_.]{1,30}$/i,facebook:/^[a-z0-9.]{1,100}$/i,x:/^[a-z0-9_]{1,15}$/i,blog:/^[a-z0-9_-]{1,50}$/i};
const RESERVED={instagram:new Set(['p','reel','reels','tv','stories','explore','accounts','direct','about','developer','web']),facebook:new Set(['l.php','home.php','profile.php','login','login.php','logout.php','sharer','sharer.php','share.php','dialog','watch','reel','reels','stories','groups','pages','events','marketplace','gaming','help','privacy','settings','photo.php','permalink.php','story.php','recover','checkpoint']),x:new Set(['home','i','intent','settings','search','explore','messages','compose','notifications','login','logout','signup','share','tos','privacy']),blog:new Set()};
const HOSTS={instagram:['instagram.com','www.instagram.com'],facebook:['facebook.com','www.facebook.com','m.facebook.com'],x:['x.com','www.x.com','twitter.com','www.twitter.com','mobile.twitter.com'],blog:['blog.naver.com','m.blog.naver.com']};
const ORIGINS={instagram:'https://www.instagram.com',facebook:'https://www.facebook.com',x:'https://x.com',blog:'https://blog.naver.com'};
const user=(platform,value)=>USERS[platform]?.test(value)&&!RESERVED[platform].has(value.toLowerCase())&&!/^\.+$/.test(value);
const number=value=>typeof value==='string'&&/^\d{1,30}$/.test(value);
// Classify URL shape only. Never fetch the target or claim account/location verification.
export function searchResultUrl(platform,value){
  if(!Object.hasOwn(HOSTS,platform)||typeof value!=='string'||value.length>2048||!/^https:\/\//i.test(value)||/[\s\\]/u.test(value))return null;
  let url;try{url=new URL(value);}catch{return null;}
  if(url.protocol!=='https:'||url.username||url.password||url.port||!HOSTS[platform].includes(url.hostname))return null;
  const path=url.pathname.replace(/\/$/,''),parts=path.split('/').slice(1),origin=ORIGINS[platform];
  const result=(suffix,kind)=>({url:origin+suffix,kind});
  if(parts.length===1&&user(platform,parts[0])){
    const name=parts[0].toLowerCase();
    return platform==='facebook'&&number(name)?result('/profile.php?id='+name,'profile'):result('/'+name+(platform==='instagram'?'/':''),'profile');
  }
  if(platform==='instagram'&&parts.length===2&&['p','reel','tv'].includes(parts[0])&&/^[a-z0-9_-]{1,100}$/i.test(parts[1]))return result('/'+parts.join('/')+'/','post');
  if(platform==='facebook'){
    if(path==='/profile.php'&&number(url.searchParams.get('id'))&&url.searchParams.getAll('id').length===1)return result('/profile.php?id='+url.searchParams.get('id'),'profile');
    if(parts.length===3&&parts[0]==='people'&&parts[1]&&number(parts[2]))return result('/profile.php?id='+parts[2],'profile');
    if(parts.length===3&&user('facebook',parts[0])&&parts[1]==='posts'&&/^[a-z0-9]{1,200}$/i.test(parts[2]))return result('/'+parts[0].toLowerCase()+'/posts/'+parts[2],'post');
    if(parts.length===2&&parts[0]==='reel'&&number(parts[1]))return result('/reel/'+parts[1],'post');
    if(path==='/watch'&&number(url.searchParams.get('v'))&&url.searchParams.getAll('v').length===1)return result('/watch/?v='+url.searchParams.get('v'),'post');
    if(path==='/photo.php'&&number(url.searchParams.get('fbid'))&&url.searchParams.getAll('fbid').length===1)return result('/photo.php?fbid='+url.searchParams.get('fbid'),'post');
    if(path==='/permalink.php'&&number(url.searchParams.get('story_fbid'))&&number(url.searchParams.get('id'))&&url.searchParams.getAll('story_fbid').length===1&&url.searchParams.getAll('id').length===1)return result('/permalink.php?story_fbid='+url.searchParams.get('story_fbid')+'&id='+url.searchParams.get('id'),'post');
  }
  if(platform==='x'&&parts.length===3&&user('x',parts[0])&&parts[1]==='status'&&number(parts[2]))return result('/'+parts[0].toLowerCase()+'/status/'+parts[2],'post');
  if(platform==='blog'){
    if(parts.length===2&&user('blog',parts[0])&&number(parts[1]))return result('/'+parts[0].toLowerCase()+'/'+parts[1],'post');
    const id=url.searchParams.get('blogId'),post=url.searchParams.get('logNo');
    if(url.searchParams.getAll('blogId').length===1&&user('blog',id||'')){
      if(path==='/PostList.naver')return result('/'+id.toLowerCase(),'profile');
      if(path==='/PostView.naver'&&number(post)&&url.searchParams.getAll('logNo').length===1)return result('/'+id.toLowerCase()+'/'+post,'post');
    }
  }
  return null;
}
