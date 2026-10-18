import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Separate deterministic ZIP; other extensions and their permissions stay intact.
const folder=fileURLToPath(new URL('../../browser-tools/naver-neighbor/',import.meta.url));
const output=fileURLToPath(new URL('../downloads/naver-neighbor.zip',import.meta.url));
const files=['README.md','background.mjs','bridge.js','core.mjs','dom-agent.mjs','manifest.json'].sort();
const manifest=JSON.parse(await fs.readFile(path.join(folder,'manifest.json'),'utf8'));
if(manifest.manifest_version!==3||manifest.version!=='0.1.1')throw Error('Unexpected Naver extension manifest');
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=crc&1?(crc>>>1)^0xedb88320:crc>>>1;}return(crc^0xffffffff)>>>0;}
const pieces=[],central=[];let offset=0;
for(const file of files){
  const name=Buffer.from(file),data=await fs.readFile(path.join(folder,file)),crc=crc32(data);
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(33,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(name.length,26);
  pieces.push(local,name,data);
  const header=Buffer.alloc(46);header.writeUInt32LE(0x02014b50);header.writeUInt16LE(20,4);header.writeUInt16LE(20,6);header.writeUInt16LE(0x800,8);header.writeUInt16LE(33,14);header.writeUInt32LE(crc,16);header.writeUInt32LE(data.length,20);header.writeUInt32LE(data.length,24);header.writeUInt16LE(name.length,28);header.writeUInt32LE(offset,42);
  central.push(header,name);offset+=local.length+name.length+data.length;
}
const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,Buffer.concat([...pieces,directory,end]));
console.log('Packaged Naver neighbor extension: '+files.length+' files.');
