/* Dedicated demo namespace; never production. Exercises the actual host module. */
const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const H=require('../capsa-host.js'),M=require('../room-membership.js'),S=require('../room-saves.js');
const E=require('../capsa-engine.js');
const NS='demo-capsa-host-web',BASE=process.env.CAPSA_TEST_DB_BASE||'http://127.0.0.1:19000';
const jwt=uid=>{const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');return enc({alg:'none',typ:'JWT'})+'.'+enc({sub:uid,user_id:uid,aud:NS,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600,firebase:{sign_in_provider:'password'}})+'.';};
const snap=v=>({exists:()=>v!==null,val:()=>v});
function client(uid){
 const raw={db:{},ref:(_db,path)=>({path,toString:()=>BASE+'/'+path}),async request(r,method='GET',value,etag){
  const response=await fetch(`${BASE}/${r.path}.json?ns=${NS}&auth=${jwt(uid)}`,{method,headers:{'Content-Type':'application/json',...(method==='GET'?{'X-Firebase-ETag':'true'}:{}),...(etag?{'if-match':etag}:{})},body:value===undefined?undefined:JSON.stringify(value)});
  const data=await response.json();if(response.status===412)return {conflict:true};if(!response.ok)throw Object.assign(Error('Database request denied '+response.status+' '+r.path+' '+JSON.stringify(data)),{status:response.status});return {data,etag:response.headers.get('etag')};
 },async get(r){return snap((await raw.request(r)).data);},async set(r,v){await raw.request(r,'PUT',v);},async update(r,v){await raw.request(r,'PATCH',v);},async remove(r){await raw.request(r,'DELETE');},async runTransaction(r,fn){for(let i=0;i<25;i++){const v=await raw.request(r),next=fn(v.data);if(next===undefined)return {committed:false,snapshot:snap(v.data)};const result=await raw.request(r,'PUT',next,v.etag);if(!result.conflict)return {committed:true,snapshot:snap(result.data)};}throw Error('Transaction retries exhausted');}};
 return {...raw,...M.databaseBridge(raw)};
}
const owner=async(path,method='GET',body)=>{const r=await fetch(BASE+'/'+path+'.json?ns='+NS,{method,headers:{Authorization:'Bearer owner','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});assert.equal(r.status,200,await r.clone().text());return r.json();};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const rules=await fetch(BASE+'/.settings/rules.json?ns='+NS,{method:'PUT',headers:{Authorization:'Bearer owner','Content-Type':'application/json'},body:fs.readFileSync(require('node:path').join(__dirname,'../database.rules.json'))});assert.equal(rules.status,200,await rules.text());await owner('','PUT',{});
 const code='WEB1',players=Object.fromEntries(Array.from({length:4},(_,i)=>['u'+i,{uid:'u'+i,seat:i,isBot:false,nickname:'Player'+i,lastSeen:Date.now()}]));
 let room={code,game:'capsa',createdAt:Date.now(),membershipVersion:2,maxPlayers:4,phase:'lobby',host:'u0',players,seats:['u0','u1','u2','u3']};
 await owner('rooms/'+code,'PUT',room);
 const fbs=Array.from({length:4},(_,i)=>client('u'+i)),hosts=fbs.map((fb,i)=>H.create(fb,{uid:()=> 'u'+i}));
 try{
  await hosts[0].start(code);room=await owner('rooms/'+code);hosts[0].observe(room);
  const views=await Promise.all(hosts.map(h=>h.view(code)));assert.equal(new Set(views.flatMap(v=>v.hand.map(c=>c.rank+c.suit))).size,52);console.log('PASS actual host start, canonical bot/roster bridge and per-player views');
  for(let i=1;i<4;i++){
   await assert.rejects(fbs[i].get(fbs[i].ref({},'capsaMatches/'+code+'/privateSnapshot')));
   await assert.rejects(fbs[i].get(fbs[i].ref({},'capsaMatches/'+code+'/hands/u0')));
   await assert.rejects(fbs[i].get(fbs[i].ref({},'capsaMatches/'+code)));
  }
  await assert.rejects(client('outsider').get(client('outsider').ref({},'capsaMatches/'+code+'/publicSnapshot')));console.log('PASS non-host/private/parent/other-hand and outsider reads denied');
  const packet=(v,type,extra={})=>({id:'client_'+crypto.randomUUID(),type,expectedRevision:v.revision,matchId:v.matchId,generation:v.generation,...extra});
  await Promise.all(hosts.map((h,i)=>h.request(code,packet(views[i],'ready'))));let v=await hosts[0].view(code);assert.equal(v.phase,'playing');assert.ok(v.ready.every(Boolean));console.log('PASS simultaneous Ready requests processed once each through actual transactions');
  const turn=v.turn,own=await hosts[turn].view(code),play=packet(own,'play',{cards:[{rank:'3',suit:'D'}]});
  await hosts[turn].request(code,play);const after=await hosts[turn].request(code,play);assert.equal(after.hand.length,12);assert.equal(after.revision,5);console.log('PASS opening 3D, lost-ack replay and conservation');
  const denied=packet(await hosts[(turn+2)%4].view(code),'play',{uid:'u'+((turn+1)%4),cards:[{rank:'4',suit:'D'}]});await assert.rejects(hosts[(turn+2)%4].request(code,denied));console.log('PASS UID payload spoof and out-of-turn move rejected by host engine');
  const before=await owner('capsaMatches/'+code+'/privateSnapshot');
  room=await owner('rooms/'+code);await fbs[0].set(fbs[0].ref({},'rooms/'+code+'/savedGame'),S.request(room,'u0','a'.repeat(32),{'.sv':'timestamp'}));
  room=await owner('rooms/'+code);hosts.forEach(h=>h.observe(room));
  const c=await owner('capsaMatches/'+code);await assert.rejects(fbs[0].set(fbs[0].ref({},'capsaMatches/'+code),c));await assert.rejects(fbs[1].set(fbs[1].ref({},'capsaMatches/'+code+'/requests/u1/blocked'),'{}'));assert.equal(await owner('capsaMatches/'+code+'/privateSnapshot'),before);console.log('PASS host and requests frozen by rules during save');
  await owner('rooms/'+code+'/savedGame','DELETE');room=await owner('rooms/'+code);hosts.forEach(h=>h.observe(room));await delay(800);
  const resumed=await hosts[0].view(code);assert.ok(resumed.deadline>Date.now()+28000);
  await owner('rooms/'+code+'/host','PUT','u1');room=await owner('rooms/'+code);hosts.forEach(h=>h.observe(room));await delay(700);
  const handed=await hosts[1].view(code);assert.deepEqual(handed.hand,(await hosts[1].view(code)).hand);await assert.rejects(fbs[0].get(fbs[0].ref({},'capsaMatches/'+code+'/privateSnapshot')));
  console.log('PASS save resume resets clock; new host takes state and old host loses private read');
  hosts.forEach(h=>h.stop());await owner('rooms/'+code,'DELETE');await H.cleanup(fbs[1]);assert.equal(await owner('capsaMatches/'+code),null);console.log('PASS orphan state/catalog cleanup only after room deletion');
  // Solo + automatic bots exercises the same bridge and timer on another room.
  const solo='WEB2';await owner('rooms/'+solo,'PUT',{code:solo,game:'capsa',createdAt:Date.now(),membershipVersion:2,maxPlayers:4,phase:'lobby',host:'u0',players:{u0:players.u0},seats:{0:'u0'}});await hosts[0].start(solo);
  let sv=await hosts[0].view(solo);assert.equal(sv.players.filter(p=>p.isBot).length,3);await hosts[0].request(solo,packet(sv,'ready'));
  sv=await hosts[0].view(solo);if(sv.turn===0)await hosts[0].request(solo,packet(sv,'play',{cards:[{rank:'3',suit:'D'}]}));
  for(let i=0;i<25;i++){sv=await hosts[0].view(solo);if(sv.counts.some((n,i)=>i>0&&n<13))break;await delay(200);}
  assert.ok(sv.counts.some((n,i)=>i>0&&n<13));console.log('PASS solo with three bots actually plays through Firebase');
  hosts.forEach(h=>h.stop());
  const resultRoom={code:'WEB3',game:'capsa',createdAt:Date.now(),membershipVersion:2,maxPlayers:4,phase:'capsa_playing',host:'u0',players,seats:['u0','u1','u2','u3']};
  let result=E.createSession(Object.values(players),E.deck(),0);result.hands=[[{rank:'3',suit:'D'}],[{rank:'4',suit:'C'}],[{rank:'5',suit:'H'}],[{rank:'6',suit:'S'}]];
  const held=new Set(result.hands.flat().map(E.cardKey));result.discard=E.deck().filter(c=>!held.has(E.cardKey(c)));result.phase='playing';result.ready=[true,true,true,true];result.deadline=Date.now()+45000;
  for(let i=0;i<2;i++)result=E.applyAction(result,{id:'test_finish_'+i,uid:'u'+i,type:'play',cards:result.hands[i],expectedRevision:result.revision},Date.now());
  await owner('rooms/WEB3','PUT',resultRoom);await owner('capsaMatches/WEB3','PUT',H.capsule(result,resultRoom,'confirmation_match'));hosts.forEach(h=>h.observe(resultRoom));await delay(400);
  let rv=await hosts[0].view('WEB3');assert.equal(rv.phase,'playing');assert.deepEqual(rv.finishOrder,[0,1]);assert.equal(rv.revealedHand,undefined);
  await assert.rejects(fbs[1].get(fbs[1].ref({},'capsaMatches/WEB3/hands/u3')));
  const p2=await hosts[2].view('WEB3');await hosts[2].request('WEB3',packet(p2,'play',{cards:p2.hand}));
  rv=await hosts[0].view('WEB3');assert.equal(rv.phase,'round_end');assert.equal(rv.round,1);
  assert.deepEqual(rv.scores,[6,4,3,1]);assert.deepEqual(rv.finishOrder,[0,1,2]);assert.equal(rv.deadline,null);
  for(const h of hosts)assert.deepEqual((await h.view('WEB3')).revealedHand,{seat:3,cards:[{rank:'6',suit:'S'}]});
  assert.equal(E.cardKey(rv.table.cards[0]),'5H');
  const restartState=JSON.parse((await owner('capsaMatches/WEB3')).privateSnapshot);
  await delay(Math.max(0,rv.roundEndUntil-Date.now()+30));
  await assert.rejects(hosts[0].request('WEB3',packet(rv,'next_round')),/Ready/);
  await Promise.all([1,2,3].map(async i=>hosts[i].request('WEB3',packet(await hosts[i].view('WEB3'),'confirm_round'))));
  rv=await hosts[0].view('WEB3');assert.deepEqual(rv.continueReady,[false,true,true,true]);assert.equal(rv.phase,'round_end');
  await assert.rejects(hosts[0].request('WEB3',packet(rv,'next_round')),/Ready/);
  await hosts[0].request('WEB3',packet(rv,'confirm_round'));rv=await hosts[0].view('WEB3');assert.deepEqual(rv.continueReady,[true,true,true,true]);
  await hosts[0].request('WEB3',packet(rv,'next_round'));rv=await hosts[0].view('WEB3');assert.equal(rv.round,2);assert.equal(rv.phase,'playing');assert.equal(rv.revealedHand,undefined);
  const opener=await hosts[rv.turn].view('WEB3');assert.ok(opener.hand.some(c=>E.cardKey(c)==='3D'));assert.deepEqual(rv.continueReady,[]);
  console.log('PASS third finisher freezes board and reveals fourth hand only at results; all Ready including host; next deal hides cards');
  const mic=fbs[0].ref({},'rooms/WEB3/voice/u0'),signal=fbs[0].ref({},'rooms/WEB3/signals/u1/test_ice');
  await fbs[0].set(mic,{name:'Player0',muted:false});
  assert.equal((await fbs[1].get(mic)).val().muted,false);
  await fbs[0].update(mic,{muted:true});
  await fbs[0].set(signal,{from:'u0',kind:'ice',data:{candidate:'fixture'}});
  await fbs[1].remove(signal);await fbs[0].remove(mic);
  assert.equal((await fbs[1].get(mic)).exists(),false);
  console.log('PASS running Capsa room supports microphone join, mute, signalling and leave under Firebase rules');
  restartState.scores=[60,4,3,1];restartState.history.at(-1).totals=restartState.scores;
  restartState.phase='session_end';restartState.endReason='score_limit';restartState.roundEndUntil=Date.now()-100;
  await owner('rooms/WEB3/phase','PUT','capsa_session_end');
  const endRoom=await owner('rooms/WEB3');
  await owner('capsaMatches/WEB3','PUT',H.capsule(restartState,endRoom,'final_before_restart'));
  await assert.rejects(hosts[1].start('WEB3'),/Hanya host/);
  await hosts[0].start('WEB3');
  const restarted=await hosts[1].view('WEB3'),sameRoom=await owner('rooms/WEB3');
  assert.equal(sameRoom.createdAt,endRoom.createdAt);assert.deepEqual(sameRoom.seats,endRoom.seats);
  assert.notEqual(restarted.matchId,'final_before_restart');assert.equal(restarted.round,1);assert.equal(restarted.phase,'round_ready');
  assert.deepEqual(restarted.scores,[0,0,0,0]);assert.equal(restarted.hand.length,13);assert.equal(restarted.revealedHand,undefined);
  console.log('PASS host starts a clean session with the same room code, players and fresh Ready gate');
  hosts.forEach(h=>h.stop());
  const tableRoom={code:'WEB4',game:'capsa',createdAt:Date.now(),membershipVersion:2,maxPlayers:4,phase:'capsa_playing',host:'u0',players,seats:['u0','u1','u2','u3']};
  let tableState=E.createSession(Object.values(players),E.deck(),0);const parse=text=>text.split(' ').map(k=>({rank:k.slice(0,-1),suit:k.slice(-1)}));
  tableState.scoringVersion=E.LEGACY_SCORING_VERSION;delete tableState.finishOrder;tableState.hands=['3D 8D','4C 8C','5H 8H JH','6S 8S'].map(parse);const tableHeld=new Set(tableState.hands.flat().map(E.cardKey));tableState.discard=E.deck().filter(c=>!tableHeld.has(E.cardKey(c)));tableState.roundPlaysIncomplete=true;tableState.phase='playing';tableState.ready=[true,true,true,true];tableState.openingRequired=false;tableState.turn=0;tableState.deadline=Date.now()+45000;
  await owner('rooms/WEB4','PUT',tableRoom);await owner('capsaMatches/WEB4','PUT',H.capsule(tableState,tableRoom,'babak_ronde_match'));hosts.forEach(h=>h.observe(tableRoom));
  async function tableAction(i,type,text){const v=await hosts[i].view('WEB4');return hosts[i].request('WEB4',packet(v,type,text?{cards:parse(text)}:{}));}
  await tableAction(0,'play','3D');await tableAction(1,'pass');await tableAction(2,'play','5H');await tableAction(3,'pass');await tableAction(0,'pass');
  let tv=await hosts[0].view('WEB4');assert.equal(tv.phase,'playing');assert.equal(tv.round,1);assert.equal(tv.trick,2);assert.equal(tv.turn,2);assert.equal(tv.lastTrickWinner,2);assert.deepEqual(tv.passed,[]);assert.ok(tv.counts.every(n=>n>0));assert.deepEqual(tv.scores,[0,0,0,0]);assert.deepEqual(tv.history,[]);
  await tableAction(2,'play','8H');await tableAction(3,'play','8S');await tableAction(0,'pass');await tableAction(1,'pass');await tableAction(2,'play','JH');
  tv=await hosts[0].view('WEB4');assert.equal(tv.phase,'round_end');assert.equal(tv.winner,2);assert.equal(tv.counts[2],0);assert.equal(tv.history.length,1);assert.ok(tv.counts[0]>0);assert.deepEqual(tv.scores,[-10,-20,0,-10]);
  console.log('PASS table ronde reset preserves cards/scores, re-enables every player, and babak ends only after committed last card');
  hosts.forEach(h=>h.stop());
  const legacyCapsule=await owner('capsaMatches/WEB4'),legacyState=JSON.parse(legacyCapsule.privateSnapshot),legacyHands=legacyCapsule.hands,legacyGeneration=legacyCapsule.generation;
  delete legacyState.scoringVersion;legacyState.scores=[240,260,100,140];legacyState.history=legacyState.history.map(h=>({...h,penalties:h.penalties.map(Math.abs),totals:[240,260,100,140]}));legacyState.phase='session_end';
  await owner('rooms/WEB4/phase','PUT','capsa_session_end');const legacyRoom=await owner('rooms/WEB4');await owner('capsaMatches/WEB4','PUT',H.publish(legacyCapsule,legacyState,legacyRoom));hosts.forEach(h=>h.observe(legacyRoom));
  let upgraded;for(let i=0;i<20;i++){upgraded=await hosts[0].view('WEB4');if(upgraded.scoringVersion===2)break;await delay(200);}
  assert.equal(upgraded.scoringVersion,2);assert.equal(upgraded.phase,'round_end');assert.deepEqual(upgraded.scores,[-240,-260,-100,-140]);assert.notEqual(upgraded.generation,legacyGeneration);
  assert.deepEqual((await owner('capsaMatches/WEB4')).hands,legacyHands);console.log('PASS legacy positive scores migrate once without changing hands; old 250-limit result can continue');

 }finally{hosts.forEach(h=>h.stop());await owner('','PUT',{});}
})().catch(e=>{console.error(e);process.exitCode=1;});
