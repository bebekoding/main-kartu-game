/* Cleanup is allowed to signed-in users only when every canonical human has
 * been absent for 30 seconds. Fresh server data is checked at deletion time. */
module.exports=function(room){
  const R="root.child('rooms').child($roomCode)";
  const real="auth != null && auth.token.firebase.sign_in_provider === 'password'";
  const slots=(r,fn)=>Array.from({length:6},(_,s)=>{
    const p=`${r}.child('players').child(${r}.child('seats/${s}').val())`;
    return `(!${r}.child('seats/${s}').exists() || ${p}.child('isBot').val() !== false || (${fn(p)}))`;
  }).join(' && ');
  const positive=x=>`${x}.isNumber() && ${x}.val() > 0`;
  const old=(x,ms)=>`(!(${positive(x)}) || ${x}.val() <= now - ${ms})`;
  const marker=`${R}.child('emptySince')`;
  const stale=slots(R,p=>`${old(`${p}.child('lastSeen')`,30000)} && ${old(`${p}.child('disconnectedAt')`,30000)} && ((${positive(`${p}.child('lastSeen')`)}) || (${positive(`${p}.child('disconnectedAt')`)}) || (${positive(marker)} && ${marker}.val() <= now - 30000))`);
  const botsOnly=slots(R,()=> 'false');
  // Bots-only rooms also wait 30 seconds after the last human leaves. Bot
  // timestamps and historic game rosters never count as a present human.
  const expired=`${R}.child('membershipVersion').val() === 2 && ${stale} && (!(${botsOnly}) || (${positive(marker)} && ${marker}.val() <= now - 30000))`;
  room['.write'] += ` || (${real} && $roomCode.matches(/^[A-Z0-9]{4,6}$/) && data.exists() && !newData.exists() && ${expired})`;
  const away=slots(R,p=>`${old(`${p}.child('lastSeen')`,15000)} && ${old(`${p}.child('disconnectedAt')`,15000)}`);
  const post='newData.parent()';
  const postBots=slots(post,()=> 'false');
  const postAway=slots(post,p=>`${old(`${p}.child('lastSeen')`,15000)} && ${old(`${p}.child('disconnectedAt')`,15000)}`);
  const lastLeaving=`${R}.child('players').child(auth.uid).child('isBot').val() === false && (${postBots})`;
  room.emptySince={
    '.write':`${real} && ${R}.exists() && ((newData.exists() && ${R}.child('membershipVersion').val() === 2 && ((!data.exists() && (${away})) || (${lastLeaving}))) || (!newData.exists() && !(${postAway})))`,
    '.validate':'newData.isNumber() && newData.val() === now',
  };
  room.$gameState['.write']=room.$gameState['.write'].replace('|signals','|signals|emptySince');
};
