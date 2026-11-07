const test=require('node:test'),assert=require('node:assert/strict'),E=require('../capsa-engine.js'),H=require('../capsa-host.js');
const players=Array.from({length:4},(_,seat)=>({uid:'u'+seat,seat,isBot:false,nickname:'P'+seat}));
const room=()=>({code:'ABCD',game:'capsa',host:'u0',createdAt:1,seats:players.map(p=>p.uid),players:Object.fromEntries(players.map(p=>[p.uid,{...p}]))});
function initial(){const r=room(),s=E.createSession(players,E.deck(),0);return {r,c:H.capsule(s,r,'match')};}
function queue(c,uid,id,body){c.requests??={};c.requests[uid]??={};c.requests[uid][id]=JSON.stringify({matchId:c.matchId,generation:c.generation,expectedRevision:c.revision,...body});return c;}
test('public projection never contains hands or receipts, while each UID has exactly own cards',()=>{const {c}=initial(),v=JSON.parse(c.publicSnapshot);assert.equal(v.hands,undefined);assert.equal(v.receipts,undefined);assert.equal(v.revealedHand,undefined);assert.equal(new Set(Object.values(c.hands).flatMap(s=>JSON.parse(s).map(E.cardKey))).size,52);});
test('simultaneous Ready requests are independently applied and all four human votes required',()=>{let {r,c}=initial();for(let i=0;i<4;i++)queue(c,'u'+i,'a'+i,{type:'ready',expectedRevision:0});for(let i=0;i<4;i++)c=H.step(c,r,'u0',0);assert.deepEqual(JSON.parse(c.privateSnapshot).ready,[true,true,true,true]);assert.equal(c.phase,'playing');assert.equal(c.revision,4);});
test('queued UID/seat cannot be spoofed, illegal moves rejected and acknowledged requests never replay',()=>{let {r,c}=initial();queue(c,'u1','spoof',{type:'play',uid:'u0',cards:[{rank:'3',suit:'D'}]});c=H.step(c,r,'u0',0);assert.equal(JSON.parse(c.responses.u1.spoof).ok,false);assert.equal(c.revision,0);queue(c,'u0','ready',{type:'ready'});c=H.step(c,r,'u0',0);const rev=c.revision;queue(c,'u0','ready',{type:'ready'});c=H.step(c,r,'u0',0);assert.equal(c.revision,rev);});
test('handoff/save resume invalidates old callbacks while preserving hands and requiring fresh queued generation',()=>{let {r,c}=initial();const hands=c.hands;r.host='u1';const before=c.generation;c=H.step(c,r,'u1',5);assert.notEqual(c.generation,before);assert.deepEqual(c.hands,hands);assert.equal(H.step(c,r,'u0',5),undefined);const frozen={...r,savedGame:{status:'saved'}};assert.equal(H.step(c,frozen,'u1',1000),undefined);const old=c.generation;c=H.step(c,r,'u1',1000,{reset:true});queue(c,'u2','old',{type:'ready',generation:old});c=H.step(c,r,'u1',1000);assert.equal(JSON.parse(c.responses.u2.old).status,409);});
test('canonical bot-seat replacement preserves cards and waits for replacement human readiness',()=>{let {r,c}=initial();const oldHand=c.hands.u2;delete r.players.u2;r.players.new={uid:'new',seat:2,isBot:false};r.seats[2]='new';c=H.step(c,r,'u0',0);assert.equal(c.hands.new,oldHand);assert.equal(c.hands.u2,undefined);assert.equal(c.roster[2],'new');assert.equal(JSON.parse(c.privateSnapshot).ready[2],false);});

test('host pump does not abort on stale SDK transaction cache when latest get contains Ready',async()=>{
 const {r,c}=initial(),stale=JSON.parse(JSON.stringify(c));queue(c,'u0','cold_ready',{type:'ready'});let stored=c,transactions=0;
 const ss=v=>({exists:()=>v!==null,val:()=>v});
 const fb={db:{},ref:(_db,p)=>p,get:async p=>ss(p==='rooms/ABCD'?r:stored),set:async()=>{},update:async()=>{},runTransaction:async(_ref,fn)=>{
  transactions++;assert.notEqual(fn(stale),undefined,'Must let SDK server hash conflict refresh stale cache');
  const next=fn(stored);assert.ok(next);stored=next;return {committed:true,snapshot:ss(next)};
 }};
 const h=H.create(fb,{uid:()=> 'u0',now:()=>0});
 try{h.observe(r);for(let i=0;i<10&&!transactions;i++)await new Promise(resolve=>setTimeout(resolve,0));assert.ok(transactions);assert.equal(JSON.parse(stored.privateSnapshot).ready[0],true);assert.ok(stored.responses.u0.cold_ready);}
 finally{h.stop();}
});

test('public round history exposes played cards only and survives host handoff/reset',()=>{
 let {r,c}=initial();let s=JSON.parse(c.privateSnapshot);
 for(let i=0;i<4;i++)s=E.applyAction(s,{id:'hist_ready'+i,uid:'u'+i,type:'ready',expectedRevision:s.revision},0);
 s=E.applyAction(s,{id:'hist_play',uid:'u0',type:'play',cards:[{rank:'3',suit:'D'}],expectedRevision:s.revision},0);
 c=H.publish(c,s,r);const v=JSON.parse(c.publicSnapshot);
 assert.deepEqual(v.roundPlays,s.roundPlays);assert.equal(v.hands,undefined);assert.equal(v.discard,undefined);
 assert.deepEqual(v.roundPlays.flatMap(e=>e.cards).map(E.cardKey),['3D']);
 r.host='u1';c=H.step(c,r,'u1',1,{reset:true});assert.deepEqual(JSON.parse(c.publicSnapshot).roundPlays,v.roundPlays);
});

function finishedCapsule(legacy=false){
 const r=room();let s=E.createSession(players,E.deck(),0);s.hands=[[{rank:'3',suit:'D'}],[{rank:'4',suit:'C'}],[{rank:'5',suit:'H'}],[{rank:'6',suit:'S'}]];
 const held=new Set(s.hands.flat().map(E.cardKey));s.discard=E.deck().filter(c=>!held.has(E.cardKey(c)));s.phase='playing';s.ready=[true,true,true,true];s.deadline=30000;
 if(legacy){s.scoringVersion=E.LEGACY_SCORING_VERSION;delete s.finishOrder;}
 for(let i=0;i<(legacy?1:3);i++){
  s=E.applyAction(s,{id:'finish_pause_'+i,uid:'u'+i,type:'play',cards:s.hands[i],expectedRevision:s.revision},100);
  if(!legacy&&i<2)assert.equal(JSON.parse(H.capsule(s,r).publicSnapshot).revealedHand,undefined);
 }
 if(!legacy)assert.deepEqual(JSON.parse(H.capsule(s,r).publicSnapshot).revealedHand,{seat:3,cards:s.hands[3]});
 return {r,c:H.capsule(s,r,'pause_match')};
}
test('round end waits indefinitely for explicit confirmations and the current host next action',()=>{
 let {r,c}=finishedCapsule();assert.equal(JSON.parse(c.publicSnapshot).roundEndUntil,7100);assert.equal(H.step(c,r,'u0',7099),undefined);
 r.host='u1';c=H.step(c,r,'u1',500);assert.equal(JSON.parse(c.publicSnapshot).roundEndUntil,7100);
 assert.equal(H.step(c,r,'u1',100000),undefined,'Time alone must never deal the next round');
 queue(c,'u1','missing_votes',{type:'next_round'});c=H.step(c,r,'u1',100000);assert.equal(JSON.parse(c.responses.u1.missing_votes).ok,false);assert.equal(c.phase,'round_end');
 for(const i of [0,2,3]){queue(c,'u'+i,'confirm_'+i,{type:'confirm_round',expectedRevision:0});c=H.step(c,r,'u1',100001);}
 queue(c,'u1','host_no_vote',{type:'next_round'});c=H.step(c,r,'u1',100002);assert.equal(JSON.parse(c.responses.u1.host_no_vote).ok,false);
 queue(c,'u1','host_ready',{type:'confirm_round'});c=H.step(c,r,'u1',100002);
 assert.equal(H.step(c,r,'u1',100002),undefined,'Even complete votes wait for the host click');
 const oldRoundCards=JSON.parse(c.privateSnapshot).roundPlays;assert.ok(oldRoundCards.length);
 queue(c,'u0','not_host_next',{type:'next_round'});c=H.step(c,r,'u1',100003);assert.equal(JSON.parse(c.responses.u0.not_host_next).ok,false);
 queue(c,'u1','host_next',{type:'next_round'});c=H.step(c,r,'u1',100004);const s=JSON.parse(c.privateSnapshot);assert.equal(s.round,2);assert.equal(s.phase,'playing');assert.deepEqual(s.roundPlays,[]);assert.deepEqual(s.ready,[true,true,true,true]);assert.equal(JSON.parse(c.publicSnapshot).revealedHand,undefined);assert.equal(s.openingRequired,true);assert.ok(s.hands[s.turn].some(c=>E.cardKey(c)==='3D'));
});
test('saved winner pause cannot advance; resume restarts seven seconds and older snapshots receive a full pause',()=>{
 let {r,c}=finishedCapsule();assert.equal(H.step(c,{...r,savedGame:{status:'saved'}},'u0',9000),undefined);
 c=H.step(c,r,'u0',9000,{reset:true});assert.equal(JSON.parse(c.publicSnapshot).roundEndUntil,16000);assert.equal(H.step(c,r,'u0',15999),undefined);
 const s=JSON.parse(c.privateSnapshot);delete s.roundEndUntil;c.privateSnapshot=JSON.stringify(s);
 c=H.step(c,r,'u0',20000);assert.equal(JSON.parse(c.publicSnapshot).roundEndUntil,27000);assert.equal(c.phase,'round_end');
});

test('upgrading an existing 15-second snapshot grants round-specific time once and preserves all cards',()=>{
 let {r,c}=initial();let s=JSON.parse(c.privateSnapshot);for(let i=0;i<4;i++)s=E.applyAction(s,{id:'upgrade_ready'+i,uid:'u'+i,type:'ready',expectedRevision:s.revision},0);
 delete s.turnMs;s.deadline=15000;c=H.publish(c,s,r);const hands=c.hands,oldGeneration=c.generation;
 c=H.step(c,r,'u0',12000);assert.equal(JSON.parse(c.publicSnapshot).turnMs,45000);assert.equal(JSON.parse(c.publicSnapshot).deadline,57000);assert.notEqual(c.generation,oldGeneration);assert.deepEqual(c.hands,hands);
 assert.equal(H.step(c,r,'u0',12001),undefined);assert.equal(H.step(c,{...r,savedGame:{status:'saved'}},'u0',50000),undefined);
});


test('legacy undealt opening is corrected to 3D holder without redealing cards',()=>{
 const {r,c}=initial();let s=JSON.parse(c.privateSnapshot);s.round=2;s.direction=-1;s.openingRequired=false;s.turn=1;s.turnMs=45000;const hands=c.hands;
 H.publish(c,s,r);const oldGeneration=c.generation,next=H.step(c,r,'u0',1000);const repaired=JSON.parse(next.privateSnapshot);
 assert.equal(repaired.turn,0);assert.equal(repaired.openingRequired,true);assert.deepEqual(next.hands,hands);assert.notEqual(next.generation,oldGeneration);
});
test('human converted to a bot cannot leave an impossible result-confirmation gate',()=>{
 let {r,c}=finishedCapsule();r.players.u2.isBot=true;c=H.step(c,r,'u0',8000);
 assert.equal(JSON.parse(c.privateSnapshot).players[2].isBot,true);assert.equal(JSON.parse(c.publicSnapshot).continueReady[2],true);
 for(const i of [0,1,3]){queue(c,'u'+i,'bot_confirm_'+i,{type:'confirm_round'});c=H.step(c,r,'u0',16000);}
 queue(c,'u0','with_converted_bot',{type:'next_round'});c=H.step(c,r,'u0',16000);assert.equal(c.phase,'playing');
});


test('old PASS locks on a cleared table are released without changing cards or scores',()=>{
 let {r,c}=initial(),s=JSON.parse(c.privateSnapshot);s.phase='playing';s.ready=[true,true,true,true];s.deadline=45000;s.openingRequired=false;s.turn=0;
 const card=s.hands[0].shift();s.discard.push(card);s.roundPlays=[{seat:0,uid:'u0',type:'single',cards:[card]}];s.table=null;s.passed=[1,2,3];delete s.trick;H.publish(c,s,r);
 const hands=c.hands,scores=[...s.scores],generation=c.generation;c=H.step(c,r,'u0',1000);s=JSON.parse(c.privateSnapshot);assert.deepEqual(s.passed,[]);assert.deepEqual(c.hands,hands);assert.deepEqual(s.scores,scores);assert.equal(s.phase,'playing');assert.equal(s.turn,0);assert.notEqual(c.generation,generation);
});


test('host migrates legacy scores once, preserves hands and invalidates old-generation packets',()=>{
 let {r,c}=finishedCapsule(true),s=JSON.parse(c.privateSnapshot);delete s.scoringVersion;s.round=6;s.direction=-1;s.turnMs=30000;s.scores=[130,260,100,140];s.phase='session_end';s.history=s.history.map(h=>({...h,penalties:h.penalties.map(Math.abs),totals:[130,260,100,140]}));H.publish(c,s,r);
 const hands=c.hands,oldGeneration=c.generation;r.host='u1';c=H.step(c,r,'u1',10000);const migrated=JSON.parse(c.privateSnapshot);assert.equal(c.owner,'u1');assert.equal(migrated.phase,'round_end');assert.deepEqual(migrated.scores,[-130,-260,-100,-140]);assert.deepEqual(c.hands,hands);assert.notEqual(c.generation,oldGeneration);
 assert.equal(H.step(c,r,'u1',10001),undefined);assert.equal(JSON.parse(c.publicSnapshot).scoringVersion,2);
});
