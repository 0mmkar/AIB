import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const profile=path.join(os.tmpdir(),'aib-video-review-'+Date.now());
const child=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
const pause=ms=>new Promise(r=>setTimeout(r,ms));let socket;
try {
  for(let i=0;i<100&&!fs.existsSync(path.join(profile,'DevToolsActivePort'));i++)await pause(100);
  const port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];
  const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
  await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
  let id=0;const pending=new Map();const errors=[];
  socket.onmessage=({data})=>{const msg=JSON.parse(data);if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params.exceptionDetails.text);if(pending.has(msg.id)){const p=pending.get(msg.id);clearTimeout(p.timer);pending.delete(msg.id);msg.error?p.j(Error(JSON.stringify(msg.error))):p.r(msg.result);}};
  const call=(method,params={})=>new Promise((r,j)=>{const key=++id;pending.set(key,{r,j,timer:setTimeout(()=>j(Error('Timeout '+method)),20000)});socket.send(JSON.stringify({id:key,method,params}));});
  const js=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  await call('Runtime.enable');await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:'file:///'+path.join(root,'deliverables/client-demo-v2/index.html').replaceAll('\\','/')});
  for(let i=0;i<100;i++){if(await js("document.querySelector('video')?.readyState>=1"))break;await pause(100);}
  const metadata=await js("(()=>{const v=document.querySelector('video');return {duration:v.duration,width:v.videoWidth,height:v.videoHeight,error:v.error?.message??null}})()");
  if(!metadata.duration||metadata.error)throw Error(JSON.stringify(metadata));
  await js("(()=>{const v=document.querySelector('video');v.muted=true;return v.play()})()");
  await pause(800);
  const plays=await js("document.querySelector('video').currentTime>0");
  if(!plays)throw Error('Video did not advance');
  const chapterCount=await js("document.querySelectorAll('[data-time]').length");
  for(let i=0;i<chapterCount;i++){
    await js(`document.querySelectorAll('[data-time]')[${i}].click()`);await pause(150);
    const success=await js(`Math.abs(document.querySelector('video').currentTime-Number(document.querySelectorAll('[data-time]')[${i}].dataset.time))<1`);
    if(!success)throw Error('Chapter seek failed '+i);
  }
  await js("document.querySelector('video').pause();document.querySelector('video').currentTime=27");await pause(300);
  let shot=await call('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(path.join(root,'.demo-work/v2/player-desktop.png'),Buffer.from(shot.data,'base64'));
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  const overflow=await js('document.documentElement.scrollWidth>innerWidth');
  if(overflow)throw Error('Mobile page overflow');
  shot=await call('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(path.join(root,'.demo-work/v2/player-mobile.png'),Buffer.from(shot.data,'base64'));
  if(errors.length)throw Error(errors.join('; '));
  const result={...metadata,plays,chaptersChecked:chapterCount,mobileOverflow:overflow,browserErrors:errors};
  fs.writeFileSync(path.join(root,'deliverables/client-demo-v2/player-verification.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));await call('Browser.close');
}catch(e){console.error(e);process.exitCode=1;}finally{socket?.close();child.kill();}
