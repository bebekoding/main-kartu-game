(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./player-profiles.js'));
  else root.ProfileUI=factory(root.PlayerProfiles);
})(typeof window==='object'?window:globalThis,function(P){
  'use strict';
  function create(fb,options){
    const doc=options.document||document,modal=doc.getElementById('profileModal'),form=doc.getElementById('profileForm');
    const input=doc.getElementById('profileNameInput'),grid=doc.getElementById('profileIconGrid'),save=doc.getElementById('profileSaveBtn');
    const errorEl=doc.getElementById('profileError'),preview=doc.getElementById('profilePreview'),tabs=doc.getElementById('profileIconGroups');
    let profiles={},uid=null,generation=0,editVersion=0,off=null,observer=null,queued=false,loading=false,busy=false,dirty=false,group='Semua',previousFocus=null;
    let draft={displayName:'',avatarId:'konoha'};
    const ref=path=>fb.ref(fb.db,path),E=(tag,cls,text)=>{const e=doc.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;};
    const same=(id,gen)=>uid===id&&options.uid()===id&&fb.authUid===id&&generation===gen;
    function decorateDOM(){
      doc.querySelectorAll('[data-profile-uid]').forEach(target=>{
        const id=target.dataset.profileUid;if(!id||id==='undefined')return;
        const wanted=P.iconFor(id,profiles),old=target.querySelector(':scope > .player-avatar');
        if(old?.classList.contains('avatar-'+wanted))return;
        old?.remove();target.prepend(P.avatar(doc,wanted));target.classList.add('profile-player-name');
      });
    }
    function buttons(){
      doc.querySelectorAll('[data-profile-open]').forEach(button=>{
        button.hidden=!uid;button.replaceChildren();
        if(!uid)return;
        button.append(P.avatar(doc,P.iconFor(uid,profiles)),E('span','',P.nameFor({uid,nickname:options.fallbackName()},profiles)),E('small','','Profil'));
      });
    }
    function publish(){buttons();decorateDOM();options.changed?.(profiles);}
    function stop(){
      generation++;off?.();off=null;observer?.disconnect();observer=null;uid=null;profiles={};close();buttons();
    }
    function start(){
      const next=options.uid();if(uid===next&&off)return;
      stop();uid=next;if(!uid||fb.authUid!==uid)return;
      const actor=uid,gen=generation;
      off=fb.onValue(ref('profiles'),snap=>{
        if(!same(actor,gen))return;profiles=snap.val()||{};publish();
      },error=>{if(same(actor,gen)&&!modal.hidden)errorEl.textContent='Profil belum bisa dimuat. Periksa koneksi Anda.';});
      if(doc.defaultView?.MutationObserver){
        observer=new doc.defaultView.MutationObserver(records=>{
          if(queued||!records.some(r=>r.type==='childList'&&(r.target?.matches?.('[data-profile-uid]')||[...r.addedNodes].some(n=>n.nodeType===1&&(n.matches?.('[data-profile-uid]')||n.querySelector?.('[data-profile-uid]'))))))return;
          queued=true;Promise.resolve().then(()=>{queued=false;if(same(actor,gen))decorateDOM();});
        });
        observer.observe(doc.body,{childList:true,subtree:true});
      }
      buttons();decorateDOM();
    }
    function render(){
      const valid=P.validName(draft.displayName);
      input.disabled=loading||busy;save.disabled=loading||busy||!valid||!P.validIcon(draft.avatarId);
      save.textContent=busy?'Menyimpan...':'Simpan profil';
      input.setAttribute('aria-invalid',String(!valid&&dirty));
      doc.getElementById('profileNameCount').textContent=draft.displayName.length+'/16';
      doc.getElementById('profileNameHint').textContent=!valid&&dirty?'Gunakan 4–16 karakter huruf A–Z, angka, atau simbol keyboard, tanpa spasi.':'4–16 karakter huruf A–Z, angka, atau simbol keyboard. Tanpa spasi.';
      preview.replaceChildren(P.avatar(doc,draft.avatarId,false),E('span','',draft.displayName||'Nama profil Anda'));
      tabs.replaceChildren();
      for(const label of ['Semua',...new Set(P.ICONS.map(i=>i.group))]){
        const button=E('button','profile-filter',label);button.type='button';button.disabled=loading||busy;
        button.setAttribute('aria-pressed',String(group===label));button.onclick=()=>{group=label;render();[...tabs.querySelectorAll('button')].find(b=>b.textContent===label)?.focus();};tabs.append(button);
      }
      const focused=doc.activeElement?.dataset?.avatarId;grid.replaceChildren();
      for(const icon of P.ICONS.filter(i=>group==='Semua'||i.group===group)){
        const button=E('button','profile-icon-choice');button.type='button';button.dataset.avatarId=icon.id;
        button.setAttribute('aria-label',icon.label+' · '+icon.group);button.setAttribute('aria-pressed',String(draft.avatarId===icon.id));button.disabled=loading||busy;
        button.append(P.avatar(doc,icon.id),E('span','',icon.label));button.onclick=()=>{draft.avatarId=icon.id;dirty=true;errorEl.textContent='';render();grid.querySelector(`[data-avatar-id="${icon.id}"]`)?.focus();};grid.append(button);
      }
      if(focused)grid.querySelector(`[data-avatar-id="${focused}"]`)?.focus();
    }
    async function open(){
      if(!uid||options.uid()!==uid)return;
      const actor=uid,gen=generation,edit=++editVersion;previousFocus=doc.activeElement;
      draft={displayName:P.nameFor({uid,nickname:options.fallbackName()},profiles),avatarId:P.iconFor(uid,profiles)};
      input.value=draft.displayName;dirty=false;group='Semua';loading=true;busy=false;errorEl.textContent='';
      doc.getElementById('profileLoginName').textContent='Akun login: '+options.loginName()+'. Nama profil tidak mengubah akun login.';
      modal.hidden=false;modal.setAttribute('aria-hidden','false');modal.classList.add('show');render();
      try{
        const snap=await fb.get(ref('profiles/'+actor));if(!same(actor,gen)||edit!==editVersion||modal.hidden)return;
        if(snap.exists()){profiles[actor]=snap.val();draft={displayName:P.nameFor({uid:actor,nickname:options.fallbackName()},profiles),avatarId:P.iconFor(actor,profiles)};input.value=draft.displayName;publish();}
      }catch(e){if(same(actor,gen)&&edit===editVersion)errorEl.textContent='Profil belum bisa dimuat. Periksa koneksi lalu coba lagi.';}
      finally{if(same(actor,gen)&&edit===editVersion&&!modal.hidden){loading=false;render();input.focus();}}
    }
    function close(){editVersion++;modal.hidden=true;modal.setAttribute('aria-hidden','true');modal.classList.remove('show');previousFocus?.focus?.();}
    async function submit(event){
      event?.preventDefault();if(busy||loading||!uid)return;
      draft.displayName=input.value;dirty=true;
      if(!P.validName(draft.displayName)||!P.validIcon(draft.avatarId)){render();input.focus();return;}
      const actor=uid,gen=generation,edit=editVersion,value={displayName:draft.displayName,avatarId:draft.avatarId,updatedAt:fb.serverTimestamp()};
      busy=true;errorEl.textContent='';render();
      try{
        await fb.set(ref('profiles/'+actor),value);if(!same(actor,gen))return;
        profiles[actor]={...value};publish();if(edit===editVersion){close();options.saved?.();}
      }catch(e){if(same(actor,gen)&&edit===editVersion)errorEl.textContent='Profil belum tersimpan. Periksa koneksi lalu coba lagi.';}
      finally{if(same(actor,gen)&&(edit===editVersion||modal.hidden)){busy=false;if(!modal.hidden)render();}}
    }
    input.oninput=()=>{draft.displayName=input.value;dirty=true;errorEl.textContent='';render();};form.onsubmit=submit;
    doc.querySelectorAll('[data-profile-open]').forEach(button=>{button.onclick=open;});doc.getElementById('profileCancelBtn').onclick=close;
    doc.getElementById('profileRandomBtn').onclick=()=>{
      const choices=P.ICONS.filter(i=>i.id!==draft.avatarId);draft.avatarId=choices[Math.floor(Math.random()*choices.length)].id;dirty=true;group='Semua';errorEl.textContent='';render();
    };
    modal.addEventListener('click',event=>{if(event.target===modal&&!busy)close();});
    modal.addEventListener('keydown',event=>{
      if(event.key==='Escape'&&!busy){event.stopPropagation();close();}
      if(event.key==='Tab'){
        const fields=[...modal.querySelectorAll('input:not(:disabled),button:not(:disabled)')],first=fields[0],last=fields[fields.length-1];
        if(event.shiftKey&&doc.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&doc.activeElement===last){event.preventDefault();first?.focus();}
      }
    });
    return {start,stop,open,close,submit,decorateDOM,get profiles(){return profiles;}};
  }
  return {create};
});
