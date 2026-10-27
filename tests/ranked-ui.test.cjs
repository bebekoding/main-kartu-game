const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.join(__dirname,'..'),ID='a'.repeat(32);
function setup(){
  const dom=new JSDOM(fs.readFileSync(path.join(root,'truf-multiplayer-v3.html'),'utf8'),{url:'http://localhost/',runScripts:'outside-only'}),w=dom.window;
  for(const file of ['vendor/dompurify/purify.min.js','game-display.js','ranked-leaderboard.js','ranked-ui.js'])w.eval(fs.readFileSync(path.join(root,file),'utf8'));
  let uid='p0',spectator=false;
  const roster={},memberSeats={},entries={};
  for(let s=0;s<4;s++){roster[s]={uid:'p'+s,key:'p'+s,username:'p'+s,name:'Player '+s};memberSeats['p'+s]=s;entries[s]={total:100-s,points:4-s};}
  const record={contract:3,roomCode:'ZZ0I',game:'remi',size:4,createdAt:Date.now()-600000,roster,memberSeats,result:{finishedAt:Date.now(),rounds:10,entries},votes:{p1:true,p2:true,p3:true}};
  const snapshot={records:new Map([[ID,record]]),pending:new Set([ID]),room:{game:'remi',phase:'remi_tournament_end',rankedMatchId:ID,code:'ZZ0I',players:Object.fromEntries(Object.values(roster).map(p=>[p.uid,{...p,seat:memberSeats[p.uid],isBot:false}])),totals:{0:100,1:99,2:98,3:97},remi:{roundNumber:10,endReason:'closed',handPenalty:{0:0,1:0,2:0,3:0}}}};
  const calls=[],client={vote:async(id,value)=>{calls.push({id,value});record.votes[uid]=value;ui.render(snapshot);},retry:async id=>calls.push({retry:id})};
  const ui=w.RankedUI.create({client:()=>client,uid:()=>uid,spectator:()=>spectator});ui.render(snapshot);
  const el=id=>w.document.getElementById(id);
  return{dom,w,ui,snapshot,record,calls,client,el,setUid:value=>uid=value,setSpectator:value=>spectator=value};
}
test('showing a result never signs a vote and displays the frozen totals for every original player',()=>{
  const h=setup();h.ui.open(ID);assert.deepEqual(h.calls,[]);
  assert.equal(h.el('rankedResultsModal').hidden,false);assert.equal(h.el('rankedResultBody').querySelectorAll('tbody tr').length,4);
  assert.ok(h.el('rankedResultStatus').textContent.includes('3/4'));
  assert.equal(h.el('rankedApproveBtn').classList.contains('hidden'),false);h.dom.window.close();
});
test('approval and rejection are explicit user actions, never inferred from host or phase',async()=>{
  for(const [button,value]of [['rankedApproveBtn',true],['rankedRejectBtn',false]]){
    const h=setup();h.ui.open(ID);await h.el(button).onclick();assert.deepEqual(h.calls,[{id:ID,value}]);
    assert.equal(h.el('rankedApproveBtn').classList.contains('hidden'),true);h.dom.window.close();
  }
});
test('a spectator or a different Auth UID cannot approve the displayed participant result',()=>{
  const h=setup();h.setSpectator(true);h.ui.render(h.snapshot);h.ui.open(ID);
  assert.equal(h.el('rankedApproveBtn').classList.contains('hidden'),true);assert.equal(h.el('rankedRejectBtn').classList.contains('hidden'),true);
  h.setSpectator(false);h.setUid('outsider');h.ui.render(h.snapshot);
  assert.equal(h.el('rankedApproveBtn').classList.contains('hidden'),true);assert.deepEqual(h.calls,[]);h.dom.window.close();
});
test('rejected or already recorded results cannot be approved again',()=>{
  for(const state of ['rejected','recorded']){
    const h=setup();if(state==='rejected')h.record.votes.p1=false;else h.record.recorded=true;
    h.ui.render(h.snapshot);h.ui.open(ID);assert.equal(h.el('rankedApproveBtn').classList.contains('hidden'),true);
    assert.ok(h.el('rankedResultStatus').textContent.includes(state==='recorded'?'sudah masuk':'ditolak'));h.dom.window.close();
  }
});
test('hostile names and result context stay text without executable markup',()=>{
  const h=setup(),payload='<img src=x onerror="window.__rankInjected=1">';h.record.roster[1].name=payload;
  h.ui.render(h.snapshot);h.ui.open(ID);assert.ok(h.el('rankedResultBody').textContent.includes(payload));
  assert.equal(h.el('rankedResultBody').querySelector('img,script,svg'),null);assert.equal(h.w.__rankInjected,undefined);h.dom.window.close();
});
test('pending result links survive a later match or return to lobby',()=>{
  const h=setup();h.snapshot.room=null;h.ui.render(h.snapshot);
  const buttons=[...h.w.document.querySelectorAll('[data-ranked-pending]')];assert.equal(buttons.length,3);
  assert.ok(buttons.every(button=>!button.classList.contains('hidden')&&button.textContent.includes('1')));
  buttons[0].onclick();assert.equal(h.el('rankedResultsModal').hidden,false);h.dom.window.close();
});
test('failed award remains retryable and is never displayed as recorded',async()=>{
  const h=setup();h.record.votes.p0=true;h.ui.render(h.snapshot);h.ui.open(ID);
  h.ui.fail({code:'SIMULATED_NETWORK_ERROR'},ID);assert.equal(h.el('rankedRetryBtn').classList.contains('hidden'),false);
  assert.ok(!h.el('rankedResultStatus').textContent.includes('sudah masuk'));await h.el('rankedRetryBtn').onclick();
  assert.deepEqual(h.calls,[{retry:ID}]);h.dom.window.close();
});
test('modal closes cleanly with Escape and does not add duplicate end-result panels',()=>{
  const h=setup();h.ui.render(h.snapshot);h.ui.render(h.snapshot);
  assert.equal(h.w.document.querySelectorAll('#remiTournamentEndModal .ranked-result-note').length,1);
  h.ui.open(ID);h.w.document.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'Escape'}));
  assert.equal(h.el('rankedResultsModal').hidden,true);assert.equal(h.el('rankedResultsModal').getAttribute('aria-hidden'),'true');h.dom.window.close();
});
