/* Emulator-only authoritative Capsa gateway + allowlisted static server.
 * Bind address, project and emulator addresses deliberately are not configurable.
 * REST ETag CAS atomically checks membership/save state and updates hidden state.
 * https://firebase.google.com/docs/database/rest/save-data#section-conditional-requests
 */
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const E=require('../capsa-engine.js'),Names=require('../bot-names.js');
const {move:botMove}=require('../capsa-bot.js');
const PROJECT='demo-main-kartu-v44',PORT=18844,BASE='http://127.0.0.1:19000',AUTH='http://127.0.0.1:19099';
const ROOT=path.resolve(__dirname,'..');
const origins=new Set([`http://127.0.0.1:${PORT}`,`http://localhost:${PORT}`]);
const check=(ok,msg,status=400)=>{if(!ok){const e=Error(msg);e.status=status;throw e;}};
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
const clone=value=>JSON.parse(JSON.stringify(value));
async function database(method='GET',data,etag){
  const r=await fetch(`${BASE}/.json?ns=${PROJECT}`,{method,headers:{Authorization:'Bearer owner',...(method==='GET'?{'X-Firebase-ETag':'true'}:{}),...(etag?{'if-match':etag}:{}),'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(5000)});
  if(r.status===412)return null;
  check(r.ok,'Emulator database belum tersedia.',503);
  return {value:await r.json()||{},etag:r.headers.get('etag')};
}
async function transact(fn){
  for(let i=0;i<20;i++){
    const snap=await database();const changed=await fn(snap.value);
    if(changed===false)return snap.value;
    if(await database('PUT',snap.value,snap.etag))return snap.value;
  }
  check(false,'Room sedang berubah. Coba lagi.',409);
}
function shuffled(){const a=E.deck();for(let i=a.length-1;i>0;i--){const j=crypto.randomInt(i+1);[a[i],a[j]]=[a[j],a[i]];}return a;}
function load(root,code){const saved=root.capsaPrivate?.[code];return saved&&saved.createdAt===root.rooms?.[code]?.createdAt?{record:saved,state:E.migrateScoring(JSON.parse(saved.snapshot))}:null;}
function member(room,uid){const p=room?.players?.[uid];check(p&&p.isBot===false&&room.seats?.[p.seat]===uid,'Anda bukan pemain manusia di room ini.',403);return p;}
function authorize(room,state,uid){const p=member(room,uid);check(state.players[p.seat]?.uid===uid,'Kursi tidak cocok dengan roster asli.',403);return p;}
function projection(root,code,uid){
  const room=root.rooms?.[code],item=load(root,code);check(room&&item,'Game belum tersedia.',404);
  const p=authorize(room,item.state,uid),s=item.state;
  return {matchId:item.record.matchId,phase:s.phase,revision:s.revision,rulesVersion:s.rulesVersion,scoringVersion:s.scoringVersion,...E.placementView(s),endReason:s.endReason??null,round:s.round,trick:s.trick||1,lastTrickWinner:s.lastTrickWinner??null,turn:s.turn,turnMs:s.turnMs??null,
    reversed:s.reversed,direction:s.direction,ready:s.ready,continueReady:s.continueReady||[],counts:s.hands.map(h=>h.length),table:s.table,passed:s.passed,
    roundPlays:s.roundPlays||[],tableStart:s.tableStart??null,roundPlaysIncomplete:s.roundPlaysIncomplete??s.discard.length>0,
    scores:s.scores,history:s.history,winner:s.winner,roundEndUntil:s.roundEndUntil??null,deadline:room.savedGame?null:s.deadline,serverNow:Date.now(),
    frozen:!!room.savedGame,hand:s.hands[p.seat],seat:p.seat,
    players:s.players.map((v,i)=>({uid:v.uid,seat:i,isBot:!!room.players?.[v.uid]?.isBot,nickname:room.players?.[v.uid]?.nickname||`Pemain ${i+1}`}))};
}
function store(root,code,record,s){
  record.snapshot=JSON.stringify(s);root.capsaPrivate[code]=record;
  root.rooms[code].phase='capsa_'+s.phase;root.rooms[code].capsaRevision=s.revision;
}
function started(root,code,uid){
  const room=root.rooms?.[code];check(room?.game==='capsa','Room Capsa tidak ditemukan.',404);member(room,uid);
  check(room.host===uid,'Hanya host yang memulai.',403);check(!room.savedGame,'Game sedang disimpan.',409);
  const old=load(root,code);check(!old||old.state.phase==='session_end','Sesi masih berjalan.',409);check(!old||!(old.state.roundEndUntil>Date.now()),'Tunggu jeda akhir ronde 7 detik.',409);
  check(room.phase==='lobby'||old?.state.phase==='session_end','Fase room berubah.',409);
  const ps=Object.values(room.players||{});check(ps.every(p=>Number.isInteger(p.seat)&&p.seat>=0&&p.seat<4)&&new Set(ps.map(p=>p.seat)).size===ps.length,'Kursi tidak valid.');
  for(let i=0;i<4;i++)if(!ps.some(p=>p.seat===i)){
    const id='capsabot_'+crypto.randomBytes(6).toString('hex');const bot={uid:id,seat:i,isBot:true,nickname:Names.pick(ps.map(player=>player.nickname)),lastSeen:0};
    room.players[id]=bot;room.seats[i]=id;ps.push(bot);
  }
  const sorted=ps.sort((a,b)=>a.seat-b.seat);check(sorted.length===4,'Capsa memerlukan empat kursi.');
  const s=E.createSession(sorted.map(p=>({uid:p.uid,isBot:p.isBot})),shuffled(),Date.now());
  room.maxPlayers=4;room.gameState={roster:Object.fromEntries(sorted.map(p=>[p.seat,{uid:p.uid,isBot:p.isBot,nickname:p.nickname}]))};
  delete room.rankedMatchId;root.capsaPrivate??={};
  store(root,code,{matchId:crypto.randomUUID(),createdAt:room.createdAt,snapshot:'',paused:false},s);
}
function apply(root,code,uid,input){
  const room=root.rooms?.[code],item=load(root,code);check(room?.game==='capsa'&&item,'Game belum tersedia.',404);
  authorize(room,item.state,uid);check(!room.savedGame,'Game sedang dibekukan untuk simpan/lanjut.',409);
  check(input.matchId===item.record.matchId,'Sesi game sudah berganti. Muat ulang.',409);
  check(['ready','confirm_round','play','pass','choose_bomb','next_round'].includes(input.type),'Aksi tidak diizinkan.');
  if(input.type==='next_round')check(room.host===uid,'Hanya host yang membagikan ronde berikutnya.',403);
  const action={id:input.id,uid,expectedRevision:input.expectedRevision,type:input.type};
  if(input.type==='play')action.cards=input.cards;
  if(input.type==='choose_bomb')action.flip=input.flip;
  if(input.type==='next_round')action.deck=shuffled();
  // For next-round retries use the original server-generated shuffled deck.
  if(input.type==='next_round'){
    const receipt=item.state.receipts.find(r=>r.id===input.id);
    if(receipt){const args=JSON.parse(receipt.fingerprint);action.deck=args[5];}
  }
  let s;
  try{s=E.applyAction(item.state,action,Date.now());}catch(e){e.status=/Revisi|sudah habis/.test(e.message)?409:400;throw e;}
  store(root,code,item.record,s);
}
async function drive(){
  await transact(root=>{
    let changed=false;
    for(const [code,record]of Object.entries(root.capsaPrivate||{})){
      const room=root.rooms?.[code];
      if(!room||record.createdAt!==room.createdAt){delete root.capsaPrivate[code];changed=true;continue;}
      const previous=JSON.parse(record.snapshot),s=E.migrateScoring(previous),now=Date.now();
      if(s!==previous){store(root,code,record,s);changed=true;continue;}
      if(room.savedGame){if(!record.paused){record.paused=true;changed=true;}continue;}
      if(s.phase==='playing'&&!s.table&&s.passed.length){
        s.passed=[];s.trick??=1;s.deadline=now+E.turnDuration(s.round);store(root,code,record,s);changed=true;continue;
      }
      const openingSeat=s.hands.findIndex(hand=>hand.some(card=>E.cardKey(card)==='3D'));
      if(['round_ready','playing'].includes(s.phase)&&s.discard.length===0&&s.hands.every(hand=>hand.length===13)&&(!s.openingRequired||s.turn!==openingSeat)){
        s.turn=openingSeat;s.openingRequired=true;if(s.phase==='playing')s.deadline=now+E.turnDuration(s.round);store(root,code,record,s);changed=true;continue;
      }
      if(s.turnMs!==E.turnDuration(s.round)){s.turnMs=E.turnDuration(s.round);if(['playing','bomb_choice'].includes(s.phase))s.deadline=now+E.turnDuration(s.round);store(root,code,record,s);changed=true;continue;}
      if(record.paused){record.paused=false;if(['playing','bomb_choice'].includes(s.phase))s.deadline=now+E.turnDuration(s.round);if(['round_end','session_end'].includes(s.phase))s.roundEndUntil=now+E.ROUND_PAUSE_MS;store(root,code,record,s);changed=true;continue;}
      const active=Object.values(room.players||{}).some(p=>!p.isBot&&!p.disconnected&&p.lastSeen>=now-15000);
      if(!active)continue;
      let action=null,actor=s.turn;
      if(s.phase==='round_ready'){
        actor=s.players.findIndex((p,i)=>!s.ready[i]&&room.players?.[p.uid]?.isBot);
        if(actor>=0)action={type:'ready'};
      }else if(['playing','bomb_choice'].includes(s.phase)){
        if(now>=s.deadline)action={type:'timeout'};
        else if(room.players?.[s.players[s.turn].uid]?.isBot&&now>=s.deadline-E.turnDuration(s.round)+900)action=botMove(s);
      }
      if(['round_end','session_end'].includes(s.phase)&&s.roundEndUntil==null){s.roundEndUntil=now+E.ROUND_PAUSE_MS;store(root,code,record,s);changed=true;continue;}
      if(action){
        const next=E.applyAction(s,{...action,id:'server_'+crypto.randomUUID(),uid:s.players[actor].uid,expectedRevision:s.revision},now);
        store(root,code,record,next);changed=true;
      }
    }
    return changed;
  });
}
async function identity(req){
  const token=(req.headers.authorization||'').replace(/^Bearer /,'');check(token&&token.length<10000,'Login diperlukan.',401);
  const r=await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:lookup?key=${PROJECT}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:token}),signal:AbortSignal.timeout(5000)});
  check(r.ok,'Sesi login lokal tidak sah.',401);const data=await r.json();const user=data.users?.[0];
  check(user&&!user.disabled,'Sesi login lokal tidak sah.',401);
  const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());
  check(claims.aud===PROJECT&&claims.firebase?.sign_in_provider==='password'&&claims.exp>Date.now()/1000,'Gunakan akun lokal dengan password.',401);
  return user.localId;
}
async function body(req){let data='';for await(const chunk of req){data+=chunk;check(data.length<10000,'Permintaan terlalu besar.',413);}return JSON.parse(data||'{}');}
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.gif':'image/gif','.mp3':'audio/mpeg','.mp4':'video/mp4','.m4a':'audio/mp4','.webp':'image/webp'};
function createServer(){return http.createServer(async(req,res)=>{
  try{
    check([`127.0.0.1:${PORT}`,`localhost:${PORT}`].includes(req.headers.host),'Host lokal tidak sah.',403);
    const url=new URL(req.url,`http://127.0.0.1:${PORT}`);
    if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
    if(url.pathname==='/local-health'){json(res,200,{local:true,project:PROJECT});return;}
    const route=url.pathname.match(/^\/capsa-api\/rooms\/([A-Z0-9]{4,6})$/);
    if(route){
      check(!req.headers.origin||origins.has(req.headers.origin),'Origin tidak diizinkan.',403);
      check(['GET','POST'].includes(req.method),'Metode tidak diizinkan.',405);
      if(req.method==='POST')check(origins.has(req.headers.origin),'Origin lokal diperlukan.',403);
      const uid=await identity(req),code=route[1];
      if(req.method==='POST'){
        const input=await body(req);await transact(root=>{if(input.type==='start')started(root,code,uid);else apply(root,code,uid,input);});
      }
      json(res,200,projection((await database()).value,code,uid));return;
    }
    check(req.method==='GET','Metode tidak diizinkan.',405);
    let name=decodeURIComponent(url.pathname).replace(/^\//,'');
    if(!name||/^(truf|cangkul|remi|tebak|capsa)(\/[A-Z0-9]{4,6})?$/.test(name))name='truf-multiplayer-v3.html';
    check(name!=='truf-game.html','Tidak ditemukan.',404);
    check(!name.split('/').some(p=>p.startsWith('.')||['scripts','tests','docs','node_modules','work','artifacts'].includes(p)),'Tidak ditemukan.',404);
    const file=path.resolve(ROOT,name);check(file.startsWith(ROOT+path.sep)&&mime[path.extname(file)],'Tidak ditemukan.',404);
    const content=await fs.readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(content);
  }catch(e){json(res,e.status|| (e.code==='ENOENT'?404:500),{error:e.status||e.code==='ENOENT'?e.message:'Layanan lokal belum siap. Periksa emulator.'});}
});}
if(require.main===module){
  const server=createServer();server.listen(PORT,'127.0.0.1',()=>console.log(`Main Kartu lokal: http://127.0.0.1:${PORT}/capsa`));
  let busy=false;const timer=setInterval(async()=>{if(busy)return;busy=true;try{await drive();}catch(e){if(process.env.LOCAL_DEBUG)console.error(e.message);}finally{busy=false;}},500);
  function stop(){clearInterval(timer);server.close();}process.on('SIGTERM',stop);process.on('SIGINT',stop);
}
module.exports={PROJECT,PORT,database,transact,projection,started,apply,drive,botMove,createServer};
