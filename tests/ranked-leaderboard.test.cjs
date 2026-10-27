const test=require('node:test'),assert=require('node:assert/strict');
const L=require('../ranked-leaderboard.js');
const ID='a'.repeat(32);
function room(game='remi',size=4){
 const players={},seats={},profiles={};
 for(let s=0;s<size;s++){const uid='p'+s;players[uid]={uid,seat:s,isBot:false,username:uid,nickname:'Player '+s};seats[s]=uid;profiles[uid]={authUid:uid,username:uid};}
 return {r:{code:'ZZ0I',game,phase:L.END[game],players,seats,totals:Object.fromEntries(Object.values(players).map(p=>[p.seat,100-p.seat])),
  remi:{roundNumber:10,endReason:'closed',handPenalty:{0:0,1:0,2:0,3:0}},
  tebak:{roundNumber:10,roundRanks:Object.fromEntries(Object.values(players).map(p=>[p.seat,p.seat+1])),roundPoints:Object.fromEntries(Object.values(players).map(p=>[p.seat,size-p.seat]))},
  cangkul:{sessionNumber:1,eliminationOrder:Array.from({length:size},(_,i)=>i),finalScores:Object.fromEntries(Object.values(players).map(p=>[p.seat,size-p.seat]))},
  gameState:{session:1},sessionResult:{sessionNumber:1,deltas:{0:5,1:4,2:3,3:1}},play:{trickNumber:13,tricksWon:{0:13,1:0,2:0,3:0}}},profiles};
}
function ready(game='remi',size=4){const {r,profiles}=room(game,size),record=L.newRecord(r,profiles,1);record.result=L.resultFor(r,record,2);record.votes=Object.fromEntries(Object.keys(record.memberSeats).map(uid=>[uid,true]));return{r,record};}
test('all four games build deterministic final-rank results',()=>{
 for(const [game,size] of [['truf',4],['remi',4],['tebak',6],['cangkul',3]]){const {record}=ready(game,size);assert.ok(record.result,game);assert.deepEqual(Object.values(record.result.entries).map(e=>e.points),Array.from({length:size},(_,i)=>size-i));}
});
test('bots, duplicate users and profiles belonging to another UID are ineligible',()=>{
 const {r,profiles}=room();r.players.p0.isBot=true;assert.equal(L.newRecord(r,profiles,1),null);r.players.p0.isBot=false;
 profiles.p0.authUid='other';assert.equal(L.newRecord(r,profiles,1),null);profiles.p0.authUid='p0';r.players.p1.username='p0';assert.equal(L.newRecord(r,profiles,1),null);
});
test('lobby, mid-game and merely setting the final phase cannot count as completed',()=>{
 const {r}=room();r.phase='lobby';assert.equal(L.completedMatch(r),false);r.phase='playing';assert.equal(L.completedMatch(r),false);
 r.phase=L.END.remi;delete r.remi.endReason;assert.equal(L.completedMatch(r),false);
});
test('Remi minimum rounds and genuine point-cap exception are checked',()=>{
 const {r}=room();r.remi.roundNumber=9;assert.equal(L.completedMatch(r),false);r.remi.matchOverReason='points';assert.equal(L.completedMatch(r),false);
 r.totals[0]=1000;assert.equal(L.completedMatch(r),true);
});
test('Tebak cannot count an unfinished tenth round with cards still drawable',()=>{
 const {r}=room('tebak');r.tebak.deck=[{rank:'K',suit:'H'}];assert.equal(L.completedMatch(r),false);r.tebak.deck=[];
 r.tebak.hands={0:[{}],1:[{}]};assert.equal(L.completedMatch(r),false);
});
test('Truf and Cangkul require actual terminal score/card structures',()=>{
 const tr=room('truf').r;tr.hands={0:[{rank:'K',suit:'H'}]};assert.equal(L.completedMatch(tr),false);
 const ca=room('cangkul',3).r;ca.cangkul.eliminationOrder=[0,0,2];assert.equal(L.completedMatch(ca),false);
});
test('changing participants or replacing a human with a bot invalidates the result',()=>{
 const {r,record}=ready();r.players.p1.uid='other';assert.equal(L.resultFor(r,record,2),null);r.players.p1.uid='p1';r.players.p1.isBot=true;assert.equal(L.resultFor(r,record,2),null);
});
test('ties use seat order consistently and fractional/string scores are rejected',()=>{
 const {r,record}=ready();r.totals={0:10,1:10,2:10,3:10};assert.deepEqual(Object.values(L.resultFor(r,record,2).entries).map(e=>e.points),[4,3,2,1]);
 r.totals[0]='100';assert.equal(L.resultFor(r,record,2),null);
});
test('one negative or missing vote prevents preparing leaderboard credits',()=>{
 const {record}=ready();delete record.votes.p2;assert.equal(L.stateOf(record),'pending');assert.throws(()=>L.awardPatch(ID,record,{},3));
 record.votes.p2=false;assert.equal(L.stateOf(record),'rejected');assert.throws(()=>L.awardPatch(ID,record,{},3));
});
test('one award packet contains every row, one permanent receipt and pending cleanup',()=>{
 const {record}=ready();const patch=L.awardPatch(ID,record,{},3);assert.equal(Object.keys(patch).length,9);
 assert.equal(patch['leaderboards/remi/p0'].matches,1);assert.equal(patch['leaderboards/remi/p0'].points,4);assert.equal(patch['rankedPending/p3/'+ID],null);
 assert.equal(patch['rankedAwards/'+ID].srcMatch,ID);
});
test('existing totals survive and the fifth-match bonus is applied exactly once per packet',()=>{
 const {record}=ready();const patch=L.awardPatch(ID,record,{p0:{matches:4,points:20}},3);
 assert.equal(patch['leaderboards/remi/p0'].matches,5);assert.equal(patch['leaderboards/remi/p0'].points,29);
 assert.throws(()=>L.awardPatch(ID,record,{p0:{authUid:'someone-else',matches:4,points:20}},3));
});
