const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const G=require('../scripts/capsa-local-server.cjs');
const enabled=process.env.CAPSA_LOCAL_TEST==='1',BASE='http://127.0.0.1:19000',API='http://127.0.0.1:18844',NS=G.PROJECT;
async function db(p,method='GET',value,token='owner'){
  const headers={'Content-Type':'application/json'};if(token==='owner')headers.Authorization='Bearer owner';
  const r=await fetch(`${BASE}/${p}.json?ns=${NS}${token&&token!=='owner'?'&auth='+token:''}`,{method,headers,body:value===undefined?undefined:JSON.stringify(value)});
  return {status:r.status,data:await r.json()};
}
async function account(i){
  const r=await fetch('http://127.0.0.1:19099/identitytoolkit.googleapis.com/v1/accounts:signUp?key='+NS,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:`captest-${Date.now()}-${i}@mainkartu.local`,password:'Local-test-492!',returnSecureToken:true})});
  assert.equal(r.status,200);const a=await r.json();return {uid:a.localId,token:a.idToken};
}
async function call(code,user,data,origin=API){
  const r=await fetch(`${API}/capsa-api/rooms/${code}`,{method:data?'POST':'GET',headers:{Authorization:'Bearer '+(user?.token||''),'Content-Type':'application/json',Origin:origin},body:data?JSON.stringify(data):undefined});return {status:r.status,data:await r.json()};
}
function packet(view,type,extra={}){return {type,id:'test_'+crypto.randomUUID(),matchId:view.matchId,expectedRevision:view.revision,...extra};}

test('Capsa HTTP + official Auth/RTDB emulators',{skip:!enabled},async t=>{
  const users=await Promise.all(Array.from({length:5},(_,i)=>account(i)));
  const allocated=[];
  async function fixture(humans=4){
    let code;
    do{code='T'+crypto.randomBytes(2).toString('hex').slice(0,3).toUpperCase();}while(allocated.includes(code)||(await db('rooms/'+code)).data);
    allocated.push(code);const players={},seats={};
    for(let i=0;i<humans;i++){const u=users[i];players[u.uid]={uid:u.uid,seat:i,isBot:false,nickname:'Player'+i,lastSeen:Date.now()};seats[i]=u.uid;}
    assert.equal((await db('rooms/'+code,'PUT',{game:'capsa',phase:'lobby',host:users[0].uid,players,seats,maxPlayers:4,membershipVersion:2,createdAt:Date.now(),code})).status,200);
    const r=await call(code,users[0],{type:'start'});assert.equal(r.status,200,JSON.stringify(r.data));return {code,view:r.data};
  }
  async function readyAll(code){let v;for(let i=0;i<4;i++){v=(await call(code,users[i])).data;assert.equal((await call(code,users[i],packet(v,'ready'))).status,200);}return (await call(code,users[0])).data;}
  await t.test('requires real local login, rejects foreign origin and nonmembers',async()=>{
    const {code}=await fixture();assert.equal((await call(code,null)).status,401);assert.equal((await call(code,users[4])).status,403);
    assert.equal((await call(code,users[0],{type:'start'},'https://example.com')).status,403);
  });
  await t.test('each player receives only own hand and public counts; database parent/private reads denied',async()=>{
    const {code}=await fixture();const views=await Promise.all(users.slice(0,4).map(u=>call(code,u)));
    const keys=views.flatMap(v=>v.data.hand.map(c=>c.rank+c.suit));assert.equal(new Set(keys).size,52);
    for(const v of views){assert.equal(v.data.hand.length,13);assert.deepEqual(v.data.counts,[13,13,13,13]);assert.equal(v.data.hands,undefined);assert.equal(v.data.receipts,undefined);}
    for(const token of [null,users[0].token,users[4].token]){
      assert.equal((await db('capsaPrivate/'+code,'GET',undefined,token)).status,401);
      assert.equal((await db('capsaPrivate','GET',undefined,token)).status,401);
    }
    const publicRoom=(await db('rooms/'+code,'GET',undefined,null)).data;
    assert.equal(publicRoom.hands,undefined);assert.equal(publicRoom.gameState.hands,undefined);assert.equal(publicRoom.capsa,undefined);
    assert.equal((await db('capsaPrivate/'+code+'/snapshot','PUT','forged',users[0].token)).status,401);
  });
  await t.test('host cannot forge phase, revision or game through inherited room writes',async()=>{
    const {code}=await fixture();for(const update of [{phase:'capsa_session_end'},{capsaRevision:999},{game:'remi'}])assert.equal((await db('rooms/'+code,'PATCH',update,users[0].token)).status,401);
  });
  await t.test('Ready requires each real player; forged UID and client timestamp do not act for another seat',async()=>{
    const {code,view}=await fixture();const r=await call(code,users[0],packet(view,'ready',{uid:users[1].uid,now:1}));
    assert.equal(r.status,200);assert.deepEqual(r.data.ready,[true,false,false,false]);assert.equal(r.data.deadline,null);
    assert.equal((await call(code,users[0],packet(r.data,'timeout',{now:1e99}))).status,400);
  });
  await t.test('start restricted to host and fills missing seats with bots without creating ranked match',async()=>{
    const {code,view}=await fixture(1);assert.equal(view.players.filter(p=>p.isBot).length,3);assert.deepEqual(view.ready,[false,true,true,true]);
    assert.equal((await db('rooms/'+code+'/rankedMatchId')).data,null);assert.equal((await db('rankedMatches')).data,null);
    assert.equal((await call(code,users[4],{type:'start'})).status,403);
  });
  await t.test('duplicate/retried play applies once; two conflicting requests produce one revision',async()=>{
    const {code}=await fixture();const v=await readyAll(code),turn=v.turn,u=users[turn],own=(await call(code,u)).data;
    const a=packet(own,'play',{cards:[own.hand.find(c=>c.rank==='3'&&c.suit==='D')]});
    const [first,second]=await Promise.all([call(code,u,a),call(code,u,a)]);assert.equal(first.status,200);assert.equal(second.status,200);
    const after=(await call(code,u)).data;assert.equal(after.revision,own.revision+1);assert.equal(after.hand.length,12);
    const nextUser=users[after.turn],other=(await call(code,nextUser)).data;
    const [x,y]=await Promise.all([call(code,nextUser,packet(other,'pass')),call(code,nextUser,packet(other,'pass'))]);
    assert.deepEqual([x.status,y.status].sort(),[200,409]);assert.equal((await call(code,u)).data.revision,after.revision+1);
  });
  await t.test('rejects wrong turn, unowned cards, stale session and triple',async()=>{
    const {code}=await fixture();const v=await readyAll(code),bad=users[(v.turn+1)%4];
    assert.equal((await call(code,bad,packet(v,'play',{cards:[{rank:'3',suit:'D'}]}))).status,400);
    const own=(await call(code,users[v.turn])).data,other=(await call(code,bad)).data;
    assert.equal((await call(code,users[v.turn],packet(own,'play',{cards:[other.hand[0]]}))).status,400);
    assert.equal((await call(code,users[v.turn],packet(own,'pass',{matchId:'old-session'}))).status,409);
    assert.equal((await call(code,users[v.turn],packet(own,'play',{cards:own.hand.slice(0,3)}))).status,400);
  });
  await t.test('save freezes state, survives gateway reads and resume restarts deadline without changing hands',async()=>{
    const {code}=await fixture();const v=await readyAll(code);
    await db('rooms/'+code+'/savedGame','PUT',{status:'saved',id:'local-save',lastAccessAt:Date.now()});
    await G.drive();const paused=(await call(code,users[0])).data;
    assert.equal(paused.frozen,true);assert.equal(paused.deadline,null);assert.equal(paused.revision,v.revision);
    assert.equal((await call(code,users[v.turn],packet(v,'pass'))).status,409);
    await db('rooms/'+code+'/savedGame','DELETE');await G.drive();const resumed=(await call(code,users[0])).data;
    assert.equal(resumed.frozen,false);assert.deepEqual(resumed.hand,paused.hand);assert.equal(resumed.revision,v.revision);
    assert.ok(resumed.deadline>Date.now()+28000);
  });
  await t.test('host change preserves authoritative hand and nonhost cannot deal a new round',async()=>{
    const {code}=await fixture();const before=(await call(code,users[1])).data;await db('rooms/'+code+'/host','PUT',users[1].uid);
    const after=(await call(code,users[1])).data;assert.deepEqual(after.hand,before.hand);assert.equal(after.matchId,before.matchId);
    assert.equal((await call(code,users[0],packet(after,'next_round'))).status,403);
  });
  await t.test('deleted room never exposes orphaned hands and driver removes private state',async()=>{
    const {code}=await fixture();await db('rooms/'+code,'DELETE');assert.equal((await call(code,users[0])).status,404);await G.drive();assert.equal((await db('capsaPrivate/'+code)).data,null);
  });
  await t.test('reused room code cannot recover a previous room generation private state',async()=>{
    const {code}=await fixture();await db('rooms/'+code+'/createdAt','PUT',Date.now()+1000);
    assert.equal((await call(code,users[0])).status,404);await G.drive();assert.equal((await db('capsaPrivate/'+code)).data,null);
  });
  await t.test('static server blocks source/config files while both deep links resolve',async()=>{
    for(const route of ['/capsa','/capsa/ABCD'])assert.equal((await fetch(API+route)).status,200);
    for(const route of ['/database.local.rules.json','/firebase.local.json','/scripts/capsa-local-server.cjs','/docs/CAPSA_ENGINE.md'])assert.equal((await fetch(API+route)).status,404);
  });
  for(const code of allocated){
    const room=(await db('rooms/'+code)).data;
    if(room&&!users.some(u=>u.uid===room.host))continue;
    await db('rooms/'+code,'DELETE');await db('capsaPrivate/'+code,'DELETE');
  }
  for(const user of users){
    const r=await fetch('http://127.0.0.1:19099/identitytoolkit.googleapis.com/v1/accounts:delete?key='+NS,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:user.token})});
    assert.equal(r.status,200,'Temporary test account cleanup failed');
  }
});
