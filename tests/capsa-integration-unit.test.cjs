const test=require('node:test'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const R=require('../local-runtime.js'),E=require('../capsa-engine.js'),UI=require('../capsa-ui.js'),G=require('../scripts/capsa-local-server.cjs'),{build}=require('../scripts/build-local-rules.cjs');
const fs=require('node:fs');
const players=Array.from({length:4},(_,i)=>({uid:'u'+i,isBot:false,nickname:'Player'+i,seat:i}));
function data(){const state=E.createSession(players,E.deck(),0);const room={game:'capsa',code:'ABCD',phase:'capsa_round_ready',host:'u0',players:Object.fromEntries(players.map(p=>[p.uid,{...p}])),seats:['u0','u1','u2','u3']};return {room,root:{rooms:{ABCD:room},capsaPrivate:{ABCD:{matchId:'match',snapshot:JSON.stringify(state)}}}};}
const delay=()=>new Promise(r=>setTimeout(r,0));
test('loopback config always targets demo emulators; external hosts retain supplied production config',()=>{
 for(const hostname of ['127.0.0.1','localhost','[::1]']){const cfg=R.config({hostname},{projectId:'production'});assert.equal(cfg.local,true);assert.equal(cfg.firebase.projectId,G.PROJECT);assert.equal(cfg.authPort,19099);}
 for(const hostname of ['main-kartu-game.web.app','localhost.example.com','127.0.0.1.example.com']){const prod={projectId:'production'};assert.equal(R.config({hostname},prod).local,false);assert.equal(R.config({hostname},prod).firebase,prod);}
});
test('local rules overlay preserves source and denies private state; Capsa terminal save guard present',()=>{
 const original=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'../database.rules.json'))),before=JSON.stringify(original),rules=build(original);
 assert.equal(JSON.stringify(original),before);assert.deepEqual(rules.rules.capsaPrivate,{'.read':false,'.write':false});assert.match(JSON.stringify(rules.rules.rooms.$roomCode.savedGame),/capsa_session_end/);
});
test('private projection excludes state, receipts and other hands even when room contains hostile names',()=>{
 const {root}=data();root.rooms.ABCD.players.u0.nickname='<img src=x onerror=alert(1)>';
 const v=G.projection(root,'ABCD','u0');assert.equal(v.hand.length,13);assert.equal(v.hands,undefined);assert.equal(v.snapshot,undefined);assert.equal(v.receipts,undefined);assert.throws(()=>G.projection(root,'ABCD','intruder'),/pemain/);
});
test('server bot selects a valid 3D opening and never plays a card outside own hand',()=>{
 const s=E.createSession(players,E.deck(),0);s.phase='playing';s.ready=[true,true,true,true];s.deadline=30000;
 const a=G.botMove(s);assert.equal(a.type,'play');assert.ok(a.cards.some(c=>E.cardKey(c)==='3D'));assert.doesNotThrow(()=>E.applyAction(s,{...a,id:'bot',uid:s.players[s.turn].uid,expectedRevision:0},0));
});
function harness(fetch,voice,actions={}){
 const dom=new JSDOM('<body></body>'),{room}=data();let uid='u0';
 const ui=UI.create({document:dom.window.document,uid:()=>uid,local:()=>true,token:async()=>'',fetch,voice,key:E.cardKey,compare:E.compare,standings:E.standings,
  card:(c,interactive)=>{const n=dom.window.document.createElement(interactive?'button':'div');n.textContent=c.rank+c.suit;return n;},enter(){},save(){},exit(){},start(){},...actions});
 return {dom,room,ui,setUid:v=>{uid=v;}};
}
test('stale private response after exit never redraws hand or restarts view',async()=>{
 let resolve;const h=harness(()=>new Promise(r=>{resolve=r;}));h.ui.observe(h.room);assert.equal(h.ui.element.querySelector('.capsa-actions button').hidden,true);assert.equal(h.ui.element.querySelector('.capsa-actions button').disabled,true);await delay();h.ui.stop();
 resolve({ok:true,json:async()=>G.projection(data().root,'ABCD','u0')});await delay();
 assert.equal(h.dom.window.document.querySelectorAll('.capsa-hand button').length,0);assert.ok(h.ui.element.classList.contains('hidden'));h.ui.stop();h.dom.window.close();
});
test('UI renders names as text, resets private cards on account switch and can leave while frozen',async()=>{
 const fixture=data();fixture.root.rooms.ABCD.players.u0.nickname='<script>bad()</script>';
 const h=harness(async()=>({ok:true,json:async()=>G.projection(fixture.root,'ABCD','u0')}));
 try{h.ui.observe(h.room);await delay();await delay();assert.equal(h.dom.window.document.querySelectorAll('.capsa-hand button').length,13);assert.equal(h.ui.element.querySelectorAll('script').length,0);
  fixture.room.savedGame={status:'saved'};h.ui.observe(fixture.room);
  assert.equal(h.ui.element.querySelector('.capsa-tools button:last-child').disabled,false);
  h.setUid('u1');await h.ui.poll(); // account change clears private DOM immediately
  assert.equal(h.ui.element.querySelectorAll('.capsa-hand button').length,0);
 }finally{h.ui.stop();h.dom.window.close();}
});

test('one Ready click survives a concurrent Ready vote without replaying a card action',async()=>{
 const fixture=data(),s=JSON.parse(fixture.root.capsaPrivate.ABCD.snapshot);
 let server=E.applyAction(s,{id:'other_ready',uid:'u1',type:'ready',expectedRevision:0},0),posts=0;
 const update=()=>{fixture.root.capsaPrivate.ABCD.snapshot=JSON.stringify(server);return G.projection(fixture.root,'ABCD','u0');};
 let first=true;
 const h=harness(async(_url,options)=>{
  if(options.method==='POST'){
   posts++;const a=JSON.parse(options.body);
   if(a.expectedRevision!==server.revision)return {ok:false,status:409,json:async()=>({error:'Revisi aksi sudah kedaluwarsa.'})};
   server=E.applyAction(server,{id:a.id,uid:'u0',type:a.type,expectedRevision:a.expectedRevision},0);
   return {ok:true,json:async()=>update()};
  }
  const value=first?(first=false,G.projection(data().root,'ABCD','u0')):update();return {ok:true,json:async()=>value};
 });
 try{h.ui.observe(h.room);await delay();await delay();await h.ui.send('ready');assert.equal(posts,2);assert.deepEqual(server.ready,[true,true,false,false]);assert.equal(server.revision,2);}
 finally{h.ui.stop();h.dom.window.close();}
});


test('local login distinguishes offline service from missing or invalid local credentials',()=>{
 assert.match(R.authError({code:'auth/network-request-failed'}),/tidak bisa dihubungi/);
 assert.match(R.authError({code:'auth/invalid-credential'}),/Pilih Daftar/);
 assert.match(R.authError({code:'auth/user-not-found'}),/Akun game online tidak berlaku/);
});

test('active table clears after passes while Historis retains all plays through freeze and next opening',async()=>{
 const fixture=data();let s=JSON.parse(fixture.root.capsaPrivate.ABCD.snapshot);
 for(let i=0;i<4;i++)s=E.applyAction(s,{id:'hist_ready'+i,uid:'u'+i,type:'ready',expectedRevision:s.revision},0);
 for(let i=0;i<2;i++)s=E.applyAction(s,{id:'hist_play'+i,uid:'u'+i,type:'play',cards:[{rank:'3',suit:i?'C':'D'}],expectedRevision:s.revision},0);
 let v;const update=()=>{fixture.root.capsaPrivate.ABCD.snapshot=JSON.stringify(s);v=G.projection(fixture.root,'ABCD','u0');};update();
 assert.deepEqual(v.roundPlays,s.roundPlays);assert.equal(v.hands,undefined);
 const h=harness(async()=>({ok:true,json:async()=>v}));h.room.players.u1.nickname='<img src=x onerror=bad()>';
 try{
  h.ui.observe(h.room);await delay();await delay();
  const list=h.ui.element.querySelector('.capsa-history-list');
  assert.equal(list.firstChild.dataset.trick,'1');assert.equal(list.firstChild.open,true);assert.match(list.textContent,/<img/);assert.equal(list.querySelectorAll('img').length,0);
  assert.equal(list.querySelectorAll('.capsa-history-card').length,2);assert.equal(list.querySelector('[aria-label="3 keriting"]').textContent,'3♣');
  assert.equal(list.querySelectorAll('.capsa-history-card.is-latest').length,1);
  for(let i=0;i<3;i++)s=E.applyAction(s,{id:'hist_pass'+i,uid:s.players[s.turn].uid,type:'pass',expectedRevision:s.revision},0);update();await h.ui.poll();
  assert.equal(v.table,null);assert.equal(list.children.length,1);assert.equal(h.ui.element.querySelectorAll('.capsa-table-cards .capsa-laid-card').length,0);
  assert.equal(list.querySelectorAll('.capsa-history-card').length,2);
  s=E.applyAction(s,{id:'new_table',uid:s.players[s.turn].uid,type:'play',cards:[{rank:'4',suit:'C'}],expectedRevision:s.revision},0);update();await h.ui.poll();
  assert.equal(h.ui.element.querySelectorAll('.capsa-table-cards .capsa-laid-card').length,1);
  assert.equal(h.ui.element.querySelectorAll('.capsa-pass').length,0);
  assert.equal(list.querySelectorAll('.capsa-history-card').length,3);
  assert.deepEqual([...list.children].map(section=>section.dataset.trick),['2','1']);
  assert.equal(list.firstChild.querySelector('.capsa-history-card').textContent,'4♣');
  assert.match(h.ui.element.querySelector('.capsa-table-label').textContent,/1 kartu di meja/);
  h.room.savedGame={status:'saved'};h.ui.observe(h.room);await delay();await delay();assert.equal(list.children.length,2);
  v={...v,round:2,roundPlays:[],table:null};await h.ui.poll();assert.match(list.textContent,/Belum ada kartu keluar/);assert.equal(list.querySelectorAll('.capsa-history-card').length,0);assert.equal(list.hidden,false);
  h.ui.stop();assert.equal(list.children.length,0);
 }finally{h.ui.stop();h.dom.window.close();}
});
test('played five-card combos are ordered on the table and in Historis, including older snapshots',async()=>{
 const cases=[
  ['straight','2C 5H 6D 3D 4H','2C 3D 4H 5H 6D'],
  ['flush','6C 10C AC QC 5C','5C 6C 10C QC AC'],
  ['full_house','8C JS 8D JD JH','JD JH JS 8D 8C'],
  ['bomb','2D 7S 7C 7D 7H','7D 7C 7H 7S 2D'],
  ['straight_flush','5S 3S AS 4S 2S','AS 2S 3S 4S 5S'],
 ];
 const asCards=keys=>keys.split(' ').map(key=>({rank:key.slice(0,-1),suit:key.at(-1)}));
 const roundPlays=cases.map(([type,input],i)=>({seat:i%4,uid:'u'+i%4,type,cards:asCards(input)}));
 let v={...G.projection(data().root,'ABCD','u0'),phase:'playing',reversed:true,tableStart:0,table:roundPlays.at(-1),roundPlays};
 const h=harness(async()=>({ok:true,json:async()=>v})),labels=keys=>asCards(keys).map(c=>c.rank+{D:'♦',C:'♣',H:'♥',S:'♠'}[c.suit]);
 const rendered=selector=>Array.from(h.ui.element.querySelectorAll(selector),card=>card.textContent);
 try{
  h.ui.observe(h.room);await delay();await delay();
  for(const [i,[,input,expected]] of cases.entries()){
   assert.deepEqual(rendered(`.capsa-play-group[data-play="${i+1}"] .capsa-laid-card`),labels(expected));
   assert.deepEqual(rendered(`.capsa-history-card[data-play="${i+1}"]`),labels(expected));
   assert.equal(roundPlays[i].cards.map(E.cardKey).join(' '),input);
  }
  v={...v,table:{seat:2,cards:roundPlays[2].cards},tableStart:null,roundPlays:[]};await h.ui.poll();
  assert.deepEqual(rendered('.capsa-laid-card'),labels(cases[2][2]));
  assert.match(h.ui.element.querySelector('.capsa-play-group').title,/Full house/);
 }finally{h.ui.stop();h.dom.window.close();}
});
test('older host snapshots display an honest partial-history message without blocking gameplay',async()=>{
 const v=G.projection(data().root,'ABCD','u0');delete v.roundPlays;v.roundPlaysIncomplete=true;
 const h=harness(async()=>({ok:true,json:async()=>v}));
 try{h.ui.observe(h.room);await delay();await delay();assert.match(h.ui.element.querySelector('.capsa-history-note').textContent,/sebelum pembaruan belum tersedia/);assert.equal(h.ui.element.querySelectorAll('.capsa-hand button').length,13);}
 finally{h.ui.stop();h.dom.window.close();}
});

test('history preserves all 52 exposed cards from older rooms with unknown round numbers',async()=>{
 const v=G.projection(data().root,'ABCD','u0');v.roundPlays=E.deck().map((c,i)=>({seat:i%4,uid:'u'+i%4,type:'single',cards:[c]}));v.counts=[0,0,0,0];
 const h=harness(async()=>({ok:true,json:async()=>v}));h.room.players.u1.nickname='NamaPanjang12345';
 try{h.ui.observe(h.room);await delay();await delay();const list=h.ui.element.querySelector('.capsa-history-list');assert.equal(list.children.length,1);
  assert.match(list.firstChild.querySelector('summary').textContent,/Ronde tidak tercatat/);
  assert.equal(list.querySelectorAll('.capsa-history-card').length,52);
  assert.equal(h.ui.element.querySelector('.capsa-history-count').textContent,'52 / 52 kartu');assert.equal(list.hasAttribute('tabindex'),false);
 }finally{h.ui.stop();h.dom.window.close();}
});
test('winner text and seven-second countdown precede next-round readiness and final session controls',async()=>{
 let v={...G.projection(data().root,'ABCD','u0'),scoringVersion:E.LEGACY_SCORING_VERSION,phase:'round_end',winner:1,counts:[13,0,13,13],roundEndUntil:Date.now()+7000,serverNow:Date.now()};
 const h=harness(async()=>({ok:true,json:async()=>v}));
 try{h.ui.observe(h.room);await delay();await delay();assert.equal(h.ui.element.querySelector('.capsa-win-title').textContent,'Babak 1 berakhir · Player1 memenangkan babak');assert.match(h.ui.element.querySelector('.capsa-win-timer').textContent,/7 detik/);assert.equal(h.ui.element.querySelector('.capsa-round-win').hidden,false);
  assert.equal([...h.ui.element.querySelectorAll('.capsa-actions button')].find(b=>b.textContent==='Lanjut babak berikutnya').disabled,true);
  v={...v,phase:'session_end'};await h.ui.poll();assert.equal([...h.ui.element.querySelectorAll('.capsa-actions button')].find(b=>b.textContent==='Main lagi').hidden,true);
  v={...v,roundEndUntil:Date.now()-1,serverNow:Date.now()};await h.ui.poll();assert.equal(h.ui.element.querySelector('.capsa-round-win').hidden,true);assert.equal([...h.ui.element.querySelectorAll('.capsa-actions button')].find(b=>b.textContent==='Main lagi').hidden,false);
 }finally{h.ui.stop();h.dom.window.close();}
});

test('Historis is closed by default, opens manually with current timer, closes with Escape and resets next round',async()=>{
 let v={...G.projection(data().root,'ABCD','u0'),scoringVersion:E.LEGACY_SCORING_VERSION,phase:'playing',turn:0,turnMs:30000,deadline:Date.now()+30000,serverNow:Date.now()};
 const h=harness(async()=>({ok:true,json:async()=>v}));
 try{h.ui.observe(h.room);await delay();await delay();const dialog=h.ui.element.querySelector('#capsaHistoryDialog'),button=h.ui.element.querySelector('.capsa-history-button');
  assert.equal(dialog.open,false);assert.equal(button.textContent,'Historis');assert.equal(button.getAttribute('aria-expanded'),'false');assert.equal(h.ui.element.querySelectorAll('.capsa-board .capsa-seat').length,4);
  button.click();assert.equal(dialog.open,true);assert.equal(button.getAttribute('aria-expanded'),'true');assert.match(dialog.querySelector('.capsa-history-clock').textContent,/30 detik.*Timer tetap berjalan/);
  dialog.dispatchEvent(new h.dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(dialog.open,false);assert.equal(h.dom.window.document.activeElement,button);
  v={...v,phase:'round_end',winner:1,counts:[13,0,13,13],roundEndUntil:Date.now()+7000};await h.ui.poll();h.ui.element.querySelector('#capsaScoreDialog > button:last-child').click();button.click();await h.ui.poll();assert.equal(dialog.open,true,'Manual history remains available during winner pause');
  button.click();v={...v,round:2};await h.ui.poll();assert.equal(dialog.open,false);button.click();h.ui.stop();assert.equal(dialog.open,false);
 }finally{h.ui.stop();h.dom.window.close();}
});

test('Remi layout rotates north/west/east/south relative to each player and keeps own hand south',async()=>{
 let v=G.projection(data().root,'ABCD','u0');const h=harness(async()=>({ok:true,json:async()=>v}));
 try{h.ui.observe(h.room);await delay();await delay();
  for(let seat=0;seat<4;seat++){v={...v,seat};await h.ui.poll();for(const [position,offset] of [['north',2],['west',1],['east',3],['south',0]]){const n=h.ui.element.querySelector(`.capsa-seat[data-position="${position}"]`);assert.ok(n);assert.equal(Number(n.dataset.seat),(seat+offset)%4);}
   assert.equal(h.ui.element.querySelector('.capsa-south .capsa-hand')!==null,true);assert.equal(h.ui.element.querySelector('.capsa-south .capsa-actions')!==null,true);
  }
 }finally{h.ui.stop();h.dom.window.close();}
});
test('round end retains all exposed cards until next deal',async()=>{
 let v={...G.projection(data().root,'ABCD','u0'),scoringVersion:E.LEGACY_SCORING_VERSION,phase:'round_end',winner:0,counts:[0,13,13,13],roundEndUntil:Date.now()+7000,serverNow:Date.now()};
 v.roundPlays=E.deck().filter(c=>c.rank!=='2'||c.suit==='D').map(c=>({seat:['D','C','H','S'].indexOf(c.suit),uid:'u'+['D','C','H','S'].indexOf(c.suit),type:'single',cards:[c]}));v.table=v.roundPlays.at(-1);v.tableStart=46;
 const h=harness(async()=>({ok:true,json:async()=>v}));
 try{h.ui.observe(h.room);await delay();await delay();const center=h.ui.element.querySelector('.capsa-table-cards');assert.equal(center.hidden,false);assert.equal(center.querySelectorAll('.capsa-laid-card').length,49);assert.equal(center.querySelectorAll('.capsa-play-group').length,49);assert.equal(center.querySelectorAll('.is-latest').length,1);assert.equal(h.ui.element.querySelector('#capsaHistoryDialog').open,false);
  for(const entry of v.roundPlays.slice(v.tableStart))assert.ok(center.querySelector(`[aria-label="${entry.cards[0].rank} ${{D:'wajik',C:'keriting',H:'hati',S:'sekop'}[entry.cards[0].suit]}"]`));
  assert.equal(h.ui.element.querySelectorAll('.capsa-history-card').length,49);
  delete v.tableStart;await h.ui.poll();assert.equal(center.querySelectorAll('.capsa-laid-card').length,49,'Ended snapshots retain the complete round history');
  v={...v,table:null};await h.ui.poll();assert.equal(center.querySelectorAll('.capsa-laid-card').length,49);
  assert.equal(h.ui.element.querySelectorAll('.capsa-history-card').length,49);
  v={...v,round:2,phase:'round_ready',winner:null,roundEndUntil:null,roundPlays:[]};await h.ui.poll();assert.equal(center.querySelectorAll('.capsa-laid-card').length,0);
  h.ui.stop();assert.equal(center.children.length,0);
 }finally{h.ui.stop();h.dom.window.close();}
});

test('four stations place played cards below profile icons and show PASS only for actual pass votes',async()=>{
 let v={...G.projection(data().root,'ABCD','u0'),phase:'playing',turn:2,passed:[1],tableStart:0,roundPlays:[{seat:0,uid:'u0',type:'single',cards:[{rank:'3',suit:'D'}]}],table:{seat:0,cards:[{rank:'3',suit:'D'}]}};
 const h=harness(async()=>({ok:true,json:async()=>v}));
 try{h.ui.observe(h.room);await delay();await delay();
  const stations=h.ui.element.querySelectorAll('.capsa-seat');assert.equal(stations.length,4);
  for(const station of stations){assert.equal(station.querySelectorAll('.player-avatar').length,1);assert.ok(station.querySelector('.capsa-seat-plays'));}
  const mine=h.ui.element.querySelector('.capsa-seat[data-seat="0"]');assert.equal(mine.querySelectorAll('.capsa-seat-plays .capsa-laid-card').length,1);
  assert.equal(h.ui.element.querySelector('.capsa-seat[data-seat="1"] .capsa-pass').textContent,'PASS');assert.equal(h.ui.element.querySelector('.capsa-seat[data-seat="2"] .capsa-pass'),null);
  v={...v,passed:[],table:null,tableStart:1};await h.ui.poll();assert.equal(h.ui.element.querySelectorAll('.capsa-pass').length,0);assert.equal(h.ui.element.querySelectorAll('.capsa-laid-card').length,0);
 }finally{h.ui.stop();h.dom.window.close();}
});

test('score dialog opens manually during play and once at round end, with safe winner text and descending negative totals',async()=>{
 let v={...G.projection(data().root,'ABCD','u0'),scoringVersion:E.LEGACY_SCORING_VERSION,phase:'playing',scores:[-30,-10,-10,-50]};
 const h=harness(async()=>({ok:true,json:async()=>v}));
 try{h.ui.observe(h.room);await delay();await delay();const dialog=h.ui.element.querySelector('#capsaScoreDialog'),button=h.ui.element.querySelector('.capsa-score-button');
  assert.equal(dialog.open,false);assert.match(h.ui.element.querySelector('.capsa-meta').textContent,/Mode : normal/);button.click();assert.equal(dialog.open,true);
  assert.deepEqual([...dialog.querySelectorAll('tbody tr')].map(r=>r.lastChild.textContent),['-10','-10','-30','-50']);
  dialog.querySelector(':scope > button:last-child').click();assert.equal(dialog.open,false);
  v={...v,phase:'round_end',winner:1,counts:[13,0,13,13],roundEndUntil:Date.now()+7000,history:[{round:1,winner:1,penalties:[-30,0,-10,-50]}],reversed:true};await h.ui.poll();
  assert.equal(dialog.open,true);assert.equal(dialog.querySelector('h2').textContent,'Babak 1 berakhir');assert.equal(dialog.querySelector('.modal-subtitle').textContent,'Player1 memenangkan babak');assert.match(h.ui.element.querySelector('.capsa-meta').textContent,/Mode : Reverse/);
  dialog.querySelector(':scope > button:last-child').click();await h.ui.poll();assert.equal(dialog.open,false,'Closed result must not reopen every poll');
  button.click();h.ui.stop();assert.equal(dialog.open,false);
 }finally{h.ui.stop();h.dom.window.close();}
});

test('result dialog waits for non-host Ready and only enables the host continuation after all votes',async()=>{
 let v={...G.projection(data().root,'ABCD','u0'),scoringVersion:E.LEGACY_SCORING_VERSION,phase:'round_end',winner:1,counts:[13,0,13,13],roundEndUntil:Date.now()-100,continueReady:[false,false,false,false]};
 const h=harness(async()=>({ok:true,json:async()=>v}));
 try{h.ui.observe(h.room);await delay();await delay();const dialog=h.ui.element.querySelector('#capsaScoreDialog'),next=dialog.querySelector('.capsa-next-round'),confirm=dialog.querySelector('.capsa-confirm-round');
  assert.equal(dialog.open,true);assert.equal(confirm.hidden,true);assert.equal(next.hidden,false);assert.equal(next.disabled,true);
  v={...v,continueReady:[false,true,true,true]};await h.ui.poll();assert.equal(next.disabled,false);assert.match(dialog.querySelector('.capsa-score-ready').textContent,/Siap/);
  assert.equal(confirm.hidden,true);
  h.room.savedGame={status:'saved'};h.ui.observe(h.room);assert.equal(next.disabled,true);
  await delay();await delay();h.room.savedGame=null;v={...v,round:2,phase:'round_ready',winner:null,roundEndUntil:null,continueReady:[]};await h.ui.poll();assert.equal(dialog.open,false);
 }finally{h.ui.stop();h.dom.window.close();}
});

test('non-host confirms a result through its own Ready control and cannot click host continuation',async()=>{
 let v={...G.projection(data().root,'ABCD','u0'),scoringVersion:E.LEGACY_SCORING_VERSION,phase:'round_end',winner:1,counts:[13,0,13,13],roundEndUntil:Date.now()-100,continueReady:[false,false,false,false]},posts=[];
 const h=harness(async(_url,options)=>{if(options.method==='POST'){const packet=JSON.parse(options.body);posts.push(packet.type);v={...v,revision:v.revision+1,continueReady:[true,false,false,false]};}return {ok:true,json:async()=>v};});h.room.host='u1';
 try{h.ui.observe(h.room);await delay();await delay();const dialog=h.ui.element.querySelector('#capsaScoreDialog'),confirm=dialog.querySelector('.capsa-confirm-round');
  assert.equal(confirm.hidden,false);assert.equal(confirm.disabled,false);assert.equal(dialog.querySelector('.capsa-next-round').hidden,true);
  confirm.click();await delay();await delay();assert.deepEqual(posts,['confirm_round']);assert.equal(confirm.disabled,true);assert.equal(confirm.textContent,'Sudah Ready');
  dialog.querySelector(':scope > button:last-child').click();await h.ui.poll();assert.equal(dialog.open,false,'Closing scores must not send another vote or deal');assert.deepEqual(posts,['confirm_round']);
 }finally{h.ui.stop();h.dom.window.close();}
});

test('a table ronde victory clears PASS without opening the babak result popup',async()=>{
 let v={...G.projection(data().root,'ABCD','u0'),phase:'playing',turn:2,trick:1,passed:[0,1],tableStart:0,roundPlays:[{seat:2,type:'single',cards:[{rank:'5',suit:'H'}]}],table:{seat:2,cards:[{rank:'5',suit:'H'}]}};
 const h=harness(async()=>({ok:true,json:async()=>v}));
 try{h.ui.observe(h.room);await delay();await delay();assert.equal(h.ui.element.querySelectorAll('.capsa-pass').length,2);
  v={...v,trick:2,lastTrickWinner:2,passed:[],table:null,tableStart:1};await h.ui.poll();
  assert.equal(h.ui.element.querySelector('#capsaScoreDialog').open,false);assert.equal(h.ui.element.querySelectorAll('.capsa-pass').length,0);assert.equal(h.ui.element.querySelectorAll('.capsa-laid-card').length,0);
  assert.match(h.ui.element.querySelector('.capsa-meta').textContent,/Babak 1\/15 · Ronde 2/);assert.match(h.ui.element.querySelector('.capsa-table-label').textContent,/Player2 menang ronde sebelumnya/);
 }finally{h.ui.stop();h.dom.window.close();}
});
test('inconsistent public winner data with cards remaining cannot announce a finished babak',async()=>{
 const v={...G.projection(data().root,'ABCD','u0'),phase:'round_end',winner:1,counts:[13,4,13,13]};
 const h=harness(async()=>({ok:true,json:async()=>v}));
 try{h.ui.observe(h.room);await delay();await delay();assert.equal(h.ui.element.querySelector('#capsaScoreDialog').open,false);assert.equal(h.ui.element.querySelector('.capsa-round-win').hidden,true);assert.match(h.ui.element.querySelector('.capsa-status').textContent,/Menyinkronkan/);}
 finally{h.ui.stop();h.dom.window.close();}
});


test('old positive public snapshot displays negative scores while waiting for the upgraded host',async()=>{
 let v={...G.projection(data().root,'ABCD','u0'),phase:'session_end',winner:1,counts:[13,0,13,13],scores:[260,30,150,90]};delete v.scoringVersion;
 const h=harness(async()=>({ok:true,json:async()=>v}));
 try{h.ui.observe(h.room);await delay();await delay();const dialog=h.ui.element.querySelector('#capsaScoreDialog');
  assert.equal(dialog.open,false);assert.match(h.ui.element.querySelector('.capsa-status').textContent,/host memuat ulang/);
  assert.equal([...h.ui.element.querySelectorAll('.capsa-actions button')].find(b=>b.textContent==='Main lagi').hidden,true);
  h.ui.element.querySelector('.capsa-score-button').click();assert.deepEqual([...dialog.querySelectorAll('tbody tr')].map(r=>r.lastChild.textContent),['-30','-90','-150','-260']);
  v={...v,scoringVersion:2,scores:[-260,-30,-150,-90],phase:'round_end'};await h.ui.poll();assert.equal(dialog.querySelector('h2').textContent,'Babak 1 berakhir');
 }finally{h.ui.stop();h.dom.window.close();}
});


test('the final table exposes only fourth place, stays visible, and requires the host Ready',async()=>{
 const fixture=data();let s=JSON.parse(fixture.root.capsaPrivate.ABCD.snapshot);
 s.hands=[['3','D'],['4','C'],['5','H'],['6','S']].map(([rank,suit])=>[{rank,suit}]);
 const held=new Set(s.hands.flat().map(E.cardKey));s.discard=E.deck().filter(c=>!held.has(E.cardKey(c)));
 s.ready.fill(true);s.phase='playing';s.deadline=Date.now()+45000;
 const turn=(seat,type,now)=>{s=E.applyAction(s,{id:type+'_'+seat,uid:'u'+seat,type,expectedRevision:s.revision,cards:type==='play'?s.hands[seat]:undefined},now);fixture.root.capsaPrivate.ABCD.snapshot=JSON.stringify(s);};
 const now=Date.now()-8000;turn(0,'play',now);turn(1,'play',now);
 const project=()=>G.projection(fixture.root,'ABCD','u0');
 const h=harness(async()=>({ok:true,json:async()=>project()}));
 try{
  h.ui.observe(h.room);await delay();await delay();const root=h.ui.element;
  assert.equal(project().revealedHand,undefined);assert.equal(root.querySelector('.capsa-revealed-hand'),null);
  assert.equal(root.querySelector('.capsa-seat[data-seat="1"] .capsa-seat-state').textContent,'Peringkat 2');
  turn(2,'play',now);await h.ui.poll();
  const scoreDialog=root.querySelector('dialog.capsa-score-dialog');
  assert.equal(scoreDialog.open,true);
  const minimize=scoreDialog.querySelector(':scope > button:last-child');
  assert.equal(minimize.textContent,'Minimalkan');minimize.click();
  await h.ui.poll();
  assert.equal(scoreDialog.open,false);
  assert.deepEqual(project().continueReady,[false,false,false,false]);
  assert.equal(root.querySelector('.capsa-play-group.is-latest .capsa-laid-card').textContent,'5♥');
  assert.equal(root.querySelector('.capsa-revealed-hand').getAttribute('aria-label'),'Sisa kartu Player3');
  const reveal=root.querySelector('.capsa-seat[data-seat="3"] .capsa-revealed-hand');
  assert.equal(reveal.querySelector('.capsa-revealed-card').textContent,'6♠');
  assert.equal(root.querySelector('.capsa-hand').hidden,true);
  assert.equal(root.querySelector('.capsa-hand').children.length,0);
  assert.equal(root.querySelector('.capsa-revealed-hand button'),null);
  const ready=root.querySelector('.capsa-result-ready'),next=root.querySelector('.capsa-actions button:nth-last-child(2)');
  assert.equal(ready.hidden,false);assert.equal(ready.disabled,false);assert.equal(next.hidden,true);
  for(const i of [1,2,3])turn(i,'confirm_round',now+1000);await h.ui.poll();assert.equal(next.hidden,true);
  turn(0,'confirm_round',now+1000);await h.ui.poll();assert.equal(ready.hidden,true);assert.equal(next.disabled,false);
  root.querySelector('.capsa-score-button').click();
  assert.equal(scoreDialog.open,true);
  assert.deepEqual([...root.querySelectorAll('.scoreboard tbody tr')].map(r=>[...r.cells].slice(2).map(c=>c.textContent)),[['1','6','6'],['2','4','4'],['3','3','3'],['4','1','1']]);
 }finally{h.ui.stop();h.dom.window.close();}
});

test('Capsa Voice controls delegate to the shared room microphone actions',()=>{
 const calls=[],h=harness(async()=>{},Object.fromEntries(['join','mute','leave'].map(k=>[k,()=>calls.push(k)])));
 try{
  for(const key of ['Join','Mute','Leave'])h.ui.element.querySelector('#capsaVoice'+key+'Btn').click();
  assert.deepEqual(calls,['join','mute','leave']);
 }finally{h.ui.stop();h.dom.window.close();}
});


test('final scoreboard waits for the reveal pause, congratulates session leaders and starts a clean game in the same room',async()=>{
 let v={...G.projection(data().root,'ABCD','u0'),matchId:'finished',phase:'session_end',winner:1,counts:[0,0,0,3],scores:[60,42,38,20],finishOrder:[1,0,2],table:{seat:2,cards:[{rank:'J',suit:'C'}]},revealedHand:{seat:3,cards:E.deck().slice(0,3)},roundEndUntil:Date.now()+7000,serverNow:Date.now()};
 let starts=0,exits=0,done;
 const h=harness(async()=>({ok:true,json:async()=>v}),null,{start:()=>{starts++;return new Promise(r=>{done=r;});},exit:()=>{exits++;}});
 try{
  h.ui.observe(h.room);await delay();const dialog=h.ui.element.querySelector('#capsaScoreDialog'),start=dialog.querySelector('.capsa-final-actions .primary');
  assert.equal(dialog.open,false);
  v={...v,roundEndUntil:Date.now()-10,serverNow:Date.now()};await h.ui.poll();
  assert.equal(dialog.open,true);assert.equal(dialog.querySelector('h2').textContent,'Papan skor akhir');
  assert.match(dialog.querySelector('.modal-subtitle').textContent,/Selamat, Player0!/);
  assert.deepEqual([...dialog.querySelectorAll('tbody tr')].map(row=>row.lastChild.textContent),['60','42','38','20']);
  assert.match(dialog.querySelector('.capsa-final-note').textContent,/ABCD/);
  h.room.host='u1';h.ui.observe(h.room);assert.equal(start.disabled,true);
  dialog.querySelector('.capsa-final-actions button').click();assert.equal(exits,1);
  h.room.host='u0';h.ui.observe(h.room);assert.equal(start.disabled,false);
  start.click();start.click();assert.equal(starts,1);
  v={...G.projection(data().root,'ABCD','u0'),matchId:'new-game'};done();await delay();await delay();
  assert.equal(dialog.open,false);assert.match(h.ui.element.querySelector('.capsa-meta').textContent,/ABCD · Babak 1/);
 }finally{h.ui.stop();h.dom.window.close();}
});

test('final scoreboard congratulates both players tied for the highest total',async()=>{
 const v={...G.projection(data().root,'ABCD','u0'),phase:'session_end',round:15,endReason:'game_limit',winner:2,counts:[0,3,0,0],scores:[58,19,46,58],finishOrder:[2,3,0],table:{seat:0,cards:[{rank:'J',suit:'C'}]},revealedHand:{seat:1,cards:E.deck().slice(0,3)}};
 const h=harness(async()=>({ok:true,json:async()=>v}));
 try{
  h.ui.observe(h.room);await delay();
  assert.match(h.ui.element.querySelector('#capsaScoreDialog .modal-subtitle').textContent,/Selamat, Player0 dan Player3/);
  assert.equal(h.ui.element.querySelectorAll('#capsaScoreDialog .winner-row').length,2);
 }finally{h.ui.stop();h.dom.window.close();}
});
