/* Real Firebase operations; UI uses plain text for all player/room data. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./room-saves.js'));
  else root.RoomSaveUI=factory(root.RoomSaves);
})(typeof window==='object'?window:globalThis,function(Saves){
  'use strict';
  function create(fb,options){
    const doc=options.document||document,now=options.now||Date.now;
    let room=null,busy=false,error='',viewKey='',frozenId=null,listOpen=false,disposed=false;
    let resumeDisconnect=null;
    const uid=()=>options.uid(),ref=p=>fb.ref(fb.db,p);
    const id=()=>options.id?options.id():Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
    const el=(tag,cls,text)=>{const n=doc.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
    const modal=doc.getElementById('savedGameModal'),list=doc.getElementById('savedGamesListModal');
    const label={truf:'Truf',remi:'Remi',cangkul:'Cangkul',tebak:'Tebak Kartu'};
    const date=t=>new Date(t).toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short'});
    const path=()=>`rooms/${room.code}`;
    async function perform(fn,obsolete){
      if(busy||disposed)return;busy=true;error='';render();
      try{await fn();}catch(e){
        // Two tabs of the same account may coordinate simultaneously. Read
        // the authoritative status before treating a lost race as a failure.
        let superseded=false;
        if(obsolete)try{superseded=await obsolete();}catch(_){}
        if(!superseded){error='Perubahan belum tersimpan. '+(e.code==='PERMISSION_DENIED'?'Status game sudah berubah atau persetujuan belum lengkap. Muat ulang lalu coba lagi.':(e.message||'Periksa koneksi Anda.'));if(!room?.savedGame)options.error?.(error);}
      }
      finally{busy=false;render();}
    }
    async function fresh(){
      if(!room?.code)throw Error('Room sudah ditutup.');
      const snap=await fb.get(ref(path()));
      if(!snap.exists())throw Error('Room sudah ditutup.');
      return {...snap.val(),code:room.code};
    }
    async function save(){
      await perform(async()=>{
        const r=await fresh();
        await fb.set(ref(`rooms/${r.code}/savedGame`),Saves.request(r,uid(),id(),fb.serverTimestamp()));
      });
      await reconcile();
    }
    async function approve(){
      const s=room?.savedGame;if(!s)return;
      await perform(()=>fb.set(ref(`${path()}/savedGame/votes/${uid()}`),s.id));
      await reconcile();
    }
    async function cancel(){await perform(()=>fb.remove(ref(`${path()}/savedGame`)));}
    async function start(){
      await perform(()=>fb.update(ref(path()),{'savedGame/status':'resuming','savedGame/resumeId':id(),
        'savedGame/resumeAt':fb.serverTimestamp(),'savedGame/ready':null,'savedGame/lastAccessAt':fb.serverTimestamp()}));
    }
    async function confirmReady(){
      const s=room?.savedGame;if(!s)return;
      await perform(async()=>{
        const key=`${path()}/savedGame/ready/${uid()}`;
        // A server disconnect invalidates this connection's confirmation.
        if(resumeDisconnect)await resumeDisconnect.cancel();
        resumeDisconnect=fb.onDisconnect(ref(key));
        await resumeDisconnect.remove();
        await fb.set(ref(key),s.resumeId);
      });
    }
    async function cancelResume(){await perform(()=>fb.set(ref(`${path()}/savedGame/status`),'saved'));}
    async function exit(){
      await perform(async()=>{
        if(options.spectator()){options.exitSpectator();return;}
        const r=await fresh();
        if(r.savedGame?.status==='request')throw Error('Setujui atau batalkan penyimpanan terlebih dahulu.');
        if(!r.savedGame)throw Error('Game sudah dilanjutkan. Gunakan tombol keluar permainan.');
        await fb.update(ref(`rooms/${r.code}`),{
          [`players/${uid()}/lastSeen`]:0,[`players/${uid()}/disconnected`]:true,
          [`players/${uid()}/disconnectedAt`]:fb.serverTimestamp(),[`savedGame/ready/${uid()}`]:null});
        options.exit();
      });
    }
    function button(text,action,disabled=false){
      const b=el('button','btn',text);b.type='button';b.disabled=busy||disabled;
      b.dataset.saveAction=action.name;b.onclick=action;return b;
    }
    function render(){
      const s=room?.savedGame,mine=Saves.isMember(room,uid())&&!options.spectator();
      doc.querySelectorAll('[data-save-game]').forEach(b=>{b.hidden=!Saves.canSave(room,uid())||options.spectator();b.disabled=busy;});
      doc.querySelectorAll('#savedGamesList button').forEach(b=>{b.disabled=busy;});
      if(!s){modal.hidden=true;modal.classList.remove('show');viewKey='';return;}
      const roster=Saves.members(room);
      const key=JSON.stringify([s,roster.map(u=>Saves.live(room,u,now())),uid(),mine,busy,error]);
      if(key===viewKey)return;viewKey=key;
      const focused=doc.activeElement?.dataset?.saveAction;
      modal.hidden=false;modal.classList.add('show');
      const card=el('div','modal-card saved-game-card');
      const solo=roster.length===1;
      const title=el('h2','modal-title',s.status==='request'?(solo?'Menyimpan game...':'Simpan permainan?'):s.status==='resuming'?'Siap melanjutkan?':'Game tersimpan');
      title.id='savedGameTitle';card.append(title);
      card.append(el('p','saved-game-help',s.status==='request'
        ?(solo?'Sedang menyimpan kartu, skor dan giliran Anda.':'Permainan dijeda. Semua pemain manusia harus setuju dalam 60 detik. Jika ditolak, permainan berlanjut.')
        :s.status==='resuming'?'Permainan baru berjalan setelah semua pemain asli masuk dan menekan Siap lanjut.'
        :'Kartu, skor dan giliran tetap tersimpan. Anda bisa kembali ke lobby dan melanjutkannya nanti.'));
      const names=el('ul','saved-game-people');
      for(const u of roster){
        const row=el('li');row.append(el('span','',room.players?.[u]?.nickname||'Pemain'));
        const text=s.status==='request'?(s.votes?.[u]===s.id?'Setuju':'Menunggu')
          :s.status==='resuming'?(Saves.live(room,u,now())?(s.ready?.[u]===s.resumeId?'Siap lanjut':'Belum siap'):'Belum masuk')
          :(Saves.live(room,u,now())?'Di room':'Belum masuk');
        const status=el('span','saved-game-person-status',text);row.append(status);names.append(row);
      }
      card.append(names);
      if(s.status!=='request')card.append(el('p','saved-game-help',`Dihapus jika tidak dibuka selama 7 hari. Batas saat ini: ${date(Saves.expiresAt(room))}.`));
      const msg=el('p','saved-game-error',error);msg.setAttribute('role','alert');card.append(msg);
      const actions=el('div','saved-game-actions');
      if(mine&&s.status==='request'){
        if(s.votes?.[uid()]!==s.id){const b=button('Setuju simpan',approve);b.classList.add('primary');actions.append(b);}
        else actions.append(el('p','saved-game-help',solo?'Menyimpan permainan Anda...':'Anda sudah setuju. Menunggu pemain lainnya.'));
        actions.append(button('Batalkan simpan',cancel));
      }else{
        if(mine&&s.status==='saved'){const b=button('Lanjutkan game',start);b.classList.add('primary');actions.append(b);}
        if(mine&&s.status==='resuming'){
          const b=button(s.ready?.[uid()]===s.resumeId?'Anda sudah siap':'Siap lanjut',confirmReady,s.ready?.[uid()]===s.resumeId);
          b.classList.add('primary');actions.append(b,button('Batalkan lanjut',cancelResume));
        }
        actions.append(button(options.spectator()?'Keluar Tonton':'Kembali ke lobby',exit));
      }
      card.append(actions);modal.replaceChildren(card);
      const focus=focused&&Array.from(actions.querySelectorAll('button')).find(b=>b.dataset.saveAction===focused&&!b.disabled);
      if(focus)focus.focus();else if(!focused&&doc.activeElement===doc.body)actions.querySelector('button:not(:disabled)')?.focus();
    }
    async function reconcile(){
      const s=room?.savedGame;if(!s||busy||!Saves.isMember(room,uid())||options.spectator())return;
      const coordinator=Saves.members(room).find(u=>Saves.live(room,u,now()));
      if(coordinator!==uid())return;
      if(s.status==='request'&&s.requestedAt+Saves.REQUEST_MS<=now()){await cancel();return;}
      const code=room.code;
      const obsolete=async()=>{
        const snapshot=await fb.get(ref(`rooms/${code}/savedGame`)),current=snapshot.val();
        return !snapshot.exists()||current.id!==s.id||current.status!==s.status;
      };
      if(s.status==='request'&&Saves.approved(room)){
        await perform(()=>fb.update(ref(path()),{'savedGame/status':'saved','savedGame/savedAt':fb.serverTimestamp()}),obsolete);
      }else if(s.status==='resuming'&&Saves.ready(room,now())){
        await perform(()=>fb.remove(ref(`${path()}/savedGame`)),obsolete);
      }
    }
    function observe(next){
      if(room?.savedGame?.id!==next?.savedGame?.id||room?.savedGame?.status!==next?.savedGame?.status)error='';
      room=next;
      const nextId=room?.savedGame?.id||null;
      if(nextId!==frozenId){frozenId=nextId;options.freezeChanged(!!nextId);}
      render();
      // Yield past the current Firebase listener; a local optimistic event
      // must not start a second mutation before its current write settles.
      Promise.resolve().then(reconcile);
    }
    async function tick(){render();await reconcile();}
    async function showList(){
      listOpen=true;list.hidden=false;list.classList.add('show');
      const body=doc.getElementById('savedGamesList');body.replaceChildren(el('p','saved-game-help','Memuat game tersimpan...'));
      try{
        const snap=await fb.get(ref('rooms'));if(!listOpen||disposed)return;
        const entries=Object.entries(snap.val()||{}).map(([code,r])=>({...r,code})).filter(r=>Saves.listed(r,uid(),now())).sort((a,b)=>b.savedGame.lastAccessAt-a.savedGame.lastAccessAt);
        body.replaceChildren();
        if(!entries.length)body.append(el('p','saved-game-help','Belum ada game tersimpan. Saat bermain, pilih Simpan game untuk melanjutkannya nanti.'));
        for(const r of entries){
          const row=el('div','saved-game-list-row');
          row.append(el('h3','',`${label[r.game]||r.game} · ${r.code}`));
          row.append(el('p','saved-game-help',Saves.members(r).map(u=>r.players?.[u]?.nickname||'Pemain').join(', ')));
          row.append(el('p','saved-game-help',`Batas simpan: ${date(Saves.expiresAt(r))}`));
          const b=button('Buka game',async function openSaved(){
            await perform(async()=>{
              const s=await fb.get(ref(`rooms/${r.code}`));const latest=s.val();
              if(!s.exists()||!Saves.listed(latest,uid(),now()))throw Error('Game ini sudah kedaluwarsa atau tidak tersedia.');
              await fb.update(ref(`rooms/${r.code}`),{[`players/${uid()}/lastSeen`]:fb.serverTimestamp(),
                [`players/${uid()}/disconnected`]:null,[`players/${uid()}/disconnectedAt`]:null,'savedGame/lastAccessAt':fb.serverTimestamp()});
              closeList();options.enter({...latest,code:r.code});
            });
            if(error)doc.getElementById('savedGamesListError').textContent=error;
          });row.append(b);body.append(row);
        }
      }catch(e){body.replaceChildren(el('p','saved-game-error','Belum bisa memuat game. Periksa koneksi lalu coba lagi.'));}
    }
    function closeList(){listOpen=false;list.hidden=true;list.classList.remove('show');doc.getElementById('savedGamesListError').textContent='';}
    doc.querySelectorAll('[data-save-game]').forEach(b=>{b.onclick=save;});
    doc.querySelectorAll('[data-saved-games]').forEach(b=>{b.onclick=showList;});
    doc.getElementById('savedGamesCloseBtn').onclick=closeList;
    doc.getElementById('savedGamesRefreshBtn').onclick=showList;
    modal.addEventListener('keydown',event=>{
      if(event.key!=='Tab')return;
      const buttons=Array.from(modal.querySelectorAll('button:not(:disabled)'));if(!buttons.length)return;
      const first=buttons[0],last=buttons[buttons.length-1];
      if(event.shiftKey&&doc.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&doc.activeElement===last){event.preventDefault();first.focus();}
    });
    return {observe,tick,showList,save,approve,start,confirmReady,cancel,cancelResume,exit,
      reset(){room=null;error='';busy=false;closeList();observe(null);if(resumeDisconnect){resumeDisconnect.cancel().catch(()=>{});resumeDisconnect=null;}},
      destroy(){this.reset();disposed=true;}};
  }
  return {create};
});
