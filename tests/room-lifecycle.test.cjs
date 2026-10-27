const test=require('node:test'),assert=require('node:assert/strict');
const L=require('../room-lifecycle.js'),M=require('../room-membership.js');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {scripts}=require('../scripts/check-render-safety.cjs');
const NOW=1000000;
const room=()=>({code:'ABCD',game:'remi',membershipVersion:2,players:{p:{uid:'p',seat:0,isBot:false,lastSeen:NOW}},seats:{0:'p'}});
test('human room expires at thirty seconds; new heartbeat extends the deadline',()=>{
  const r=room();assert.equal(L.expired(r,NOW+29999),false);assert.equal(L.expired(r,NOW+30000),true);
  r.players.p.lastSeen=NOW+20000;assert.equal(L.expired(r,NOW+30000),false);
});
test('server disconnect time protects full grace and zero lastSeen is supported',()=>{
  const r=room();r.players.p.lastSeen=0;r.players.p.disconnectedAt=NOW+10000;
  assert.equal(L.expired(r,NOW+39999),false);assert.equal(L.expired(r,NOW+40000),true);
});
test('bots and spectators never extend empty-room expiry',()=>{
  const r=room();r.players.p.isBot=true;r.emptySince=NOW;r.players.p.lastSeen=NOW+50000;r.spectators={viewer:{lastSeen:NOW+50000}};
  assert.equal(L.expired(r,NOW+30000),true);
});
test('legacy zero-presence and bots-only rooms require a server marker first',()=>{
  for(const bots of [true,false]){
    const r=room();r.players.p.isBot=bots;r.players.p.lastSeen=0;
    assert.equal(L.expired(r,NOW),false);assert.equal(L.needsMarker(r,NOW),true);
    r.emptySince=NOW;assert.equal(L.needsMarker(r,NOW),false);assert.equal(L.expired(r,NOW+29999),false);assert.equal(L.expired(r,NOW+30000),true);
  }
});
test('malformed or unindexed rooms cannot be removed by the automatic cleaner',()=>{
  const r=room();delete r.seats[0];assert.equal(L.expired(r,NOW+90000),false);
  r.seats[0]='p';delete r.membershipVersion;assert.equal(L.expired(r,NOW+90000),false);
});
test('last-human membership change starts one timer and rejoin clears it',()=>{
  const r=room(),patch=M.membershipPatch(r,{'players/p/isBot':true});assert.deepEqual(patch.emptySince,{'.sv':'timestamp'});
  r.players.p.isBot=true;r.emptySince=NOW;
  assert.equal(M.membershipPatch(r,{'players/p/seat':0}).emptySince,undefined);
  assert.equal(M.membershipPatch(r,{'players/p/isBot':false}).emptySince,null);
  r.players.p.isBot=false;
  assert.deepEqual(M.membershipPatch(r,{'players/p/isBot':true}).emptySince,{'.sv':'timestamp'});
});
test('cleaner clears an old absence marker when human presence resumes',async()=>{
  const r=room();r.emptySince=NOW-90000;const writes=[];let callback;
  const fb={authUid:'viewer',db:{},ref:(_,p)=>p,onValue:(_,fn)=>{callback=fn;return()=>{};},remove:async p=>writes.push(p)};
  const cleaner=L.create(fb,{now:()=>NOW});cleaner.start();callback({val:()=>({ABCD:r})});await cleaner.scan();await new Promise(setImmediate);
  assert.deepEqual(writes,['rooms/ABCD/emptySince']);cleaner.stop();
});
test('cleaner deletes only expired rooms and stops on logout',async()=>{
  const r=room();r.players.p.lastSeen=NOW-31000;
  const fresh=room(),writes=[];let callback,off=0;
  const fb={authUid:'viewer',db:{},ref:(_,p)=>p,onValue:(_,fn)=>{callback=fn;return()=>off++;},remove:async p=>writes.push(p),set:async()=>assert.fail('unexpected marker'),serverTimestamp:()=>({'.sv':'timestamp'})};
  const cleaner=L.create(fb,{now:()=>NOW});cleaner.start();callback({val:()=>({ABCD:r,EFGH:fresh})});await cleaner.scan();await new Promise(setImmediate);
  assert.deepEqual(writes,['rooms/ABCD']);fb.authUid=null;await cleaner.scan();assert.equal(writes.length,1);
  cleaner.stop();assert.equal(off,1);
});
function actual(name){
  for(const {ast,code}of scripts(fs.readFileSync(path.join(__dirname,'../truf-multiplayer-v3.html'),'utf8'))){
    const n=ast.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);if(n)return code.slice(n.start,n.end);
  }
  throw Error(name);
}
test('in-game onDisconnect records server time without deleting a hand or ending bot grace',async()=>{
  const writes=[],context=vm.createContext({myUid:'p',onDisconnectMode:null,
    fb:{db:{},ref:(_,p)=>p,serverTimestamp:()=>({'.sv':'timestamp'}),onDisconnect:ref=>({cancel:async()=>{},update:async data=>writes.push({ref,data})})}});
  vm.runInContext(actual('setupOnDisconnect'),context);await context.setupOnDisconnect('ABCD','keep');
  assert.deepEqual(JSON.parse(JSON.stringify(writes)),[{ref:'rooms/ABCD/players/p',data:{disconnectedAt:{'.sv':'timestamp'}}}]);
});
test('actual heartbeat never writes a spectator into the player list',async()=>{
  let tick;const writes=[],context=vm.createContext({heartbeatTimer:null,currentRoom:'ABCD',isSpectator:true,myUid:'viewer',PRESENCE_HEARTBEAT_MS:5000,
    setInterval:fn=>{tick=fn;return 1;},clearInterval:()=>{},fb:{db:{},ref:(_,p)=>p,serverTimestamp:()=>({'.sv':'timestamp'}),update:async(...args)=>writes.push(args)}});
  vm.runInContext(actual('startHeartbeat'),context);context.startHeartbeat();await tick();assert.equal(writes.length,0);
  context.isSpectator=false;await tick();assert.equal(writes.length,1);assert.equal(writes[0][0],'rooms/ABCD/players/viewer');
});
