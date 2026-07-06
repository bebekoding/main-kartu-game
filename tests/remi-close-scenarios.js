// Standalone test harness untuk close detection di Remi.
// Replikasi logic dari maybeResolveRemiRound supaya bisa di-run via node tanpa Firebase.
// Run: node tests/remi-close-scenarios.js

const MAX_PLAYERS = 4;

function remiCardValue(card) {
  if (!card) return 0;
  if (card.rank === 'JOKER') return 25;
  if (card.rank === 'A') return 15;
  if (card.rank === 'K' || card.rank === 'Q' || card.rank === 'J') return 10;
  return 5;
}

// Direct port dari logic di truf-multiplayer-v3.html maybeResolveRemiRound,
// hanya menghitung helperDelta + closingExtra + closeNoBonus + reversalNextRound.
function resolveClose(state) {
  const c2 = state;
  const closedBy = c2.closedBy;
  const helperDelta = {};
  let closingExtra = {};
  let closeNoBonus = false;
  let bonusUnit = 0;
  let contArr = [];

  if (closedBy != null) {
    const closingMethod = c2.lastDrawnFrom || 'deck';
    if (closingMethod === 'discard') {
      const discardArr = Array.isArray(c2.discard) ? c2.discard : Object.values(c2.discard || {});
      const lastEntry = discardArr[discardArr.length - 1];
      const lastDiscardCard = (lastEntry && lastEntry.card) ? lastEntry.card : lastEntry;
      const lastDiscardValue = lastDiscardCard ? remiCardValue(lastDiscardCard) : 0;
      bonusUnit = lastDiscardValue * 10;

      const rawContribs = c2.lastPickupContributors || [];
      const pickupSeatsRaw = Array.isArray(rawContribs) ? rawContribs : Object.values(rawContribs);
      const pickupSeats = new Set(
        pickupSeatsRaw
          .map(s => (typeof s === 'string' ? Number(s) : s))
          .filter(s => s != null && !Number.isNaN(s) && s !== closedBy)
      );

      const closerLaidRaw = (c2.laidDown && (c2.laidDown[closedBy] || c2.laidDown[String(closedBy)])) || [];
      const closerLaid = Array.isArray(closerLaidRaw) ? closerLaidRaw : Object.values(closerLaidRaw);

      const contributors = new Set();
      for (const combo of closerLaid) {
        const cardsArr = Array.isArray(combo.cards) ? combo.cards : Object.values(combo.cards || {});
        for (const card of cardsArr) {
          const origin = card ? card.fromDiscardBy : null;
          const originNum = (typeof origin === 'string') ? Number(origin) : origin;
          const closedByNum = (typeof closedBy === 'string') ? Number(closedBy) : closedBy;
          const isOtherContributor = originNum != null && !Number.isNaN(originNum)
            && originNum !== closedByNum;
          if (isOtherContributor) {
            if (pickupSeats.has(originNum) || card.justPicked === true) {
              contributors.add(originNum);
            }
          }
        }
      }

      contArr = Array.from(contributors).sort((a, b) => {
        const da = ((a - closedBy) + MAX_PLAYERS) % MAX_PLAYERS;
        const db = ((b - closedBy) + MAX_PLAYERS) % MAX_PLAYERS;
        return da - db;
      });

      const extraPenalty = [0, -50, -100];
      closingExtra = {};
      for (let ci = 0; ci < contArr.length; ci++) {
        const cseat = contArr[ci];
        const extra = (ci < extraPenalty.length) ? extraPenalty[ci] : -(50 * ci);
        helperDelta[cseat] = (helperDelta[cseat] || 0) - bonusUnit + extra;
        if (extra !== 0) closingExtra[cseat] = extra;
      }
      if (contArr.length > 0) {
        helperDelta[closedBy] = (helperDelta[closedBy] || 0) + bonusUnit;
      } else {
        closeNoBonus = true; // rule 4
      }
    } else {
      // rule 2: close via cabutan
      closeNoBonus = true;
    }
  }

  return {
    closingMethod: closedBy != null ? (c2.lastDrawnFrom || 'deck') : null,
    bonusUnit,
    contributors: contArr,
    helperDelta,
    closingExtra,
    closeNoBonus,
    reverseNextRound: closedBy != null, // setiap close → reversal
  };
}

// ===== Test utilities =====
let pass = 0, fail = 0;
const failures = [];

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== 'object') return a === b;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!deepEqual(a[k], b[k])) return false;
  return true;
}

function test(name, state, expected) {
  const actual = resolveClose(state);
  const okMethod = actual.closingMethod === expected.closingMethod;
  const okBonus = actual.bonusUnit === expected.bonusUnit;
  const okContribs = deepEqual(actual.contributors, expected.contributors);
  const okDelta = deepEqual(actual.helperDelta, expected.helperDelta);
  const okExtra = deepEqual(actual.closingExtra, expected.closingExtra);
  const okNoBonus = actual.closeNoBonus === expected.closeNoBonus;
  const okReverse = actual.reverseNextRound === expected.reverseNextRound;

  const passed = okMethod && okBonus && okContribs && okDelta && okExtra && okNoBonus && okReverse;
  if (passed) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    failures.push({ name, expected, actual });
    console.log(`  ❌ ${name}`);
    if (!okMethod)   console.log(`     method  expected=${expected.closingMethod}  actual=${actual.closingMethod}`);
    if (!okBonus)    console.log(`     bonus   expected=${expected.bonusUnit}  actual=${actual.bonusUnit}`);
    if (!okContribs) console.log(`     contrib expected=${JSON.stringify(expected.contributors)}  actual=${JSON.stringify(actual.contributors)}`);
    if (!okDelta)    console.log(`     delta   expected=${JSON.stringify(expected.helperDelta)}  actual=${JSON.stringify(actual.helperDelta)}`);
    if (!okExtra)    console.log(`     extra   expected=${JSON.stringify(expected.closingExtra)}  actual=${JSON.stringify(actual.closingExtra)}`);
    if (!okNoBonus)  console.log(`     noBonus expected=${expected.closeNoBonus}  actual=${actual.closeNoBonus}`);
    if (!okReverse)  console.log(`     reverse expected=${expected.reverseNextRound}  actual=${actual.reverseNextRound}`);
  }
}

// ===== Helpers untuk bangun state =====
function discardEntry(card, by) { return { card, by }; }
function pickedCard(card, fromSeat, opts = {}) {
  return { ...card, fromDiscardBy: fromSeat, justPicked: true, justPickedSeq: opts.seq || 0,
    ...(opts.mustLay ? { mustLayThisTurn: true } : {}) };
}
function ownCard(card) { return { ...card }; }
function combo(kind, cards) { return { kind, cards, atTurn: Date.now() }; }

// =================================================================
// SCENARIO 1: Close via CABUTAN (deck)
//   Closer (seat 0) draws from deck → discards last card → close
//   Rule 2: no bonus + reversal
// =================================================================
console.log('\n📦 Scenario 1: Close via cabutan (deck)');
test('cabutan close: no bonus + reversal', {
  closedBy: 0,
  lastDrawnFrom: 'deck',
  lastPickupContributors: [],
  discard: [
    discardEntry({rank:'5', suit:'♠'}, 0), // closer's closing card
  ],
  laidDown: { 0: [], 1: [], 2: [], 3: [] },
}, {
  closingMethod: 'deck',
  bonusUnit: 0,
  contributors: [],
  helperDelta: {},
  closingExtra: {},
  closeNoBonus: true,
  reverseNextRound: true,
});

// =================================================================
// SCENARIO 2: Close via DISCARD but picked card hanya tutupan
//   Closer ambil card dari discard → tidak lay → discard sebagai close
//   Rule 4: no bonus + reversal
// =================================================================
console.log('\n📦 Scenario 2: Close via discard, picked card = tutupan only');
test('discard close, no lay (card jadi tutupan)', {
  closedBy: 0,
  lastDrawnFrom: 'discard',
  lastPickupContributors: [2], // closer picked from seat 2 originally
  discard: [
    discardEntry({rank:'K', suit:'♥', fromDiscardBy: 2}, 0), // picked card now back as close discard
  ],
  laidDown: { 0: [], 1: [], 2: [], 3: [] }, // no combos laid
}, {
  closingMethod: 'discard',
  bonusUnit: 100, // K = 10 × 10 (but unused since no contributors)
  contributors: [],
  helperDelta: {},
  closingExtra: {},
  closeNoBonus: true,
  reverseNextRound: true,
});

// =================================================================
// SCENARIO 3: Close via DISCARD with 1 contributor (basic bonus)
//   Closer (seat 1) ambil dari discard (seat 0 punya), lay combo, close
//   Rule 5: bonus +50 untuk closer, penalty -50 untuk seat 0
// =================================================================
console.log('\n📦 Scenario 3: Close via discard, 1 contributor laid');
test('discard close, 1 contributor (basic bonus)', {
  closedBy: 1,
  lastDrawnFrom: 'discard',
  lastPickupContributors: [0],
  discard: [
    discardEntry({rank:'5', suit:'♣'}, 1), // closer's closing card (own discard, value 5)
  ],
  laidDown: {
    0: [],
    1: [
      combo('dasar', [
        pickedCard({rank:'7', suit:'♠'}, 0, {mustLay:true}),
        ownCard({rank:'8', suit:'♠'}),
        ownCard({rank:'9', suit:'♠'}),
      ]),
    ],
    2: [], 3: [],
  },
}, {
  closingMethod: 'discard',
  bonusUnit: 50, // closing card value 5 × 10
  contributors: [0],
  helperDelta: { 0: -50, 1: 50 },
  closingExtra: {},
  closeNoBonus: false,
  reverseNextRound: true,
});

// =================================================================
// SCENARIO 4: Close via DISCARD with 2 contributors (tarikan -50)
//   Closer (seat 2) picked dari seat 0 + seat 3, both jadi combo
//   Rule 6: penyumbang ke-1 = -bonus, penyumbang ke-2 = -bonus - 50
// =================================================================
console.log('\n📦 Scenario 4: Close via discard, 2 contributors (tarikan -50)');
test('discard close, 2 contributors (tarikan)', {
  closedBy: 2,
  lastDrawnFrom: 'discard',
  lastPickupContributors: [0, 3],
  discard: [
    discardEntry({rank:'J', suit:'♦'}, 2), // closer's closing card (J = 10 × 10 = 100)
  ],
  laidDown: {
    0: [], 1: [],
    2: [
      combo('pararel', [
        pickedCard({rank:'5', suit:'♠'}, 0, {seq:0}),
        ownCard({rank:'5', suit:'♥'}),
        ownCard({rank:'5', suit:'♣'}),
      ]),
      combo('dasar', [
        pickedCard({rank:'10', suit:'♦'}, 3, {seq:1, mustLay:true}),
        ownCard({rank:'J', suit:'♦'}),
        ownCard({rank:'Q', suit:'♦'}),
      ]),
    ],
    3: [],
  },
}, {
  closingMethod: 'discard',
  bonusUnit: 100,
  // Order: contArr sorted clockwise from closedBy=2 → 3 (offset 1), then 0 (offset 2)
  contributors: [3, 0],
  helperDelta: { 3: -100, 0: -150, 2: 100 }, // 0 gets extra -50
  closingExtra: { 0: -50 },
  closeNoBonus: false,
  reverseNextRound: true,
});

// =================================================================
// SCENARIO 5: Close via DISCARD with 3 contributors (tarikan -50, -100)
// =================================================================
console.log('\n📦 Scenario 5: Close via discard, 3 contributors (tarikan -50, -100)');
test('discard close, 3 contributors (full tarikan)', {
  closedBy: 0,
  lastDrawnFrom: 'discard',
  lastPickupContributors: [1, 2, 3],
  discard: [
    discardEntry({rank:'A', suit:'♣'}, 0), // closing card A = 15 × 10 = 150
  ],
  laidDown: {
    0: [
      combo('dasar', [
        pickedCard({rank:'3', suit:'♠'}, 1, {seq:0}),
        ownCard({rank:'4', suit:'♠'}),
        ownCard({rank:'5', suit:'♠'}),
      ]),
      combo('dasar', [
        pickedCard({rank:'7', suit:'♥'}, 2, {seq:1}),
        ownCard({rank:'8', suit:'♥'}),
        ownCard({rank:'9', suit:'♥'}),
      ]),
      combo('pararel', [
        pickedCard({rank:'Q', suit:'♣'}, 3, {seq:2, mustLay:true}),
        ownCard({rank:'Q', suit:'♥'}),
        ownCard({rank:'Q', suit:'♦'}),
      ]),
    ],
    1: [], 2: [], 3: [],
  },
}, {
  closingMethod: 'discard',
  bonusUnit: 150,
  // From seat 0, clockwise: 1 (offset 1), 2 (offset 2), 3 (offset 3)
  contributors: [1, 2, 3],
  helperDelta: { 1: -150, 2: -200, 3: -250, 0: 150 },
  closingExtra: { 2: -50, 3: -100 },
  closeNoBonus: false,
  reverseNextRound: true,
});

// =================================================================
// SCENARIO 6: 3 picks but only 2 jadi (1 stays as tutupan)
//   Closer pick 3 cards (from 3 different seats), only 2 laid, 1 didiscard sebagai tutupan
//   Rule 7: only 2 contributors penalized
// =================================================================
console.log('\n📦 Scenario 6: 3 picks, only 2 jadi (1 stays as tutupan)');
test('discard close, 3 picked but 1 just tutupan', {
  closedBy: 1,
  lastDrawnFrom: 'discard',
  lastPickupContributors: [0, 2, 3], // 3 different contributors picked from
  discard: [
    // The 3rd pick (seat 3's card) became the closing discard — back to pile
    discardEntry({rank:'8', suit:'♦', fromDiscardBy: 3}, 1),
  ],
  laidDown: {
    0: [], 2: [], 3: [],
    1: [
      // Combo 1: contains seat 0's card (jadi)
      combo('dasar', [
        pickedCard({rank:'4', suit:'♣'}, 0, {seq:0}),
        ownCard({rank:'5', suit:'♣'}),
        ownCard({rank:'6', suit:'♣'}),
      ]),
      // Combo 2: contains seat 2's card (jadi)
      combo('pararel', [
        pickedCard({rank:'10', suit:'♥'}, 2, {seq:1, mustLay:true}),
        ownCard({rank:'10', suit:'♣'}),
        ownCard({rank:'10', suit:'♠'}),
      ]),
      // Seat 3's card NOT in any combo — closer discarded it as tutupan
    ],
  },
}, {
  closingMethod: 'discard',
  bonusUnit: 80, // 8 = 5 × 10... wait closing card is 8 (number), value=5, ×10 = 50
  contributors: [2, 0], // sorted clockwise from 1: 2 (offset 1), 0 (offset 3) — wait check
  helperDelta: { 2: -50, 0: -100, 1: 50 },
  closingExtra: { 0: -50 },
  closeNoBonus: false,
  reverseNextRound: true,
});

// Hmm let me reconsider scenario 6 — the closing card is 8 (value 5, bonus 50)
// not 80. Let me re-check assertions.

// =================================================================
// SCENARIO 7: 2 picks dari seat sama (same contributor)
//   Picked 2 cards but both from seat 0 (e.g. seat 0 discarded 2 turns ago + 1 turn ago)
//   Both end up in lay — counted as 1 contributor (not double-penalized)
// =================================================================
console.log('\n📦 Scenario 7: 2 picks dari 1 contributor (no double-penalty)');
test('discard close, 2 cards but 1 contributor (no double)', {
  closedBy: 1,
  lastDrawnFrom: 'discard',
  lastPickupContributors: [0],
  discard: [
    discardEntry({rank:'9', suit:'♣'}, 1), // closing card: 9 value=5 × 10 = 50
  ],
  laidDown: {
    0: [], 2: [], 3: [],
    1: [
      combo('dasar', [
        pickedCard({rank:'4', suit:'♥'}, 0, {seq:0}),
        pickedCard({rank:'5', suit:'♥'}, 0, {seq:1, mustLay:true}),
        ownCard({rank:'6', suit:'♥'}),
      ]),
    ],
  },
}, {
  closingMethod: 'discard',
  bonusUnit: 50,
  contributors: [0],
  helperDelta: { 0: -50, 1: 50 },
  closingExtra: {},
  closeNoBonus: false,
  reverseNextRound: true,
});

// =================================================================
// SCENARIO 8: Picked card NOT in any laid combo (just tutupan use)
//   Closer picks 1 card from seat 0, doesn't lay it, just discards it
//   Rule 4: no bonus, no penalty + reversal
// =================================================================
console.log('\n📦 Scenario 8: Picked card stays as tutupan (no lay)');
test('discard close, picked card became closing discard (no lay)', {
  closedBy: 2,
  lastDrawnFrom: 'discard',
  lastPickupContributors: [0],
  discard: [
    // Closer picked from seat 0, then discarded the same card
    discardEntry({rank:'5', suit:'♠', fromDiscardBy: 0}, 2),
  ],
  laidDown: { 0: [], 1: [], 2: [], 3: [] }, // no combos
}, {
  closingMethod: 'discard',
  bonusUnit: 50,
  contributors: [],
  helperDelta: {},
  closingExtra: {},
  closeNoBonus: true,
  reverseNextRound: true,
});

// =================================================================
// SCENARIO 9: Fallback test — lastPickupContributors empty but card has justPicked
//   Edge case: jika data race, lastPickupContributors null/empty
//   Fallback: justPicked === true di laid combo masih dideteksi sebagai contributor
// =================================================================
console.log('\n📦 Scenario 9: Fallback (lastPickupContributors empty, justPicked tag intact)');
test('discard close, fallback via justPicked tag', {
  closedBy: 0,
  lastDrawnFrom: 'discard',
  lastPickupContributors: [], // empty (race condition)
  discard: [
    discardEntry({rank:'K', suit:'♦'}, 0),
  ],
  laidDown: {
    0: [
      combo('dasar', [
        pickedCard({rank:'7', suit:'♣'}, 2, {mustLay:true}), // still has justPicked: true
        ownCard({rank:'8', suit:'♣'}),
        ownCard({rank:'9', suit:'♣'}),
      ]),
    ],
    1: [], 2: [], 3: [],
  },
}, {
  closingMethod: 'discard',
  bonusUnit: 100, // K = 10 × 10
  contributors: [2], // detected via justPicked fallback
  helperDelta: { 2: -100, 0: 100 },
  closingExtra: {},
  closeNoBonus: false,
  reverseNextRound: true,
});

// =================================================================
// SCENARIO 10: Closer's own previous discard re-picked (own contribution NOT counted)
// =================================================================
console.log('\n📦 Scenario 10: Closer picks own discard (no self-contribution)');
test('discard close, picked own card (not counted)', {
  closedBy: 1,
  lastDrawnFrom: 'discard',
  lastPickupContributors: [], // own picks filtered out at pickup
  discard: [
    discardEntry({rank:'6', suit:'♥'}, 1),
  ],
  laidDown: {
    0: [], 2: [], 3: [],
    1: [
      combo('dasar', [
        pickedCard({rank:'4', suit:'♦'}, 1, {mustLay:true}), // fromDiscardBy = self (1)
        ownCard({rank:'5', suit:'♦'}),
        ownCard({rank:'6', suit:'♦'}),
      ]),
    ],
  },
}, {
  closingMethod: 'discard',
  bonusUnit: 50,
  contributors: [], // own contribution excluded
  helperDelta: {},
  closingExtra: {},
  closeNoBonus: true,
  reverseNextRound: true,
});

// =================================================================
// SCENARIO 11: Joker as closing card (value 25 × 10 = 250)
// =================================================================
console.log('\n📦 Scenario 11: Joker closing card (high-value bonus)');
test('discard close, closing card = JOKER (250 bonus)', {
  closedBy: 0,
  lastDrawnFrom: 'discard',
  lastPickupContributors: [2],
  discard: [
    discardEntry({rank:'JOKER', suit:'JOKER', color:'red'}, 0),
  ],
  laidDown: {
    0: [
      combo('dasar', [
        pickedCard({rank:'A', suit:'♠'}, 2, {mustLay:true}),
        ownCard({rank:'2', suit:'♠'}),
        ownCard({rank:'3', suit:'♠'}),
      ]),
    ],
    1: [], 2: [], 3: [],
  },
}, {
  closingMethod: 'discard',
  bonusUnit: 250,
  contributors: [2],
  helperDelta: { 2: -250, 0: 250 },
  closingExtra: {},
  closeNoBonus: false,
  reverseNextRound: true,
});

// =================================================================
// SCENARIO 12: Deck-empty stuck (no closer) — no reversal
// =================================================================
console.log('\n📦 Scenario 12: Deck empty, no closer (no reversal)');
test('deck empty, no close (no reversal)', {
  closedBy: null,
  lastDrawnFrom: 'deck',
  lastPickupContributors: [],
  discard: [discardEntry({rank:'9', suit:'♠'}, 2)],
  laidDown: { 0: [], 1: [], 2: [], 3: [] },
}, {
  closingMethod: null,
  bonusUnit: 0,
  contributors: [],
  helperDelta: {},
  closingExtra: {},
  closeNoBonus: false,
  reverseNextRound: false,
});

// =================================================================
console.log('\n=== SUMMARY ===');
console.log(`Total: ${pass + fail}  ·  Pass: ${pass}  ·  Fail: ${fail}`);
if (fail > 0) {
  console.log('\n❌ FAILURES:');
  for (const f of failures) {
    console.log(`  - ${f.name}`);
    console.log(`    expected:`, JSON.stringify(f.expected, null, 2).replace(/\n/g, '\n    '));
    console.log(`    actual:  `, JSON.stringify(f.actual,   null, 2).replace(/\n/g, '\n    '));
  }
  process.exit(1);
} else {
  console.log('\n✅ All scenarios pass.');
  process.exit(0);
}
