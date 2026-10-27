/* Actual client + actual app start handlers + actual local RTDB rules.
 * Only synthetic demo identities. No production credentials, traffic or data.
 */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict');
const Client=require('../ranked-client.js'),L=require('../ranked-leaderboard.js'),Membership=require('../room-membership.js');
const {scripts}=require('../scripts/check-render-safety.cjs');
const html=fs.readFileSync(path.join(__dirname,'../truf-multiplayer-v3.html'),'utf8'),parsed=scripts(html);
const BASE='http://127.0.0.1:19000',NS='demo-main-kartu-host',ID='c'.repeat(32);
function token(uid){const b=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),now=Math.floor(Date.now()/1000);return b({alg:'none',typ:'JWT'})+'.'+b({sub:uid,user_id:uid,aud:NS,iss:'https://securetoken.google.com/'+NS,iat:now,exp:now+3600,firebase:{sign_in_provider:'password'}})+'.';}
async function rpc(uid,route,method='GET',body){
  const url=new URL(BASE+'/'+route+'.json');url.searchParams.set('ns',NS);
  const headers={'Content-Type':'application/json'};
  if(uid==='OWNER')headers.Authorization='Bearer owner';else url.searchParams.set('auth',token(uid));
  const result=await fetch(url,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const value=await result.json();
  if(!result.ok){const error=Error('Local emulator '+result.status+': '+JSON.stringify(value));error.code=result.status===401?'PERMISSION_DENIED':'TEST_REQUEST_FAILED';throw error;}
  return value;
}
function fixture(game,size){
  const people={},seats={},accounts={};
  for(let s=0;s<size;s++){const uid='p'+s;people[uid]={uid,seat:s,username:uid,nickname:'P'+s,isBot:false,lastSeen:Date.now()};seats[s]=uid;accounts[uid]={authUid:uid,username:uid,name:'P'+s};}
  return{rooms:{ZZ0I:{code:'ZZ0I',game,phase:'lobby',host:'p0',membershipVersion:2,maxPlayers:size,players:people,seats}},accounts,config:{leaderboardContract:3}};
}
function transport(uid,controls={}){
  const snapshot=value=>({exists:()=>value!=null,val:()=>value});
  const raw={db:{},ref:(_,p='')=>({path:p,toString:()=> 'https://local.invalid/'+p}),
    get:async r=>snapshot(await rpc(uid,r.path)),set:async(r,v)=>rpc(uid,r.path,'PUT',v),remove:async r=>rpc(uid,r.path,'DELETE'),
    update:async(r,v)=>{
      const award=Object.keys(v).some(k=>k.startsWith('rankedAwards/'));
      if(award&&controls.failBefore>0){controls.failBefore--;throw Error('simulated offline');}
      const result=await rpc(uid,r.path,'PATCH',v);
      if(award){controls.awards=(controls.awards||0)+1;if(controls.loseAck){controls.loseAck=false;throw Error('simulated lost acknowledgement');}}
      return result;
    }};
  return {...raw,...Membership.databaseBridge(raw),authUid:uid,
    onValue:()=>()=>{},serverTimestamp:()=>({'.sv':'timestamp'})};
}
function source(name){for(const {ast,code}of parsed){const n=ast.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);if(n)return code.slice(n.start,n.end);}throw Error('Missing '+name);}
async function actualStart(game,size,client,fb){
  const errors=[];
  const env={console:{log:()=>{},warn:()=>{},error:(...e)=>errors.push(e.map(String).join(' '))},Math,Date,Set,Map,
    fb,currentRoom:'ZZ0I',myUid:'p0',MAX_PLAYERS:4,
    SUITS:['S','H','C','D'],RANKS:['2','3','4','5','6','7','8','9','10','J','Q','K','A'],
    setBtnLoading:()=>{},showLobbyStatus:msg=>errors.push(msg),resetHostTrackers:()=>{},
    getRankedClient:()=>client,sortCardCompare:()=>0,sortCangkulCardCompare:()=>0};
  const context=vm.createContext(env);
  for(const name of ['handleStartGame','handleStartRemi','handleStartCangkul','handleStartTebak','generateShuffledDeck','generateCekiDeck','generateCangkulDeck','generateTebakDeck','extractFourOfAKind'])vm.runInContext(source(name),context);
  await env.handleStartGame();assert.deepEqual(errors,[],game+' app start');
  const room=await rpc('p0','rooms/ZZ0I');assert.equal(room.rankedMatchId,ID);assert.equal(room.phase,game==='truf'?'bidding':'playing');
  assert.equal(Object.keys(room.players).length,size);
  const state=room[game]||room;
  assert.ok(state.hands||room.hands,'actual deck/hand payload accepted');
  return room;
}
async function makeFinished(game,size){
  const final={phase:L.END[game],totals:Object.fromEntries(Array.from({length:size},(_,s)=>[s,100-s]))};
  if(game==='remi')final.remi={roundNumber:10,endReason:'closed',handPenalty:{0:0,1:0,2:0,3:0}};
  else if(game==='tebak')final.tebak={roundNumber:10,roundRanks:Object.fromEntries(Array.from({length:size},(_,s)=>[s,s+1])),roundPoints:Object.fromEntries(Array.from({length:size},(_,s)=>[s,size-s]))};
  else if(game==='cangkul')final.cangkul={sessionNumber:1,eliminationOrder:Array.from({length:size},(_,s)=>s),finalScores:Object.fromEntries(Array.from({length:size},(_,s)=>[s,size-s]))};
  else Object.assign(final,{hands:null,gameState:{session:1},sessionResult:{sessionNumber:1,deltas:{0:0,1:0,2:0,3:0}},play:{trickNumber:13,tricksWon:{0:13,1:0,2:0,3:0}}});
  await rpc('OWNER','rooms/ZZ0I','PATCH',final);return rpc('p0','rooms/ZZ0I');
}
async function setup(game='remi',size=4,controls={}){
  await rpc('OWNER','','PUT',fixture(game,size));
  const fb=transport('p0',controls),client=Client.create(fb,{randomId:()=>ID});client.start();
  await actualStart(game,size,client,fb);
  const room=await makeFinished(game,size);await client.propose(room);
  return {fb,client,room,controls};
}
async function approveDirect(size,start=0){for(let s=start;s<size;s++)await rpc('p'+s,'rankedMatches/'+ID+'/votes/p'+s,'PUT',true);}
(async()=>{
  await rpc('OWNER','.settings/rules','PUT',JSON.parse(fs.readFileSync(path.join(__dirname,'../database.rules.json'),'utf8')));
  for(const [game,size]of [['truf',4],['remi',4],['cangkul',3],['cangkul',6],['tebak',4],['tebak',6]]){
    const {client}=await setup(game,size);
    for(let s=0;s<size;s++){
      const peer=Client.create(transport('p'+s));peer.start();await peer.vote(ID,true);peer.stop();
    }
    assert.equal((await rpc('p0','leaderboards/'+game+'/p0')).matches,1);
    assert.equal(await client.finalize(ID),true);
    assert.equal((await rpc('p0','leaderboards/'+game+'/p0')).matches,1);client.stop();
    console.log('PASS actual '+game+' start → frozen result → '+size+' signed approvals → single award');
  }
  {
    const h=await setup('remi',4,{loseAck:true});await approveDirect(4);assert.equal(await h.client.finalize(ID),true);
    assert.equal(h.controls.awards,1);assert.equal((await rpc('p0','leaderboards/remi/p0')).matches,1);h.client.stop();
    console.log('PASS server committed but acknowledgement lost: read receipt, no duplicate');
  }
  {
    const h=await setup('remi',4,{failBefore:4});await approveDirect(4);await assert.rejects(h.client.finalize(ID));
    assert.equal(await rpc('p0','rankedAwards/'+ID),null);assert.equal(await rpc('p0','leaderboards/remi/p0'),null);
    h.controls.failBefore=0;await h.client.retry(ID);assert.equal((await rpc('p0','leaderboards/remi/p0')).matches,1);h.client.stop();
    console.log('PASS failed award consumes no credit; later explicit retry succeeds');
  }
  {
    const h=await setup();await approveDirect(4);const peer=Client.create(transport('p1'));peer.start();
    await Promise.all([h.client.finalize(ID),peer.finalize(ID)]);
    assert.equal((await rpc('p0','leaderboards/remi/p0')).matches,1);h.client.stop();peer.stop();
    console.log('PASS simultaneous coordinators record exactly one award');
  }
  {
    const h=await setup();await rpc('OWNER','rooms/ZZ0I','DELETE');await approveDirect(4);
    const survivor=Client.create(transport('p2'));survivor.start();await survivor.retry(ID);
    assert.equal((await rpc('p0','leaderboards/remi/p0')).matches,1);survivor.stop();h.client.stop();
    console.log('PASS original participant recovers result after room deletion and host departure');
  }
  {
    const h=await setup();await h.client.vote(ID,false);
    const peer=Client.create(transport('p1'));peer.start();await peer.retry(ID);await peer.retry(ID);
    assert.equal(await rpc('p0','rankedPending/p0'),null);assert.equal(await rpc('p0','leaderboards/remi/p0'),null);
    assert.equal(await rpc('p0','rankedAwards/'+ID),null);h.client.stop();peer.stop();
    console.log('PASS rejection cleanup is idempotent across participants and retries');
  }
  {
    const h=await setup();await h.client.vote(ID,true);await h.client.vote(ID,true);
    await assert.rejects(h.client.vote(ID,false));assert.equal((await rpc('p0','rankedMatches/'+ID)).votes.p0,true);
    await approveDirect(4,1);await h.client.finalize(ID);assert.equal((await rpc('p0','leaderboards/remi/p0')).matches,1);h.client.stop();
    console.log('PASS repeated identical approval is safe; changing a signed decision is refused');
  }
  console.log('12 local client/rules integration scenarios passed.');
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
