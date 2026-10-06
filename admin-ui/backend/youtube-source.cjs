const axios=require('axios');
const {Readable}=require('node:stream');
const {parseYouTubeUrl}=require('./links.cjs');
const {error}=require('./errors.cjs');
const clean=(text,max)=>typeof text==='string'?text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'').slice(0,max):'';
function thumbnailUrl(value,id) {
  try{const u=new URL(value);if(u.protocol==='https:'&&u.hostname==='i.ytimg.com'&&!u.port&&!u.username&&!u.password&&new RegExp('^/vi/'+id+'/[a-zA-Z0-9_-]+\\.jpg$').test(u.pathname)&&!u.search&&!u.hash)return u.href;}catch{}
  return null;
}
class YouTubeSource {
  constructor(settings,photos,options={}){this.settings=settings;this.photos=photos;this.get=options.get||axios.get;this.busy=false;}
  async fetch(value) {
    const source=parseYouTubeUrl(value);if(!source)throw error(400,'invalid_youtube_url');
    const key=this.settings.env.YOUTUBE_API_KEY;if(!key)throw error(503,'youtube_key_missing');
    if(this.busy)throw error(429,'youtube_import_busy');this.busy=true;
    try {
      let response;try{response=await this.get('https://www.googleapis.com/youtube/v3/videos',{params:{key,id:source.id,part:'snippet,status'},timeout:15000,maxRedirects:0,maxContentLength:128*1024,validateStatus:()=>true});}catch{throw error(502,'youtube_fetch_failed');}
      if(response.status===403||response.status===429)throw error(503,'youtube_access_or_quota');
      if(response.status&&response.status!==200||response.data?.error)throw error(502,'youtube_fetch_failed');
      const video=response.data?.items?.find(v=>v.id===source.id);
      if(!video||!['public','unlisted'].includes(video.status?.privacyStatus))throw error(404,'youtube_unavailable');
      const title=clean(video.snippet?.title,200),description=clean(video.snippet?.description,5000);
      if(!title)throw error(502,'youtube_invalid_response');
      const result={...source,title,description,channelTitle:clean(video.snippet?.channelTitle,120),privacy:video.status.privacyStatus,thumbnail:null,thumbnailError:null};
      const thumbnails=video.snippet?.thumbnails||{};
      const selected=['maxres','standard','high','medium','default'].map(key=>thumbnailUrl(thumbnails[key]?.url,source.id)).find(Boolean);
      if(!selected){result.thumbnailError='youtube_thumbnail_unavailable';return result;}
      try{
        const picture=await this.get(selected,{responseType:'arraybuffer',timeout:15000,maxRedirects:0,maxContentLength:2*1024**2,validateStatus:()=>true});
        const bytes=Buffer.from(picture.data);
        if(picture.status&&picture.status!==200||bytes.length>2*1024**2)throw error(502,'youtube_thumbnail_unavailable');
        const req=Readable.from([bytes]);req.headers={'content-type':'image/jpeg','content-length':String(bytes.length),'x-upload-name':encodeURIComponent('youtube-'+source.id+'.jpg')};
        const media=await this.photos.upload(req);if(media.trashedAt)throw error(409,'media_in_trash');
        result.thumbnail={id:media.id,name:media.name,preview:'/api/admin/media/'+media.id+'?preview=1',width:media.width,height:media.height};
      }catch{result.thumbnailError='youtube_thumbnail_unavailable';}
      return result;
    }finally{this.busy=false;}
  }
}
module.exports={YouTubeSource,thumbnailUrl};
