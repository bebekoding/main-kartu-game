/* Checkpoints only the fixed localhost demo namespace. Never reads production.
 * Auth emulator password hashes are test-only and not cryptographically secure.
 * Keep these files private and excluded from Hosting/Git. Never log payloads.
 */
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const PROJECT='demo-main-kartu-v44';
const DB=`http://127.0.0.1:19000/.json?ns=${PROJECT}`;
const AUTH=`http://127.0.0.1:19099/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts`;
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function encode(database,users,now=Date.now()){
  const payload={format:1,project:PROJECT,savedAt:now,database,users};
  return JSON.stringify({payload,sha256:digest(payload)});
}
function decode(text){
  const record=JSON.parse(text),p=record.payload;
  if(!object(p)||p.format!==1||p.project!==PROJECT||!Number.isFinite(p.savedAt)||p.savedAt<0||
    !object(p.database)||!Array.isArray(p.users)||record.sha256!==digest(p)||
    p.users.some(u=>!object(u)||typeof u.localId!=='string'||!u.localId||u.tenantId)||
    new Set(p.users.map(u=>u.localId)).size!==p.users.length)throw Error('Cadangan lokal tidak valid.');
  return p;
}
function create({directory,fetch:request=fetch,now=Date.now}={}){
  if(!directory)throw Error('Folder cadangan lokal wajib ditentukan.');
  const latest=path.join(directory,'latest.json'),previous=path.join(directory,'previous.json');
  let queue=Promise.resolve();
  async function api(url,{method='GET',body}={}){
    const response=await request(url,{method,headers:{Authorization:'Bearer owner','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(7000)});
    if(!response.ok)throw Error('Layanan emulator belum siap untuk cadangan/pemulihan.');
    return response.json();
  }
  async function accounts(){
    const users=[],seen=new Set();let token='';
    do{
      const data=await api(AUTH+':batchGet?maxResults=1000'+(token?'&nextPageToken='+encodeURIComponent(token):''));
      users.push(...(data.users||[]));token=data.nextPageToken||'';
      if(token&&seen.has(token))throw Error('Pagination cadangan akun tidak valid.');
      seen.add(token);
    }while(token);
    return users;
  }
  async function atomic(file,text){
    await fs.mkdir(directory,{recursive:true,mode:0o700});await fs.chmod(directory,0o700);
    const temp=file+'.'+crypto.randomUUID()+'.tmp';let handle;
    try{handle=await fs.open(temp,'wx',0o600);await handle.writeFile(text);await handle.sync();await handle.close();handle=null;await fs.rename(temp,file);}
    finally{if(handle)await handle.close();await fs.rm(temp,{force:true});}
  }
  async function read(){
    let error=null;
    for(const [file,fallback]of [[latest,false],[previous,true]]){
      try{const text=await fs.readFile(file,'utf8');return {payload:decode(text),text,fallback};}
      catch(e){if(e.code!=='ENOENT')error=e;}
    }
    if(error)throw Error('Cadangan lokal rusak atau tidak dapat dibaca; startup dihentikan agar data tidak tertimpa.');
    return null;
  }
  function serialized(operation){const result=queue.then(operation);queue=result.catch(()=>{});return result;}
  function checkpoint(){return serialized(async()=>{
    // Read DB first, then Auth: a just-created account must be in the account
    // export before any of its already-captured database records are restored.
    const savedAt=now(),database=await api(DB)||{},users=await accounts(),text=encode(database,users,savedAt);
    decode(text);const old=await read();
    if(old)await atomic(previous,old.text);
    await atomic(latest,text);
    return {savedAt,accounts:users.length,rooms:Object.keys(database.rooms||{}).length};
  });}
  function restore(){return serialized(async()=>{
    const saved=await read();if(!saved)return {restored:false,fallback:false};
    const current=await api(DB),existing=await accounts();
    if((current&&Object.keys(current).length)||existing.length)throw Error('Pemulihan menolak menimpa emulator yang sudah berisi data.');
    const p=saved.payload;
    for(let i=0;i<p.users.length;i+=1000){
      const result=await api(AUTH+':batchCreate',{method:'POST',body:{users:p.users.slice(i,i+1000),sanityCheck:true,allowOverwrite:false}});
      if(result.error?.length)throw Error('Pemulihan sebagian akun gagal; startup dihentikan. Cadangan dipertahankan.');
    }
    await api(DB,{method:'PUT',body:p.database});
    return {restored:true,fallback:saved.fallback,accounts:p.users.length,rooms:Object.keys(p.database.rooms||{}).length,savedAt:p.savedAt};
  });}
  return {checkpoint,restore,read,latest,previous};
}
if(require.main===module){
  const state=create({directory:path.join(__dirname,'../artifacts/local-state')});
  const command=process.argv[2];
  if(!['checkpoint','restore'].includes(command)){console.error('Gunakan local-state.cjs checkpoint atau restore.');process.exitCode=1;}
  else state[command]().then(stats=>console.log(JSON.stringify(stats))).catch(e=>{console.error(e.message);process.exitCode=1;});
}
module.exports={PROJECT,encode,decode,create};
