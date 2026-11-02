const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const S=require('../room-saves.js'),L=require('../room-lifecycle.js'),UI=require('../room-save-ui.js');
const html=fs.readFileSync(path.join(__dirname,'../truf-multiplayer-v3.html'),'utf8');
const NOW=1000000,ID='a'.repeat(32);
function fixture(size=2){
  const players={},seats={};
  for(let seat=0;seat<4;seat++){
    const uid='p'+seat;players[uid]={uid,seat,nickname:'Pemain '+seat,isBot:seat>=size,lastSeen:NOW};seats[seat]=uid;
  }
  return {code:'ABCD',game:'remi',phase:'playing',host:'p0',membershipVersion:2,players,seats,
    remi:{roundNumber:3,currentPlayer:0,turnPhase:'discard',hands:{0:[{rank:'K',suit:'D'}],1:[{rank:'J',suit:'H'}]}},totals:{0:100,1:-100}};
}
test('save eligibility covers all four games and rejects lobby, spectators and final matches',()=>{
  for(const game of ['truf','remi','cangkul','tebak']){const r=fixture();r.game=game;assert.equal(S.canSave(r,'p0'),true);assert.equal(S.canSave(r,'p2'),false);assert.equal(S.canSave(r,'viewer'),false);}
  for(const phase of ['lobby','tournament_end','remi_tournament_end','cangkul_tournament_end','tebak_match_end']){const r=fixture();r.phase=phase;assert.equal(S.canSave(r,'p0'),false);}
});
test('saved games require the exact original humans; bots and viewers never count',()=>{
  const r=fixture();r.savedGame=S.request(r,'p0',ID,NOW);
  assert.deepEqual(r.savedGame.humans,{0:'p0',1:'p1'});assert.equal(S.approved(r),false);
  r.savedGame.votes.p2=ID;r.savedGame.votes.viewer=ID;assert.equal(S.approved(r),false);
  r.savedGame.votes.p1=ID;assert.equal(S.approved(r),true);
});
test('seven-day retention replaces thirty seconds only for a saved game',()=>{
  const r=fixture(1);r.savedGame={...S.request(r,'p0',ID,NOW),status:'saved'};
  assert.equal(L.expired(r,NOW+30000),false);assert.equal(L.expired(r,NOW+S.WEEK_MS-1),false);assert.equal(L.expired(r,NOW+S.WEEK_MS),true);
  r.savedGame.lastAccessAt=NOW+60000;assert.equal(L.expired(r,NOW+S.WEEK_MS),false);
  assert.equal(S.listed(r,'p0',NOW+60000),true);assert.equal(S.listed(r,'p2',NOW+60000),false);
  delete r.savedGame;assert.equal(L.expired(r,NOW+30000),true);
});
test('save request gives a finite sixty-second window and requires fresh confirmations per resume attempt',()=>{
  const r=fixture();r.savedGame=S.request(r,'p0',ID,NOW);
  assert.equal(L.expired(r,NOW+30000),false);assert.equal(L.expired(r,NOW+60000),true);
  r.savedGame.status='resuming';r.savedGame.resumeId='b'.repeat(32);r.savedGame.ready={p0:ID,p1:ID};
  assert.equal(S.ready(r,NOW),false);r.savedGame.ready={p0:r.savedGame.resumeId,p1:r.savedGame.resumeId};assert.equal(S.ready(r,NOW),true);
  r.players.p1.disconnectedAt=NOW;assert.equal(S.ready(r,NOW),false);delete r.players.p1.disconnectedAt;
  assert.equal(S.ready(r,NOW+15001),false);
});
function harness(size=2){
  const state=fixture(size),clients=[],disconnects=[],writes=[];let clock=NOW,nonce=0,failure=false;
  const stamp=value=>value&&typeof value==='object'?(value['.sv']==='timestamp'?clock:Object.fromEntries(Object.entries(value).map(([k,v])=>[k,stamp(v)]))):value;
  function change(p,value){const parts=p.replace(/^rooms\/ABCD\/?/,'').split('/').filter(Boolean),last=parts.pop();let n=state;for(const k of parts)n=n[k]||(n[k]={});if(value===null)delete n[last];else n[last]=stamp(structuredClone(value));}
  const notify=()=>clients.forEach(c=>c.api.observe(structuredClone(state)));
  function transport(){return{db:{},ref:(_,p)=>p,serverTimestamp:()=>({'.sv':'timestamp'}),
    get:async p=>{const value=p==='rooms'?{ABCD:state}:p.endsWith('/savedGame')?state.savedGame:state;return{exists:()=>value!=null,val:()=>structuredClone(value)};},
    set:async(p,v)=>{if(failure)throw Error('Jaringan terputus');writes.push(p);change(p,v);notify();},
    remove:async p=>{writes.push(p);change(p,null);notify();},
    update:async(p,patch)=>{writes.push({p,patch});for(const [k,v]of Object.entries(patch))change(p+'/'+k,v);notify();},
    onDisconnect:p=>({cancel:async()=>{},remove:async()=>disconnects.push(p)})};}
  function client(n,spectator=false){
    const dom=new JSDOM(html,{url:'https://local.invalid/remi'}),events=[],fb=transport();let uid='p'+n;
    const api=UI.create(fb,{document:dom.window.document,now:()=>clock,id:()=>String(++nonce).padStart(32,'0'),uid:()=>uid,spectator:()=>spectator,
      enter:r=>{events.push('enter');api.observe(r);},error:message=>events.push(message),exit:()=>{events.push('exit');api.observe(null);},exitSpectator:()=>events.push('exit-spectator'),freezeChanged:flag=>events.push(flag?'frozen':'thawed')});
    const c={dom,api,events,fb,uid,el:id=>dom.window.document.getElementById(id)};clients.push(c);api.observe(structuredClone(state));return c;
  }
  const settle=async()=>{for(let i=0;i<4;i++)await new Promise(setImmediate);};
  return{state,client,writes,disconnects,notify,settle,clock:v=>{clock=v;},fail:v=>{failure=v;},close(){for(const c of clients){c.api.destroy();c.dom.window.close();}}};
}
test('real UI completes solo save, leave, list, open and explicit resume without changing game state',async()=>{
  const h=harness(1),c=h.client(0),before=structuredClone(h.state.remi);await c.api.save();await h.settle();await c.api.tick();await h.settle();
  assert.equal(h.state.savedGame.status,'saved');assert.match(c.el('savedGameModal').textContent,/Game tersimpan/);
  await c.api.exit();assert.ok(c.events.includes('exit'));assert.equal(h.state.players.p0.isBot,false);assert.equal(h.state.host,'p0');
  await c.api.showList();assert.match(c.el('savedGamesList').textContent,/Remi · ABCD/);
  c.el('savedGamesList').querySelector('button').click();await h.settle();assert.ok(c.events.includes('enter'));
  assert.equal(h.state.savedGame.status,'saved');await c.api.start();await c.api.confirmReady();await h.settle();await c.api.tick();await h.settle();
  assert.equal(h.state.savedGame,undefined);assert.deepEqual(h.state.remi,before);assert.ok(c.events.includes('thawed'));assert.equal(h.disconnects.length,1);h.close();
});
test('real two-player UI waits for unanimous save, presence and resume confirmation',async()=>{
  const h=harness(2),a=h.client(0),b=h.client(1);await a.api.save();await h.settle();assert.equal(h.state.savedGame.status,'request');
  assert.match(b.el('savedGameModal').textContent,/Setuju simpan/);await b.api.approve();await a.api.tick();await h.settle();assert.equal(h.state.savedGame.status,'saved');
  await b.api.exit();await a.api.start();await a.api.confirmReady();await h.settle();assert.equal(h.state.savedGame.status,'resuming');
  assert.match(a.el('savedGameModal').textContent,/Belum masuk/);assert.equal(h.state.players.p1.isBot,false);
  h.state.players.p1.lastSeen=NOW;delete h.state.players.p1.disconnected;delete h.state.players.p1.disconnectedAt;h.notify();
  await h.settle();assert.ok(h.state.savedGame);await b.api.confirmReady();await a.api.tick();await h.settle();assert.equal(h.state.savedGame,undefined);h.close();
});
test('rejection and timeout preserve the match and remove the save overlay',async()=>{
  const h=harness(),a=h.client(0),b=h.client(1),before=structuredClone(h.state.remi);await a.api.save();await b.api.cancel();await h.settle();
  assert.equal(a.el('savedGameModal').hidden,true);assert.deepEqual(h.state.remi,before);
  await a.api.save();h.clock(NOW+61000);h.state.players.p0.lastSeen=NOW+61000;h.notify();await a.api.tick();await h.settle();
  assert.equal(h.state.savedGame,undefined);assert.deepEqual(h.state.remi,before);h.close();
});
test('humans separated by bots save/resume without counting RTDB array null holes as players',async()=>{
  const h=harness();h.state.players.p1.isBot=true;h.state.players.p2.isBot=false;
  const a=h.client(0),b=h.client(2);await a.api.save();h.state.savedGame.humans=['p0',null,'p2'];h.notify();
  await b.api.approve();await a.api.tick();await h.settle();assert.equal(h.state.savedGame.status,'saved');
  assert.equal(a.el('savedGameModal').querySelectorAll('li').length,2);assert.equal(S.isMember(h.state,null),false);
  await a.api.start();await a.api.confirmReady();await b.api.confirmReady();await a.api.tick();await h.settle();
  assert.equal(h.state.savedGame,undefined);h.close();
});
test('spectators can leave a saved game but never approve, resume or extend it',async()=>{
  const h=harness(1),a=h.client(0),viewer=h.client(9,true);await a.api.save();await a.api.tick();await h.settle();
  const buttons=[...viewer.el('savedGameModal').querySelectorAll('button')].map(b=>b.textContent);assert.deepEqual(buttons,['Keluar Tonton']);
  const before=h.writes.length;await viewer.api.tick();await viewer.api.exit();assert.equal(h.writes.length,before);assert.ok(viewer.events.includes('exit-spectator'));h.close();
});
test('player names render as inert text and failed save shows an actionable error',async()=>{
  const h=harness(),a=h.client(0);h.state.players.p1.nickname='<img src=x onerror=alert(1)>';h.notify();await a.api.save();await h.settle();
  assert.equal(a.el('savedGameModal').querySelector('img'),null);assert.match(a.el('savedGameModal').textContent,/<img src=x/);
  await a.api.cancel();h.fail(true);await a.api.save();assert.equal(h.state.savedGame,undefined);
  assert.ok(a.events.some(e=>e.includes('Jaringan terputus')));
  assert.equal(a.el('savedGameModal').hidden,true);h.close();
});
test('cleaner leaves saved game alone until seven days, irrespective of bot activity',async()=>{
  const r=fixture(1);r.savedGame={...S.request(r,'p0',ID,NOW),status:'saved'};r.emptySince=NOW-90000;
  let cb,clock=NOW+31000;const writes=[],fb={authUid:'viewer',db:{},ref:(_,p)=>p,onValue:(_,fn)=>{cb=fn;return()=>{};},remove:async p=>writes.push(p)};
  const cleaner=L.create(fb,{now:()=>clock});cleaner.start();cb({val:()=>({ABCD:r})});await cleaner.scan();await new Promise(setImmediate);assert.deepEqual(writes,[]);
  clock=NOW+S.WEEK_MS;await cleaner.scan();assert.deepEqual(writes,['rooms/ABCD']);cleaner.stop();
});
