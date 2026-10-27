(function(root,factory){
  const api=factory(root,root.RankedLeaderboard,root.GameDisplay);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.RankedUI=api;
})(typeof window==='object'?window:globalThis,function(root,L,G){
  'use strict';
  function create(options){
    const doc=root.document,modal=doc.getElementById('rankedResultsModal');
    const select=modal.querySelector('#rankedMatchSelect'),body=modal.querySelector('#rankedResultBody');
    const selectLabel=modal.querySelector('label[for="rankedMatchSelect"]');
    const message=modal.querySelector('#rankedResultStatus'),errorEl=modal.querySelector('#rankedResultError');
    const approve=modal.querySelector('#rankedApproveBtn'),reject=modal.querySelector('#rankedRejectBtn');
    const retry=modal.querySelector('#rankedRetryBtn'),closeBtn=modal.querySelector('#rankedCloseBtn');
    const pendingButtons=[...doc.querySelectorAll('[data-ranked-pending]')],notes=new Map(),errors=new Map();
    let snapshot={records:new Map(),pending:new Set(),room:null},selected=null,busy=false,previousFocus=null;
    const E=value=>G.escapeHTML(value);
    const gameLabel=game=>({truf:'Truf',remi:'Remi',cangkul:'Cangkul',tebak:'Tebak Kartu'}[game]||game);
    const time=value=>Number.isFinite(value)?new Date(value).toLocaleString('id-ID',{dateStyle:'short',timeStyle:'short'}):'Menunggu server';
    const status=record=>record?.recorded?'recorded':L.stateOf(record);
    function open(id){
      selected=id||snapshot.pending.values().next().value||null;previousFocus=doc.activeElement;
      modal.hidden=false;modal.setAttribute('aria-hidden','false');modal.classList.add('show');renderModal();closeBtn.focus();
    }
    function close(){modal.hidden=true;modal.setAttribute('aria-hidden','true');modal.classList.remove('show');previousFocus?.focus?.();}
    function fail(error,id){
      errors.set(id||'*','Belum tersimpan. Periksa koneksi atau muat ulang halaman, lalu coba lagi.');
      console.warn('[ranked] request failed',error?.code||error?.message||'unknown');render(snapshot);
    }
    function renderModal(){
      const ids=new Set(snapshot.pending);if(selected&&snapshot.records.has(selected))ids.add(selected);
      if(!selected||!ids.has(selected))selected=ids.values().next().value||null;
      select.replaceChildren();
      for(const id of ids){const r=snapshot.records.get(id),option=doc.createElement('option');option.value=id;option.textContent=r?gameLabel(r.game)+' · Room '+r.roomCode:'Memuat hasil…';select.appendChild(option);}
      if(selected)select.value=selected;
      select.disabled=busy||ids.size<2;select.classList.toggle('hidden',ids.size<2);selectLabel?.classList.toggle('hidden',ids.size<2);
      const record=snapshot.records.get(selected),uid=options.uid(),state=status(record);
      const ownVote=record?.votes?.[uid];
      if(record?.result){
        const rows=Object.entries(record.roster).sort((a,b)=>record.result.entries[b[0]].total-record.result.entries[a[0]].total||Number(a[0])-Number(b[0])).map(([seat,p])=>{
          const entry=record.result.entries[seat],vote=record.votes?.[p.uid];
          const label=vote===true?'Setuju':vote===false?'Tidak setuju':'Menunggu';
          const detail=p.name!==p.username?E(p.username)+(p.uid===uid?' · Anda':''):(p.uid===uid?'Anda':'');
          return `<tr><td>${E(p.name)}${detail?'<small>'+detail+'</small>':''}</td><td>${E(entry.total)}</td><td>+${E(entry.points)}</td><td>${label}</td></tr>`;
        }).join('');
        G.setHTML(body,`<p class="ranked-result-context">${E(gameLabel(record.game))} · Room ${E(record.roomCode)} · ${E(record.result.rounds)} ${record.game==='truf'||record.game==='cangkul'?'sesi':'ronde'} selesai<br>Mulai ${E(time(record.createdAt))} · Selesai ${E(time(record.result.finishedAt))}</p><div class="ranked-result-table"><table><thead><tr><th>Pemain</th><th>Skor akhir</th><th>Poin dasar</th><th>Konfirmasi</th></tr></thead><tbody>${rows}</tbody></table></div><p class="ranked-result-help">Periksa hasil sebelum memilih. Setujui hanya pertandingan yang benar-benar Anda ikuti. Poin masuk setelah semua peserta setuju. Bonus 5 poin tetap berlaku pada setiap match kelima. Keputusan yang sudah dikirim tidak dapat diubah.</p>`);
        const agreed=Object.values(record.votes||{}).filter(v=>v===true).length;
        message.textContent=state==='recorded'?'Hasil sudah masuk peringkat.':state==='rejected'?'Hasil ditolak peserta. Tidak ada poin ditambahkan.':state==='ready'?'Semua peserta setuju. Menyimpan hasil…':`${agreed}/${record.size} peserta setuju${ownVote===true?' · Persetujuan Anda sudah tersimpan.':''}`;
      }else{
        G.setHTML(body,'');message.textContent=selected?'Menyiapkan hasil akhir…':'Tidak ada hasil yang menunggu konfirmasi.';
      }
      const mayVote=!!(record?.result&&record.memberSeats?.[uid]!=null&&ownVote===undefined&&state==='pending'&&!options.spectator());
      approve.classList.toggle('hidden',!mayVote);reject.classList.toggle('hidden',!mayVote);
      approve.disabled=busy;reject.disabled=busy;
      retry.classList.toggle('hidden',!selected||state==='recorded'||(!errors.has(selected)&&!errors.has('*')&&state!=='ready'));
      retry.disabled=busy;
      errorEl.textContent=state==='recorded'?'':(errors.get(selected)||errors.get('*')||'');
      errorEl.classList.toggle('hidden',!errorEl.textContent);
      if(busy)message.textContent='Menyimpan keputusan…';
    }
    async function decide(value){
      if(busy||!selected)return;const id=selected;busy=true;errors.delete(id);errors.delete('*');renderModal();
      try{await options.client().vote(id,value);}catch(error){fail(error,id);}finally{busy=false;renderModal();}
    }
    function render(next){
      snapshot=next;
      const count=snapshot.pending.size,visible=!!(options.uid()&&!options.spectator()&&count);
      for(const button of pendingButtons){button.classList.toggle('hidden',!visible);button.textContent=`Hasil peringkat · ${count}`;}
      const room=snapshot.room;
      for(const [game,id]of Object.entries({truf:'tournamentEndModal',remi:'remiTournamentEndModal',cangkul:'cangkulTournamentEndModal',tebak:'tebakMatchEndModal'})){
        const card=doc.getElementById(id)?.querySelector('.modal-card, .modal-content');if(!card)continue;
        if(!notes.has(id)){
          const note=doc.createElement('div'),text=doc.createElement('p'),button=doc.createElement('button');
          note.className='ranked-result-note';button.type='button';button.className='btn';button.textContent='Periksa hasil peringkat';
          note.append(text,button);card.appendChild(note);notes.set(id,{note,text,button});
        }
        const {note,text,button}=notes.get(id),show=room?.game===game&&room.phase===L.END[game]&&!options.spectator();
        note.classList.toggle('hidden',!show);if(!show)continue;
        const matchId=room.rankedMatchId,record=snapshot.records.get(matchId),state=status(record);
        button.classList.toggle('hidden',!matchId||!L.completedMatch(room)||(record&&!record.result&&!L.resultFor(room,record,1)));
        button.onclick=()=>open(matchId);
        text.textContent=!matchId?'Match ini tidak terdaftar untuk peringkat.':!L.completedMatch(room)?'Hasil belum memenuhi syarat peringkat.':
          record&&!record.result&&!L.resultFor(room,record,1)?'Susunan peserta berubah. Match tidak dihitung.':state==='recorded'?'Hasil sudah masuk peringkat.':
          state==='rejected'?'Hasil ditolak peserta. Tidak ada poin ditambahkan.':record?.result?`${Object.values(record.votes||{}).filter(v=>v===true).length}/${record.size} peserta menyetujui hasil peringkat.`:'Menyiapkan hasil peringkat…';
      }
      if(!modal.hidden)renderModal();
    }
    for(const button of pendingButtons)button.onclick=()=>open();
    approve.onclick=()=>decide(true);reject.onclick=()=>decide(false);closeBtn.onclick=close;
    select.onchange=()=>{selected=select.value;renderModal();};
    retry.onclick=async()=>{
      if(busy||!selected)return;const id=selected;busy=true;errors.delete(id);errors.delete('*');renderModal();
      try{await options.client().retry(id);}catch(error){fail(error,id);}finally{busy=false;renderModal();}
    };
    modal.addEventListener('click',event=>{if(event.target===modal)close();});
    doc.addEventListener('keydown',event=>{
      if(modal.hidden)return;
      if(event.key==='Escape'){event.stopPropagation();close();}
      if(event.key==='Tab'){
        const fields=[...modal.querySelectorAll('button:not([disabled]),select:not([disabled])')].filter(el=>!el.classList.contains('hidden'));
        const first=fields[0],last=fields[fields.length-1];
        if(event.shiftKey&&doc.activeElement===first){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&doc.activeElement===last){event.preventDefault();first?.focus();}
      }
    });
    return {render,open,close,fail};
  }
  return {create};
});
