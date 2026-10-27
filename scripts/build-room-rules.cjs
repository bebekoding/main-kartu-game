/* Generate the fixed (maximum six) seat checks that RTDB rules cannot loop over.
 * Run after changing policy: node scripts/build-room-rules.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, '../database.rules.json');
const rules = JSON.parse(fs.readFileSync(file, 'utf8'));
const R = "root.child('rooms').child($roomCode)";
const real = "auth != null && auth.token.firebase.sign_in_provider === 'password'";
const valid = `${real} && $roomCode.matches(/^[A-Z0-9]{4,6}$/)`;
const p = (r, uid) => `${r}.child('players').child(${uid})`;
const owner = `${R}.child('host').val() === auth.uid`;
const human = (r, uid) => `(${p(r,uid)}.exists() && ${p(r,uid)}.child('isBot').val() === false)`;
const live = (r, uid) => `(${human(r,uid)} && ${p(r,uid)}.child('disconnected').val() !== true && ${p(r,uid)}.child('lastSeen').val() >= now - 15000)`;
const seatUid = (r, s) => `${r}.child('seats/${s}').val()`;
const noHumans = r => `(${r}.child('membershipVersion').val() === 2 && ` + Array.from({length:6},(_,s)=>`(!${r}.child('seats/${s}').exists() || ${p(r,seatUid(r,s))}.child('isBot').val() !== false)`).join(' && ') + ')';
const me = p(R, 'auth.uid');
const member = `(${me}.exists() && ${me}.child('uid').val() === auth.uid && ${me}.child('isBot').val() === false && ${R}.child('seats').child(${me}.child('seat').val() + '').val() === auth.uid)`;
const oldHost = `${R}.child('host').val()`;
const oldHostGone = `(!${R}.child('host').exists() || !${p(R,oldHost)}.exists() || ${p(R,oldHost)}.child('isBot').val() === true || ${p(R,oldHost)}.child('disconnected').val() === true || ${p(R,oldHost)}.child('lastSeen').val() < now - 42000)`;
const firstOnline = Array.from({length:6},(_,s)=>`(${me}.child('seat').val() <= ${s} || !${R}.child('seats/${s}').exists() || !${live(R,seatUid(R,s))})`).join(' && ');
const returnSeat = s => `${R}.child('gameState/roster').child(${s}).child('uid').val() === auth.uid && ${R}.child('gameState/roster').child(${s}).child('isBot').val() === false`;
const postPlayerRoom = 'newData.parent().parent()';
const newSeat = "newData.child('seat').val() + ''";
const targetBefore = `${R}.child('seats').child(${newSeat})`;
const originalReturn = `(${returnSeat(newSeat)} && (!${targetBefore}.exists() || ${targetBefore}.val() === auth.uid || ${p(R,`${targetBefore}.val()`)}.child('isBot').val() === true))`;
const claim = `(${noHumans(R)} && ${postPlayerRoom}.child('host').val() === auth.uid)`;
const reconnectRemove = `(${returnSeat("data.child('seat').val() + ''")} && data.child('isBot').val() === true)`;
const room = {
  '.write': `${valid} && ((!data.exists() && newData.child('host').val() === auth.uid) || (!newData.exists() && (data.child('host').val() === auth.uid || root.child('adminSessions').child(auth.uid).exists())))`,
  '.validate': "newData.child('membershipVersion').val() === 2 && newData.child('maxPlayers').isNumber() && newData.child('maxPlayers').val() >= 3 && newData.child('maxPlayers').val() <= 6 && " + Array.from({length:6},(_,s)=>`(!newData.child('seats/${s}').exists() || (${s} < newData.child('maxPlayers').val() && newData.child('players').child(newData.child('seats/${s}').val()).child('seat').val() === ${s}))`).join(' && ') + ' && ' +
    // Removing/replacing an index must also remove or re-index its old player.
    // Otherwise a human could disappear from the all-bot check while still seated.
    Array.from({length:6},(_,s)=>`(!data.child('seats/${s}').exists() || !newData.child('players').child(data.child('seats/${s}').val()).exists() || newData.child('seats').child(newData.child('players').child(data.child('seats/${s}').val()).child('seat').val() + '').val() === data.child('seats/${s}').val())`).join(' && ') +
    " && (!data.exists() || newData.child('host').val() === data.child('host').val() || !newData.child('hostRequests').exists())",
  membershipVersion: {'.write': `${valid} && ${owner}`, '.validate': 'newData.val() === 2'},
  seats: {
    '.write': `${valid} && ${owner}`,
    '$seat': {
      '.write': `${valid} && $seat.matches(/^[0-5]$/) && ((data.val() === auth.uid && !newData.exists()) || (newData.val() === auth.uid && (!data.exists() || data.val() === auth.uid || ${p(R,'data.val()')}.child('isBot').val() === true)))`,
      '.validate': "newData.isString() && newData.parent().parent().child('players').child(newData.val()).child('seat').val() + '' === $seat",
    },
  },
  host: {
    '.write': `${valid} && (` +
      // Existing owner approves a live request, or leaves atomically.
      `(${owner} && ((newData.exists() && ${live('newData.parent()','newData.val()')} && ${R}.child('hostRequests').child(newData.val()).child('hostUid').val() === auth.uid) || (!${human('newData.parent()','auth.uid')} && (!newData.exists() || ${live('newData.parent()','newData.val()')})))) || ` +
      // Automatic failover belongs only to the first already-seated live human.
      `(newData.val() === auth.uid && ${member} && ${live(R,'auth.uid')} && ${oldHostGone} && ${firstOnline}) || ` +
      // Open claim: the pre-state has no human at any canonical seat.
      `(newData.val() === auth.uid && ${noHumans(R)} && ${live('newData.parent()','auth.uid')})` + ')',
    '.validate': "newData.isString() && newData.parent().child('players').child(newData.val()).child('isBot').val() === false",
  },
  hostRequests: {
    '.write': `${valid} && !newData.exists() && (${owner} || (newData.parent().child('host').val() === auth.uid && ${R}.child('host').val() !== auth.uid))`,
    '$uid': {
      '.write': `${valid} && (($uid === auth.uid && (!newData.exists() || (${member} && ${live(R,'auth.uid')} && ${R}.child('host').val() !== auth.uid))) || (${owner} && !newData.exists()))`,
      '.validate': `newData.hasChildren(['uid','hostUid','requestedAt']) && newData.child('uid').val() === $uid && newData.child('hostUid').val() === ${R}.child('host').val() && newData.child('requestedAt').isNumber() && newData.child('requestedAt').val() >= now - 10000 && newData.child('requestedAt').val() <= now + 5000`,
    },
  },
  players: {
    '$playerUid': {
      '.write': `${valid} && ${R}.exists() && (` +
        `($playerUid === auth.uid && (data.exists() || (${R}.child('phase').val() === 'lobby' && !${targetBefore}.exists()) || ${originalReturn} || ${claim})) || ` +
        `(${owner} && (newData.exists() || data.child('isBot').val() === true || data.child('disconnected').val() === true || data.child('lastSeen').val() < now - 42000) && (data.exists() || newData.child('isBot').val() === true || ${R}.child('phase').val() === 'lobby' || (${R}.child('gameState/roster').child(${newSeat}).child('uid').val() === $playerUid && ${R}.child('gameState/roster').child(${newSeat}).child('isBot').val() === false))) || ` +
        `(!newData.exists() && (${reconnectRemove} || (${noHumans(R)} && ${postPlayerRoom}.child('host').val() === auth.uid))))`,
      '.validate': `newData.hasChildren(['uid','seat','nickname','isBot']) && newData.child('uid').val() === $playerUid && newData.child('nickname').isString() && newData.child('nickname').val().length <= 64 && newData.child('isBot').isBoolean() && newData.child('seat').isNumber() && newData.child('seat').val() % 1 === 0 && newData.child('seat').val() >= 0 && newData.child('seat').val() < 6 && ${postPlayerRoom}.child('seats').child(${newSeat}).val() === $playerUid && (!data.exists() || ${R}.child('phase').val() === 'lobby' || newData.child('seat').val() === data.child('seat').val())`,
      lastSeen: {'.validate': 'newData.isNumber() && newData.val() >= 0 && newData.val() <= now + 5000'},
    },
  },
};
for (const field of ['phase','gameState','roster','maxPlayers','botDifficulty','code','game','createdAt']) {
  room[field] = {'.write': `${valid} && ${owner}`};
}
for (const field of ['chat','voice','signals']) room[field] = rules.rules.rooms.$roomCode[field];
const reserved = 'host|players|seats|membershipVersion|hostRequests|phase|gameState|roster|maxPlayers|botDifficulty|code|game|createdAt|chat|voice|signals';
room.$gameState = {'.write': `${valid} && !$gameState.matches(/^(${reserved})$/) && ${member}`};
require('./card-schema.cjs')(room, `${valid} && ${member}`);
rules.rules.rooms.$roomCode = room;
require('./admin-policy.cjs')(rules);
require('./leaderboard-policy.cjs')(rules, room);
fs.writeFileSync(file, JSON.stringify(rules,null,2)+'\n');
