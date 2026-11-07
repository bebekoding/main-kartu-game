/* Trusted-browser-host transport. Rules protect hands from non-host players;
 * the elected human host deliberately has access to the full engine state. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./capsa-engine.js'),require('./capsa-bot.js'),require('./bot-names.js'));else root.CapsaHost=factory(root.CapsaEngine,root.CapsaBot,root.BotNames);})(typeof window==='object'?window:globalThis,function(E,Bot,Names){
'use strict';
const copy=v=>JSON.parse(JSON.stringify(v)),id=()=>crypto.randomUUID(),key=()=>id().replace(/-/g,'');
function shuffle(){const cards=E.deck();for(let i=cards.length-1;i>0;i--){let n;const max=Math.floor(4294967296/(i+1))*(i+1);do{n=crypto.getRandomValues(new Uint32Array(1))[0];}while(n>=max);const j=n%(i+1);[cards[i],cards[j]]=[cards[j],cards[i]];}return cards;}
function publish(c,s,room){
 for(const entry of s.roundPlays||[])if(!entry.nickname)entry.nickname=room.players?.[entry.uid]?.nickname||'Pemain sebelumnya';
 c.privateSnapshot=JSON.stringify(s);c.revision=s.revision;c.phase=s.phase;
 c.publicSnapshot=JSON.stringify({matchId:c.matchId,generation:c.generation,createdAt:c.createdAt,rulesVersion:s.rulesVersion,scoringVersion:s.scoringVersion,...E.placementView(s),endReason:s.endReason??null,phase:s.phase,revision:s.revision,round:s.round,trick:s.trick||1,lastTrickWinner:s.lastTrickWinner??null,turn:s.turn,turnMs:s.turnMs??null,reversed:s.reversed,direction:s.direction,ready:s.ready,continueReady:s.continueReady||[],counts:s.hands.map(h=>h.length),table:s.table,passed:s.passed,roundPlays:s.roundPlays||[],tableStart:s.tableStart??null,roundPlaysIncomplete:s.roundPlaysIncomplete??s.discard.length>0,scores:s.scores,history:s.history,winner:s.winner,roundEndUntil:s.roundEndUntil??null,deadline:s.deadline,players:s.players.map((p,i)=>({uid:p.uid,seat:i,isBot:!!room.players?.[p.uid]?.isBot,nickname:room.players?.[p.uid]?.nickname||'Pemain'}))});
 c.hands=Object.fromEntries(s.players.map((p,i)=>[p.uid,JSON.stringify(s.hands[i])]));return c;
}
function capsule(s,room,matchId=id()){return publish({matchId,generation:key(),createdAt:room.createdAt,owner:room.host,roster:Object.fromEntries(s.players.map((p,i)=>[i,p.uid]))},s,room);}
function step(input,room,uid,now,{reset=false,actionId='host_'+id()}={}){
 if(!input||room.savedGame||room.host!==uid||input.createdAt!==room.createdAt)return;
 const c=copy(input),previous=JSON.parse(c.privateSnapshot);let s=E.migrateScoring(previous);const scoringChanged=s!==previous;E.assertState(s);c.responses??={};c.requests??={};
 // Canonical membership permits replacing a bot only under its existing policy.
 // Saved matches cannot reach this path. Preserve cards at the same seat.
 for(let i=0;i<4;i++)if(room.seats?.[i]!==s.players[i].uid||(room.players?.[s.players[i].uid]&&room.players[s.players[i].uid].isBot!==s.players[i].isBot)){
  const next=room.players?.[room.seats?.[i]];
  if(!next||next.seat!==i)throw Error('Kursi tidak valid.');
  s.players[i]={uid:next.uid,isBot:next.isBot};if(s.phase==='round_ready')s.ready[i]=next.isBot;if(s.continueReady?.length)s.continueReady[i]=next.isBot;c.roster[i]=next.uid;reset=true;
 }
 if(scoringChanged){c.owner=uid;c.generation=key();return publish(c,s,room);}
 if(s.phase==='playing'&&!s.table&&s.passed.length){
  s.passed=[];s.trick??=1;c.generation=key();s.deadline=now+E.turnDuration(s.round);return publish(c,s,room);
 }
 const openingSeat=s.hands.findIndex(hand=>hand.some(card=>E.cardKey(card)==='3D'));
 if(['round_ready','playing'].includes(s.phase)&&s.discard.length===0&&s.hands.every(hand=>hand.length===13)&&(!s.openingRequired||s.turn!==openingSeat)){
  s.turn=openingSeat;s.openingRequired=true;c.generation=key();if(s.phase==='playing')s.deadline=now+E.turnDuration(s.round);return publish(c,s,room);
 }
 const changedTimer=s.turnMs!==E.turnDuration(s.round);s.turnMs=E.turnDuration(s.round);
 if(changedTimer&&!reset&&c.owner===uid){c.generation=key();if(['playing','bomb_choice'].includes(s.phase))s.deadline=now+E.turnDuration(s.round);return publish(c,s,room);}
 if(reset||c.owner!==uid){c.owner=uid;c.generation=key();if(['playing','bomb_choice'].includes(s.phase))s.deadline=now+E.turnDuration(s.round);if(reset&&['round_end','session_end'].includes(s.phase))s.roundEndUntil=now+E.ROUND_PAUSE_MS;return publish(c,s,room);}
 if(['round_end','session_end'].includes(s.phase)&&s.roundEndUntil==null){s.roundEndUntil=now+E.ROUND_PAUSE_MS;return publish(c,s,room);}
 const pending=Object.keys(c.requests).filter(u=>Object.keys(c.requests[u]||{}).length).sort();
 const actorUid=pending.find(u=>u>(c.lastRequestUid||''))||pending[0];
 if(actorUid){
  const requestId=Object.keys(c.requests[actorUid]).sort()[0],text=c.requests[actorUid][requestId];c.lastRequestUid=actorUid;
  c.responses[actorUid]??={};
  if(!c.responses[actorUid][requestId]){
   try{
    const a=JSON.parse(text),p=room.players?.[actorUid],seat=p?.seat;
    if(!p||p.isBot||room.seats?.[seat]!==actorUid||s.players[seat]?.uid!==actorUid)throw Error('Anda tidak berada di kursi asli.');
    if(a.matchId!==c.matchId||a.generation!==c.generation)throw Object.assign(Error('Status game sudah berganti. Coba lagi.'),{status:409});
    if(!['ready','confirm_round','play','pass','choose_bomb','next_round'].includes(a.type))throw Error('Aksi tidak diizinkan.');
    if(a.type==='next_round'&&uid!==actorUid)throw Error('Hanya host yang membagikan kartu.');
    const action={id:requestId,uid:actorUid,type:a.type,expectedRevision:['ready','confirm_round'].includes(a.type)?s.revision:a.expectedRevision};
    if(a.type==='play')action.cards=a.cards;if(a.type==='choose_bomb')action.flip=a.flip;
    if(a.type==='next_round')action.deck=shuffle();
    s=E.applyAction(s,action,now);c.responses[actorUid][requestId]=JSON.stringify({packet:text,ok:true,revision:s.revision});
   }catch(e){c.responses[actorUid][requestId]=JSON.stringify({packet:text,ok:false,error:e.message,status:e.status||(/Revisi|sudah habis/.test(e.message)?409:400)});}
  }
  delete c.requests[actorUid][requestId];if(!Object.keys(c.requests[actorUid]).length)delete c.requests[actorUid];return publish(c,s,room);
 }
 let action=null,actor=s.turn;
 if(s.phase==='round_ready'){actor=s.players.findIndex((p,i)=>!s.ready[i]&&room.players?.[p.uid]?.isBot);if(actor>=0)action={type:'ready'};}
 else if(['playing','bomb_choice'].includes(s.phase)){
  if(now>=s.deadline)action={type:'timeout'};
  else if(room.players?.[s.players[s.turn].uid]?.isBot&&now>=s.deadline-E.turnDuration(s.round)+900)action=Bot.move(s);
 }
 if(!action)return;
 s=E.applyAction(s,{...action,id:actionId,uid:s.players[actor].uid,expectedRevision:s.revision},now);return publish(c,s,room);
}
async function cleanup(fb){
 const ref=p=>fb.ref(fb.db,p),[a,b]=await Promise.all([fb.get(ref('capsaCatalog')),fb.get(ref('rooms'))]),rooms=b.val()||{},changes={};
 for(const code of Object.keys(a.val()||{}))if(/^[A-Z0-9]{4,6}$/.test(code)&&!rooms[code]){changes['capsaMatches/'+code]=null;changes['capsaCatalog/'+code]=null;}
 if(Object.keys(changes).length)await fb.update(ref(''),changes);
}
function create(fb,o){
 let room=null,epoch=0,timer=null,busy=false,wasFrozen=false,reset=false,lastError='',stage='idle';
 const ref=p=>fb.ref(fb.db,p),now=o.now||Date.now;
 const still=(code,uid,g)=>epoch===g&&room?.code===code&&o.uid()===uid;
 async function getRoom(code){const snap=await fb.get(ref('rooms/'+code));if(!snap.exists())throw Error('Room sudah ditutup.');return {...snap.val(),code};}
 async function mirror(code,c){
  const fresh=await getRoom(code);if(fresh.host!==o.uid()||fresh.savedGame||fresh.createdAt!==c.createdAt)return;
  const phase='capsa_'+c.phase,patch={};if(fresh.phase!==phase)patch.phase=phase;
  if(Object.entries(c.roster).some(([i,u])=>fresh.gameState?.roster?.[i]?.uid!==u))patch.gameState={roster:Object.fromEntries(Object.entries(c.roster).map(([i,u])=>[i,{uid:u,isBot:!!fresh.players?.[u]?.isBot,nickname:fresh.players?.[u]?.nickname||'Pemain'}]))};
  if(Object.keys(patch).length)await fb.update(ref('rooms/'+code),patch);
  await fb.set(ref('capsaCatalog/'+code),c.createdAt);
 }
 async function pump(){
  o.trace?.(busy?'busy:'+stage:!room?'no-room':room.host!==o.uid()?'peer':room.savedGame?'frozen':'starting');
  if(busy||!room||room.host!==o.uid()||room.savedGame)return;busy=true;
  const code=room.code,uid=o.uid(),g=epoch,needsReset=reset;
  try{
   stage='room';o.trace?.(stage);const fresh=await getRoom(code);if(!still(code,uid,g)||fresh.host!==uid||fresh.savedGame)return;
   stage='snapshot';o.trace?.(stage);const r=ref('capsaMatches/'+code),loaded=(await fb.get(r)).val();if(!still(code,uid,g))return;
   const time=now();
   if(!step(loaded,fresh,uid,time,{reset:needsReset})){if(loaded)await mirror(code,loaded);return;}
   stage='transaction';o.trace?.(stage);const result=await fb.runTransaction(r,current=>{
    if(!still(code,uid,g))return;
    // SDK get() and transaction caches can differ. Returning undefined on a
    // stale cache aborts before the server can supply its newer request queue.
    const base=current||loaded;
    return step(base,fresh,uid,time,{reset:needsReset})||base;
   },{applyLocally:false});
   if(!still(code,uid,g))return;
   if(result.committed&&needsReset)reset=false;
   const c=result.snapshot.val();if(c)await mirror(code,c);
  }catch(e){o.trace?.('error:'+e.message);if(lastError!==e.message){lastError=e.message;if(o.error)o.error(e);else console.warn('Capsa host:',e.message);}}finally{busy=false;stage='idle';o.trace?.(stage);}
 }
 async function start(code){
  const uid=o.uid();let fresh=await getRoom(code);if(fresh.game!=='capsa'||fresh.host!==uid||fresh.savedGame)throw Error('Hanya host dapat memulai Capsa.');
  let previous=null;
  try{previous=(await fb.get(ref('capsaMatches/'+code))).val();}
  catch(e){ // A reused room code must never reveal the old generation to a new host.
   await fb.remove(ref('capsaMatches/'+code));
  }
  if(previous&&previous.createdAt===fresh.createdAt&&previous.phase==='session_end'&&JSON.parse(previous.privateSnapshot).roundEndUntil>now())throw Error('Tunggu jeda akhir ronde 7 detik.');
  if(previous&&previous.createdAt===fresh.createdAt&&previous.phase!=='session_end'){await mirror(code,previous);observe(fresh);return;}
  const changes={capsaMode:'browser_host'},players=Object.values(fresh.players||{});
  for(let i=0;i<4;i++)if(!players.some(p=>p.seat===i)){
   const p={uid:'capsabot_'+key(),seat:i,nickname:Names.pick(players.map(player=>player.nickname)),isBot:true,lastSeen:0};players.push(p);changes['players/'+p.uid]=p;
  }
  if(players.length!==4||new Set(players.map(p=>p.seat)).size!==4)throw Error('Capsa membutuhkan empat kursi.');
  changes.gameState={roster:Object.fromEntries(players.map(p=>[p.seat,{uid:p.uid,isBot:p.isBot,nickname:p.nickname}]))};
  await fb.update(ref('rooms/'+code),changes);fresh=await getRoom(code);
  const roster=Object.values(fresh.players).sort((a,b)=>a.seat-b.seat),s=E.createSession(roster.map(p=>({uid:p.uid,isBot:p.isBot})),shuffle(),now());
  const initial=capsule(s,fresh),r=ref('capsaMatches/'+code);await fb.get(r);
  const result=await fb.runTransaction(r,current=>{
   if(o.uid()!==uid)return;
   if(current&&current.createdAt===fresh.createdAt&&current.phase!=='session_end')return;
   if(current&&previous&&current.matchId!==previous.matchId)return;
   return initial;
  },{applyLocally:false});
  const value=result.snapshot.val();if(!value)throw Error('Pembagian belum berhasil. Coba lagi.');await mirror(code,value);observe(await getRoom(code));cleanup(fb).catch(()=>{});
 }
 function observe(next){
  if(!next||next.game!=='capsa'){stop();return;}
  if(room?.code!==next.code){stop();room=next;epoch++;timer=setInterval(pump,500);}else room=next;
  if(next.savedGame)wasFrozen=true;else if(wasFrozen){wasFrozen=false;reset=true;}
  pump();
 }
 function stop(){epoch++;room=null;wasFrozen=false;reset=false;if(timer)clearInterval(timer);timer=null;}
 async function view(code){
  const uid=o.uid(),fresh=await getRoom(code),p=fresh.players?.[uid];if(!p||p.isBot)throw Error('Anda bukan pemain di room ini.');
  if(fresh.host===uid){observe(fresh);await pump();}
  const [a,b]=await Promise.all([fb.get(ref('capsaMatches/'+code+'/publicSnapshot')),fb.get(ref('capsaMatches/'+code+'/hands/'+uid))]);
  if(!a.exists()||!b.exists())throw Error('Host sedang menyiapkan meja.');
  const data=JSON.parse(a.val());if(data.createdAt!==fresh.createdAt)throw Error('Generasi room sudah berganti.');
  return {...data,hand:JSON.parse(b.val()),seat:p.seat,frozen:!!fresh.savedGame,serverNow:now()};
 }
 async function request(code,packet,signal){
  if(!packet)return view(code);
  const uid=o.uid(),text=JSON.stringify(packet),ackRef=ref(`capsaMatches/${code}/responses/${uid}/${packet.id}`),queue=ref(`capsaMatches/${code}/requests/${uid}/${packet.id}`);
  const before=await fb.get(ackRef);
  if(!before.exists())try{await fb.set(queue,text);}catch(e){if(!(await fb.get(ackRef)).exists())throw e;}
  const end=Date.now()+22000;
  while(Date.now()<end){
   if(signal?.aborted||o.uid()!==uid)throw Object.assign(Error('Aksi dibatalkan.'),{name:'AbortError'});
   if(room?.host===uid)await pump();
   const ack=await fb.get(ackRef);
   if(ack.exists()){
    const result=JSON.parse(ack.val());if(result.packet!==text)throw Error('ID aksi dipakai dengan isi berbeda.');
    if(!result.ok)throw Object.assign(Error(result.error),{status:result.status});return view(code);
   }
   await new Promise(r=>setTimeout(r,200));
  }
  throw Error('Menunggu host aktif. Coba kirim lagi setelah koneksi host pulih.');
 }
 return {observe,stop,start,request,pump,view};
}
return {create,cleanup,step,capsule,publish,shuffle};
});
