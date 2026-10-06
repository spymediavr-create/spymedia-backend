function parseYouTubeUrl(value) {
  if(typeof value!=='string'||value.length>2048||/[\x00-\x20\x7f\\]/.test(value.trim()))return null;
  try {
    const u=new URL(value.trim());if(u.protocol!=='https:'||u.username||u.password||u.port)return null;
    let id;
    if(u.hostname==='youtu.be'&&/^\/[a-zA-Z0-9_-]{11}\/?$/.test(u.pathname))id=u.pathname.split('/')[1];
    else if(['youtube.com','www.youtube.com','m.youtube.com'].includes(u.hostname)){
      if(u.pathname==='/watch'&&u.searchParams.getAll('v').length===1)id=u.searchParams.get('v');
      else if(/^\/(shorts|live)\/[a-zA-Z0-9_-]{11}\/?$/.test(u.pathname))id=u.pathname.split('/')[2];
    }
    if(!/^[a-zA-Z0-9_-]{11}$/.test(id||''))return null;
    return {id,url:'https://www.youtube.com/watch?v='+id};
  }catch{return null;}
}
export {parseYouTubeUrl};
