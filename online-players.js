(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.OnlinePlayers=api;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const FRESH_MS=30000;
  function count(rows,now){return Object.values(rows||{}).filter(connections=>Object.values(connections||{}).some(t=>Number.isFinite(t)&&t>now-FRESH_MS&&t<=now+5000)).length;}
  function create(fb,options){
    let uid=null,gen=0,roomOff=null,connectionOff=null,beat=null,tick=null,currentRef=null,rows={},loaded=false,connected=false;
    const ref=p=>fb.ref(fb.db,p),now=options.now||Date.now;
    const render=()=>options.render(connected&&loaded?count(rows,now()):null);
    function stop(){
      gen++;uid=null;roomOff?.();connectionOff?.();roomOff=connectionOff=null;
      clearInterval(beat);clearInterval(tick);beat=tick=null;
      const old=currentRef;currentRef=null;if(old)fb.remove(old).catch(()=>{});
      rows={};loaded=false;connected=false;render();
    }
    function start(){
      if(uid&&uid===fb.authUid)return;stop();uid=fb.authUid;if(!uid)return;
      const actor=uid,version=gen,id=options.id?.()||globalThis.crypto.randomUUID().replace(/-/g,'');
      const own=ref('onlinePlayers/'+actor+'/'+id);currentRef=own;
      const live=()=>gen===version&&uid===actor&&fb.authUid===actor;
      async function heartbeat(){if(live()&&connected)try{await fb.set(own,fb.serverTimestamp());}catch(e){if(live()){loaded=false;render();}}}
      roomOff=fb.onValue(ref('onlinePlayers'),snap=>{if(!live())return;rows=snap.val()||{};loaded=true;render();},()=>{if(live()){loaded=false;render();}});
      connectionOff=fb.onValue(ref('.info/connected'),async snap=>{
        if(!live())return;connected=snap.val()===true;render();if(!connected)return;
        try{await fb.onDisconnect(own).remove();if(!live())return;await heartbeat();}catch(e){if(live()){loaded=false;render();}}
      });
      beat=setInterval(heartbeat,5000);tick=setInterval(render,1000);
    }
    return {start,stop};
  }
  return {FRESH_MS,count,create};
});
