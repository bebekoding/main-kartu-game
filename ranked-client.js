/* Ranking client: never writes a bare counter or consumes a local flag early.
 * All authority, votes, point deltas and the single-use receipt are checked by
 * database rules. This module only prepares requests and recovers retries.
 */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./ranked-leaderboard.js'));
  else root.RankedClient=factory(root.RankedLeaderboard);
})(typeof window==='object'?window:globalThis,function(L){
  'use strict';
  function create(fb,options={}){
    let user=null,generation=0,pendingStop=null,connectedStop=null,currentRoom=null;
    const records=new Map(),watches=new Map(),pending=new Set(),jobs=new Map();
    const ref=path=>fb.ref(fb.db,path);
    const changed=()=>options.changed?.({records:new Map(records),pending:new Set(pending),room:currentRoom});
    const failure=(error,id)=>options.error?.(error,id);
    const live=(uid,gen)=>uid&&fb.authUid===uid&&user===uid&&generation===gen;
    function stop(){
      generation++;user=null;currentRoom=null;
      if(pendingStop){pendingStop();pendingStop=null;}
      if(connectedStop){connectedStop();connectedStop=null;}
      for(const unsubscribe of watches.values())unsubscribe();
      watches.clear();pending.clear();records.clear();jobs.clear();changed();
    }
    function start(){
      if(user&&user===fb.authUid)return;
      stop();user=fb.authUid;if(!user)return;
      const uid=user,gen=generation;
      connectedStop=fb.onValue(ref('.info/connected'),snap=>{
        if(!live(uid,gen)||snap.val()!==true)return;
        for(const [id,record]of records)if(!record.recorded&&L.stateOf(record)==='ready')finalize(id).catch(error=>failure(error,id));
      });
      pendingStop=fb.onValue(ref('rankedPending/'+uid),snap=>{
        if(!live(uid,gen))return;
        pending.clear();for(const id of Object.keys(snap.val()||{})){if(/^[a-f0-9]{32}$/.test(id)){pending.add(id);watch(id);}}
        for(const [id,unsubscribe]of watches){if(!pending.has(id)&&currentRoom?.rankedMatchId!==id){unsubscribe();watches.delete(id);}}
        changed();
      },error=>{if(live(uid,gen))failure(error);});
    }
    function once(key,action){
      if(jobs.has(key))return jobs.get(key);
      const task=Promise.resolve().then(action).finally(()=>{if(jobs.get(key)===task)jobs.delete(key);});
      jobs.set(key,task);return task;
    }
    function watch(id){
      if(watches.has(id)||!user)return;
      const uid=user,gen=generation;
      const unsubscribe=fb.onValue(ref('rankedMatches/'+id),snap=>{
        if(!live(uid,gen)||!snap.exists())return;
        const record=snap.val();
        if(record.contract!==L.CONTRACT){failure(Error('Versi hasil peringkat tidak sesuai.'),id);return;}
        records.set(id,record);changed();
        if(L.stateOf(record)==='ready')finalize(id).catch(error=>failure(error,id));
        else if(L.stateOf(record)==='rejected')cleanRejected(id,record).catch(error=>failure(error,id));
        else if(currentRoom?.rankedMatchId===id&&!record.result&&L.completedMatch(currentRoom))propose(currentRoom).catch(error=>failure(error,id));
      },error=>{if(live(uid,gen))failure(error,id);});
      watches.set(id,unsubscribe);
    }
    function observe(room){
      start();currentRoom=room;
      const id=room?.rankedMatchId;
      if(id&&/^[a-f0-9]{32}$/.test(id)&&room.players?.[user]?.isBot===false){watch(id);}
      for(const [old,unsubscribe]of watches){if(old!==id&&!pending.has(old)){unsubscribe();watches.delete(old);}}
      changed();
      if(id&&records.has(id)&&!records.get(id).recorded&&L.stateOf(records.get(id))==='ready')finalize(id).catch(error=>failure(error,id));
      if(id&&L.completedMatch(room))propose(room).catch(error=>failure(error,id));
    }
    async function prepare(room){
      start();const uid=user,gen=generation;
      if(!live(uid,gen)||room.host!==uid||room.phase!=='lobby')throw Error('Hanya host dapat memulai dari lobby.');
      // Cangkul/Tebak use a compact turn order. Reserve its final seats before
      // freezing the ranking roster, using the existing atomic membership bridge.
      if(['cangkul','tebak'].includes(room.game)){
        const changes={};L.players(room).forEach((p,index)=>{if(p.seat!==index)changes['players/'+p.uid+'/seat']=index;});
        if(Object.keys(changes).length){
          await fb.update(ref('rooms/'+room.code),changes);
          if(!live(uid,gen))throw Error('Akun berubah. Muat ulang sebelum memulai.');
          const fresh=await fb.get(ref('rooms/'+room.code));room=fresh.val();
          if(!room||room.host!==uid||room.phase!=='lobby')throw Error('Room berubah. Coba mulai kembali.');
        }
      }
      const ps=L.players(room),game=room.game||'truf';
      const potential=ps.length>=(game==='cangkul'?3:4)&&ps.length<=6&&(!['truf','remi'].includes(game)||ps.length===4)&&ps.every(p=>p.isBot===false&&p.username);
      let record=null;
      if(potential){
        const profiles={};await Promise.all(ps.map(async p=>{const key=L.keyFor(p.username);profiles[key]=(await fb.get(ref('accounts/'+key))).val();}));
        record=L.newRecord(room,profiles,fb.serverTimestamp());
      }
      if(!live(uid,gen))throw Error('Akun berubah. Muat ulang sebelum memulai.');
      if(!record){
        if(room.rankedMatchId)await fb.update(ref('rooms/'+room.code),{rankedMatchId:null});
        if(!live(uid,gen))throw Error('Akun berubah. Mulai kembali dari lobby.');
        return {...room,rankedMatchId:null};
      }
      const contract=await fb.get(ref('config/leaderboardContract'));
      if(contract.val()!==L.CONTRACT)throw Error('Versi peringkat belum sesuai. Muat ulang halaman.');
      if(room.rankedMatchId){
        try{
          const existing=(await fb.get(ref('rankedMatches/'+room.rankedMatchId))).val();
          if(existing&&existing.contract===L.CONTRACT&&!existing.result&&existing.game===record.game&&JSON.stringify(existing.roster)===JSON.stringify(record.roster)){
            if(!live(uid,gen))throw Error('Akun berubah. Mulai kembali dari lobby.');
            return room;
          }
        }catch(error){if(!error.code||!String(error.code).toLowerCase().includes('permission'))throw error;}
      }
      const id=(options.randomId?.()||globalThis.crypto.randomUUID().replace(/-/g,'')).toLowerCase();
      if(!live(uid,gen))throw Error('Akun berubah. Muat ulang sebelum memulai.');
      await fb.update(ref(''),{['rankedMatches/'+id]:record,['rooms/'+room.code+'/rankedMatchId']:id,['rooms/'+room.code+'/game']:record.game});
      if(!live(uid,gen))throw Error('Akun berubah. Mulai kembali dari lobby.');
      return {...room,game:record.game,rankedMatchId:id};
    }
    function propose(room){
      const id=room?.rankedMatchId;if(!id||!L.completedMatch(room))return Promise.resolve(null);
      return once('propose:'+id,async()=>{
        const uid=user,gen=generation;
        if(!live(uid,gen))throw Error('Akun berubah. Hasil belum dikirim.');
        const snap=await fb.get(ref('rankedMatches/'+id));if(!snap.exists())return null;
        const record=snap.val();if(!live(uid,gen))throw Error('Akun berubah. Hasil belum dikirim.');if(record.result)return record;
        const result=L.resultFor(room,record,fb.serverTimestamp());if(!result)return null;
        if(!live(uid,gen))throw Error('Akun berubah. Hasil belum dikirim.');
        const patch={['rankedMatches/'+id+'/result']:result};
        for(const person of Object.values(record.roster))patch['rankedPending/'+person.uid+'/'+id]=true;
        try{await fb.update(ref(''),patch);}catch(error){
          const latest=(await fb.get(ref('rankedMatches/'+id))).val();if(!latest?.result)throw error;
        }
        const frozen=(await fb.get(ref('rankedMatches/'+id))).val();
        if(live(uid,gen)){records.set(id,frozen);watch(id);changed();}return frozen;
      });
    }
    async function vote(id,approved){
      const uid=user,gen=generation;if(!live(uid,gen)||typeof approved!=='boolean')throw Error('Masuk kembali untuk mengonfirmasi hasil.');
      const record=(await fb.get(ref('rankedMatches/'+id))).val();
      if(!record?.result||record.memberSeats?.[uid]==null)throw Error('Hanya peserta asli dapat mengonfirmasi hasil.');
      if(record.votes?.[uid]!==undefined&&record.votes[uid]!==approved)throw Error('Keputusan Anda sudah tersimpan dan tidak dapat diubah.');
      if(!live(uid,gen))throw Error('Akun berubah. Keputusan belum dikirim.');
      if(record.votes?.[uid]===undefined){
        try{await fb.set(ref('rankedMatches/'+id+'/votes/'+uid),approved);}catch(error){
          const latest=(await fb.get(ref('rankedMatches/'+id))).val();
          if(latest?.votes?.[uid]!==approved)throw error;
        }
      }
      const latest=(await fb.get(ref('rankedMatches/'+id))).val();
      if(live(uid,gen)){records.set(id,latest);changed();}
      if(approved)await finalize(id);else await cleanRejected(id,{...record,votes:{...record.votes,[uid]:false}});
    }
    function finalize(id){
      return once('award:'+id,async()=>{
        const uid=user,gen=generation;
        for(let attempt=0;attempt<4;attempt++){
          if(!live(uid,gen))return false;
          const [matchSnap,receipt]=await Promise.all([fb.get(ref('rankedMatches/'+id)),fb.get(ref('rankedAwards/'+id))]);
          if(receipt.exists()){if(live(uid,gen)){const r=matchSnap.val();records.set(id,{...r,recorded:true});changed();}return true;}
          const record=matchSnap.val();if(L.stateOf(record)!=='ready')return false;
          const current={};await Promise.all(Object.values(record.roster).map(async p=>{current[p.key]=(await fb.get(ref('leaderboards/'+record.game+'/'+p.key))).val()||{};}));
          const patch=L.awardPatch(id,record,current,fb.serverTimestamp());
          if(!live(uid,gen))return false;
          try{
            await fb.update(ref(''),patch);
            if(live(uid,gen)){records.set(id,{...record,recorded:true});changed();}return true;
          }catch(error){
            if((await fb.get(ref('rankedAwards/'+id))).exists()){if(live(uid,gen)){records.set(id,{...record,recorded:true});changed();}return true;}
            if(attempt===3)throw error;
            await new Promise(resolve=>setTimeout(resolve,80*(attempt+1)));
          }
        }
        return false;
      });
    }
    function cleanRejected(id,record){
      return once('rejected:'+id,async()=>{
        const uid=user,gen=generation;if(!live(uid,gen)||L.stateOf(record)!=='rejected')return;
        const patch={};for(const p of Object.values(record.roster))patch['rankedPending/'+p.uid+'/'+id]=null;
        if(live(uid,gen))await fb.update(ref(''),patch);
      });
    }
    async function retry(id){
      const record=(await fb.get(ref('rankedMatches/'+id))).val();
      if(L.stateOf(record)==='rejected')return cleanRejected(id,record);
      if(record?.result)return finalize(id);
      if(currentRoom?.rankedMatchId===id)return propose(currentRoom);
      return null;
    }
    return {start,stop,prepare,observe,propose,vote,finalize,retry,records,pending};
  }
  return {create};
});
