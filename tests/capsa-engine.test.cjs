const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../capsa-engine.js');
const c = key => ({rank:key.slice(0,-1),suit:key.slice(-1)});
const cs = text => text.split(' ').map(c);
const people = bots => Array.from({length:4},(_,i)=>({uid:'u'+i,isBot:!!bots}));
let serial=0;
function act(s,type,extra={},now,actor=s.turn) {
  now??=type==='next_round'?(s.roundEndUntil||0):0;
  return E.applyAction(s,{id:'a'+(++serial),expectedRevision:s.revision,uid:s.players[actor].uid,type,...extra},now);
}
function fresh(bots=false) {return E.createSession(people(bots),E.deck(),0);}
function ready(s) {
  for(let i=0;i<4;i++) if(s.phase==='round_ready'&&!s.ready[i]) s=act(s,'ready',{},0,i);
  return s;
}
function endReady(s,actor=s.turn){if(s.phase==='round_end')for(let i=0;i<4;i++)if((E.placementMode(s)||i!==actor)&&!s.players[i].isBot&&!s.continueReady?.[i])s=act(s,'confirm_round',{},0,i);return s;}
// Synthetic legal mid-round snapshots; all omitted cards are already discarded.
function position(hands,table=null,reversed=false,legacy=false) {
  const s=ready(fresh());
  if(legacy){s.scoringVersion=E.LEGACY_SCORING_VERSION;delete s.finishOrder;}
  s.hands=hands.map(cs);s.table=table?{seat:table.seat,cards:cs(table.cards)}:null;
  const held=new Set(s.hands.flat().map(E.cardKey));
  assert.equal(held.size,s.hands.flat().length);
  s.discard=E.deck().filter(c=>!held.has(E.cardKey(c)));
  s.openingRequired=false;s.reversed=reversed;s.turn=0;s.deadline=45000;
  E.assertState(s);return s;
}
const cmp=(a,b,r=false)=>E.compare(cs(a),cs(b),r);

test('canonical deck has 52 unique cards; rejects joker, malformed, duplicate and incomplete decks',()=>{
  assert.equal(new Set(E.deck().map(E.cardKey)).size,52);
  for(const invalid of [[{rank:'3',suit:'X'}],[{rank:'3',suit:'D',joker:true}],cs('3D 3D')]) assert.throws(()=>E.classify(invalid));
  assert.throws(()=>E.createSession(people(),E.deck().slice(1),0),/52/);
  assert.throws(()=>E.createSession([people()[0],people()[0],...people().slice(2)],E.deck(),0),/UID/);
});
test('accepts singles/pairs and all five-card types; rejects standalone triple and invalid five cards',()=>{
  const examples={single:'3D',pair:'3D 3C',straight:'3D 4C 5H 6S 7D',flush:'3D 5D 7D 9D JD',full_house:'3D 3C 3H 4D 4C',bomb:'7D 7C 7H 7S KD',straight_flush:'3D 4D 5D 6D 7D'};
  for(const [type,cards] of Object.entries(examples)) assert.equal(E.classify(cs(cards)).type,type);
  for(const cards of ['3D 4D','3D 3H 3C','3D 4H 5C 6S 8D']) assert.throws(()=>E.classify(cs(cards)));
});
test('supports exactly ten straight sequences through 10JQKA, with A2345 ending at 5 and no JQKA2',()=>{
  const runs=['A 2 3 4 5','2 3 4 5 6','3 4 5 6 7','4 5 6 7 8','5 6 7 8 9','6 7 8 9 10','7 8 9 10 J','8 9 10 J Q','9 10 J Q K','10 J Q K A'];
  const combos=runs.map(run=>run.split(' ').map((rank,i)=>({rank,suit:['D','C','H','S','D'][i]})));
  for(let i=0;i<combos.length;i++) {
    assert.equal(E.classify(combos[i]).type,'straight');
    if(i){assert.equal(E.compare(combos[i],combos[i-1]),1);assert.equal(E.compare(combos[i],combos[i-1],true),-1);}
  }
  assert.throws(()=>E.classify(cs('JD QC KH AS 2D')),/tidak sah/);
});
test('straight uses endpoint rank and endpoint suit in normal and reversed orders',()=>{
  assert.equal(cmp('AD 2H 3C 4S 5C','AH 2C 3S 4D 5D'),1);
  assert.equal(cmp('AD 2H 3C 4S 5C','AH 2C 3S 4D 5D',true),-1);
  assert.equal(cmp('8D 9C 10H JS QD','2C 3H 4S 5D 6C'),1);
});
test('five-card category hierarchy reverses; bombs never compare across different card counts',()=>{
  const combos=['3D 4C 5H 6S 7D','3D 5D 7D 9D JD','3D 3C 3H 4D 4C','7D 7C 7H 7S KD','3D 4D 5D 6D 7D'];
  for(let i=1;i<combos.length;i++) {assert.equal(cmp(combos[i],combos[i-1]),1);assert.equal(cmp(combos[i],combos[i-1],true),-1);}
  for(const reverse of [false,true]) {assert.equal(cmp(combos[3],'3D',reverse),null);assert.equal(cmp(combos[3],'3D 3C',reverse),null);}
});
test('flush uses suit first; re-selects strongest active rank for same-suit reversed flushes',()=>{
  assert.equal(cmp('3S 5S 7S 9S JS','4H 6H 8H AH 2H'),1);
  assert.equal(cmp('3S 5S 7S 9S JS','4H 6H 8H AH 2H',true),-1);
  // Normal highest K loses against A; reversed strongest 3 beats strongest 4.
  const a='3D 9D JD QD KD',b='4D 5D 6D 8D AD';
  assert.equal(cmp(a,b),-1);assert.equal(cmp(a,b,true),1);
});
test('pair re-selects strongest active suit; full house uses triple and bomb uses quad, not kicker',()=>{
  assert.equal(cmp('7S 7D','7H 7C'),1);assert.equal(cmp('7S 7D','7H 7C',true),1);
  assert.equal(cmp('7D 7C 7H KD KC','8D 8C 8H 3D 3C'),-1);
  assert.equal(cmp('7D 7C 7H KD KC','8D 8C 8H 3D 3C',true),1);
  assert.equal(cmp('7D 7C 7H 7S 2D','8D 8C 8H 8S 3D'),-1);
});
test('comparison is antisymmetric, independent of card input order and equal for identical combos',()=>{
  const samples=['3D','2S','3D 3C','7S 7D','AD 2H 3C 4S 5C','2C 3H 4S 5D 6C','3D 9D JD QD KD','4D 5D 6D 8D AD','7D 7C 7H KD KC','7D 7C 7H 7S 2D'];
  for(const a of samples) for(const b of samples) for(const reverse of [false,true]) {
    const result=cmp(a,b,reverse), opposite=cmp(b,a,reverse);
    if(result!==null) assert.equal(result===0?0:result,opposite===0?0:-opposite);
    assert.equal(E.compare(cs(a).reverse(),cs(b),reverse),result);
  }
});
test('four players receive 13 cards; fresh Ready from all humans required and no Ready timeout',()=>{
  let s=fresh();assert.deepEqual(s.hands.map(h=>h.length),[13,13,13,13]);assert.equal(s.deadline,null);
  assert.throws(()=>act(s,'play',{cards:cs('3D')}),/giliran/);
  assert.throws(()=>act(s,'timeout',{},1e6),/Timer/);
  for(let i=0;i<3;i++) s=act(s,'ready',{},100000,i);
  assert.equal(s.phase,'round_ready');s=act(s,'ready',{},100000,3);
  assert.equal(s.phase,'playing');assert.equal(s.deadline,145000);
  assert.equal(fresh(true).phase,'playing');
});
test('only holder of 3D opens first; single, pair and legal five-card opening accepted',()=>{
  for(const cards of ['3D','3D 3C','3D 4C 5H 6S 7D']) {
    const played=cs(cards),used=new Set(played.map(E.cardKey));
    const rest=E.deck().filter(c=>!used.has(E.cardKey(c)));
    const hands=[played.concat(rest.splice(0,13-played.length)),...Array.from({length:3},()=>rest.splice(0,13))];
    const packed=Array.from({length:13},(_,i)=>hands.map(h=>h[i])).flat();
    const s=ready(E.createSession(people(),packed,0));assert.equal(s.turn,0);
    assert.equal(act(s,'play',{cards:played}).hands[0].length,13-played.length);
    assert.throws(()=>act(s,'pass'),/Pembuka/);
    assert.throws(()=>act(s,'play',{cards:[hands[0].find(c=>E.cardKey(c)!=='3D')]}),/3 wajik/);
  }
  const shifted=E.deck();[shifted[0],shifted[2]]=[shifted[2],shifted[0]];
  assert.equal(ready(E.createSession(people(),shifted,0)).turn,2);
});
test('membership, turn, card ownership, malformed combo and revision checks leave original unchanged',()=>{
  const s=ready(fresh()),before=JSON.stringify(s);
  assert.throws(()=>act(s,'play',{cards:cs('3D')},0,1),/giliran/);
  assert.throws(()=>act(s,'play',{cards:cs('3H')}),/milik/);
  assert.throws(()=>E.applyAction(s,{id:'x',uid:'outsider',type:'ready',expectedRevision:s.revision},0),/UID/);
  assert.throws(()=>E.applyAction(s,{id:'x',uid:'u0',type:'play',cards:cs('3D'),expectedRevision:s.revision-1},0),/Revisi/);
  assert.equal(JSON.stringify(s),before);
});
test('duplicate acknowledged action is idempotent; altered replay and stale concurrent action rejected',()=>{
  const s=ready(fresh()),a={id:'same',uid:'u0',type:'play',cards:cs('3D'),expectedRevision:s.revision};
  const next=E.applyAction(s,a,0);assert.deepEqual(E.applyAction(next,a,20000),next);
  assert.throws(()=>E.applyAction(next,{...a,cards:cs('4D')},0),/isi berbeda/);
  assert.throws(()=>E.applyAction(next,{...a,id:'concurrent'},0),/Revisi/);
});
test('PASS lasts only for the table ronde; winner opens the next ronde and all players re-enter',()=>{
 let s=position(['3D 8D','4C 8C','5H 8H JH','6S 8S']);s=act(s,'play',{cards:cs('3D')});
 s=act(s,'pass');assert.deepEqual(s.passed,[1]);s=act(s,'play',{cards:cs('5H')});assert.deepEqual(s.passed,[1]);
 s=act(s,'pass');s=act(s,'pass');assert.equal(s.turn,2);assert.deepEqual(s.passed,[]);assert.equal(s.table,null);assert.equal(s.trick,2);assert.equal(s.lastTrickWinner,2);
 assert.equal(s.phase,'playing');assert.deepEqual(s.scores,[0,0,0,0]);assert.equal(s.history.length,0);assert.ok(s.hands.every(h=>h.length>0));
 s=act(s,'play',{cards:cs('8H')});assert.equal(s.turn,3);s=act(s,'play',{cards:cs('8S')});assert.equal(s.turn,0);
 s=act(s,'pass');assert.equal(s.turn,1);s=act(s,'pass');s=act(s,'play',{cards:cs('JH')});assert.equal(s.phase,'playing');assert.deepEqual(s.finishOrder,[2]);assert.equal(s.hands[2].length,0);
 assert.equal(s.trick,2);assert.equal(s.turn,3);s=act(s,'pass');assert.equal(s.trick,3);assert.equal(s.turn,3);assert.deepEqual(s.passed,[]);assert.equal(s.table,null);assert.deepEqual(s.scores,[0,0,0,0]);
});
test('persistent pass skips seats in the reversed direction as well',()=>{
 let s=position(['3D 8D','4C 8C','5H 8H','6S 8S']);s.direction=-1;s.round=2;
 s=act(s,'play',{cards:cs('3D')});assert.equal(s.turn,3);s=act(s,'pass');s=act(s,'play',{cards:cs('5H')});
 assert.deepEqual(s.passed,[3]);assert.equal(s.turn,1);s=act(s,'play',{cards:cs('8C')});assert.equal(s.turn,0);
 s=act(s,'pass');assert.equal(s.turn,2);assert.deepEqual(s.passed,[3,0]);
});
test('three passes reopen table with last player without ending round or changing direction',()=>{
  let s=position(['3D 8D','4C 8C','5H 8H','6S 8S']);s=act(s,'play',{cards:cs('3D')});
  for(let i=0;i<3;i++) s=act(s,'pass');
  assert.equal(s.phase,'playing');assert.equal(s.turn,0);assert.equal(s.table,null);assert.equal(s.direction,1);
});
test('winning bomb waits for owner; only owner can choose toggle and direction remains fixed',()=>{
  let s=position(['7D 7C 7H 7S KD 3D','4C 8C','5H 8H','6S 8S']);
  s=act(s,'play',{cards:cs('7D 7C 7H 7S KD')});for(let i=0;i<3;i++) s=act(s,'pass');
  assert.equal(s.phase,'bomb_choice');assert.equal(s.tableStart,0);assert.throws(()=>act(s,'choose_bomb',{flip:true},0,1),/pemilik/);
  const next=act(s,'choose_bomb',{flip:true});assert.equal(next.reversed,true);assert.equal(next.direction,1);assert.equal(next.table,null);assert.equal(next.tableStart,1);
});
test('second winning bomb toggles reversed back to normal; keeping state never resets reversal',()=>{
  let s=position(['7D 7C 7H 7S KD 3D','4C 8C','5H 8H','6S 8S'],null,true);
  s=act(s,'play',{cards:cs('7D 7C 7H 7S KD')});for(let i=0;i<3;i++) s=act(s,'pass');
  assert.equal(act(s,'choose_bomb',{flip:true}).reversed,false);
  assert.equal(act(s,'choose_bomb',{flip:false}).reversed,true);
});
test('defeated bomb never grants its old owner a reversal choice',()=>{
  let s=position(['7D 7C 7H 7S KD 3D','8C 9C 10C JC QC 4D','5H 8H','6S 8S']);
  s=act(s,'play',{cards:cs('7D 7C 7H 7S KD')});s=act(s,'play',{cards:cs('8C 9C 10C JC QC')});
  for(let i=0;i<3;i++) s=act(s,'pass');assert.equal(s.phase,'playing');assert.equal(s.turn,1);assert.equal(s.reversed,false);
});
test('illegal lower/equal and unequal-size responses rejected, including bomb on single',()=>{
  let s=position(['8D 3D','7D 7C 7H 7S KD 4D','5H 8H','6S 8S']);s=act(s,'play',{cards:cs('8D')});
  assert.throws(()=>act(s,'play',{cards:cs('4D')}),/lebih kuat/);
  assert.throws(()=>act(s,'play',{cards:cs('7D 7C 7H 7S KD')}),/berjumlah sama/);
});
test('timeout boundary rejects late manual action; first opening auto-plays 3D and responses pass',()=>{
  let s=ready(fresh());assert.throws(()=>act(s,'timeout',{},44999),/belum habis/);
  assert.throws(()=>act(s,'play',{cards:cs('3D')},45000),/sudah habis/);
  s=act(s,'timeout',{},45000);assert.deepEqual(s.table.cards,cs('3D'));assert.equal(s.turn,1);
  s=act(s,'timeout',{},90000);assert.deepEqual(s.passed,[1]);
});
test('timeout on free reversed opening chooses weakest active single; bomb timeout preserves order',()=>{
  let s=position(['3D 2S 2D','4C 8C','5H 8H','6S 8S'],null,true);
  s=act(s,'timeout',{},45000);assert.deepEqual(s.table.cards,cs('2S'));
  s=position(['7D 7C 7H 7S KD 3D','4C 8C','5H 8H','6S 8S'],null,true);
  s=act(s,'play',{cards:cs('7D 7C 7H 7S KD')});for(let i=0;i<3;i++) s=act(s,'pass');
  s=act(s,'timeout',{},45000);assert.equal(s.reversed,true);assert.equal(s.phase,'playing');assert.equal(s.table,null);
});
test('legacy last-card bomb scores immediately without bomb choice; negative penalties apply once before <=-300 evaluation',()=>{
  const s=position(['7D 7C 7H 7S KD','4C 8C','5H 8H 9H','6S 8S 9S 10S'],null,false,true);s.scores=[0,-290,0,0];
  const a={id:'finish',uid:'u0',type:'play',cards:cs('7D 7C 7H 7S KD'),expectedRevision:s.revision};
  const end=E.applyAction(s,a,0);assert.equal(end.phase,'session_end');assert.deepEqual(end.scores,[0,-310,-30,-40]);
  assert.deepEqual(E.applyAction(end,a,0).scores,end.scores);assert.equal(end.history.length,1);assert.equal(end.deadline,null);
  assert.throws(()=>act(end,'next_round',{deck:E.deck()}),/belum tersedia/);
});
test('legacy next round uses the new 3D holder, reverses seats and requires fresh readiness',()=>{
  let s=position(['3D','4C 8C','5H 8H','6S 8S'],null,true,true);s=act(s,'play',{cards:cs('3D')});
  const deck=E.deck();s=act(endReady(s),'next_round',{deck:deck.slice(1).concat(deck[0])});assert.equal(s.round,2);assert.equal(s.turn,3);assert.equal(s.direction,-1);
  assert.equal(s.reversed,false);assert.equal(s.openingRequired,true);assert.deepEqual(s.ready,[false,false,false,false]);
  s=ready(s);assert.throws(()=>act(s,'play',{cards:[s.hands[3].find(c=>E.cardKey(c)!=='3D')]}),/3 wajik/);s=act(s,'play',{cards:cs('3D')});assert.equal(s.turn,2);
});
test('all equal session scores stay in one shared standing group',()=>{
  assert.deepEqual(E.standings([-30,-10,-30,-100]),[{score:-10,seats:[1]},{score:-30,seats:[0,2]},{score:-100,seats:[3]}]);
  assert.deepEqual(E.standings([0,0,0,0]),[{score:0,seats:[0,1,2,3]}]);
});
test('rejects corrupt state with duplicated or missing cards',()=>{
  const s=ready(fresh());s.hands[0][0]=s.hands[1][0];assert.throws(()=>E.assertState(s),/duplikat/);
  const missing=ready(fresh());missing.hands[0].pop();assert.throws(()=>E.assertState(missing),/52/);
});
test('deterministic full sessions conserve 52 cards through ready, timeouts and alternating rounds',()=>{
  for(let offset=0;offset<4;offset++) {
    const cards=E.deck(),shifted=cards.slice(offset).concat(cards.slice(0,offset));
    let s=E.createSession(people(),shifted,0),now=0,actions=0;
    while(s.phase!=='session_end') {
      if(s.phase==='round_ready') {for(let i=0;i<4&&s.phase==='round_ready';i++) s=act(s,'ready',{},now,i);}
      else if(s.phase==='round_end') {now=s.roundEndUntil;s=act(endReady(s),'next_round',{deck:shifted},now);}
      else {now=s.deadline;s=act(s,'timeout',{},now);}
      E.assertState(s);assert.ok(++actions<4000);
    }
    assert.ok(s.scores.some(v=>v>=60)||s.round>=15);assert.ok(s.history.length>=10);
    assert.ok(s.history.every(h=>[...h.points].sort().join(',')==='1,3,4,6'));
    assert.deepEqual(s.scores,s.history.at(-1).totals);
  }
});

test('old acknowledged actions remain idempotent after later actions; IDs cannot be reused at a fresh revision',()=>{
  let s=fresh();
  const a={id:'old',uid:'u0',type:'ready',expectedRevision:s.revision};
  s=E.applyAction(s,a,0);s=act(s,'ready',{},0,1);
  assert.deepEqual(E.applyAction(s,a,0),s);
  assert.throws(()=>E.applyAction(s,{...a,expectedRevision:s.revision},0),/isi berbeda/);
});

test('round history records only committed plays in order and survives a cleared table and replay',()=>{
 let s=ready(fresh());const before=s;
 s=act(s,'play',{cards:cs('3D')});s=act(s,'play',{cards:cs('3C')});
 assert.deepEqual(s.roundPlays,[{trick:1,seat:0,uid:'u0',type:'single',cards:cs('3D')},{trick:1,seat:1,uid:'u1',type:'single',cards:cs('3C')}]);
 assert.deepEqual(before.roundPlays,[]);assert.equal(s.tableStart,0);
 assert.throws(()=>act(s,'play',{cards:cs('3D')}),/mil.|kuat/);assert.equal(s.roundPlays.length,2);
 for(let i=0;i<3;i++)s=act(s,'pass');assert.equal(s.table,null);assert.equal(s.roundPlays.length,2);assert.equal(s.tableStart,2);
 const a={id:'history_replay',uid:s.players[s.turn].uid,type:'play',cards:cs('4C'),expectedRevision:s.revision};
 s=E.applyAction(s,a,0);assert.equal(E.applyAction(s,a,0).roundPlays.length,3);assert.equal(s.tableStart,2);
 assert.ok(s.roundPlays.flatMap(x=>x.cards).every(c=>s.discard.some(d=>E.cardKey(c)===E.cardKey(d))));
});
test('timeout opening is recorded; winning play remains until next round resets the history',()=>{
 const timed=act(ready(fresh()),'timeout',{},45000);assert.deepEqual(timed.roundPlays[0].cards,cs('3D'));
 let s=completeThree(position(['3D','4C','6H','8S 9S']));
 assert.equal(s.phase,'round_end');assert.equal(s.roundPlays.length,3);
 s=act(endReady(s),'next_round',{deck:E.deck()});assert.deepEqual(s.roundPlays,[]);assert.equal(s.roundPlaysIncomplete,false);
});
test('legacy saved states can continue with explicitly partial history and no invented prior moves',()=>{
 let s=act(ready(fresh()),'play',{cards:cs('3D')});delete s.roundPlays;delete s.roundPlaysIncomplete;
 assert.doesNotThrow(()=>E.assertState(s));s=act(s,'play',{cards:cs('3C')});
 assert.equal(s.roundPlaysIncomplete,true);assert.deepEqual(s.roundPlays,[{trick:1,seat:1,uid:'u1',type:'single',cards:cs('3C')}]);
});
test('history validation rejects hidden-hand cards, duplicate cards and invalid player seats',()=>{
 let s=act(ready(fresh()),'play',{cards:cs('3D')});
 for(const entry of [{seat:0,type:'single',cards:cs('4D')},{seat:4,type:'single',cards:cs('3D')}]){const bad=structuredClone(s);bad.roundPlays=[entry];assert.throws(()=>E.assertState(bad));}
 s.roundPlays.push(structuredClone(s.roundPlays[0]));assert.throws(()=>E.assertState(s),/duplikat/);
});


test('winner pause lasts exactly seven seconds; an early next round is rejected without scoring twice',()=>{
 let s=completeThree(position(['3D','4C','6H','8S 9S']),100);
 assert.equal(s.roundEndUntil,7100);assert.equal(E.ROUND_PAUSE_MS,7000);
 assert.throws(()=>E.applyAction(s,{id:'too_early',uid:'u0',type:'next_round',deck:E.deck(),expectedRevision:s.revision},7099),/7 detik/);
 assert.equal(s.round,1);assert.equal(s.history.length,1);const scores=[...s.scores];
 s=act(endReady(s),'next_round',{deck:E.deck()},7100);assert.equal(s.phase,'playing');assert.equal(s.roundEndUntil,null);assert.deepEqual(s.scores,scores);assert.deepEqual(s.ready,[true,true,true,true]);
});

test('rounds one and two allow 45 seconds per turn; later rounds allow 30 seconds',()=>{
 assert.equal(E.TURN_MS,30000);assert.equal(E.ROUND_PAUSE_MS,7000);
 for(const round of [1,2,3,4]){
  const duration=round<=2?45000:30000;let s=fresh();s.round=round;s.direction=round%2?1:-1;s=ready(s);
  assert.equal(s.turnMs,duration);assert.equal(s.deadline,duration);
  s=act(s,'play',{cards:cs('3D')},20000);assert.equal(s.deadline,20000+duration);
  s=act(s,'pass',{},25000);assert.equal(s.deadline,25000+duration);
  assert.throws(()=>act(s,'timeout',{},s.deadline-1),/belum habis/);
  s=act(s,'timeout',{},s.deadline);assert.equal(s.deadline,25000+duration*2);
 }
});

test('round continuation requires human confirmations and resets them for each new deal',()=>{
 let s=completeThree(position(['3D','4C','6H','8S 9S']),100);
 const advance=()=>E.applyAction(s,{id:'blocked_next',uid:'u0',type:'next_round',deck:E.deck(),expectedRevision:s.revision},10000);
 assert.throws(advance,/Ready/);s=act(s,'confirm_round',{},500,1);s=act(s,'confirm_round',{},500,2);assert.throws(advance,/Ready/);
 s=act(s,'confirm_round',{},500,3);assert.throws(advance,/Ready/);s=act(s,'confirm_round',{},500,0);const scores=[...s.scores];s=E.applyAction(s,{id:'next_after_votes',uid:'u0',type:'next_round',deck:E.deck(),expectedRevision:s.revision},10000);
 assert.deepEqual(s.continueReady,[]);assert.deepEqual(s.scores,scores);assert.equal(s.phase,'playing');assert.equal(s.turn,0);assert.equal(s.openingRequired,true);
 assert.throws(()=>act(s,'confirm_round',{},10001,1),/setelah babak/);
});

test('all opponents passing never ends a babak or removes unplayed cards',()=>{
 for(const reverse of [false,true]){
  let s=position(['3D 8D','4C 8C','5H 8H','6S 8S']);if(reverse){s.direction=-1;s.round=2;}
  s=act(s,'play',{cards:cs('3D')});const hands=structuredClone(s.hands),scores=[...s.scores],discard=[...s.discard];
  for(let i=0;i<3;i++)s=act(s,'pass');assert.equal(s.phase,'playing');assert.equal(s.round,reverse?2:1);assert.equal(s.trick,2);assert.equal(s.turn,0);assert.equal(s.lastTrickWinner,0);assert.deepEqual(s.passed,[]);
  assert.deepEqual(s.hands,hands);assert.deepEqual(s.scores,scores);assert.deepEqual(s.discard,discard);assert.equal(s.history.length,0);assert.equal(s.winner,null);assert.equal(s.roundEndUntil,null);
  assert.throws(()=>act(s,'confirm_round',{},0,1),/setelah babak/);
 }
});
test('forged finishers and a premature result with cards remaining are rejected',()=>{
 let s=position(['3D 8D','4C 8C','5H 8H','6S 8S']);const fake=structuredClone(s);fake.phase='round_end';fake.winner=0;fake.deadline=null;assert.throws(()=>E.assertState(fake),/peringkat/);
 const empty=structuredClone(s);empty.discard.push(...empty.hands[1]);empty.hands[1]=[];assert.throws(()=>E.assertState(empty),/peringkat/);empty.finishOrder=[1];E.assertState(empty);empty.turn=1;assert.throws(()=>E.assertState(empty),/Giliran belum siap/);empty.phase='round_ready';empty.deadline=null;assert.throws(()=>E.assertState(empty),/tangan kosong/);
 assert.throws(()=>act(s,'finish_round'),/Jenis aksi/);
});

function completeThree(s,now=0){
 for(let i=0;i<3;i++)s=act(s,'play',{cards:[s.hands[s.turn][0]]},now);
 return s;
}
test('the third empty hand freezes the final table and awards points exactly once',()=>{
 let s=position(['3D','4C','6H','8S 9S']);
 s=act(s,'play',{cards:cs('3D')});assert.deepEqual(s.finishOrder,[0]);assert.equal(s.phase,'playing');
 s=act(s,'play',{cards:cs('4C')});assert.deepEqual(s.finishOrder,[0,1]);assert.deepEqual(s.scores,[0,0,0,0]);
 assert.deepEqual(E.placementView(s),{finishOrder:[0,1]});
 const action={id:'third_last_card',uid:'u2',type:'play',cards:cs('6H'),expectedRevision:s.revision};
 s=E.applyAction(s,action,100);
 assert.equal(s.phase,'round_end');assert.equal(s.winner,0);assert.equal(s.deadline,null);assert.deepEqual(s.table,{seat:2,cards:cs('6H')});
 assert.deepEqual(E.placementView(s),{finishOrder:[0,1,2],revealedHand:{seat:3,cards:cs('8S 9S')}});
 assert.deepEqual(s.history.at(-1).placements,[0,1,2,3]);assert.deepEqual(s.history.at(-1).points,[6,4,3,1]);assert.deepEqual(s.scores,[6,4,3,1]);
 assert.deepEqual(E.applyAction(s,action,200),s);assert.throws(()=>act(s,'pass'),/giliran/);
});
test('an empty-handed bomb owner can flip after all active opponents pass; next live seat opens',()=>{
 let s=position(['7D 7C 7H 7S KD','4C','5H','6S']);s.round=2;s.direction=-1;
 s=act(s,'play',{cards:cs('7D 7C 7H 7S KD')});assert.deepEqual(s.finishOrder,[0]);assert.equal(s.turn,3);
 for(let i=0;i<3;i++)s=act(s,'pass');assert.equal(s.phase,'bomb_choice');assert.equal(s.turn,0);
 s=act(s,'choose_bomb',{flip:true});assert.equal(s.reversed,true);assert.equal(s.turn,3);assert.deepEqual(s.passed,[]);assert.equal(s.table,null);
 s=act(s,'play',{cards:cs('6S')});assert.equal(s.turn,2);
 s=act(s,'pass');s=act(s,'pass');assert.equal(s.turn,2);assert.equal(s.table,null);
 s=act(s,'play',{cards:cs('5H')});assert.deepEqual(s.finishOrder,[0,3,2]);assert.deepEqual(s.scores,[6,1,3,4]);
});
test('a bomb that finishes the third player freezes immediately without a reverse prompt',()=>{
 const s=position(['3D','4C','7D 7C 7H 7S KD','8S 9S']);
 s.discard.push(...s.hands[0],...s.hands[1]);s.hands[0]=[];s.hands[1]=[];s.finishOrder=[0,1];s.turn=2;
 const end=act(s,'play',{cards:s.hands[2]});assert.equal(end.phase,'round_end');assert.equal(end.table.cards.length,5);assert.equal(end.deadline,null);
});
test('session stops at exactly 60 points or above; standings sort positive totals highest first',()=>{
 for(const prior of [54,57]){
  let s=position(['3D','4C','6H','9S']);s.scores=[prior,0,0,0];s=completeThree(s);
  assert.equal(s.phase,'session_end');assert.equal(s.endReason,'score_limit');assert.equal(s.scores[0],prior+6);
  assert.deepEqual(E.standings(s.scores).map(g=>g.score),[prior+6,4,3,1]);
 }
});
test('fifteenth completed game ends the session even when no player reaches 60',()=>{
 let scores=[0,0,0,0],history=[];
 for(let n=1;n<=15;n++){
  const first=(n-1)%4,dir=n%2?1:-1,hands=[];
  for(const [i,key] of ['3D','4C','6H','9S'].entries())hands[(first+dir*i+8)%4]=key;
  let s=position(hands);s.round=n;s.direction=dir;s.turn=first;s.scores=scores;s.history=history;s=completeThree(s);
  assert.equal(s.phase,n===15?'session_end':'round_end');scores=s.scores;history=s.history;
  if(n===15){assert.equal(s.endReason,'game_limit');assert.ok(scores.every(n=>n<60));assert.equal(history.length,15);}
 }
});
test('legacy positive scoring migrates once and restores an old 250-limit result for continuation',()=>{
 let s=position(['3D','4C','6H','9S'],null,false,true);s=act(s,'play',{cards:cs('3D')});delete s.scoringVersion;s.round=6;s.direction=-1;s.phase='session_end';s.scores=[130,260,100,140];
 s.history=s.history.map(h=>({...h,penalties:h.penalties.map(n=>Math.abs(n)),totals:[130,260,100,140]}));const original=structuredClone(s);
 const next=E.migrateScoring(s);assert.deepEqual(s,original);assert.deepEqual(next.scores,[-130,-260,-100,-140]);assert.equal(next.phase,'round_end');assert.equal(next.scoringVersion,2);assert.deepEqual(next.hands,s.hands);assert.deepEqual(next.history[0].penalties,[0,-10,-10,-10]);
 assert.deepEqual(E.migrateScoring(next),next);assert.doesNotThrow(()=>E.assertState(next));
});
