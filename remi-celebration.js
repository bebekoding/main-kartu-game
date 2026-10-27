/* One owned audio element, explicit BGM focus and gesture recovery. */
(function(root,factory){
  const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.RemiCelebration=api;
})(typeof window==='object'?window:globalThis,function(root){
  'use strict';
  function create({sound,document:doc=root.document,audio=new root.Audio('/close-celebration.m4a?v=1'),setTimer=root.setTimeout,clearTimer=root.clearTimeout}={}){
    let active=null,priming=false,primeAttempted=false;
    audio.preload='auto';audio.loop=false;
    function settings(){audio.muted=sound.isMuted();audio.volume=Math.min(1,Math.max(0,sound.getSfxVol()));}
    function silent(){return sound.isMuted()||sound.getSfxVol()===0;}
    function render(job){
      if(active!==job)return;
      job.wrap.dataset.audioState=job.state;
      job.status.textContent=job.state==='blocked'?'Ketuk Putar lagu tutupan untuk mengaktifkan suara.':job.state==='failed'?'Lagu belum bisa diputar. Coba lagi.':job.state==='playing'?(silent()?'Suara tutupan dimatikan.':'Lagu tutupan sedang diputar.'):'Memuat lagu tutupan…';
      job.retry.hidden=job.state==='playing';job.skip.hidden=!['blocked','failed'].includes(job.state);
    }
    function finish(job,resume=true){
      if(active!==job)return;active=null;
      if(job.timer)clearTimer(job.timer);
      for(const [event,fn]of job.listeners)audio.removeEventListener(event,fn);
      audio.pause();try{audio.currentTime=0;}catch(e){}
      if(job.video){job.video.pause();job.video.removeAttribute('src');job.video.load();}
      job.wrap.remove();job.release(resume);
    }
    function attempt(job){
      if(active!==job)return;settings();job.state='loading';render(job);
      const generation=++job.attempt;
      try{
        const playing=audio.play();
        Promise.resolve(playing).then(()=>{
          if(active!==job||job.attempt!==generation)return;
          job.state='playing';render(job);
        }).catch(error=>{
          if(active!==job||job.attempt!==generation)return;
          job.state=error?.name==='NotAllowedError'?'blocked':'failed';render(job);
          if(silent()&&job.visualEnded)finish(job);
        });
      }catch(error){job.state='failed';render(job);}
    }
    function unlock(){
      if(active){attempt(active);return;}
      if(primeAttempted||priming)return;primeAttempted=true;priming=true;
      audio.volume=0;
      try{Promise.resolve(audio.play()).catch(()=>{}).finally(()=>{
        priming=false;if(!active){audio.pause();try{audio.currentTime=0;}catch(e){}settings();}
      });}catch(e){priming=false;}
    }
    function play({key,mode='video'}={}){
      if(active?.key===key)return;
      // Acquire first so replacing an animation never briefly restarts BGM.
      const release=sound.holdBgm();if(active)finish(active);
      const wrap=doc.createElement('div');wrap.className='remi-close-video-wrap';wrap.setAttribute('role','region');wrap.setAttribute('aria-label','Tutupan Remi');
      const media=doc.createElement('div');media.className='remi-close-media';
      const footer=doc.createElement('div');footer.className='remi-close-controls';
      const status=doc.createElement('p');status.setAttribute('role','status');
      const retry=doc.createElement('button');retry.type='button';retry.className='btn primary';retry.textContent='Putar lagu tutupan';
      const minimize=doc.createElement('button');minimize.type='button';minimize.className='btn';minimize.textContent='Sembunyikan animasi';
      const skip=doc.createElement('button');skip.type='button';skip.className='btn';skip.textContent='Lewati suara';skip.hidden=true;
      footer.append(status,retry,minimize,skip);wrap.append(media,footer);
      if(audio.nodeType===1){audio.hidden=true;wrap.appendChild(audio);}
      doc.body.appendChild(wrap);
      const job={key,wrap,media,status,retry,skip,release,state:'loading',attempt:0,listeners:[],visualEnded:false};active=job;
      const listen=(event,fn)=>{audio.addEventListener(event,fn);job.listeners.push([event,fn]);};
      const visualFinished=()=>{if(active!==job)return;job.visualEnded=true;if(silent()&&job.state!=='playing')finish(job);};
      const gif=()=>{
        if(active!==job)return;
        if(job.timer)clearTimer(job.timer);
        if(job.video){const video=job.video;job.video=null;video.pause();video.removeAttribute('src');video.load();}
        const image=doc.createElement('img');image.src='/close-deck.gif?v=2';image.alt='Animasi tutupan Remi';
        media.replaceChildren(image);job.timer=setTimer(visualFinished,6000);
      };
      if(mode==='gif')gif();else{
        const video=doc.createElement('video');job.video=video;video.muted=true;video.playsInline=true;video.preload='auto';video.src='/close-celebration.mp4?v=2';
        video.addEventListener('ended',visualFinished);video.addEventListener('error',gif,{once:true});media.appendChild(video);
        try{Promise.resolve(video.play()).catch(gif);}catch(e){gif();}
      }
      audio.pause();audio.src=mode==='gif'?'/close-deck.mp3?v=2':'/close-celebration.m4a?v=1';try{audio.currentTime=0;}catch(e){}
      listen('ended',()=>finish(job));
      listen('playing',()=>{if(active===job){job.state='playing';render(job);}});
      listen('error',()=>{if(active===job){job.state='failed';render(job);}});
      listen('waiting',()=>{if(active===job){job.state='loading';render(job);}});
      retry.onclick=()=>{if(active!==job)return;if(job.video){try{job.video.currentTime=0;Promise.resolve(job.video.play()).catch(()=>{});}catch(e){}}attempt(job);};
      skip.onclick=()=>finish(job);
      minimize.onclick=()=>{const small=wrap.classList.toggle('minimized');minimize.textContent=small?'Tampilkan animasi':'Sembunyikan animasi';};
      attempt(job);
    }
    const off=sound.onSettingsChange?.(()=>{settings();if(active){render(active);if(active.state!=='playing')attempt(active);}});
    return{play,unlock,stop:()=>{if(active)finish(active,false);},destroy:()=>{if(active)finish(active,false);off?.();},isActive:()=>!!active};
  }
  return{create};
});
