import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const config=JSON.parse((await readFile(path.join(root,'.runtime','config.json'),'utf8')).replace(/^\uFEFF/,''));
await mkdir(path.join(root,'dist','audio'),{recursive:true});
const names=['demo-focus','demo-slow','demo-night'];
const chords=[[130.8128,164.8138,195.9977],[110,130.8128,164.8138],[97.9989,123.4708,146.8324]];
for(let track=0;track<names.length;track++){
  const rate=22050,seconds=32,count=rate*seconds,pcm=Buffer.alloc(count*2);
  for(let i=0;i<count;i++){
    const t=i/rate,fade=Math.min(1,t/2,(seconds-t)/3),frequencies=chords[track];let value=0;
    for(let n=0;n<3;n++)value+=Math.sin(2*Math.PI*frequencies[n]*t+.11*Math.sin(t*.22+n))*.075*(.7+.3*Math.sin(t*.28+n));
    const beat=1.8+track*.4,step=Math.floor(t/beat),age=t-step*beat,note=frequencies[[0,2,1,2,0,1,2,1][step%8]]*2;
    value+=Math.sin(2*Math.PI*note*t)*Math.exp(-age*2.2)*.09;
    value+=Math.sin(2*Math.PI*frequencies[0]/2*t)*.035;
    pcm.writeInt16LE(Math.round(Math.max(-1,Math.min(1,value*fade))*32767),i*2);
  }
  const header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(36+pcm.length,4);header.write('WAVE',8);header.write('fmt ',12);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(rate,24);header.writeUInt32LE(rate*2,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);
  const wav=path.join(root,'.runtime',`${names[track]}.wav`),mp3=path.join(root,'dist','audio',`${names[track]}.mp3`);
  await writeFile(wav,Buffer.concat([header,pcm]));
  const converted=spawnSync(config.ffmpeg,['-hide_banner','-loglevel','error','-y','-i',wav,'-vn','-c:a','libmp3lame','-b:a','128k',mp3],{windowsHide:true,encoding:'utf8'});
  if(converted.status!==0)throw new Error(converted.stderr||'Could not create demo audio');
  await unlink(wav);console.log(`Created original sample: ${names[track]}`);
}
