/* Host-trust Capsa. Hidden data is outside public rooms. Non-host clients can
 * submit only their own immutable requests and read only their own hand/acks. */
module.exports=function(rules,room){
 const R="root.child('rooms').child($code)",C="root.child('capsaMatches').child($code)";
 const real="auth != null && auth.token.firebase.sign_in_provider === 'password'";
 const member=`${R}.child('game').val() === 'capsa' && ${R}.child('players').child(auth.uid).child('isBot').val() === false && ${R}.child('seats').child(${R}.child('players').child(auth.uid).child('seat').val() + '').val() === auth.uid`;
 const host=`${real} && ${member} && ${R}.child('host').val() === auth.uid`;
 const same=`${C}.child('createdAt').val() === ${R}.child('createdAt').val()`;
 const active=`${real} && ${member} && ${same}`;
 const unfrozen=`!${R}.child('savedGame').exists()`;
 rules.rules.capsaMatches={ '$code':{
  '.read':`${host} && (!data.exists() || ${same})`,
  '.write':`$code.matches(/^[A-Z0-9]{4,6}$/) && (newData.exists() ? (${host} && ${unfrozen}) : (${real} && (!${R}.exists() || (${host} && !(${same})))))`,
  '.validate':`newData.hasChildren(['matchId','generation','createdAt','owner','roster','revision','phase','privateSnapshot','publicSnapshot','hands']) && newData.child('createdAt').val() === ${R}.child('createdAt').val() && newData.child('owner').val() === ${R}.child('host').val() && (!data.exists() || newData.child('matchId').val() !== data.child('matchId').val() || (newData.child('revision').val() >= data.child('revision').val() && newData.child('revision').val() <= data.child('revision').val() + 1))`,
  createdAt:{'.validate':'newData.isNumber()'},revision:{'.validate':'newData.isNumber() && newData.val() >= 0 && newData.val() % 1 === 0'},
  matchId:{'.validate':'newData.isString() && newData.val().length <= 80'},generation:{'.validate':'newData.isString() && newData.val().length <= 80'},owner:{'.validate':'newData.isString()'},
  phase:{'.validate':"newData.isString() && newData.val().matches(/^(round_ready|playing|bomb_choice|round_end|session_end)$/)"},
  roster:Object.fromEntries(Array.from({length:4},(_,s)=>[s,{'.validate':`newData.isString() && newData.val() === ${R}.child('seats/${s}').val()`}])),
  privateSnapshot:{'.validate':'newData.isString() && newData.val().length < 2000000'},
  publicSnapshot:{'.read':active,'.validate':'newData.isString() && newData.val().length < 150000'},
  hands:{'$uid':{'.read':`${active} && $uid === auth.uid`,'.validate':'newData.isString() && newData.val().length < 5000'}},
  requests:{'$uid':{
   '.read':`${active} && $uid === auth.uid`,
   '$id':{'.write':`${active} && ${unfrozen} && $uid === auth.uid && newData.exists() && (data.exists() ? newData.val() === data.val() : !data.parent().exists()) && !${C}.child('responses').child($uid).child($id).exists()`,'.validate':"$id.matches(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/) && newData.isString() && newData.val().length < 8000"}
  }},
  responses:{'$uid':{'.read':`${active} && $uid === auth.uid`}},
 }};
 rules.rules.capsaCatalog={'.read':true,'$code':{'.write':`$code.matches(/^[A-Z0-9]{4,6}$/) && ${real} && (newData.exists() ? (${host} && newData.val() === ${R}.child('createdAt').val()) : !${R}.exists())`,'.validate':'newData.isNumber()'}};
 room.capsaMode={'.write':"auth != null && root.child('rooms').child($roomCode).child('host').val() === auth.uid && !root.child('rooms').child($roomCode).child('savedGame').exists()",'.validate':"newData.val() === 'browser_host'"};
 room.$gameState['.write']+=" && $gameState !== 'capsaMode'";
 const cap="root.child('capsaMatches').child($roomCode)";
 room.savedGame['.write']+=` && (!newData.exists() || data.exists() || root.child('rooms').child($roomCode).child('capsaMode').val() !== 'browser_host' || (${cap}.child('phase').exists() && ${cap}.child('phase').val() !== 'session_end'))`;
};
