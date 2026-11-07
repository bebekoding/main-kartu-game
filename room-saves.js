/* Consent-based persistence. The room itself is the frozen game snapshot. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;else root.RoomSaves=api;
})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const WEEK_MS=7*24*60*60*1000, REQUEST_MS=60000;
  // RTDB returns dense numeric-key maps as arrays, including null holes when
  // bots sit between the humans. Empty seats must never become voters.
  const members=room=>Object.values(room?.savedGame?.humans||{}).filter(uid=>typeof uid==='string'&&uid.length>0);
  const isMember=(room,uid)=>typeof uid==='string'&&members(room).includes(uid);
  const live=(room,uid,now)=>{
    const p=room?.players?.[uid];
    return !!(p&&p.isBot===false&&!p.disconnected&&!p.disconnectedAt&&
      p.lastSeen>=now-15000&&p.lastSeen<=now+5000);
  };
  function canSave(room,uid){
    return !!(room&&room.membershipVersion===2&&!room.savedGame&&room.players?.[uid]?.isBot===false&&
      room.phase&&room.phase!=='lobby'&&!['tournament_end','remi_tournament_end','cangkul_tournament_end','tebak_match_end','capsa_session_end'].includes(room.phase));
  }
  function humans(room){
    return Object.fromEntries(Object.values(room.players||{}).filter(p=>p.isBot===false).map(p=>[p.seat,p.uid]));
  }
  function request(room,uid,id,timestamp){
    if(!canSave(room,uid))throw Error('Permainan ini belum bisa disimpan.');
    return {version:1,id,status:'request',requestedBy:uid,requestedAt:timestamp,
      lastAccessAt:timestamp,humans:humans(room),votes:{[uid]:id}};
  }
  function approved(room){
    const s=room?.savedGame;
    return !!s&&members(room).length>0&&members(room).every(uid=>s.votes?.[uid]===s.id);
  }
  function ready(room,now){
    const s=room?.savedGame;
    return !!s&&s.status==='resuming'&&members(room).length>0&&
      members(room).every(uid=>s.ready?.[uid]===s.resumeId&&live(room,uid,now));
  }
  function expiresAt(room){
    const s=room?.savedGame;
    return s&&s.status!=='request'&&Number.isFinite(s.lastAccessAt)?s.lastAccessAt+WEEK_MS:Infinity;
  }
  function listed(room,uid,now){return isMember(room,uid)&&room.savedGame.status!=='request'&&expiresAt(room)>now;}
  return {WEEK_MS,REQUEST_MS,members,isMember,live,humans,canSave,request,approved,ready,expiresAt,listed};
});
