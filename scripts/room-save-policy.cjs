/* Fixed six-seat consent checks. Never trust a client-supplied participant list. */
module.exports=function(room){
  const R="root.child('rooms').child($roomCode)",S=`${R}.child('savedGame')`;
  const real="auth != null && auth.token.firebase.sign_in_provider === 'password'";
  const valid=`${real} && $roomCode.matches(/^[A-Z0-9]{4,6}$/)`;
  const uid=(s,n=S)=>`${n}.child('humans/${s}').val()`;
  const each=(n,fn)=>Array.from({length:6},(_,s)=>`(!${n}.child('humans/${s}').exists() || (${fn(s)}))`).join(' && ');
  const member=`(${R}.child('players').child(auth.uid).child('seat').isNumber() && ${S}.child('humans').child(${R}.child('players').child(auth.uid).child('seat').val() + '').val() === auth.uid)`;
  const active=`${S}.child('lastAccessAt').val() > now - 604800000`;
  const participant=`${valid} && ${member} && ${active}`;
  const online=u=>`${R}.child('players').child(${u}).child('isBot').val() === false && ${R}.child('players').child(${u}).child('lastSeen').val() >= now - 15000 && !${R}.child('players').child(${u}).child('disconnectedAt').exists() && ${R}.child('players').child(${u}).child('disconnected').val() !== true`;
  const allVotes=each(S,s=>`${S}.child('votes').child(${uid(s)}).val() === ${S}.child('id').val()`);
  const allReady=each(S,s=>`${S}.child('ready').child(${uid(s)}).val() === ${S}.child('resumeId').val() && ${online(uid(s))}`);
  const thaw=`(${participant} && ${S}.child('status').val() === 'resuming' && ${allReady})`;
  const cancel=`(${valid} && ${S}.child('status').val() === 'request' && (${member} || ${S}.child('requestedAt').val() <= now - 60000))`;
  const create=`${valid} && !data.exists() && ${R}.child('membershipVersion').val() === 2 && ${online('auth.uid')} && ${R}.child('phase').isString() && !${R}.child('phase').val().matches(/^(lobby|tournament_end|remi_tournament_end|cangkul_tournament_end|tebak_match_end)$/)`;
  const post='newData.parent()';
  const saving=`${S}.child('status').val() === 'request' && ${S}.child('requestedAt').val() > now - 60000 && ${allVotes}`;
  const start=`${S}.child('status').val() === 'saved'`;
  const reset=`${S}.child('status').val() === 'resuming'`;

  // Ancestor grants cannot be revoked by children: restrict every existing
  // gameplay/membership write and the ordinary host's room DELETE grant.
  room['.write']=room['.write'].replace("data.child('host').val() === auth.uid",`(data.child('host').val() === auth.uid && !data.child('savedGame').exists())`);
  room['.validate']+=` && (data.exists() || !newData.child('savedGame').exists())`;
  for(const [key,node]of Object.entries(room)){
    if(!node||typeof node!=='object'||!node['.write']||['chat','voice','signals','emptySince'].includes(key))continue;
    node['.write']=`(${node['.write']}) && !${S}.exists()`;
  }
  // Nested seat/player grants also need the freeze guard.
  room.seats.$seat['.write']=`(${room.seats.$seat['.write']}) && !${S}.exists()`;
  room.hostRequests.$uid['.write']=`(${room.hostRequests.$uid['.write']}) && !${S}.exists()`;
  const p=room.players.$playerUid;
  p['.write']=`(${p['.write']}) && !${S}.exists()`;
  const ownPresence=`${participant} && $playerUid === auth.uid && ${R}.child('players').child(auth.uid).exists()`;
  p.lastSeen['.write']=`${ownPresence} && newData.exists() && (newData.val() === now || newData.val() === 0)`;
  p.disconnected={'.write':`${ownPresence} && (!newData.exists() || newData.val() === true)`,'.validate':'newData.val() === true'};
  p.disconnectedAt={'.write':`${ownPresence} && (!newData.exists() || newData.val() === now)`,'.validate':'newData.isNumber() && newData.val() <= now + 5000'};
  // The broad gameplay wildcard must never become a fallback for savedGame.
  room.$gameState['.write']=room.$gameState['.write'].replace('|emptySince','|emptySince|savedGame');

  const rosterChecks=Array.from({length:6},(_,s)=>{
    const person=`${R}.child('players').child(${R}.child('seats/${s}').val())`;
    return `(${R}.child('seats/${s}').exists() && ${person}.child('isBot').val() === false ? newData.child('humans/${s}').val() === ${R}.child('seats/${s}').val() : !newData.child('humans/${s}').exists())`;
  }).join(' && ');
  const initial=`newData.child('status').val() === 'request' && newData.child('requestedBy').val() === auth.uid && newData.child('requestedAt').val() === now && newData.child('lastAccessAt').val() === now && ${rosterChecks} && newData.child('votes').child(auth.uid).val() === newData.child('id').val() && !newData.child('ready').exists() && !newData.child('resumeId').exists() && !newData.child('resumeAt').exists() && !newData.child('savedAt').exists()`;
  const preserve=['version','id','requestedBy','requestedAt',...Array.from({length:6},(_,s)=>'humans/'+s)];
  room.savedGame={
    '.write':`(${create}) || (!newData.exists() && ((${thaw}) || (${cancel})))`,
    '.validate':`newData.hasChildren(['version','id','status','requestedBy','requestedAt','lastAccessAt','humans','votes']) && (data.exists() ? (${preserve.map(k=>`newData.child('${k}').val() === data.child('${k}').val()`).join(' && ')} && (newData.child('status').val() === 'request' || newData.child('savedAt').isNumber()) && (newData.child('status').val() !== 'resuming' || (newData.child('resumeAt').isNumber() && newData.child('resumeId').isString())) && (data.child('status').val() !== 'saved' || newData.child('status').val() !== 'resuming' || (!newData.child('ready').exists() && newData.child('resumeId').val() !== data.child('resumeId').val() && newData.child('resumeAt').val() === now))) : (${initial}))`,
    version:{'.validate':'newData.val() === 1'},
    id:{'.validate':"newData.isString() && newData.val().matches(/^[a-f0-9]{32}$/)"},
    requestedBy:{'.validate':'newData.isString()'},
    requestedAt:{'.validate':'newData.isNumber()'},
    humans:{'$seat':{'.validate':"$seat.matches(/^[0-5]$/) && newData.isString()"}},
    status:{
      '.write':`${participant} && ((newData.val() === 'saved' && ((${saving}) || (${reset}))) || (newData.val() === 'resuming' && ${start}))`,
      '.validate':"newData.isString() && newData.val().matches(/^(request|saved|resuming)$/)",
    },
    savedAt:{'.write':`${participant} && ${saving} && ${post}.child('status').val() === 'saved'`,'.validate':'newData.isNumber() && newData.val() === now'},
    lastAccessAt:{'.write':`${participant} && ${S}.child('status').val() !== 'request'`,'.validate':'newData.isNumber() && newData.val() === now'},
    votes:{'$uid':{
      '.write':`${participant} && $uid === auth.uid && ${S}.child('status').val() === 'request' && ${S}.child('requestedAt').val() > now - 60000 && newData.exists()`,
      '.validate':`$uid === auth.uid && newData.val() === newData.parent().parent().child('id').val()`,
    }},
    resumeId:{'.write':`${participant} && ${start} && ${post}.child('status').val() === 'resuming'`,'.validate':"newData.isString() && newData.val().matches(/^[a-f0-9]{32}$/) && newData.val() !== data.val()"},
    resumeAt:{'.write':`${participant} && ${start} && ${post}.child('status').val() === 'resuming'`,'.validate':'newData.isNumber() && newData.val() === now'},
    ready:{
      '.write':`${participant} && ${start} && ${post}.child('status').val() === 'resuming' && !newData.exists()`,
      '$uid':{'.write':`${participant} && $uid === auth.uid && (!newData.exists() || (${S}.child('status').val() === 'resuming' && ${online('auth.uid')}))`,
        '.validate':`newData.isString() && newData.val() === ${S}.child('resumeId').val() && $uid === auth.uid`},
    },
    '$other':{'.validate':false},
  };
};
