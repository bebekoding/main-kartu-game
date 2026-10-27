const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom'),{scripts}=require('../scripts/check-render-safety.cjs');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'truf-multiplayer-v3.html'),'utf8');
const parsed=scripts(html);
function source(name){for(const {code,ast}of parsed){const n=ast.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);if(n)return code.slice(n.start,n.end);}throw Error(name);}
function setup(origin='lobby'){
  const dom=new JSDOM(html,{url:'http://localhost/remi/ABCD',runScripts:'outside-only'}),w=dom.window,events=[];
  for(const file of ['vendor/dompurify/purify.min.js','game-display.js'])w.eval(fs.readFileSync(path.join(root,file),'utf8'));
  Object.assign(w,{isSpectator:true,_spectatorOrigin:origin,_rankedClient:null,_lastRoom:null,_remiStandingsOpen:true,_remiLbOpen:true,
    currentRoom:'ABCD',currentGameType:'remi',mySeat:0,lastPhase:'playing',chatLastCount:0,
    roomUnsubscribe:()=>events.push('unsubscribe'),hasAdminAccess:()=>origin==='admin',
    stopHeartbeat:()=>events.push('stop-heartbeat'),stopCountdownTicker:()=>events.push('stop-ticker'),
    clearGameHistoryGuard:()=>events.push('clear-history'),closeSpectateRoomsModal:()=>{},closeHostControl:()=>{},
    TurnReminder:{reset:()=>{}},RemiTurnTimer:{reset:()=>{}},Voice:{leave:()=>events.push('leave-voice')},
    Sound:{playBgm:()=>{},stopWin:()=>{}},setLayoutFloatingVisible:()=>{},
    showAdminView:()=>{events.push('admin');w.document.getElementById('adminView').classList.remove('hidden');},
    routerClearRoomUrl:()=>events.push('clear-url'),setSafeHTML:(el,markup)=>w.GameDisplay.setHTML(el,markup),
    escapeHtml:value=>w.GameDisplay.escapeHTML(value),isBotControlled:p=>p.isBot||p.disconnected});
  for(const name of ['hideRemiOverlay','renderRemiPause','handleExitSpectator'])w.eval(source(name));
  const gv=w.document.getElementById('remiGameView');gv.classList.add('show','spectator-mode');
  w.document.getElementById('spectatorExitBtn').hidden=false;
  // Execute the same trusted event binding that attachListeners installs.
  const binding=source('attachListeners').match(/const spectatorExitBtn[^]*?spectatorExitBtn.onclick = handleExitSpectator;/)[0];w.eval(binding);
  return{dom,w,events,el:id=>w.document.getElementById(id)};
}
test('paused spectator has an exit even while the player-ready action is hidden',()=>{
  const h=setup();h.w.renderRemiPause({phase:'playing',players:{p:{uid:'p',seat:0,nickname:'mifty',isBot:false}},remi:{pause:{by:0,byName:'mifty'}}});
  assert.ok(h.el('remiPauseModal').classList.contains('show'));assert.equal(h.el('remiPauseReadyBtn').style.display,'none');
  assert.equal(h.el('spectatorExitBtn').hidden,false);assert.equal(h.el('spectatorExitBtn').parentElement,h.w.document.body);
  h.el('spectatorExitBtn').click();assert.equal(h.w.isSpectator,false);assert.equal(h.w.currentRoom,null);
  assert.ok(!h.el('remiPauseModal').classList.contains('show'));assert.ok(!h.el('lobbyView').classList.contains('hidden'));h.dom.window.close();
});
test('exit clears all modal hit targets, paused board and subscriptions without writing membership',()=>{
  const h=setup();for(const id of ['remiPauseModal','remiStandingsModal','remiEndModal','remiTournamentEndModal','scoreEditModal']){
    h.el(id).classList.add('show');h.el(id).style.pointerEvents='auto';h.el(id).style.zIndex='9999';
  }
  h.w.handleExitSpectator();assert.equal(h.el('spectatorExitBtn').hidden,true);assert.ok(h.el('remiGameView').classList.contains('hidden'));
  for(const id of ['remiPauseModal','remiStandingsModal','remiEndModal','remiTournamentEndModal','scoreEditModal']){
    assert.ok(!h.el(id).classList.contains('show'));assert.notEqual(h.el(id).style.pointerEvents,'auto');
  }
  assert.ok(h.events.includes('unsubscribe'));assert.ok(h.events.includes('stop-heartbeat'));assert.ok(h.events.includes('clear-url'));
  assert.equal(h.w._remiStandingsOpen,false);h.dom.window.close();
});
test('admin spectator returns to admin and ordinary spectator returns to lobby',()=>{
  for(const origin of ['admin','lobby']){
    const h=setup(origin);h.el('spectatorExitBtn').click();assert.equal(h.events.includes('admin'),origin==='admin');
    assert.equal(h.el(origin==='admin'?'adminView':'lobbyView').classList.contains('hidden'),false);h.dom.window.close();
  }
});
test('pause can render again after exit without stale invisible overlay or hidden ready action',()=>{
  const h=setup();h.w.handleExitSpectator();h.w.isSpectator=false;
  h.w.renderRemiPause({phase:'playing',players:{p:{seat:0,nickname:'p',isBot:false}},remi:{pause:{by:0}}});
  assert.ok(h.el('remiPauseModal').classList.contains('show'));assert.notEqual(h.el('remiPauseModal').style.display,'none');assert.notEqual(h.el('remiPauseReadyBtn').style.display,'none');h.dom.window.close();
});
