const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const S=require('../scripts/local-state.cjs');
const user={localId:'local-u1',email:'fixture@mainkartu.local',passwordHash:'fixture-hash',salt:'fixture-salt'};
const fixture=()=>({rooms:{ABCD:{savedGame:{status:'saved'},createdAt:123}},capsaPrivate:{ABCD:{snapshot:'{"hands":[[1],[2],[3],[4]],"revision":8}'}}});
async function harness(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'capsa-checkpoint-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
function fake({database={},users=[],failAuth=false,failImport=false,paginated=false}={}){
 const calls=[];return {calls,fetch:async(url,options)=>{
  calls.push({url,method:options.method,body:options.body});
  if(url.includes('accounts:batchGet')){
   if(failAuth)return {ok:false,json:async()=>({})};
   return {ok:true,json:async()=>paginated&&url.includes('nextPageToken=')?{users:[]}:{users,nextPageToken:paginated?'next-token':undefined}};
  }
  if(url.includes('accounts:batchCreate'))return {ok:true,json:async()=>failImport?{error:[{index:0}]}:{}};
  return {ok:true,json:async()=>database};
 }};
}
test('checkpoint retains complete database/private state and account fields with private permissions',async t=>{
 const dir=await harness(t),remote=fake({database:fixture(),users:[user]}),state=S.create({directory:dir,fetch:remote.fetch,now:()=>12345});
 const stats=await state.checkpoint(),saved=await state.read();
 assert.equal(stats.savedAt,12345);assert.deepEqual(saved.payload.database,fixture());assert.deepEqual(saved.payload.users,[user]);
 assert.equal((await fs.stat(dir)).mode&0o777,0o700);assert.equal((await fs.stat(state.latest)).mode&0o777,0o600);
 assert.equal(remote.calls[0].url,'http://127.0.0.1:19000/.json?ns=demo-main-kartu-v44');
 assert.ok(remote.calls.every(c=>c.url.startsWith('http://127.0.0.1:')));
});
test('export follows every Auth page and never truncates at page boundary',async t=>{
 const dir=await harness(t),remote=fake({users:[user],paginated:true}),state=S.create({directory:dir,fetch:remote.fetch});
 await state.checkpoint();assert.equal(remote.calls.filter(c=>c.url.includes('batchGet')).length,2);assert.deepEqual((await state.read()).payload.users,[user]);
});
test('restore preserves UIDs/password data and exact state; accounts restored before database',async t=>{
 const dir=await harness(t),live=fake({database:fixture(),users:[user]});
 await S.create({directory:dir,fetch:live.fetch}).checkpoint();const empty=fake(),restored=S.create({directory:dir,fetch:empty.fetch});
 assert.equal((await restored.restore()).restored,true);
 const writes=empty.calls.filter(c=>c.method!=='GET');assert.match(writes[0].url,/accounts:batchCreate$/);
 assert.deepEqual(JSON.parse(writes[0].body).users,[user]);assert.equal(writes[1].method,'PUT');assert.deepEqual(JSON.parse(writes[1].body),fixture());
});
test('restoration refuses nonempty database or existing Auth accounts before writing',async t=>{
 const dir=await harness(t);await fs.writeFile(path.join(dir,'latest.json'),S.encode(fixture(),[user]));
 for(const existing of [{database:{existing:true}},{users:[user]}]){
  const remote=fake(existing),state=S.create({directory:dir,fetch:remote.fetch});await assert.rejects(state.restore(),/menimpa/);assert.ok(remote.calls.every(c=>c.method==='GET'));
 }
});
test('corrupt latest checkpoint recovers previous good generation and never imports corrupted data',async t=>{
 const dir=await harness(t),state=S.create({directory:dir,fetch:fake({database:fixture(),users:[user]}).fetch});
 await state.checkpoint();await state.checkpoint();await fs.writeFile(state.latest,'broken JSON');
 assert.equal((await state.read()).fallback,true);const empty=fake();assert.equal((await S.create({directory:dir,fetch:empty.fetch}).restore()).fallback,true);
 assert.deepEqual(JSON.parse(empty.calls.find(c=>c.method==='PUT').body),fixture());
});
test('wrong project/checksum, two bad generations and partial import fail closed',async t=>{
 const dir=await harness(t),file=path.join(dir,'latest.json');
 const wrong=JSON.parse(S.encode(fixture(),[user]));wrong.payload.project='production';assert.throws(()=>S.decode(JSON.stringify(wrong)),/tidak valid/);
 const altered=JSON.parse(S.encode(fixture(),[user]));altered.payload.database.extra=true;assert.throws(()=>S.decode(JSON.stringify(altered)),/tidak valid/);
 await fs.writeFile(file,'broken');await assert.rejects(S.create({directory:dir,fetch:fake().fetch}).restore(),/rusak/);
 await fs.writeFile(file,S.encode(fixture(),[user]));const remote=fake({failImport:true});await assert.rejects(S.create({directory:dir,fetch:remote.fetch}).restore(),/sebagian akun/);assert.ok(!remote.calls.some(c=>c.method==='PUT'));
});
test('failed export never replaces a good checkpoint; parallel checkpoints serialize cleanly',async t=>{
 const dir=await harness(t),good=S.create({directory:dir,fetch:fake({database:fixture(),users:[user]}).fetch});
 await Promise.all([good.checkpoint(),good.checkpoint()]);const before=await fs.readFile(good.latest,'utf8');
 await assert.rejects(S.create({directory:dir,fetch:fake({failAuth:true}).fetch}).checkpoint(),/belum siap/);assert.equal(await fs.readFile(good.latest,'utf8'),before);
 assert.deepEqual((await fs.readdir(dir)).sort(),['latest.json','previous.json']);
});
test('empty installation has no restore side effects and snapshot rejects duplicate/tenant UIDs',async t=>{
 const dir=await harness(t),remote=fake();assert.equal((await S.create({directory:dir,fetch:remote.fetch}).restore()).restored,false);assert.equal(remote.calls.length,0);
 assert.throws(()=>S.decode(S.encode({},[user,user])),/tidak valid/);assert.throws(()=>S.decode(S.encode({},[{...user,tenantId:'another'}])),/tidak valid/);
});
