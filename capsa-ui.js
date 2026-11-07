/* Capsa receives only its public table and the authenticated player's hand. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./player-profiles.js'),require('./capsa-engine.js'),require('./bot-names.js'));else root.CapsaUI=factory(root.PlayerProfiles,root.CapsaEngine,root.BotNames);})(typeof window==='object'?window:globalThis,function(P,E,Names){
  'use strict';
  const displayRanks=['3','4','5','6','7','8','9','10','J','Q','K','A','2'],displaySuits=['D','C','H','S'];
  function displayPlay(entry){
    if(entry.cards.length!==5)return entry;
    let {type,cards}=entry;
    if(!type){try{type=E.classify(cards).type;}catch{return entry;}}
    const ranks=cards.map(c=>c.rank);
    const straight=type==='straight'||type==='straight_flush';
    const aceLow=straight&&ranks.includes('A')&&ranks.includes('2');
    const rankOrder=rank=>straight&&rank==='2'?-1:aceLow&&rank==='A'?-2:displayRanks.indexOf(rank);
    const groupSize=type==='full_house'||type==='bomb'?rank=>ranks.filter(r=>r===rank).length:()=>0;
    return {...entry,type,cards:[...cards].sort((a,b)=>groupSize(b.rank)-groupSize(a.rank)||rankOrder(a.rank)-rankOrder(b.rank)||displaySuits.indexOf(a.suit)-displaySuits.indexOf(b.suit))};
  }
  function isBabakEnd(v){
    if(v.legacyScoring||!['round_end','session_end'].includes(v.phase)||v.counts?.[v.winner]!==0)return false;
    if(!E.placementMode(v))return true;
    const order=v.finishOrder,loser=v.revealedHand;
    return Array.isArray(order)&&order.length===3&&new Set(order).size===3&&order[0]===v.winner&&order[2]===v.table?.seat&&
      order.every(i=>v.counts[i]===0)&&v.counts[loser?.seat]>0&&Array.isArray(loser.cards)&&loser.cards.length===v.counts[loser.seat];
  }
  function scoreView(v){
    if(E.placementMode(v)||v.scoringVersion===E.LEGACY_SCORING_VERSION)return v;
    const signed=n=>n>0?-n:n;
    return {
      ...v,legacyScoring:true,scores:v.scores.map(signed),
      history:(v.history||[]).map(h=>({...h,penalties:h.penalties?.map(signed),totals:h.totals?.map(signed)})),
    };
  }
  function create(o){
    const doc=o.document||document,selected=new Set();
    let room=null,view=null,timer=null,boundUid=null,epoch=0,inflight=null,busy=false,offset=0,handStamp='',historyStamp='',seatStamp='',lastPhase=null,tableStamp='',retry=null,scoreAutoKey='';
    const el=(tag,cls,text)=>{const n=doc.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
    const root=el('section','capsa-view hidden');root.id='capsaGameView';root.setAttribute('aria-label','Meja Capsa');
    const top=el('header','capsa-top'),title=el('h1','','Capsa'),meta=el('p','capsa-meta'),tools=el('div','capsa-tools');
    const button=(text,fn,primary=false)=>{const b=el('button','btn'+(primary?' primary':''),text);b.type='button';b.onclick=fn;return b;};
    const historyButton=button('Historis',openHistory),save=button('Simpan game',()=>o.save()),exit=button('Keluar',()=>o.exit());historyButton.classList.add('capsa-history-button');historyButton.setAttribute('aria-haspopup','dialog');historyButton.setAttribute('aria-controls','capsaHistoryDialog');historyButton.setAttribute('aria-expanded','false');const scoreButton=button('Scoreboard',()=>openScores());scoreButton.classList.add('capsa-score-button');scoreButton.setAttribute('aria-haspopup','dialog');scoreButton.setAttribute('aria-controls','capsaScoreDialog');tools.append(scoreButton,historyButton,save);
    if(o.voice){
      const joinVoice=button('🎙 Voice',o.voice.join),muteVoice=button('🎙 Mic Aktif',o.voice.mute),leaveVoice=button('Keluar Voice',o.voice.leave);
      joinVoice.id='capsaVoiceJoinBtn';muteVoice.id='capsaVoiceMuteBtn';leaveVoice.id='capsaVoiceLeaveBtn';
      muteVoice.style.display=leaveVoice.style.display='none';tools.append(joinVoice,muteVoice,leaveVoice);
    }
    tools.append(exit);top.append(title,meta,tools);
    const table=el('div','capsa-table'),status=el('p','capsa-status','Memuat meja...');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    const clock=el('p','capsa-clock'),tableCards=el('div','capsa-table-cards'),results=el('div','capsa-results'),tableLabel=el('p','capsa-table-label');
    const direction=el('div','capsa-direction');direction.setAttribute('aria-hidden','true');
    const turnInfo=el('div','capsa-turn-info');turnInfo.append(status,clock);
    const roundWin=el('div','capsa-round-win'),winTitle=el('h2','capsa-win-title'),winTimer=el('p','capsa-win-timer');roundWin.setAttribute('role','status');roundWin.setAttribute('aria-live','polite');const winSeconds=el('strong','capsa-win-seconds'),winCaption=el('span');winTimer.append(winSeconds,winCaption);roundWin.append(winTitle,winTimer);roundWin.hidden=true;
    table.append(turnInfo,roundWin,tableLabel,tableCards,results);
    const players=el('div','capsa-seats'),board=el('div','capsa-board'),history=el('dialog','capsa-history'),historyTop=el('header','capsa-history-top'),historyTitle=el('h2','','Kartu keluar babak ini'),historyCount=el('span','capsa-history-count'),historyNote=el('p','capsa-history-note'),historyList=el('div','capsa-history-list'),south=el('section','capsa-south'),selfInfo=el('div','capsa-self-info');
    history.id='capsaHistoryDialog';historyTitle.id='capsaHistoryTitle';history.setAttribute('aria-labelledby',historyTitle.id);
    historyList.setAttribute('aria-label','Kartu keluar per ronde');
    const closeHistoryButton=button('Tutup',()=>closeHistory()),historyClock=el('p','capsa-history-clock');historyTop.append(historyTitle,historyCount,closeHistoryButton);history.append(historyTop,historyClock,historyNote,historyList);tableCards.append(players,selfInfo,direction);board.append(table,south);tableCards.setAttribute('aria-label','Kombinasi pada putaran meja aktif');
    history.addEventListener('close',()=>{historyButton.setAttribute('aria-expanded','false');if(active())historyButton.focus();});
    history.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();closeHistory();}});
    const controls=el('div','capsa-actions'),ready=button('Ready',()=>send('ready'),true),play=button('Mainkan kartu',()=>send('play',{cards:[...selected].map(k=>view.hand.find(c=>o.key(c)===k))}),true),pass=button('Pass',()=>send('pass')),
      flip=button('Balik kekuatan',()=>send('choose_bomb',{flip:true}),true),keep=button('Pertahankan',()=>send('choose_bomb',{flip:false})),next=button('Lanjut babak berikutnya',()=>advanceRound(),true),restart=button('Main lagi',startNewGame,true);
    const resultReady=button('Ready',()=>send('confirm_round'),true);
    resultReady.classList.add('capsa-result-ready');
    controls.append(ready,play,pass,flip,keep,resultReady,next,restart);
    for(const b of controls.children){b.hidden=true;b.disabled=true;}save.disabled=true;
    const hint=el('p','capsa-hint','Pilih 1, 2, atau 5 kartu untuk dimainkan.'),hand=el('div','capsa-hand');hand.setAttribute('aria-label','Kartu Anda');
    const error=el('p','capsa-error');error.setAttribute('role','alert');
    const retryButton=button('Coba kirim lagi',()=>retry&&send(retry.type,retry.extra,retry.id));retryButton.hidden=true;
    const handTop=el('div','capsa-hand-top'),handTitle=el('h2','','Kartu Anda'),handHint=el('span','','Pilih kartu untuk membalas');handTop.append(handTitle,handHint);
    south.append(handTop,hand,controls,hint,error,retryButton);const scoreDialog=el('dialog','capsa-score-dialog modal-card'),scoreTitle=el('h2','modal-title'),scoreWinner=el('p','modal-subtitle'),scoreBody=el('div','capsa-score-body'),scoreClose=button('Tutup',()=>closeScores(),true);
    const scoreConfirm=button('Ready',()=>send('confirm_round'),true),scoreNext=button('Lanjut babak berikutnya',()=>advanceRound(),true),scoreReady=el('p','capsa-score-ready');scoreConfirm.classList.add('capsa-confirm-round');scoreNext.classList.add('capsa-next-round');scoreDialog.append(scoreReady,scoreConfirm,scoreNext);
    const finalActions=el('div','capsa-final-actions'),finalNote=el('p','capsa-final-note'),finalError=el('p','capsa-error');
    const finalLeave=button('Meninggalkan room',()=>o.exit()),finalStart=button('Mulai game baru',startNewGame,true);
    finalError.setAttribute('role','alert');finalActions.append(finalLeave,finalStart);scoreDialog.append(finalNote,finalActions,finalError);
    scoreTitle.tabIndex=-1;
    scoreDialog.id='capsaScoreDialog';scoreTitle.id='capsaScoreTitle';scoreDialog.setAttribute('aria-labelledby',scoreTitle.id);scoreDialog.prepend(scoreTitle,scoreWinner,scoreBody);scoreDialog.append(scoreClose);
    scoreDialog.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();closeScores();}});
    root.append(top,board,history,scoreDialog);doc.body.append(root);
    async function advanceRound(){await send('next_round');if(view?.phase!=='round_end')closeScores();}
    function isFinal(v){return v.phase==='session_end'&&isBabakEnd(v);}
    function canRestart(v){return isFinal(v)&&room.host===o.uid()&&!v.frozen&&!room.savedGame&&!busy&&!(v.roundEndUntil>Date.now()+offset);}
    async function startNewGame(){
      if(!active()||!view||!canRestart(view))return;
      const generation=epoch;busy=true;error.textContent=finalError.textContent='';render();
      try{await o.start();}
      catch(e){if(generation===epoch){fail(e);finalError.textContent=error.textContent;}}
      finally{if(generation===epoch){busy=false;render();poll();}}
    }
    function displayNames(v){
      const names=v.players.map(player=>room.players?.[player.uid]?.nickname||player.nickname);
      const taken=new Set(names);
      // Older Capsa rooms stored generic seat labels. Pick consistent display names.
      return names.map((name,index)=>{
        if(!v.players[index].isBot||!/^Bot [1-4]$/.test(name))return name;
        const alias=Names.pick(taken,()=>0);
        taken.add(alias);
        return alias;
      });
    }
    function syncScoreControls(){
      if(!view)return;const v=view,isHost=room.host===o.uid(),placed=E.placementMode(v),ended=v.phase==='round_end'&&isBabakEnd(v),confirmed=v.continueReady||[],allReady=v.players.every((p,i)=>p.isBot||(!placed&&p.uid===room.host)||confirmed[i]);
      scoreConfirm.hidden=!ended||(!placed&&isHost);scoreConfirm.disabled=v.legacyScoring||busy||v.frozen||!!room.savedGame||!!confirmed[v.seat];scoreConfirm.textContent=confirmed[v.seat]?'Sudah Ready':'Ready';
      resultReady.hidden=!placed||!ended||(isHost&&!!confirmed[v.seat]);
      resultReady.disabled=scoreConfirm.disabled;resultReady.textContent=scoreConfirm.textContent;
      next.hidden=!ended||!isHost||(placed&&!confirmed[v.seat]);
      scoreNext.hidden=next.hidden;scoreNext.disabled=v.legacyScoring||!ended||busy||v.frozen||!!room.savedGame||!allReady||(v.roundEndUntil!=null&&Date.now()+offset<v.roundEndUntil);
      scoreReady.hidden=!ended;scoreReady.textContent=ended?displayNames(v).map((name,i)=>`${name}: ${!placed&&v.players[i].uid===room.host?'Host':v.players[i].isBot||confirmed[i]?'Siap':'Menunggu Ready'}`).join(' · '):'';
      next.disabled=scoreNext.disabled;
      const final=isFinal(v);
      finalActions.hidden=finalNote.hidden=!final;
      finalError.hidden=!final||!finalError.textContent;
      finalStart.disabled=!canRestart(v);finalStart.textContent=final&&busy?'Memulai…':'Mulai game baru';
      finalLeave.disabled=busy;
      scoreClose.hidden=final;
      scoreClose.textContent=ended?'Minimalkan':'Tutup';
      finalNote.textContent=!final?'':isHost?`Game baru memakai kode room ${room.code}.`:`Host dapat memulai game baru dengan kode room ${room.code}.`;
    }
    function closeScores(){if(scoreDialog.open){if(scoreDialog.close)scoreDialog.close();else scoreDialog.removeAttribute('open');if(active())scoreButton.focus();}}
    function openScores(){
      if(!view||!active())return;closeHistory();const v=view,ended=isBabakEnd(v),names=displayNames(v);
      const final=isFinal(v),groups=o.standings(v.scores),winners=groups[0].seats.map(i=>names[i]);
      scoreDialog.dataset.round=`${v.matchId}:${v.round}:${v.phase}`;
      scoreTitle.textContent=final?'Papan skor akhir':ended?`Babak ${v.round} berakhir`:'Skor dan peringkat';
      scoreWinner.textContent=final?`Selamat, ${winners.join(' dan ')}!${winners.length>1?' Kalian berbagi peringkat pertama.':''}`:ended?`${names[v.winner]} memenangkan babak`:`Babak ${v.round} · Poin tertinggi mendapat peringkat terbaik`;
      scoreBody.replaceChildren();const heading=el('h3','','Skor dan peringkat'),grid=el('table','scoreboard'),head=el('thead'),hr=el('tr');
      const result=ended&&!final?v.history.at(-1):null,placements=result?.placements,points=result?.points||result?.penalties;
      for(const label of ['Peringkat','Pemain',...(placements?['Posisi babak']:[]),...(!final?['Poin babak']:[]),'Total'])hr.append(el('th','',label));
      head.append(hr);grid.append(head);const body=el('tbody');let rank=1;
      for(const group of groups){
        for(const seat of group.seats){
          const row=el('tr',rank===1?'winner-row':''),name=el('td','name',names[seat]),uid=v.players[seat].uid;
          name.prepend(P.avatar(doc,room.players?.[uid]?.avatarId||P.fallbackIcon(uid)));
          row.append(el('td','',String(rank)+(group.seats.length>1?' =':'')),name);
          if(placements)row.append(el('td','',String(placements.indexOf(seat)+1)));
          if(!final)row.append(el('td','',points?String(points[seat]):'·'));
          row.append(el('td','',String(group.score)));body.append(row);
        }
        rank+=group.seats.length;
      }
      grid.append(body);if(!final)scoreBody.append(heading);scoreBody.append(grid);syncScoreControls();if(!scoreDialog.open){if(scoreDialog.showModal)scoreDialog.showModal();else scoreDialog.setAttribute('open','');}(final?scoreTitle:scoreClose).focus();
    }
    function openHistory(){if(!view||!active()||history.open)return;render();if(scoreDialog.open)return;if(history.showModal)history.showModal();else history.setAttribute('open','');historyButton.setAttribute('aria-expanded','true');closeHistoryButton.focus();}
    function closeHistory(){if(!history.open)return;if(history.close)history.close();else{history.removeAttribute('open');historyButton.setAttribute('aria-expanded','false');if(active())historyButton.focus();}}
    function fail(e){error.textContent=e.message||'Koneksi terputus. Coba lagi.';}
    function active(){return room&&room.game==='capsa'&&room.phase!=='lobby'&&o.local()&&o.uid()===boundUid;}
    async function request(method,data,signal){
      const code=room.code;
      if(o.transport){const result=o.transport(code,data,signal);if(result)return result;}
      const token=await o.token();
      const r=await (o.fetch||fetch)(`/capsa-api/rooms/${code}`,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined,signal});
      const result=await r.json();if(!r.ok){const e=Error(result.error||'Permintaan belum berhasil.');e.status=r.status;throw e;}return result;
    }
    async function poll(){
      if(!active()){if(room)stop();return;}if(inflight)return;
      const generation=epoch,uid=o.uid();inflight=new AbortController();
      try{const data=await request('GET',null,inflight.signal);if(generation!==epoch||uid!==o.uid())return;if(view&&data.matchId===view.matchId&&data.revision<view.revision)return;view=scoreView(data);offset=data.serverNow-Date.now();render();}
      catch(e){if(generation===epoch&&e.name!=='AbortError')fail(e);}
      finally{if(generation===epoch)inflight=null;}
    }
    async function send(type,extra={},id){
      if(busy||!view||!active())return;
      const generation=epoch,uid=o.uid();busy=true;error.textContent='';
      // Retain a lost-ack packet, including its revision; retry uses its exact ID.
      let packet=id&&retry?retry.packet:{type,...extra,id:id||'client_'+crypto.randomUUID(),expectedRevision:view.revision,matchId:view.matchId,generation:view.generation};
      render();
      try{
        let data;
        for(let attempt=0;attempt<8;attempt++){
          try{data=await request('POST',packet);break;}
          catch(e){
            if(!['ready','confirm_round'].includes(type)||e.status!==409||attempt===7)throw e;
            const fresh=await request('GET');
            if(generation!==epoch||uid!==o.uid())return;
            // Independent Ready votes can race. Refresh/retry this vote only;
            // never replay a card move automatically against a new revision.
            if(type==='ready'?(fresh.phase!=='round_ready'||fresh.ready[fresh.seat]):(fresh.phase!=='round_end'||fresh.continueReady?.[fresh.seat])){data=fresh;break;}
            packet={...packet,id:'client_'+crypto.randomUUID(),expectedRevision:fresh.revision,generation:fresh.generation};
          }
        }
        if(generation!==epoch||uid!==o.uid())return;
        retry=null;view=scoreView(data);offset=data.serverNow-Date.now();selected.clear();handStamp='';
        if(type==='play')o.sound?.();
      }catch(e){if(generation!==epoch)return;fail(e);if(!e.status||e.status>=500)retry={type,extra,id:packet.id,packet};else retry=null;}
      finally{if(generation===epoch){busy=false;render();poll();}}
    }
    function card(c,interactive){
      const n=o.card(c,interactive);n.setAttribute('aria-label',c.rank+' '+({S:'sekop',H:'hati',C:'keriting',D:'wajik'}[c.suit]));
      if(interactive){const k=o.key(c);n.type='button';n.classList.toggle('selected',selected.has(k));n.setAttribute('aria-pressed',String(selected.has(k)));
        n.onclick=()=>{if(selected.has(k))selected.delete(k);else selected.add(k);handStamp='';render();const focus=Array.from(hand.children).find(n=>n.dataset.key===k);focus?.focus();};n.dataset.key=k;}
      return n;
    }
    const comboNames={single:'Single',pair:'Pair',straight:'Straight',flush:'Flush',full_house:'Full house',bomb:'Bomb',straight_flush:'Straight flush'};
    function renderHistory(v,names){
      const roundKey=`${v.matchId}:${v.round}`;
      const newRound=history.dataset.round!==roundKey;
      if(newRound){closeHistory();history.dataset.round=roundKey;}
      const plays=v.roundPlays||[];
      const stamp=JSON.stringify([roundKey,plays,names,v.seat,v.roundPlaysIncomplete,v.trick,v.tableStart,!!v.table]);
      if(stamp===historyStamp)return;
      historyStamp=stamp;
      const openRounds=new Map(newRound?[]:Array.from(historyList.querySelectorAll('details'),node=>[node.dataset.trick,node.open]));
      const focusedRound=doc.activeElement?.closest('details')?.dataset.trick;
      historyTitle.textContent=`Historis babak ${v.round}`;historyButton.disabled=false;
      historyCount.textContent=`${plays.reduce((n,play)=>n+play.cards.length,0)} / 52 kartu`;
      const groups=new Map();
      for(const [index,play] of plays.entries()){
        // Saved rooms predating trick numbers can identify only the active table.
        const current=Number.isInteger(v.tableStart)&&v.tableStart>=0&&v.table&&index>=v.tableStart;
        const trick=play.trick??(current?v.trick:0)??0;
        if(!groups.has(trick))groups.set(trick,[]);
        groups.get(trick).push({play:displayPlay(play),index});
      }
      historyNote.textContent=v.roundPlaysIncomplete?'Kartu sebelum pembaruan belum tersedia.':'Garis emas menandai kombinasi terakhir.';
      historyList.replaceChildren();
      if(!groups.size){historyList.append(el('p','capsa-history-empty','Belum ada kartu keluar.'));return;}
      const tricks=[...groups.keys()].sort((a,b)=>b-a);
      for(const trick of tricks){
        const entries=groups.get(trick),section=el('details','capsa-history-round');
        section.dataset.trick=String(trick);
        section.open=openRounds.get(section.dataset.trick)??trick===tricks[0];
        const title=trick?`Ronde ${trick}`:'Ronde tidak tercatat';
        const count=entries.reduce((n,{play})=>n+play.cards.length,0);
        const summary=el('summary');
        summary.append(el('strong','',title),el('span','capsa-history-count',`${count} kartu`));
        section.append(summary);
        for(const {play,index} of entries){
          const player=v.players[play.seat];
          const name=play.uid&&play.uid!==player?.uid?play.nickname||'Pemain sebelumnya':names[play.seat];
          const row=el('div','capsa-history-play');
          const label=el('div','capsa-history-play-label');
          label.append(el('strong','',name),el('small','',comboNames[play.type]||'Kartu'));
          const cards=el('div','capsa-history-cards');
          for(const c of play.cards){
            const face=tableCard(c,'capsa-history-card'+(index===plays.length-1?' is-latest':''));
            face.dataset.play=index+1;
            cards.append(face);
          }
          row.append(label,cards);section.append(row);
        }
        historyList.append(section);
        if(history.open&&focusedRound===section.dataset.trick)summary.focus({preventScroll:true});
      }
    }
    function renderSeats(v,names){
      const stamp=JSON.stringify([v.matchId,v.round,names,v.players,v.seat,v.turn,v.phase,v.ready,v.passed,v.counts,v.scores,v.finishOrder,v.revealedHand?.seat]);
      if(stamp===seatStamp)return;
      seatStamp=stamp;tableStamp='';
      players.replaceChildren();selfInfo.replaceChildren();
      const ordered=[(v.seat+2)%4,(v.seat+1)%4,(v.seat+3)%4,v.seat];
      for(const index of ordered){
        const p=v.players[index];
        const place=v.finishOrder?.indexOf(index)??-1;
        const state=place>=0?(v.phase==='bomb_choice'&&v.turn===index?`Peringkat ${place+1} · Pilih mode`:`Peringkat ${place+1}`):isBabakEnd(v)&&v.revealedHand?.seat===index?'Peringkat 4':v.phase==='round_ready'?(v.ready[index]?'Siap':'Belum Ready'):['round_end','session_end'].includes(v.phase)?(index===v.winner?'Pemenang':''):index===v.turn?'Giliran':v.passed.includes(index)?'PASS':p.isBot?'Bot':'';
        const seat=el('div','capsa-seat'+(index===v.turn&&['playing','bomb_choice'].includes(v.phase)?' is-turn':'')),seatName=el('strong','',`${names[index]}${index===v.seat?' · Anda':''}`);seat.dataset.position=['south','west','north','east'][(index-v.seat+4)%4];seat.dataset.seat=index;seat.setAttribute('aria-label',`${{north:'Utara',south:'Selatan',east:'Timur',west:'Barat'}[seat.dataset.position]} · ${names[index]}`);seatName.dataset.profileUid=p.uid;const avatarId=room.players?.[p.uid]?.avatarId;seatName.prepend(P.avatar(doc,P.validIcon(avatarId)?avatarId:P.fallbackIcon(p.uid)));const stateLabel=el('small','capsa-seat-state',state==='PASS'?'':state),played=el('div','capsa-seat-plays');played.setAttribute('aria-label','Kartu keluar '+names[index]);const details=el('div','capsa-seat-details');details.append(el('span','',`${v.counts[index]} kartu · ${v.scores[index]} poin`),stateLabel);seat.append(seatName,details,played);if(index===v.seat)selfInfo.append(seat);else players.append(seat);
      }
    }
    function tableEntries(v){
      const history=v.roundPlays||[];
      if(!E.placementMode(v)&&['round_end','session_end'].includes(v.phase))return history.length?history:v.table?[v.table]:[];
      if(!v.table)return [];
      if(Number.isInteger(v.tableStart)&&v.tableStart>=0&&v.tableStart<history.length)return history.slice(v.tableStart);
      // Older saved matches have no reliable boundary: show only the current play.
      return [{...v.table,type:v.table.cards.length===1?'single':v.table.cards.length===2?'pair':null}];
    }
    function tableCard(c,className){
      const suit={S:'sekop',H:'hati',C:'keriting',D:'wajik'}[c.suit];
      const face=el('div',className+(['H','D'].includes(c.suit)?' red':''));
      face.setAttribute('aria-label',c.rank+' '+suit);
      face.append(el('b','',c.rank),el('span','',{S:'♠',H:'♥',C:'♣',D:'♦'}[c.suit]));
      return face;
    }
    function renderTable(v,names,reveal){
      const entries=tableEntries(v).map(displayPlay);
      direction.textContent=v.direction===-1?'↺':'↻';direction.title=v.direction===-1?'Berlawanan arah jarum jam':'Searah jarum jam';
      const stamp=JSON.stringify([v.matchId,v.round,entries,names,v.seat,v.phase,v.passed,reveal]);if(stamp===tableStamp)return;tableStamp=stamp;
      if(!players.parentNode)tableCards.append(players,selfInfo,direction);
      for(const target of tableCards.querySelectorAll('.capsa-seat-plays'))target.replaceChildren();
      const ordered=[(v.seat+2)%4,(v.seat+1)%4,(v.seat+3)%4,v.seat];
      for(const index of ordered){
        const own=entries.map((entry,i)=>({entry,i})).filter(x=>x.entry.seat===index);
        const groups=tableCards.querySelector(`.capsa-seat[data-seat="${index}"] .capsa-seat-plays`);if(!groups)continue;
        groups.classList.toggle('is-dense',own.reduce((n,x)=>n+x.entry.cards.length,0)>7);
        groups.setAttribute('aria-label',(reveal?.seat===index?'Kartu ':'Kartu keluar ')+names[index]);
        if(reveal?.seat===index){
          const remaining=el('div','capsa-revealed-hand');
          remaining.setAttribute('role','group');
          remaining.setAttribute('aria-label','Sisa kartu '+names[index]);
          const cards=el('div','capsa-revealed-cards');
          for(const c of [...reveal.cards].sort((a,b)=>o.compare([a],[b])||0)){
            cards.append(tableCard(c,'capsa-revealed-card capsa-laid-card'));
          }
          remaining.append(el('strong','capsa-revealed-label','Sisa kartu'),cards);
          groups.append(remaining);
        }
        for(const {entry,i} of own){
          const group=el('div','capsa-play-group'+(i===entries.length-1?' is-latest':''));group.dataset.play=i+1;
          const name=entry.uid&&entry.uid!==v.players[index]?.uid?entry.nickname||names[index]:names[index];
          group.title=`#${i+1} · ${name} · ${comboNames[entry.type]||'Kartu'}`;group.setAttribute('aria-label',group.title);
          for(const c of entry.cards)group.append(tableCard(c,'capsa-laid-card'));
          groups.append(group);
        }
        if(!isBabakEnd(v)&&v.passed.includes(index))groups.append(el('strong','capsa-pass','PASS'));
      }
    }
    function render(){
      if(!active()){if(room)stop();return;}
      if(!view)return;const v=view,mine=v.turn===v.seat,frozen=!!room.savedGame||v.frozen;
      const placed=E.placementMode(v),ended=isBabakEnd(v),reveal=placed&&ended?v.revealedHand:null;
      const remaining=ended&&v.roundEndUntil!=null?Math.max(0,Math.ceil((v.roundEndUntil-Date.now()-offset)/1000)):0,showWin=ended&&(!!reveal||v.phase==='round_end'||remaining>0);
      meta.textContent=`${room.code} · Babak ${v.round}/15 · Ronde ${v.trick||1} · ${v.direction===1?'Searah jarum jam':'Berlawanan jarum jam'} · ${v.reversed?'Mode : Reverse':'Mode : normal'}`;

      const names=displayNames(v);
      const scoreKey=`${v.matchId}:${v.round}:${v.phase}`;
      if(scoreDialog.open&&(scoreDialog.dataset.round!==scoreKey||frozen)){
        closeScores();finalError.textContent='';
      }
      renderHistory(v,names);renderSeats(v,names);renderTable(v,names,reveal);
      const showScores=ended&&!frozen&&(!isFinal(v)||remaining===0);
      if(showScores&&scoreAutoKey!==scoreKey){
        scoreAutoKey=scoreKey;
        if(!scoreDialog.open)openScores();
      }
      const phrases={round_ready:'Tekan Ready setelah Anda siap. Menunggu seluruh pemain.',playing:mine?'Giliran Anda. Pilih kartu, lalu mainkan.':`Menunggu ${names[v.turn]} bermain.`,bomb_choice:mine?'Bomb Anda menang. Balik kekuatan atau pertahankan?':`${names[v.turn]} sedang memilih kekuatan.`,round_end:ended?`${names[v.winner]} menghabiskan kartu. Babak selesai.`:'Menyinkronkan status kartu babak...',session_end:ended?`Sesi selesai: ${v.endReason==='game_limit'?'15 babak selesai':(placed?'batas 60 poin tercapai':'batas -300 poin tercapai')}. Poin tertinggi mendapat peringkat terbaik.`:'Menyinkronkan status kartu babak...'};
      const message=v.legacyScoring?'Menunggu host memuat ulang halaman untuk aturan skor terbaru.':frozen?'Game dibekukan untuk simpan/lanjut.':phrases[v.phase];if(status.textContent!==message)status.textContent=message;
      if(showWin&&lastPhase!==v.phase)closeHistory();lastPhase=v.phase;
      roundWin.hidden=!showWin;winTitle.textContent=ended?`Babak ${v.round} berakhir · ${names[v.winner]} memenangkan babak`:'';
      winSeconds.hidden=!!reveal||frozen||remaining<=0;winSeconds.textContent=remaining;
      winTimer.hidden=!!reveal&&v.phase==='round_end';
      winCaption.textContent=reveal?(v.phase==='session_end'?phrases.session_end:''):frozen?'Jeda dihentikan saat game disimpan.':remaining>0?` detik · ${v.phase==='session_end'?'Hasil akhir segera ditampilkan':'Setelah jeda, konfirmasi untuk lanjut'}`:v.roundEndUntil==null?'Babak selesai.':'Menunggu konfirmasi Ready dan host melanjutkan babak.';
      clock.textContent=v.deadline&&!frozen?`${Math.max(0,Math.ceil((v.deadline-Date.now()-offset)/1000))} detik`:'Timer belum berjalan';
      historyClock.textContent=frozen?'Game sedang disimpan.':v.phase==='playing'?`${mine?'Giliran Anda':`Giliran ${names[v.turn]}`} · ${clock.textContent}. Timer tetap berjalan.`:v.phase==='bomb_choice'?`${names[v.turn]} memilih kekuatan · ${clock.textContent}.`:v.phase==='round_ready'?'Menunggu semua pemain Ready.':'Babak selesai.';
      turnInfo.hidden=showWin;tableLabel.hidden=!!reveal;tableCards.hidden=false;
      const count=tableEntries(v).reduce((n,p)=>n+p.cards.length,0);
      tableLabel.textContent=`Ronde ${v.trick||1} · ${count} kartu di meja${v.table?` · Terakhir: ${names[v.table.seat]}`:v.lastTrickWinner!=null?` · ${names[v.lastTrickWinner]} menang ronde sebelumnya · ${names[v.turn]} membuka ronde ini`:' · Meja terbuka'}`;
      results.replaceChildren();results.hidden=showWin;if(ended&&!showWin){
        for(const group of o.standings(v.scores))results.append(el('p','',`${group.score} poin · ${group.seats.map(i=>names[i]).join(' / ')}${group.seats.length>1?' · Seri':''}`));
        const penalties=v.history.at(-1)?.penalties;if(penalties)results.append(el('p','capsa-hint','Pengurangan babak: '+penalties.map((n,i)=>`${names[i]} ${n}`).join(' · ')));
      }
      const permitted=!busy&&!frozen&&!v.legacyScoring,playing=v.phase==='playing'&&mine;
      ready.hidden=v.phase!=='round_ready';ready.disabled=!permitted||v.ready[v.seat];ready.textContent=v.ready[v.seat]?'Sudah Ready':'Ready';
      play.hidden=pass.hidden=v.phase!=='playing';play.disabled=!permitted||!playing||![1,2,5].includes(selected.size);pass.disabled=!permitted||!playing||!v.table;
      flip.hidden=keep.hidden=v.phase!=='bomb_choice';flip.disabled=keep.disabled=!permitted||!mine;
      syncScoreControls();
      restart.hidden=!ended||v.phase!=='session_end'||remaining>0;restart.disabled=!canRestart(v);
      save.hidden=v.phase==='session_end';save.disabled=busy||frozen;retryButton.hidden=!retry;retryButton.disabled=busy;
      hint.hidden=!!reveal&&v.phase==='round_end';
      hint.textContent=placed&&v.phase==='playing'&&v.finishOrder?.includes(v.seat)?'Anda sudah finis. Menunggu pemain lain menyelesaikan babak.':ended?(v.phase==='session_end'?'Sesi selesai. Poin tertinggi mendapat peringkat terbaik.':'Babak berikutnya menunggu semua pemain Ready.'):busy?'Mengirim aksi...':v.counts.every(n=>n===13)?'Pembuka setiap babak wajib memuat 3 wajik. Pilih 1, 2, atau 5 kartu.':'Pilih 1, 2, atau 5 kartu. Balasan harus berjumlah sama dan lebih kuat.';
      const valid=new Set(v.hand.map(o.key));for(const k of selected)if(!valid.has(k))selected.delete(k);
      // The player's hand area never renders another seat's cards.
      handTop.hidden=hand.hidden=!!reveal;
      const handCards=reveal?[]:v.hand;
      const stamp=JSON.stringify([handCards,[...selected],playing,permitted,v.reversed]);
      if(stamp!==handStamp){handStamp=stamp;hand.replaceChildren();
        const cards=[...handCards].sort((a,b)=>o.compare([a],[b],v.reversed)||0);
        for(const c of cards){const n=card(c,true);n.disabled=!playing||!permitted;hand.append(n);}}
    }
    function stop(){closeScores();finalError.textContent='';scoreAutoKey='';epoch++;room=null;view=null;boundUid=null;for(const b of controls.children){b.hidden=true;b.disabled=true;}save.disabled=true;historyButton.disabled=true;closeHistory();players.replaceChildren();selfInfo.replaceChildren();hand.replaceChildren();tableCards.replaceChildren();historyList.replaceChildren();historyCount.textContent='';historyNote.textContent='';error.textContent='';selected.clear();retry=null;busy=false;handStamp='';historyStamp='';seatStamp='';tableStamp='';lastPhase=null;if(timer)clearInterval(timer);timer=null;if(inflight)inflight.abort();inflight=null;root.classList.add('hidden');root.style.display='';}
    return {observe(r){
      if(!r||r.game!=='capsa'||r.phase==='lobby'||!o.local()){if(room)stop();return;}
      if(room?.code!==r.code||boundUid!==o.uid()){stop();room=r;boundUid=o.uid();root.classList.remove('hidden');o.enter(root);poll();timer=setInterval(()=>{render();poll();},800);}
      else {room=r;root.classList.remove('hidden');o.enter(root);render();poll();}
    },stop,poll,send,element:root};
  }
  return {create};
});
