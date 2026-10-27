/* Expiry uses server presence, never the number of viewers or bot heartbeats. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;else root.RoomLifecycle=api;
})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const EMPTY_MS=30000,SCAN_MS=1000;
  const stamp=value=>Number.isFinite(value)&&value>0?value:0;
  function humans(room){return Object.values(room?.players||{}).filter(p=>p?.isBot===false);}
  function signal(p){return Math.max(stamp(p.lastSeen),stamp(p.disconnectedAt));}
  function valid(room){
    if(!room||room.membershipVersion!==2)return false;
    const seen=new Set();
    return Object.entries(room.players||{}).every(([uid,p])=>{
      if(!p||p.uid!==uid||typeof p.isBot!=='boolean'||!Number.isInteger(p.seat)||p.seat<0||p.seat>=6||seen.has(p.seat)||room.seats?.[p.seat]!==uid)return false;
      seen.add(p.seat);return true;
    })&&
      Object.entries(room.seats||{}).every(([seat,uid])=>room.players?.[uid]?.seat===Number(seat));
  }
  function expiresAt(room){
    if(!valid(room))return Infinity;
    const ps=humans(room),fallback=stamp(room.emptySince);
    const signals=ps.length?ps.map(p=>signal(p)||fallback):[fallback];
    if(signals.some(s=>!s))return Infinity;
    return Math.max(...signals)+EMPTY_MS;
  }
  function expired(room,now){return Number.isFinite(now)&&expiresAt(room)<=now;}
  function needsMarker(room,now){
    return valid(room)&&!stamp(room.emptySince)&&(!humans(room).length||humans(room).some(p=>!signal(p)))&&
      humans(room).every(p=>signal(p)<=now-15000);
  }
  function create(fb,options={}){
    let uid=null,generation=0,unsubscribe=null,timer=null,rooms={};
    const jobs=new Set(),now=options.now||Date.now;
    const ref=path=>fb.ref(fb.db,path);
    function stop(){
      generation++;uid=null;rooms={};if(unsubscribe)unsubscribe();unsubscribe=null;
      if(timer)clearInterval(timer);timer=null;jobs.clear();
    }
    async function inspect(code,room){
      if(!uid||fb.authUid!==uid||jobs.has(code)||!/^[A-Z0-9]{4,6}$/.test(code))return;
      const gen=generation;let operation=null;
      if(stamp(room.emptySince)&&humans(room).some(p=>signal(p)>now()-15000))operation=()=>fb.remove(ref('rooms/'+code+'/emptySince'));
      else if(expired(room,now()))operation=()=>fb.remove(ref('rooms/'+code));
      else if(needsMarker(room,now()))operation=()=>fb.set(ref('rooms/'+code+'/emptySince'),fb.serverTimestamp());
      if(!operation)return;jobs.add(code);
      try{if(gen===generation&&fb.authUid===uid)await operation();}
      catch(error){
        // A heartbeat, rejoin or another cleaner may win the race. Rules decide
        // using current server data; stale snapshots never authorize deletion.
        if(!String(error.code||error.message).toLowerCase().includes('permission'))options.error?.(error);
      }finally{if(gen===generation)jobs.delete(code);}
    }
    async function scan(){await Promise.all(Object.entries(rooms).map(([code,room])=>inspect(code,room)));}
    function start(){
      if(uid&&uid===fb.authUid)return;stop();uid=fb.authUid;if(!uid)return;
      const gen=generation;
      unsubscribe=fb.onValue(ref('rooms'),snap=>{if(gen!==generation||fb.authUid!==uid)return;rooms=snap.val()||{};scan();},error=>options.error?.(error));
      timer=setInterval(scan,SCAN_MS);
    }
    return {start,stop,scan};
  }
  return {EMPTY_MS,SCAN_MS,humans,signal,valid,expiresAt,expired,needsMarker,create};
});
