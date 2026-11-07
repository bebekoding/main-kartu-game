const {spawn,execFileSync}=require('node:child_process');
const path=require('node:path'),fs=require('node:fs'),os=require('node:os'),net=require('node:net');
const {create}=require('./local-state.cjs');
const root=path.resolve(__dirname,'..'),children=[];
const state=create({directory:path.join(root,'artifacts/local-state')});
let stopping=false,initialized=false,checkpointTimer=null,checkpointBusy=false,gateway=null;
function logError(error){console.error(error.message);}
function signal(child,signal){if(!child?.pid)return;try{process.kill(-child.pid,signal);}catch(e){if(e.code!=='ESRCH')logError(e);}}
async function finishChild(child){
  if(!child||child.exitCode!==null||child.signalCode)return;
  await new Promise(resolve=>{child.once('exit',resolve);signal(child,'SIGTERM');const timer=setTimeout(()=>{signal(child,'SIGKILL');resolve();},5000);timer.unref();child.once('exit',()=>clearTimeout(timer));});
}
async function stop(code=0){
  if(stopping)return;stopping=true;if(checkpointTimer)clearInterval(checkpointTimer);
  // Children have separate process groups: Ctrl+C must not kill Auth/RTDB
  // before the final checkpoint has completed.
  await finishChild(gateway);
  if(initialized)try{await state.checkpoint();console.log('Cadangan lokal tersimpan.');}catch(e){logError(e);code=1;}
  await Promise.all(children.filter(c=>c!==gateway).map(finishChild));process.exitCode=code;
}
function launch(command,args){
  const child=spawn(command,args,{cwd:root,stdio:['ignore','inherit','inherit'],detached:true});children.push(child);
  child.on('exit',code=>{if(!stopping)stop(code||0).catch(logError);});child.on('error',e=>{logError(e);stop(1).catch(logError);});return child;
}
function occupied(port){return new Promise(resolve=>{const socket=net.connect({host:'127.0.0.1',port});socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));socket.setTimeout(1000,()=>{socket.destroy();resolve(false);});});}
async function boot(){
  // Fail before spawning or restoring anything if another instance owns ports.
  const ports=[18844,19000,19099,14400,14500];
  for(const port of ports)if(await occupied(port))throw Error(`Port lokal ${port} sedang dipakai. Gunakan preview yang sudah berjalan atau hentikan layanannya terlebih dahulu.`);
  await state.read(); // Corrupt backups must never silently turn into fresh data.
  execFileSync(process.execPath,[path.join(__dirname,'build-local-rules.cjs')]);
  const jar=path.join(os.homedir(),'.cache/firebase/emulators/firebase-database-emulator-v4.11.2.jar');
  try{execFileSync('java',['-version'],{stdio:['ignore','pipe','pipe']});}catch(_){throw Error('Java diperlukan untuk emulator RTDB.');}
  if(fs.existsSync(jar)){
    launch('java',['-jar',jar,'--host','127.0.0.1','--port','19000','--single_project_mode','Warning']);
    launch('firebase',['emulators:start','--config','firebase.local.json','--project','demo-main-kartu-v44','--only','auth']);
  }else launch('firebase',['emulators:start','--config','firebase.local.json','--project','demo-main-kartu-v44','--only','database,auth']);
  let ready=false;
  for(let i=0;i<80&&!stopping;i++){
    try{
      const auth=await fetch('http://127.0.0.1:19099/',{signal:AbortSignal.timeout(1000)});
      if(auth.status<500){
        const r=await fetch('http://127.0.0.1:19000/.settings/rules.json?ns=demo-main-kartu-v44',{method:'PUT',headers:{Authorization:'Bearer owner','Content-Type':'application/json'},body:fs.readFileSync(path.join(root,'database.local.rules.json'),'utf8'),signal:AbortSignal.timeout(1000)});
        if(r.ok){ready=true;break;}
      }
    }catch(_){}
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  if(stopping)return;
  if(!ready)throw Error('Emulator lokal belum siap. Periksa port 19000/19099.');
  const restored=await state.restore();
  if(restored.restored)console.log(`Cadangan lokal dipulihkan: ${restored.accounts} akun, ${restored.rooms} room${restored.fallback?' (cadangan sebelumnya)':''}.`);
  initialized=true;await state.checkpoint();
  gateway=launch(process.execPath,[path.join(__dirname,'capsa-local-server.cjs')]);
  checkpointTimer=setInterval(async()=>{
    if(stopping||checkpointBusy)return;checkpointBusy=true;
    try{await state.checkpoint();}catch(e){logError(e);}finally{checkpointBusy=false;}
  },5000);
}
process.on('SIGINT',()=>stop().catch(logError));process.on('SIGTERM',()=>stop().catch(logError));
boot().catch(e=>{logError(e);stop(1).catch(logError);});
