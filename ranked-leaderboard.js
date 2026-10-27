/* Shared ranking contract. Browser + Node, no credentials or hidden card data. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RankedLeaderboard=api;
})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const CONTRACT=3;
  const END={truf:'tournament_end',remi:'remi_tournament_end',cangkul:'cangkul_tournament_end',tebak:'tebak_match_end'};
  const array=value=>Array.isArray(value)?value:Object.values(value||{});
  const keyFor=name=>String(name||'').toLowerCase().replace(/[.#$\/\[\]]/g,'_');
  const integer=(value,min=0,max=1000000000)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
  function players(room){return array(room&&room.players).sort((a,b)=>a.seat-b.seat);}
  function startRoster(room,profiles){
    const ps=players(room),game=room.game||'truf',size=ps.length;
    if(!END[game]||size<(game==='cangkul'?3:4)||size>6||(['remi','truf'].includes(game)&&size!==4))return null;
    const seenUid=new Set(),seenKey=new Set(),roster={},memberSeats={};
    for(let seat=0;seat<size;seat++){
      const p=ps[seat],key=keyFor(p.username),profile=(profiles||{})[key];
      if(!p||p.isBot!==false||p.seat!==seat||p.uid!==room.seats?.[seat]||!p.username||
          !profile||profile.authUid!==p.uid||keyFor(profile.username)!==key||
          seenUid.has(p.uid)||seenKey.has(key))return null;
      seenUid.add(p.uid);seenKey.add(key);
      roster[seat]={uid:p.uid,key,username:profile.username,name:p.nickname||profile.name||profile.username};
      memberSeats[p.uid]=seat;
    }
    return {roster,memberSeats,size,game};
  }
  function newRecord(room,profiles,createdAt){
    const roster=startRoster(room,profiles);
    return roster?{contract:CONTRACT,roomCode:room.code,...roster,createdAt}:null;
  }
  function completedMatch(room){
    const game=room&&room.game||'truf';
    if(!room||room.phase!==END[game])return false;
    const ps=players(room),state=room[game]||{},totals=room.totals||{};
    if(!ps.length||ps.some(p=>!integer(totals[p.seat],-1000000,1000000)))return false;
    if(game==='remi'){
      const cap=state.matchOverReason==='points'&&ps.some(p=>Math.abs(totals[p.seat])>=1000);
      return integer(state.roundNumber,1,20)&&(state.roundNumber>=10||cap)&&
        ['closed','deck_empty','stuck'].includes(state.endReason)&&
        ps.every(p=>integer(state.handPenalty?.[p.seat],-1000000,1000000));
    }
    if(game==='tebak')return integer(state.roundNumber,10,20)&&array(state.deck).length===0&&
      ps.filter(p=>array(state.hands?.[p.seat]).length>0).length<=1&&
      ps.every(p=>integer(state.roundRanks?.[p.seat],1,ps.length)&&integer(state.roundPoints?.[p.seat],1,ps.length));
    if(game==='cangkul'){
      const order=array(state.eliminationOrder);
      return integer(state.sessionNumber,1,100000)&&array(state.activeSeats).length===0&&order.length===ps.length&&
        new Set(order).size===ps.length&&order.every(s=>integer(s,0,ps.length-1))&&
        ps.filter(p=>array(state.hands?.[p.seat]).length>0).length<=1&&
        order.every((s,i)=>state.finalScores?.[s]===ps.length-i);
    }
    return integer(room.gameState?.session,1,100000)&&
      room.sessionResult?.sessionNumber===room.gameState.session&&room.play?.trickNumber===13&&
      ps.every(p=>array(room.hands?.[p.seat]).length===0&&integer(room.sessionResult?.deltas?.[p.seat],-1000,1000)&&integer(room.play?.tricksWon?.[p.seat],0,13))&&
      ps.reduce((sum,p)=>sum+room.play.tricksWon[p.seat],0)===13;
  }
  function resultFor(room,record,finishedAt){
    if(!record||record.contract!==CONTRACT||room.code!==record.roomCode||room.game!==record.game||!completedMatch(room))return null;
    const ps=players(room);
    if(ps.length!==record.size||ps.some(p=>p.isBot!==false||p.uid!==record.roster?.[p.seat]?.uid||keyFor(p.username)!==record.roster?.[p.seat]?.key))return null;
    const entries={};
    for(const p of ps){
      const total=room.totals[p.seat];
      const above=ps.filter(other=>room.totals[other.seat]>total||(room.totals[other.seat]===total&&other.seat<p.seat)).length;
      entries[p.seat]={total,points:record.size-above};
    }
    return {finishedAt,rounds:room.game==='truf'?room.gameState.session:
      room.game==='cangkul'?room.cangkul.sessionNumber:room[room.game].roundNumber,entries};
  }
  function stateOf(record,award){
    if(award)return 'recorded';
    if(!record?.result)return 'playing';
    const votes=record.votes||{};
    if(Object.values(votes).some(v=>v===false))return 'rejected';
    return Object.keys(record.memberSeats||{}).every(uid=>votes[uid]===true)?'ready':'pending';
  }
  function awardPatch(id,record,currentRows,at){
    if(!/^[a-f0-9]{32}$/.test(id)||record?.contract!==CONTRACT||stateOf(record)!=='ready')throw Error('Hasil belum disetujui semua peserta.');
    const patch={['rankedAwards/'+id]:{contract:CONTRACT,game:record.game,srcRoom:record.roomCode,srcMatch:id,at}};
    for(let seat=0;seat<record.size;seat++){
      const p=record.roster[seat],cur=currentRows[p.key]||{},base=record.result.entries[seat].points;
      const matches=cur.matches??0,points=cur.points??0;
      if(!integer(matches)||!integer(points)||(cur.authUid&&cur.authUid!==p.uid)||!integer(base,1,record.size))throw Error('Data peringkat perlu diperiksa administrator.');
      const nextMatches=matches+1;
      patch['leaderboards/'+record.game+'/'+p.key]={contract:CONTRACT,authUid:p.uid,username:p.username,name:p.name,
        matches:nextMatches,points:points+base+(nextMatches%5===0?5:0),srcRoom:record.roomCode,srcMatch:id};
      patch['rankedPending/'+p.uid+'/'+id]=null;
    }
    return patch;
  }
  return {CONTRACT,END,keyFor,players,startRoster,newRecord,completedMatch,resultFor,stateOf,awardPatch};
});
