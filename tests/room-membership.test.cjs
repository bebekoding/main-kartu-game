const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('../room-membership.js');
const NOW = Date.now();
const p = (uid,seat,isBot=false) => ({uid,seat,isBot,nickname:uid,lastSeen:NOW});
const room = () => ({code:'ABCD',game:'remi',phase:'playing',host:'h',maxPlayers:4,membershipVersion:2,
  players:{h:p('h',0),u:p('u',1),b:p('b',2,true)},seats:{0:'h',1:'u',2:'b'},
  gameState:{roster:{0:p('h',0),1:p('u',1),2:p('b',2,true)}}});

test('active match rejects a new UID even if nickname is copied',()=>{
  assert.throws(()=>M.joinPatch(room(),'x','u','u',NOW),/terdaftar/);
});
test('reconnect restores only the authenticated original UID',()=>{
  const r=room();delete r.players.u;r.players.replacement=p('replacement',1,true);r.seats[1]='replacement';
  const j=M.joinPatch(r,'u','U','u',NOW);
  assert.equal(j.changes['players/replacement'],null);assert.equal(j.changes['players/u'].seat,1);
  assert.equal(j.claiming,false);
});
test('full lobby does not generate a fifth seat',()=>{
  const r=room();r.phase='lobby';r.players.c=p('c',3,true);r.seats[3]='c';
  assert.throws(()=>M.joinPatch(r,'x','X','x',NOW),/terisi/);
});
test('six-player lobby allocates fifth seat',()=>{
  const r=room();r.phase='lobby';r.game='tebak';r.maxPlayers=6;r.players.c=p('c',3);r.seats[3]='c';
  assert.equal(M.joinPatch(r,'x','X','x',NOW).changes['players/x'].seat,4);
});
test('offline humans prevent free claim',()=>{
  const r=room();r.players.h.isBot=true;r.players.u.lastSeen=0;
  assert.equal(M.allBots(r),false);assert.throws(()=>M.joinPatch(r,'x','X','x',NOW),/terdaftar/);
});
test('all-bot claim atomically swaps bot, joins and takes ownership',()=>{
  const r=room();Object.values(r.players).forEach(p=>p.isBot=true);
  const j=M.joinPatch(r,'x','X','x',NOW);const patch=M.membershipPatch(r,j.changes);
  assert.equal(j.claiming,true);assert.equal(patch.host,'x');assert.equal(patch['players/h'],null);
  assert.equal(patch['seats/0'],'x');assert.equal(patch['players/x'].isBot,false);
});
test('legacy rooms cannot be freely claimed from an incomplete index',()=>{
  const r=room();delete r.membershipVersion;Object.values(r.players).forEach(p=>p.isBot=true);
  assert.equal(M.allBots(r),false);assert.throws(()=>M.joinPatch(r,'x','X','x',NOW),/terdaftar/);
});
test('successor is lowest online human, skips stale/disconnected/bot',()=>{
  const r=room();r.players.z=p('z',3);r.players.u.disconnected=true;
  assert.equal(M.onlineHumans(r,NOW,'h')[0].uid,'z');
  r.players.z.lastSeen=NOW-16000;assert.equal(M.onlineHumans(r,NOW,'h').length,0);
});
test('host is not considered lost before 42-second grace',()=>{
  const r=room();r.players.h.lastSeen=NOW-20000;assert.equal(M.hostUnavailable(r,NOW),false);
  r.players.h.lastSeen=NOW-43000;assert.equal(M.hostUnavailable(r,NOW),true);
});
test('atomic membership patch updates both sides of a reseat',()=>{
  const r=room();r.phase='lobby';
  const result=M.membershipPatch(r,{'players/u/seat':3});
  assert.equal(result['seats/1'],null);assert.equal(result['seats/3'],'u');
});
test('duplicate seats and out-of-range players fail before commit',()=>{
  assert.throws(()=>M.membershipPatch(room(),{'players/x':p('x',1)}),/dua pemain/);
  assert.throws(()=>M.membershipPatch(room(),{'players/x':p('x',4)}),/tidak valid/);
});
test('deleting player releases seat; converting to bot preserves hand position',()=>{
  const a=M.membershipPatch(room(),{'players/u':null});assert.equal(a['seats/1'],null);
  const b=M.membershipPatch(room(),{'players/u/isBot':true});assert.equal(b['seats/1'],undefined);
});
test('database bridge uses one update for player + canonical seat',async()=>{
  const r=room();r.phase='lobby';let commits=[],reads=0;
  const ref=(_,path)=>({toString:()=> 'https://example.test/'+path});
  const raw={db:{},ref,get:async()=>{reads++;return{exists:()=>true,val:()=>r};},
    set:async()=>assert.fail('must use atomic room update'),remove:async()=>assert.fail('must use indexed removal'),
    update:async(ref,data)=>commits.push({path:ref.toString(),data})};
  const bridge=M.databaseBridge(raw);
  await bridge.set(ref(null,'rooms/ABCD/players/x'),p('x',3));
  assert.equal(commits.length,1);assert.equal(commits[0].data['seats/3'],'x');
  assert.equal(commits[0].data['players/x'].seat,3);assert.equal(reads,1);
  await bridge.update(ref(null,'rooms/ABCD/players/u'),{lastSeen:NOW});
  assert.equal(reads,1); // heartbeats must not re-read the entire room
});

const html=fs.readFileSync(path.join(__dirname,'../truf-multiplayer-v3.html'),'utf8');
function source(name){
  const m=html.match(new RegExp('^(?:async )?function '+name+'\\([^]*?^}','m'));
  assert.ok(m,name);return m[0];
}
function leaveHarness(r,uid='h'){
  let writes=[];
  const env={RoomMembership:M,currentRoom:'ABCD',myUid:uid,serverNow:()=>NOW,
    getRoomNicknames:()=>new Set(),pickRandomBotName:()=> 'Bot',
    fb:{db:{},ref:(_,p)=>p, get:async()=>({exists:()=>true,val:()=>r}),update:async(ref,data)=>writes.push({ref,data})}};
  vm.createContext(env);vm.runInContext(source('leaveRoomMembership'),env);
  return{env,writes};
}
test('actual leave handler hands host to live human and keeps match intact',async()=>{
  const h=leaveHarness(room());await h.env.leaveRoomMembership();
  assert.equal(h.writes.length,1);const patch=h.writes[0].data;
  assert.equal(patch.host,'u');assert.equal(patch['players/h/isBot'],true);
  assert.equal(patch['players/h/leftHuman'],true);assert.equal(patch.remi,undefined);
});
test('actual last-human exit leaves reclaimable bots, does not delete room',async()=>{
  const r=room();r.players.u.isBot=true;const h=leaveHarness(r);await h.env.leaveRoomMembership();
  assert.equal(h.writes[0].data.host,null);assert.equal(h.writes[0].data['players/h/isBot'],true);
});
test('actual lobby exit removes only own slot and transfers host',async()=>{
  const r=room();r.phase='lobby';const h=leaveHarness(r);await h.env.leaveRoomMembership();
  assert.equal(h.writes[0].data['players/h'],null);assert.equal(h.writes[0].data.host,'u');
});
test('non-host exit cannot nominate a different owner',async()=>{
  const h=leaveHarness(room(),'u');await h.env.leaveRoomMembership();
  assert.equal(h.writes[0].data.host,undefined);
});
test('all delayed host drivers are bound to originating room and owner',()=>{
  for(const name of ['maybeRunRemiBot','maybeRunCangkulBot','maybeRunTebakBot','maybeResolveTrick','maybeFinishSession']){
    const f=source(name);assert.match(f,/currentRoom !== scheduledRoom/);assert.match(f,/_lastRoom.host !== myUid/);
  }
});
