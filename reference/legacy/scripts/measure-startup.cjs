'use strict';
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
(async()=>{
 const old=process.argv[2],targets=old?[['previous',path.resolve(old)],['current',path.resolve('.')]]:[['current',path.resolve('.')]],samples={};
 for(let iteration=0;iteration<3;iteration++)for(const[label,target]of targets){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'legacylock-startup-'));
  try{
   const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
   const start=performance.now();
   const ms=await new Promise((resolve,reject)=>{
    const child=spawn(require('electron'),[path.resolve('tests/measure-startup-child.cjs'),target,dir],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let ready=false,elapsed,output='';
    child.stdout.on('data',d=>{if(String(d).includes('READY')){ready=true;elapsed=performance.now()-start;}});
    child.stderr.on('data',d=>{output+=d;});
    const timer=setTimeout(()=>{child.kill();reject(Error('Startup timed out'));},12000);
    child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('exit',code=>{clearTimeout(timer);if(code!==0||!ready)reject(Error(output||'Startup failed'));else resolve(Math.round(elapsed));});
   });
   (samples[label]??=[]).push(ms);
  }finally{
   if(path.dirname(path.resolve(dir))!==path.resolve(os.tmpdir())||!path.basename(dir).startsWith('legacylock-startup-'))throw Error('Unsafe fixture cleanup');
   await fs.rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:200});
  }
 }
 for(const[label,values]of Object.entries(samples))console.log(JSON.stringify({label,ms:values,medianMs:[...values].sort((a,b)=>a-b)[1]}));
})().catch(e=>{console.error(e);process.exitCode=1;});
