/* Validation only: this never expands who may write a game action. Child
 * validation also runs for parent PUT/PATCH and atomic multi-location writes.
 */
const rank = "newData.isString() && newData.val().matches(/^(2|3|4|5|6|7|8|9|10|J|Q|K|A)$/)";
const seat = {'.validate': 'newData.isNumber() && newData.val() % 1 === 0 && newData.val() >= 0 && newData.val() < 6'};
const boolean = {'.validate': 'newData.isBoolean()'};
function card(jokers) {
  const standard = "newData.child('rank').isString() && newData.child('rank').val().matches(/^(2|3|4|5|6|7|8|9|10|J|Q|K|A)$/) && newData.child('suit').isString() && newData.child('suit').val().matches(/^[SHCD]$/) && !newData.child('color').exists()";
  const joker = "newData.child('rank').val() === 'JOKER' && !newData.child('suit').exists() && newData.child('color').isString() && newData.child('color').val().matches(/^(red|black)$/)";
  return {
    '.validate': `(${standard})${jokers ? ` || (${joker})` : ''}`,
    rank: {'.validate': `newData.isString() && newData.val().matches(/^(2|3|4|5|6|7|8|9|10|J|Q|K|A${jokers ? '|JOKER' : ''})$/)`},
    suit: {'.validate': "newData.isString() && newData.val().matches(/^[SHCD]$/)"},
    color: {'.validate': "newData.isString() && newData.val().matches(/^(red|black)$/)"},
    fromDiscardBy: seat,
    mustLayThisTurn: boolean,
    justPicked: boolean,
    justPickedSeq: {'.validate': 'newData.isNumber() && newData.val() % 1 === 0 && newData.val() >= 0 && newData.val() < 56'},
    pickupNonce: {'.validate': "newData.isString() && newData.val().matches(/^[A-Za-z0-9]{1,80}$/)"},
    '$other': {'.validate': false},
  };
}
function list(item) {
  return {'.validate': 'newData.hasChildren()', '$index': {
    ...item, '.validate': '$index.matches(/^(0|[1-9]|[1-4][0-9]|5[0-5])$/) && (' + (item['.validate'] || 'true') + ')',
  }};
}
function hands(jokers) {
  return {'.validate':'newData.hasChildren()', '$seat': {
    ...list(card(jokers)), '.validate': "$seat.matches(/^[0-5]$/) && newData.hasChildren()",
  }};
}
function tricks(jokers) {
  return list({'.validate': "newData.hasChildren(['seat','card'])", seat, card:card(jokers), '$other':{'.validate':false}});
}
function action(log = false) {
  return {
    '.validate': log ? "newData.hasChildren(['by','rank','at','hit'])" : "newData.hasChildren(['by','rank','at','type'])",
    rank:{'.validate':rank}, by:seat, target:seat,
    at:{'.validate':'newData.isNumber() && newData.val() >= 0'},
    type:{'.validate':"newData.isString() && newData.val().matches(/^(guess_hit|guess_miss|four_of_kind)$/)"},
    hit:{'.validate':'newData.isNumber() && newData.val() % 1 === 0 && newData.val() >= 0 && newData.val() <= 4'},
    count:{'.validate':'newData.isNumber() && newData.val() % 1 === 0 && newData.val() >= 0 && newData.val() <= 4'},
    four:list({'.validate':rank}), noDraw:boolean, drew:boolean,
    '$other':{'.validate':false},
  };
}
module.exports = function install(room, write) {
  // Each game node has the same write policy as the previous wildcard. Explicit
  // literals need this policy because the fallback must exclude their names.
  const fallback = room.$gameState['.write'];
  room.hands = {'.write':write, ...hands(false)};
  room.bidding = {'.write':write, bids:{'$seat':{cards:list(card(false))}}};
  room.play = {'.write':write, currentTrick:tricks(false)};
  room.remi = {'.write':write, hands:hands(true), deck:list(card(true)), lastDrawnCard:card(true),
    discard:list({...card(true), '.validate': "newData.hasChild('card') || ("+card(true)['.validate']+")", card:card(true), by:seat}),
    laidDown:{'$seat':{...list({'.validate':"newData.hasChildren(['kind','cards'])", kind:{'.validate':"newData.isString() && newData.val().matches(/^(dasar|pararel)$/)"},cards:list(card(true))}), '.validate':"$seat.matches(/^[0-5]$/) && newData.hasChildren()"}},
  };
  room.cangkul = {'.write':write, hands:hands(true), drawPile:list(card(true)), lastDrawnCard:card(true), currentTrick:tricks(true)};
  room.tebak = {'.write':write, hands:hands(false), deck:list(card(false)), lastAction:action(), log:list(action(true)),
    jadi:{'$seat':{...list({'.validate':"("+rank+") || newData.hasChildren(['rank'])", rank:{'.validate':rank}, cards:list(card(false))}), '.validate':"$seat.matches(/^[0-5]$/) && newData.hasChildren()"}},
  };
  // Exclude literal nodes, otherwise a denied explicit write could fall through
  // to the wildcard (or a future edit could accidentally weaken their policy).
  room.$gameState['.write'] = fallback.replace('createdAt|chat|voice|signals', 'createdAt|chat|voice|signals|hands|bidding|play|remi|cangkul|tebak');
};
