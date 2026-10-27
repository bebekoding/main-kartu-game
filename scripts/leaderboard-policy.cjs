/* Ranking v3: immutable match identity, participant attestations, one atomic
 * all-player award. Client room state is NOT a trusted gameplay engine; every
 * original human must explicitly attest the frozen result before any credit.
 */
module.exports=function installRanking(document,room){
  const real="auth != null && auth.token.firebase.sign_in_provider === 'password'";
  const keyPattern=String.raw`/^[^.#$\[\]\/]{1,64}$/`;
  const ID="$matchId.matches(/^[a-f0-9]{32}$/)";
  const match=(root,id='$matchId')=>`${root}.child('rankedMatches').child(${id})`;
  const roster=(m,s)=>`${m}.child('roster/${s}')`;
  const participant=(m,uid='auth.uid')=>`(${m}.child('contract').val() === 3 && ${m}.child('memberSeats').child(${uid}).exists())`;
  const each=(m,fn)=>Array.from({length:6},(_,s)=>`(${m}.child('size').val() <= ${s} || (${fn(s)}))`).join(' && ');
  const everyVote=(m,value)=>each(m,s=>`${m}.child('votes').child(${roster(m,s)}.child('uid').val()).val() === ${value}`);
  const rejected=m=>Array.from({length:6},(_,s)=>`(${m}.child('size').val() > ${s} && ${m}.child('votes').child(${roster(m,s)}.child('uid').val()).val() === false)`).join(' || ');
  const integer=(x,min,max)=>`${x}.isNumber() && ${x}.val() % 1 === 0 && ${x}.val() >= ${min} && ${x}.val() <= ${max}`;
  const timestamp={'.validate':'newData.isNumber() && newData.val() >= now - 300000 && newData.val() <= now + 5000'};
  const root3='newData.parent().parent().parent()';
  const M=match('root');
  const R=`root.child('rooms').child(${M}.child('roomCode').val())`;
  const uid=s=>`${roster(M,s)}.child('uid').val()`;
  const key=s=>`${roster(M,s)}.child('key').val()`;
  const samePlayers=each(M,s=>`${R}.child('seats/${s}').val() === ${uid(s)} && ${R}.child('players').child(${uid(s)}).child('seat').val() === ${s} && ${R}.child('players').child(${uid(s)}).child('isBot').val() === false`)+
    ' && '+Array.from({length:6},(_,s)=>`(${M}.child('size').val() > ${s} || !${R}.child('seats/${s}').exists())`).join(' && ');
  const totalsValid=each(M,s=>integer(`${R}.child('totals/${s}')`,-1000000,1000000));
  const nonemptyHands=path=>'('+Array.from({length:6},(_,s)=>`((${M}.child('size').val() > ${s} && ${R}.child('${path}/${s}').exists()) ? 1 : 0)`).join(' + ')+')';
  const pointCap='('+Array.from({length:6},(_,s)=>`(${M}.child('size').val() > ${s} && (${R}.child('totals/${s}').val() >= 1000 || ${R}.child('totals/${s}').val() <= -1000))`).join(' || ')+')';
  const truf=`(${M}.child('game').val() === 'truf' && ${R}.child('phase').val() === 'tournament_end' && ${R}.child('sessionResult/sessionNumber').val() === ${R}.child('gameState/session').val() && ${integer(`${R}.child('gameState/session')`,1,100000)} && ${R}.child('play/trickNumber').val() === 13 && `+
    each(M,s=>`!${R}.child('hands/${s}').exists() && ${integer(`${R}.child('sessionResult/deltas/${s}')`,-1000,1000)} && ${integer(`${R}.child('play/tricksWon/${s}')`,0,13)}`)+
    ` && (${[0,1,2,3].map(s=>`${R}.child('play/tricksWon/${s}').val()`).join(' + ')}) === 13)`;
  const remi=`(${M}.child('game').val() === 'remi' && ${R}.child('phase').val() === 'remi_tournament_end' && ${integer(`${R}.child('remi/roundNumber')`,1,20)} && (${R}.child('remi/roundNumber').val() >= 10 || (${R}.child('remi/matchOverReason').val() === 'points' && ${pointCap})) && ${R}.child('remi/endReason').isString() && ${R}.child('remi/endReason').val().matches(/^(closed|deck_empty|stuck)$/) && `+each(M,s=>integer(`${R}.child('remi/handPenalty/${s}')`,-1000000,1000000))+')';
  const tebak=`(${M}.child('game').val() === 'tebak' && ${R}.child('phase').val() === 'tebak_match_end' && ${integer(`${R}.child('tebak/roundNumber')`,10,20)} && !${R}.child('tebak/deck').exists() && ${nonemptyHands('tebak/hands')} <= 1 && `+each(M,s=>`${integer(`${R}.child('tebak/roundRanks/${s}')`,1,6)} && ${R}.child('tebak/roundRanks/${s}').val() <= ${M}.child('size').val() && ${integer(`${R}.child('tebak/roundPoints/${s}')`,1,6)} && ${R}.child('tebak/roundPoints/${s}').val() <= ${M}.child('size').val()`)+')';
  const cangkul=`(${M}.child('game').val() === 'cangkul' && ${R}.child('phase').val() === 'cangkul_tournament_end' && ${integer(`${R}.child('cangkul/sessionNumber')`,1,100000)} && !${R}.child('cangkul/activeSeats').exists() && ${nonemptyHands('cangkul/hands')} <= 1 && `+each(M,s=>{
    const pos=`${R}.child('cangkul/eliminationOrder/${s}')`;
    return `${integer(pos,0,5)} && ${pos}.val() < ${M}.child('size').val() && ${R}.child('cangkul/finalScores').child(${pos}.val() + '').val() === ${M}.child('size').val() - ${s}`+
      Array.from({length:s},(_,other)=>` && ${pos}.val() !== ${R}.child('cangkul/eliminationOrder/${other}').val()`).join('');
  })+')';
  const eligible=`${R}.child('rankedMatchId').val() === $matchId && ${R}.child('game').val() === ${M}.child('game').val() && ${samePlayers} && ${totalsValid} && (${truf} || ${remi} || ${tebak} || ${cangkul})`;
  const basePoints=s=>`${M}.child('size').val() - (`+Array.from({length:6},(_,other)=>`((${M}.child('size').val() > ${other} && (${R}.child('totals/${other}').val() > ${R}.child('totals/${s}').val()${other<s?` || ${R}.child('totals/${other}').val() === ${R}.child('totals/${s}').val()`:''})) ? 1 : 0)`).join(' + ')+')';
  const newRoom=`root.child('rooms').child(newData.child('roomCode').val())`;
  const postRoom=`newData.parent().parent().child('rooms').child(newData.child('roomCode').val())`;
  const birthSlots=Array.from({length:6},(_,s)=>{
    const p=`newData.child('roster/${s}')`,puid=`${p}.child('uid').val()`,pkey=`${p}.child('key').val()`;
    return `(newData.child('size').val() <= ${s} ? (!${p}.exists() && !${newRoom}.child('seats/${s}').exists()) : (`+
      `${p}.hasChildren(['uid','key','username','name']) && ${p}.child('uid').isString() && ${p}.child('key').isString() && ${p}.child('key').val().matches(${keyPattern}) && ${p}.child('username').isString() && ${p}.child('name').isString() && ${p}.child('name').val().length <= 64 && `+
      `${newRoom}.child('seats/${s}').val() === ${puid} && ${newRoom}.child('players').child(${puid}).child('isBot').val() === false && ${newRoom}.child('players').child(${puid}).child('seat').val() === ${s} && `+
      `root.child('accounts').child(${pkey}).child('authUid').val() === ${puid} && root.child('accounts').child(${pkey}).child('username').val() === ${p}.child('username').val() && `+
      `newData.child('memberSeats').child(${puid}).val() === ${s}`+
      Array.from({length:s},(_,t)=>` && ${pkey} !== newData.child('roster/${t}/key').val() && ${puid} !== newData.child('roster/${t}/uid').val()`).join('')+'))';
  }).join(' && ');
  document.rules.rankedMatches={
    '$matchId':{
      '.read':`${real} && ${participant('data')}`,
      '.write':`${real} && ${ID} && !data.exists() && newData.exists() && ${newRoom}.child('phase').val() === 'lobby' && !${newRoom}.child('totals').exists() && ${newRoom}.child('host').val() === auth.uid && ${postRoom}.child('rankedMatchId').val() === $matchId`,
      '.validate':"newData.hasChildren(['contract','roomCode','game','size','roster','memberSeats','createdAt']) && (data.exists() || (!newData.child('result').exists() && !newData.child('votes').exists() && "+birthSlots+'))',
      contract:{'.validate':'newData.val() === 3'},
      roomCode:{'.validate':"newData.isString() && newData.val().matches(/^[A-Z0-9]{4,6}$/)"},
      game:{'.validate':"newData.isString() && newData.val().matches(/^(truf|remi|cangkul|tebak)$/)"},
      size:{'.validate':"newData.isNumber() && newData.val() % 1 === 0 && ((newData.parent().child('game').val().matches(/^(truf|remi)$/) && newData.val() === 4) || (newData.parent().child('game').val() === 'cangkul' && newData.val() >= 3 && newData.val() <= 6) || (newData.parent().child('game').val() === 'tebak' && newData.val() >= 4 && newData.val() <= 6))"},
      createdAt:timestamp,
      roster:{'$seat':{'.validate':"$seat.matches(/^[0-5]$/)",uid:{'.validate':'newData.isString()'},key:{'.validate':'newData.isString()'},username:{'.validate':'newData.isString()'},name:{'.validate':'newData.isString()'},'$other':{'.validate':false}}},
      memberSeats:{'$uid':{'.validate':"newData.isNumber() && newData.val() % 1 === 0 && newData.val() >= 0 && newData.val() < newData.parent().parent().child('size').val() && newData.parent().parent().child('roster').child(newData.val() + '').child('uid').val() === $uid"}},
      result:{
        '.write':`${real} && !data.exists() && newData.exists() && ${participant(M)} && ${eligible}`,
        '.validate':"newData.hasChildren(['finishedAt','rounds','entries']) && "+
          `newData.child('rounds').val() === (${M}.child('game').val() === 'truf' ? ${R}.child('gameState/session').val() : (${M}.child('game').val() === 'cangkul' ? ${R}.child('cangkul/sessionNumber').val() : (${M}.child('game').val() === 'remi' ? ${R}.child('remi/roundNumber').val() : ${R}.child('tebak/roundNumber').val()))) && `+
          each(M,s=>`newData.child('entries/${s}/total').val() === ${R}.child('totals/${s}').val() && newData.child('entries/${s}/points').val() === ${basePoints(s)} && ${root3}.child('rankedPending').child(${uid(s)}).child($matchId).val() === true`),
        finishedAt:timestamp,rounds:{'.validate':'newData.isNumber()'},
        entries:{'$seat':{'.validate':"$seat.matches(/^[0-5]$/) && newData.parent().parent().parent().child('roster').child($seat).exists() && newData.hasChildren(['total','points'])",total:{'.validate':integer('newData',-1000000,1000000)},points:{'.validate':integer('newData',1,6)},'$other':{'.validate':false}}},
        '$other':{'.validate':false},
      },
      votes:{'$uid':{
        '.write':`${real} && auth.uid === $uid && ${participant(M)} && ${M}.child('result').exists() && !data.exists() && newData.isBoolean()`,
        '.validate':'newData.isBoolean()',
      }},
      '$other':{'.validate':false},
    },
  };
  room.rankedMatchId={
    '.write':`${real} && root.child('rooms').child($roomCode).child('host').val() === auth.uid && ((!newData.exists() && newData.parent().child('phase').val() === 'lobby') || root.child('rooms').child($roomCode).child('phase').val() === 'lobby')`,
    '.validate':"newData.isString() && newData.val().matches(/^[a-f0-9]{32}$/) && root.child('rooms').child($roomCode).exists() && newData.parent().parent().parent().child('rankedMatches').child(newData.val()).child('roomCode').val() === $roomCode && newData.parent().parent().parent().child('rankedMatches').child(newData.val()).child('game').val() === newData.parent().child('game').val()",
  };
  room.$gameState['.write']=room.$gameState['.write'].replace('|signals','|signals|rankedMatchId');
  const startMatch="newData.parent().parent().child('rankedMatches').child(newData.child('rankedMatchId').val())";
  room['.validate'] += " && (data.child('phase').val() !== 'lobby' || newData.child('phase').val() === 'lobby' || !newData.child('rankedMatchId').exists() || ("+
    each(startMatch,s=>`newData.child('seats/${s}').val() === ${roster(startMatch,s)}.child('uid').val() && newData.child('players').child(${roster(startMatch,s)}.child('uid').val()).child('isBot').val() === false`)+
    ' && '+Array.from({length:6},(_,s)=>`(${startMatch}.child('size').val() > ${s} || !newData.child('seats/${s}').exists())`).join(' && ')+'))';
  document.rules.rankedPending={'$uid':{
    '.read':`${real} && $uid === auth.uid`,
    '$matchId':{
      '.write':`${real} && ${ID} && (`+
        `(!data.exists() && newData.val() === true && !${M}.child('result').exists() && ${participant(M)} && ${participant(M,'$uid')} && ${match(root3)}.child('result').exists()) || `+
        `(!newData.exists() && ${participant(M)} && ${participant(M,'$uid')} && (root.child('rankedAwards').child($matchId).exists() || ${root3}.child('rankedAwards').child($matchId).exists() || (${rejected(M)}))))`,
      '.validate':'newData.val() === true',
    },
  }};
  const postAwardRoot='newData.parent().parent()';
  const oldRow=s=>`root.child('leaderboards').child(${M}.child('game').val()).child(${key(s)})`;
  const postRow=s=>`${postAwardRoot}.child('leaderboards').child(${M}.child('game').val()).child(${key(s)})`;
  const oldMatches=s=>`(${oldRow(s)}.child('matches').exists() ? ${oldRow(s)}.child('matches').val() : 0)`;
  const oldPoints=s=>`(${oldRow(s)}.child('points').exists() ? ${oldRow(s)}.child('points').val() : 0)`;
  document.rules.rankedAwards={'$matchId':{
    '.read':`${real} && ${participant(M)}`,
    '.write':`${real} && ${ID} && !data.exists() && newData.exists() && ${participant(M)} && ${M}.child('result').exists() && ${everyVote(M,'true')}`,
    '.validate':"newData.hasChildren(['contract','game','srcRoom','srcMatch','at']) && newData.child('contract').val() === 3 && newData.child('game').val() === "+M+".child('game').val() && newData.child('srcRoom').val() === "+M+".child('roomCode').val() && newData.child('srcMatch').val() === $matchId && "+each(M,s=>
      `${postRow(s)}.child('contract').val() === 3 && ${postRow(s)}.child('authUid').val() === ${uid(s)} && ${postRow(s)}.child('username').val() === ${roster(M,s)}.child('username').val() && ${postRow(s)}.child('name').val() === ${roster(M,s)}.child('name').val() && ${postRow(s)}.child('srcMatch').val() === $matchId && ${postRow(s)}.child('srcRoom').val() === ${M}.child('roomCode').val() && `+
      `(!${oldRow(s)}.child('authUid').exists() || ${oldRow(s)}.child('authUid').val() === ${uid(s)}) && ${postRow(s)}.child('matches').val() === ${oldMatches(s)} + 1 && `+
      `${postRow(s)}.child('points').val() === ${oldPoints(s)} + ${M}.child('result/entries/${s}/points').val() + ((${oldMatches(s)} + 1) % 5 === 0 ? 5 : 0) && !${postAwardRoot}.child('rankedPending').child(${uid(s)}).child($matchId).exists()`),
    at:timestamp,contract:{'.validate':'newData.val() === 3'},game:{'.validate':'newData.isString()'},srcRoom:{'.validate':'newData.isString()'},srcMatch:{'.validate':'newData.isString()'},'$other':{'.validate':false},
  }};
  const rowMatch=match('root',"newData.child('srcMatch').val()");
  const rowBelongs=Array.from({length:6},(_,s)=>`(${rowMatch}.child('size').val() > ${s} && ${roster(rowMatch,s)}.child('key').val() === $username && ${roster(rowMatch,s)}.child('uid').val() === newData.child('authUid').val())`).join(' || ');
  document.rules.leaderboards={'.read':true,'$game':{
    '$username':{
      '.write':`${real} && newData.exists() && !root.child('rankedAwards').child(newData.child('srcMatch').val()).exists() && ${root3}.child('rankedAwards').child(newData.child('srcMatch').val()).exists() && ${participant(rowMatch)} && ${rowMatch}.child('game').val() === $game && (${rowBelongs})`,
      '.validate':"newData.hasChildren(['contract','authUid','username','name','matches','points','srcRoom','srcMatch']) && newData.child('contract').val() === 3 && "+integer("newData.child('matches')",1,1000000000)+' && '+integer("newData.child('points')",0,1000000000),
      contract:{'.validate':'newData.val() === 3'},authUid:{'.validate':'newData.isString()'},username:{'.validate':'newData.isString()'},name:{'.validate':'newData.isString()'},matches:{'.validate':'newData.isNumber()'},points:{'.validate':'newData.isNumber()'},srcRoom:{'.validate':'newData.isString()'},srcMatch:{'.validate':"newData.isString() && newData.val().matches(/^[a-f0-9]{32}$/)"},'$other':{'.validate':false},
    },
  }};
  document.rules.config.leaderboardContract={'.read':true,'.write':false};
};
