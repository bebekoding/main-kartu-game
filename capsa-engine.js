/* Pure Capsa rules. No Firebase, timers, randomness or DOM side effects.
 * The transport must authorize actors, supply trusted time, and commit revisions
 * atomically. This module alone is not a server security boundary.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CapsaEngine = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const RULES_VERSION = 'capsa-v4.4-kickoff-1';
  const TURN_MS = 30000;
  const turnDuration = round => round <= 2 ? 45000 : TURN_MS;
  const ROUND_PAUSE_MS = 7000;
  const RANKS = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
  const SUITS = ['D','C','H','S'];
  const TYPES = ['straight','flush','full_house','bomb','straight_flush'];
  const PHASES = ['round_ready','playing','bomb_choice','round_end','session_end'];
  const copy = value => JSON.parse(JSON.stringify(value));
  const seat = value => Number.isInteger(value) && value >= 0 && value < 4;
  const fail = message => { throw new Error(message); };
  function cardKey(card) {
    if (!card || !RANKS.includes(card.rank) || !SUITS.includes(card.suit) || card.joker) {
      fail('Kartu tidak valid.');
    }
    return card.rank + card.suit;
  }
  function cleanCards(cards) {
    if (!Array.isArray(cards)) fail('Daftar kartu tidak valid.');
    const keys = cards.map(cardKey);
    if (new Set(keys).size !== keys.length) fail('Kartu duplikat.');
    return cards.map(c => ({rank:c.rank, suit:c.suit}));
  }
  function deck() {
    return RANKS.flatMap(rank => SUITS.map(suit => ({rank, suit})));
  }
  function checkedDeck(cards) {
    const result = cleanCards(cards);
    if (result.length !== 52) fail('Pembagian membutuhkan tepat 52 kartu.');
    return result;
  }
  function straightEnd(cards) {
    const nums = cards.map(c => ({J:11,Q:12,K:13,A:14}[c.rank] || Number(c.rank))).sort((a,b)=>a-b);
    if (new Set(nums).size !== 5) return null;
    if (nums.join(',') === '2,3,4,5,14') return 5;
    if (nums[0] >= 2 && nums[4] <= 14 && nums.every((v,i)=>v===nums[0]+i)) return nums[4];
    return null;
  }
  function classify(cards) {
    cards = cleanCards(cards);
    if (![1,2,5].includes(cards.length)) fail('Mainkan single, pair, atau kombinasi lima kartu.');
    const counts = {};
    for (const c of cards) counts[c.rank] = (counts[c.rank] || 0) + 1;
    if (cards.length === 1) return {type:'single', cards};
    if (cards.length === 2) {
      if (cards[0].rank !== cards[1].rank) fail('Pair harus memiliki rank sama.');
      return {type:'pair', cards};
    }
    const flush = cards.every(c => c.suit === cards[0].suit);
    const end = straightEnd(cards);
    let type;
    if (flush && end !== null) type = 'straight_flush';
    else if (Object.values(counts).includes(4)) type = 'bomb';
    else if (Object.values(counts).includes(3) && Object.values(counts).includes(2)) type = 'full_house';
    else if (flush) type = 'flush';
    else if (end !== null) type = 'straight';
    else fail('Kombinasi lima kartu tidak sah.');
    return {type, cards};
  }
  const strength = (c, reversed) => [
    RANKS.indexOf(c.rank) * (reversed ? -1 : 1),
    SUITS.indexOf(c.suit) * (reversed ? -1 : 1)
  ];
  function lex(a,b) {
    for (let i=0; i<a.length; i++) if (a[i] !== b[i]) return Math.sign(a[i]-b[i]);
    return 0;
  }
  function strongest(cards, reversed) {
    return cards.reduce((best,c)=>lex(strength(c,reversed),strength(best,reversed)) > 0 ? c : best);
  }
  function comboKey(combo, reversed) {
    const cards = combo.cards, sign = reversed ? -1 : 1;
    if (combo.type === 'single' || combo.type === 'pair') return strength(strongest(cards,reversed),reversed);
    const prefix = [TYPES.indexOf(combo.type) * sign];
    if (combo.type === 'straight' || combo.type === 'straight_flush') {
      const end = straightEnd(cards);
      const rank = end === 14 ? 'A' : end === 13 ? 'K' : end === 12 ? 'Q' : end === 11 ? 'J' : String(end);
      return prefix.concat([end * sign, SUITS.indexOf(cards.find(c=>c.rank===rank).suit) * sign]);
    }
    if (combo.type === 'flush') {
      // Re-select the strongest card under the active order, as confirmed.
      return prefix.concat([SUITS.indexOf(cards[0].suit)*sign, strength(strongest(cards,reversed),reversed)[0]]);
    }
    const size = combo.type === 'bomb' ? 4 : 3;
    const deciding = cards.find(c=>cards.filter(other=>other.rank===c.rank).length===size);
    return prefix.concat([RANKS.indexOf(deciding.rank)*sign]);
  }
  // null means different card counts: never allow a five-card bomb over a pair.
  function compare(a,b,reversed=false) {
    const left=classify(a), right=classify(b);
    if (left.cards.length !== right.cards.length) return null;
    return lex(comboKey(left,reversed),comboKey(right,reversed));
  }
  const SCORING_VERSION=3, LEGACY_SCORING_VERSION=2, SCORE_LIMIT=60, MAX_GAMES=15;
  const PLACEMENT_POINTS=[6,4,3,1];
  const placementMode=s=>s.scoringVersion===SCORING_VERSION;
  const isResult=s=>['round_end','session_end'].includes(s.phase);
  function placementView(s) {
    if(!placementMode(s))return {};
    const result={finishOrder:[...s.finishOrder]};
    if(isResult(s)){
      const seat=s.hands.findIndex(hand=>hand.length>0);
      result.revealedHand={seat,cards:cleanCards(s.hands[seat])};
    }
    return result;
  }
  function migrateScoring(input){
    if(!input||typeof input!=='object')fail('State Capsa tidak valid.');
    if(placementMode(input)||input.scoringVersion===LEGACY_SCORING_VERSION)return input;
    if(input.scoringVersion!=null)fail('Versi skor tidak dikenali.');
    const s=copy(input),negative=n=>{if(!Number.isInteger(n)||n<0)fail('Skor lama tidak valid.');return n===0?0:-n;};
    s.scores=s.scores.map(negative);
    s.history=s.history.map(h=>({...h,penalties:h.penalties?.map(negative),totals:h.totals?.map(negative)}));
    s.scoringVersion=LEGACY_SCORING_VERSION;
    if(isResult(s)){
      const limit=s.scores.some(v=>v<=-300);
      s.endReason=limit?'score_limit':s.round>=MAX_GAMES?'game_limit':null;
      s.phase=s.endReason?'session_end':'round_end';
    }
    return s;
  }
  function standings(scores) {
    if (!Array.isArray(scores) || scores.length!==4 || scores.some(v=>!Number.isInteger(v))) fail('Skor tidak valid.');
    // Groups avoid choosing between dense/competition numbering for shared ranks.
    return [...new Set(scores)].sort((a,b)=>b-a).map(score=>({score,seats:scores.flatMap((v,i)=>v===score?[i]:[])}));
  }
  function assertState(s) {
    if (!s || ![SCORING_VERSION,LEGACY_SCORING_VERSION].includes(s.scoringVersion) || s.rulesVersion!==RULES_VERSION || !PHASES.includes(s.phase) ||
        !Number.isInteger(s.revision) || s.revision<0 || !Number.isInteger(s.round) || s.round<1 ||
        s.direction!==(s.round%2 ? 1 : -1) || typeof s.reversed!=='boolean' ||
        typeof s.openingRequired!=='boolean') fail('State Capsa tidak valid.');
    if (!Array.isArray(s.players) || s.players.length!==4 ||
        s.players.some(p=>!p||typeof p.uid!=='string'||!p.uid||typeof p.isBot!=='boolean') ||
        new Set(s.players.map(p=>p.uid)).size!==4) fail('Roster harus empat UID unik.');
    if (!Array.isArray(s.hands)||s.hands.length!==4||s.hands.some(h=>!Array.isArray(h))) fail('Tangan tidak valid.');
    checkedDeck(s.hands.flat().concat(s.discard));
    standings(s.scores);
    const placed=placementMode(s),empty=s.hands.flatMap((h,i)=>h.length?[]:[i]);
    if(s.scores.some(v=>placed?v<0:v>0))fail('Skor tidak valid.');
    if(placed){
      const order=s.finishOrder;
      if(!Array.isArray(order)||new Set(order).size!==order.length||order.length!==empty.length||
        order.some(i=>!empty.includes(i))||(isResult(s)?order.length!==3||s.winner!==order[0]||s.table?.seat!==order[2]:order.length>2))fail('Urutan peringkat babak tidak valid.');
    }
    if (!Array.isArray(s.ready)||s.ready.length!==4||s.ready.some(v=>typeof v!=='boolean') ||
        !Array.isArray(s.passed)||new Set(s.passed).size!==s.passed.length||s.passed.some(v=>!seat(v))) fail('Status giliran tidak valid.');
    if (!seat(s.turn) || !Array.isArray(s.history) || !Array.isArray(s.receipts)) fail('State giliran tidak valid.');
    if (s.roundEndUntil!=null && (!Number.isFinite(s.roundEndUntil)||!['round_end','session_end'].includes(s.phase))) fail('Timer akhir ronde tidak valid.');
    if(s.continueReady!==undefined&&(!Array.isArray(s.continueReady)||![0,4].includes(s.continueReady.length)||s.continueReady.some(v=>typeof v!=='boolean')))fail('Konfirmasi babak tidak valid.');
    // Optional for saved matches created before round history was introduced.
    if (s.roundPlays!==undefined) {
      if (!Array.isArray(s.roundPlays)||s.roundPlays.length>52) fail('Riwayat kartu tidak valid.');
      const played=[];
      for (const entry of s.roundPlays) {
        if (!entry||!seat(entry.seat)||classify(entry.cards).type!==entry.type) fail('Riwayat kartu tidak valid.');
        if(entry.trick!==undefined&&(!Number.isInteger(entry.trick)||entry.trick<1||entry.trick>(s.trick||1)))fail('Nomor ronde riwayat tidak valid.');
        played.push(...entry.cards);
      }
      const keys=cleanCards(played).map(cardKey),discard=new Set(s.discard.map(cardKey));
      if (!keys.every(k=>discard.has(k))) fail('Riwayat hanya boleh memuat kartu yang sudah dimainkan.');
    }
    if (['playing','bomb_choice'].includes(s.phase)) {
      if (!Number.isFinite(s.deadline) || !s.ready.every(Boolean) || (!placed&&empty.length) ||
        (s.phase==='playing'&&(empty.includes(s.turn)||(s.table&&s.passed.includes(s.turn))))) fail('Giliran belum siap.');
    } else if (s.deadline!==null) fail('Timer harus berhenti di luar giliran.');
    if (s.table) {
      if (!seat(s.table.seat)) fail('Pemilik meja tidak valid.');
      classify(s.table.cards);
      const discardKeys=new Set(s.discard.map(cardKey));
      if (!s.table.cards.every(c=>discardKeys.has(cardKey(c)))) fail('Kartu meja harus sudah dimainkan.');
    }
    if (s.phase==='bomb_choice' && (!s.table || classify(s.table.cards).type!=='bomb' || s.turn!==s.table.seat)) fail('Pilihan bomb tidak valid.');
    if(s.phase==='round_ready'&&s.hands.some(h=>h.length===0))fail('Babak aktif tidak boleh memiliki tangan kosong.');
    if(s.trick!==undefined&&(!Number.isInteger(s.trick)||s.trick<1))fail('Nomor ronde meja tidak valid.');
    if(s.lastTrickWinner!=null&&!seat(s.lastTrickWinner))fail('Pemenang ronde meja tidak valid.');
    if (['round_end','session_end'].includes(s.phase) && (!seat(s.winner)||s.hands[s.winner].length!==0)) fail('Pemenang ronde tidak valid.');
    return true;
  }
  function begin(s,now) {
    s.phase='playing';
    s.deadline=now+turnDuration(s.round);
  }
  function dealRound(s,cards,now) {
    cards=checkedDeck(cards);
    s.hands=Array.from({length:4},()=>[]);
    cards.forEach((c,i)=>s.hands[i%4].push(c));
    s.phase='round_ready';s.turnMs=turnDuration(s.round);
    s.direction=s.round%2 ? 1 : -1;
    s.reversed=false;
    s.openingRequired=true;
    s.turn=s.hands.findIndex(h=>h.some(c=>cardKey(c)==='3D'));
    s.ready=s.players.map(p=>p.isBot);s.continueReady=[];s.endReason=null;s.trick=1;s.lastTrickWinner=null;
    s.discard=[];s.tableStart=0;s.roundPlays=[];s.roundPlaysIncomplete=false;s.table=null;s.passed=[];s.winner=null;s.deadline=null;s.roundEndUntil=null;
    if(placementMode(s))s.finishOrder=[];
    if (s.ready.every(Boolean)) begin(s,now);
  }
  function createSession(players,cards,now) {
    if (!Number.isFinite(now)) fail('Waktu tidak valid.');
    const s={rulesVersion:RULES_VERSION,revision:0,scoringVersion:SCORING_VERSION,round:1,players:copy(players),scores:[0,0,0,0],history:[],receipts:[],lastAction:null};
    if (!Array.isArray(players)||players.length!==4||players.some(p=>!p||typeof p.uid!=='string'||!p.uid||typeof p.isBot!=='boolean')||new Set(players.map(p=>p.uid)).size!==4) fail('Roster harus empat UID unik.');
    dealRound(s,cards,now);
    assertState(s);
    return s;
  }
  function requireTurn(s,actor) {
    if (s.phase!=='playing' || s.turn!==actor || s.passed.includes(actor) || !s.hands[actor].length) fail('Bukan giliran pemain.');
  }
  function finishRound(s,winner,now) {
    if(s.hands[winner].length!==0)fail('Babak hanya berakhir setelah kartu pemenang habis dimainkan.');
    const placed=placementMode(s);
    const placements=placed?s.finishOrder.concat(s.hands.findIndex(h=>h.length>0)):null;
    const points=placed?s.hands.map((_,i)=>PLACEMENT_POINTS[placements.indexOf(i)]):s.hands.map(h=>h.length===0?0:-h.length*10);
    s.scores=s.scores.map((v,i)=>v+points[i]);
    s.winner=winner;s.deadline=null;s.continueReady=s.players.map(p=>p.isBot);
    s.roundEndUntil=now+ROUND_PAUSE_MS;
    s.history.push({round:s.round,winner,...(placed?{placements,points}:{penalties:points}),totals:[...s.scores]});
    const scoreLimit=s.scores.some(v=>placed?v>=SCORE_LIMIT:v<=-300);s.endReason=scoreLimit?'score_limit':s.round>=MAX_GAMES?'game_limit':null;
    s.phase=s.endReason?'session_end':'round_end';
  }
  function play(s,actor,cards,now) {
    requireTurn(s,actor);
    const combo=classify(cards), own=new Set(s.hands[actor].map(cardKey));
    if (!combo.cards.every(c=>own.has(cardKey(c)))) fail('Kartu bukan milik pemain.');
    if (s.openingRequired && !combo.cards.some(c=>cardKey(c)==='3D')) fail('Pembuka wajib memuat 3 wajik.');
    if (s.table) {
      const result=compare(combo.cards,s.table.cards,s.reversed);
      if (result===null || result<=0) fail('Balasan harus berjumlah sama dan lebih kuat.');
    }
    const used=new Set(combo.cards.map(cardKey));
    if (!s.roundPlays) {s.roundPlays=[];s.roundPlaysIncomplete=s.discard.length>0;}
    if (!s.table) s.tableStart=s.roundPlays.length;
    s.roundPlays.push({trick:s.trick,seat:actor,uid:s.players[actor].uid,type:combo.type,cards:copy(combo.cards)});
    s.hands[actor]=s.hands[actor].filter(c=>!used.has(cardKey(c)));
    s.discard.push(...combo.cards);s.table={seat:actor,cards:combo.cards};
    s.openingRequired=false;
    if (!s.hands[actor].length) {
      if(!placementMode(s)){finishRound(s,actor,now);return;}
      s.finishOrder.push(actor);
      if(s.finishOrder.length===3){finishRound(s,s.finishOrder[0],now);return;}
    }
    advanceTable(s,actor,now);
  }
  function nextActive(s,actor){
    for(let i=1;i<4;i++){const n=(actor+s.direction*i+8)%4;if(s.hands[n].length&&!s.passed.includes(n))return n;}
    return -1;
  }
  function advanceTable(s,actor,now){
    const next=nextActive(s,actor);
    if(next<0||next===s.table.seat)winTable(s,now);
    else {s.turn=next;s.deadline=now+turnDuration(s.round);}
  }
  function winTable(s,now){
    if(classify(s.table.cards).type==='bomb'){s.phase='bomb_choice';s.turn=s.table.seat;s.deadline=now+turnDuration(s.round);}
    else openTable(s,now);
  }
  function openTable(s,now) {
    const winner=s.table.seat;
    s.passed=[];s.turn=s.hands[winner].length?winner:nextActive(s,winner);s.lastTrickWinner=winner;
    s.trick=(s.trick||1)+1;s.table=null;s.tableStart=(s.roundPlays||[]).length;begin(s,now);
  }
  function pass(s,actor,now) {
    requireTurn(s,actor);
    if (!s.table) fail('Pembuka tidak boleh pass.');
    if (!s.passed.includes(actor)) s.passed.push(actor);
    advanceTable(s,actor,now);
  }
  function chooseBomb(s,actor,flip,now) {
    if (s.phase!=='bomb_choice'||s.turn!==actor||typeof flip!=='boolean') fail('Hanya pemilik bomb yang memilih.');
    if (flip) s.reversed=!s.reversed;
    openTable(s,now);
  }
  function timeout(s,now) {
    if (!['playing','bomb_choice'].includes(s.phase)||now<s.deadline) fail('Timer belum habis.');
    if (s.phase==='bomb_choice') {chooseBomb(s,s.turn,false,now);return;}
    if (s.table) {pass(s,s.turn,now);return;}
    const cards=s.openingRequired ? [s.hands[s.turn].find(c=>cardKey(c)==='3D')] :
      [s.hands[s.turn].reduce((lowest,c)=>compare([c],[lowest],s.reversed)<0?c:lowest)];
    play(s,s.turn,cards,now);
  }
  function signature(a) {
    return JSON.stringify([a.type,a.uid,a.expectedRevision,a.cards||null,a.flip===undefined?null:a.flip,a.deck||null]);
  }
  function applyAction(state,action,now) {
    state=migrateScoring(state);assertState(state);
    if (!action||typeof action.id!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(action.id)||!Number.isFinite(now)) fail('Aksi tidak valid.');
    const actor=state.players.findIndex(p=>p.uid===action.uid);
    if (actor<0) fail('UID tidak terdaftar.');
    const fingerprint=signature(action);
    const receipt=state.receipts.find(r=>r.id===action.id);
    if (receipt) {
      if (receipt.fingerprint!==fingerprint) fail('ID aksi dipakai dengan isi berbeda.');
      return copy(state);
    }
    if (action.expectedRevision!==state.revision) fail('Revisi aksi sudah kedaluwarsa.');
    const s=copy(state);s.turnMs=turnDuration(s.round);s.trick??=1;
    // Legacy clients kept PASS beyond a cleared table; re-enable every seat.
    if(s.phase==='playing'&&!s.table)s.passed=[];
    if (action.type!=='timeout' && ['playing','bomb_choice'].includes(s.phase) && now>=s.deadline) fail('Waktu giliran sudah habis.');
    switch(action.type) {
      case 'ready':
        if (s.phase!=='round_ready') fail('Bukan fase Ready.');
        s.ready[actor]=true;
        if (s.ready.every(Boolean)) begin(s,now);
        break;
      case 'confirm_round':
        if(s.phase!=='round_end') fail('Konfirmasi hanya tersedia setelah babak selesai.');
        if(!s.continueReady?.length)s.continueReady=s.players.map(p=>p.isBot);
        s.continueReady[actor]=true;break;
      case 'play': play(s,actor,action.cards,now);break;
      case 'pass': pass(s,actor,now);break;
      case 'choose_bomb': chooseBomb(s,actor,action.flip,now);break;
      case 'timeout': timeout(s,now);break;
      case 'next_round':
        if (s.phase!=='round_end') fail('Ronde berikutnya belum tersedia.');
        if (s.roundEndUntil!=null && now<s.roundEndUntil) fail('Tunggu jeda akhir ronde 7 detik.');
        if(s.players.some((p,i)=>!p.isBot&&(placementMode(s)||i!==actor)&&!s.continueReady?.[i]))fail('Menunggu semua pemain Ready untuk lanjut.');
        s.round++;dealRound(s,action.deck,now);
        if(placementMode(s)){s.ready.fill(true);begin(s,now);}
        break;
      default: fail('Jenis aksi tidak dikenal.');
    }
    s.revision++;s.lastAction={id:action.id,fingerprint};
    s.receipts.push(s.lastAction);
    assertState(s);
    return s;
  }
  return {RULES_VERSION,SCORING_VERSION,LEGACY_SCORING_VERSION,SCORE_LIMIT,MAX_GAMES,migrateScoring,placementMode,placementView,TURN_MS,turnDuration,ROUND_PAUSE_MS,deck,cardKey,classify,compare,standings,createSession,assertState,applyAction};
});
