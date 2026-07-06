/**
 * ============================================================
 * AKTUAL CODE: REMI rules + scoring + close logic
 * ============================================================
 * Di-extract VERBATIM dari truf-multiplayer-v3.html.
 * Bukan simplifikasi — ini code yang sebenarnya jalan di production.
 *
 * Tujuan: audit oleh AI lain untuk masalah scoring yang tidak terselesaikan.
 *
 * Catatan dependencies (tidak di-extract):
 *   - fb.get / fb.update / fb.ref / fb.db — Firebase RTDB wrapper
 *   - currentRoom — global room code
 *   - myUid / mySeat — global identity
 *   - MAX_PLAYERS = 4
 *   - Sound.cardReveal() / Sound.cardDrop() — SFX no-ops untuk audit
 *   - showGameToast() — UI toast no-op
 *   - remiSelectedIndices — Set<int> indeks kartu terpilih untuk lay
 *   - _remiResolveScheduled / remiResolveScheduled — host concurrency flags
 *   - serverNow() — server time ms
 *
 * Versi: 2025-06-08 (post turn-reversal-always + closeNoBonus flag)
 * ============================================================
 */

const MAX_PLAYERS = 4;
const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const MIN_RANKED_ROUNDS = 10;
const RANK_POINTS = [4, 3, 2, 1]; // 1st, 2nd, 3rd, 4th


// ======================================================================
// REMI_RANK_NUM constant
// truf-multiplayer-v3.html L9095-L9095
// ======================================================================
const REMI_RANK_NUM = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14 };

// ======================================================================
// generateCekiDeck()
// truf-multiplayer-v3.html L8969-L8982
// ======================================================================
function generateCekiDeck() {
  // Same shape as Cangkul deck: 52 + 4 jokers
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ rank: r, suit: s });
  deck.push({ rank: 'JOKER', suit: null, color: 'red' });
  deck.push({ rank: 'JOKER', suit: null, color: 'red' });
  deck.push({ rank: 'JOKER', suit: null, color: 'black' });
  deck.push({ rank: 'JOKER', suit: null, color: 'black' });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// ======================================================================
// isValidDasar(cards)
// truf-multiplayer-v3.html L9097-L9140
// ======================================================================
// Dasar: sequence ≥3 same suit, consecutive ranks within a SINGLE band.
// Bands (per user rules):
//   - Number band [2..10] — 10 and J cannot combine
//   - Face band [J..K]   — K and A cannot combine
//   - A is NOT part of any sequence (A and 2 cannot combine either)
// Special case: 4 Aces (one of each suit) is a valid dasar.
function isValidDasar(cards) {
  if (!cards || cards.length < 3) return false;
  // Special case: 4 Aces (one per suit)
  if (cards.length === 4 && cards.every(c => c && c.rank === 'A')) {
    const suits = new Set(cards.map(c => c.suit));
    if (suits.size === 4) return true;
  }
  const nonJokers = cards.filter(c => c && c.rank !== 'JOKER');
  const jokers = cards.length - nonJokers.length;
  if (nonJokers.length === 0) return false;
  // A cannot be part of a regular sequence (A is only valid as 4-aces above)
  if (nonJokers.some(c => c.rank === 'A')) return false;
  const suit = nonJokers[0].suit;
  if (!nonJokers.every(c => c.suit === suit)) return false;
  const ranks = nonJokers.map(c => REMI_RANK_NUM[c.rank]).sort((a, b) => a - b);
  for (let i = 1; i < ranks.length; i++) if (ranks[i] === ranks[i-1]) return false;
  const low = ranks[0], high = ranks[ranks.length - 1];
  const naturalSpan = high - low + 1;
  if (naturalSpan > cards.length) return false;
  // Boundary: cannot cross 10 (=10) and J (=11) ranks
  if (low <= 10 && high >= 11) return false;
  // Internal gaps must be filled by jokers
  let internalGaps = 0;
  for (let i = 1; i < ranks.length; i++) internalGaps += (ranks[i] - ranks[i-1] - 1);
  const extraJokers = jokers - internalGaps;
  if (extraJokers < 0) return false;
  // Extension limits depend on which band the sequence lives in
  let canExtendLow, canExtendHigh;
  if (high <= 10) {
    canExtendLow = low - 2;       // number band, low edge = 2
    canExtendHigh = 10 - high;    // number band, high edge = 10
  } else {
    canExtendLow = low - 11;      // face band, low edge = J=11
    canExtendHigh = 13 - high;    // face band, high edge = K=13
  }
  if (extraJokers > canExtendLow + canExtendHigh) return false;
  return true;
}

// ======================================================================
// pendingPickupCardsInHand(c, seat)
// truf-multiplayer-v3.html L9142-L9151
// ======================================================================
// Returns the cards still in this seat's hand that MUST be laid this turn
// (per rule: only the DEEPEST card from a pickup is required to be laid).
// Cards tagged with `mustLayThisTurn` need to be moved out of hand into a
// combo before the player can discard.
function pendingPickupCardsInHand(c, seat) {
  if (!c || !c.hands) return [];
  const handRaw = (c.hands[seat] != null ? c.hands[seat] : c.hands[String(seat)]) || [];
  const hand = Array.isArray(handRaw) ? handRaw : Object.values(handRaw);
  return hand.filter(card => card && card.mustLayThisTurn === true);
}

// ======================================================================
// isPureRemiCombo(co)
// truf-multiplayer-v3.html L9153-L9160
// ======================================================================
// A combo is "pure" if it contains no jokers (4-Aces dasar qualifies as pure
// since it has no jokers). Used by the joker-eligibility rule: jokers may
// only be used once a pure dasar anchors the player's combos.
function isPureRemiCombo(co) {
  if (!co) return false;
  const cards = Array.isArray(co.cards) ? co.cards : Object.values(co.cards || {});
  return cards.length > 0 && !cards.some(c => c && c.rank === 'JOKER');
}

// ======================================================================
// anyDasarLaidDown(c)
// truf-multiplayer-v3.html L9162-L9171
// ======================================================================
// Returns true if ANY dasar combo has been laid by any player on the table.
function anyDasarLaidDown(c) {
  if (!c || !c.laidDown) return false;
  for (const key of Object.keys(c.laidDown)) {
    const arr = c.laidDown[key];
    const combos = Array.isArray(arr) ? arr : Object.values(arr || {});
    if (combos.some(co => co && co.kind === 'dasar')) return true;
  }
  return false;
}

// ======================================================================
// isValidPararel(cards)
// truf-multiplayer-v3.html L9173-L9183
// ======================================================================
// Pararel: ≥3 same rank, different suits. Joker substitutes; max 4 (4 suits).
function isValidPararel(cards) {
  if (!cards || cards.length < 3 || cards.length > 4) return false;
  const nonJokers = cards.filter(c => c && c.rank !== 'JOKER');
  if (nonJokers.length === 0) return false;
  const rank = nonJokers[0].rank;
  if (!nonJokers.every(c => c.rank === rank)) return false;
  const suits = new Set(nonJokers.map(c => c.suit));
  if (suits.size !== nonJokers.length) return false; // no duplicate suits
  return true;
}

// ======================================================================
// findOneRemiCombo (bot helper, no joker)
// truf-multiplayer-v3.html L9185-L9231
// ======================================================================
// ---- Bot combo-finding helpers ----
// Find ONE valid combo in `hand` (no jokers — bots save them).
// Returns { kind, cards } or null. Prefers pararel (lower card count) first.
function findOneRemiCombo(hand) {
  // Try pararel (same rank)
  const byRank = {};
  for (const c of hand) {
    if (c.rank === 'JOKER') continue;
    (byRank[c.rank] = byRank[c.rank] || []).push(c);
  }
  for (const rank of Object.keys(byRank)) {
    if (byRank[rank].length >= 3) {
      const cards = byRank[rank].slice(0, 4);
      if (isValidPararel(cards)) return { kind: 'pararel', cards };
    }
  }
  // Try dasar (same suit consecutive ranks within a single band)
  const bySuit = { S: [], H: [], D: [], C: [] };
  for (const c of hand) if (c.rank !== 'JOKER' && c.rank !== 'A' && bySuit[c.suit]) bySuit[c.suit].push(c);
  for (const suit of ['S','H','D','C']) {
    const sorted = bySuit[suit].slice().sort((a, b) => REMI_RANK_NUM[a.rank] - REMI_RANK_NUM[b.rank]);
    for (let i = 0; i < sorted.length; i++) {
      const run = [sorted[i]];
      for (let j = i + 1; j < sorted.length; j++) {
        const lastV = REMI_RANK_NUM[run[run.length - 1].rank];
        const nextV = REMI_RANK_NUM[sorted[j].rank];
        if (nextV === lastV + 1) {
          // Reject crossing 10→J boundary
          if (lastV === 10 && nextV === 11) break;
          run.push(sorted[j]);
        }
        else if (nextV === lastV) continue;
        else break;
      }
      if (run.length >= 3 && isValidDasar(run)) {
        return { kind: 'dasar', cards: run };
      }
    }
  }
  // 4-Aces dasar
  const aces = hand.filter(c => c.rank === 'A');
  if (aces.length === 4) {
    const suits = new Set(aces.map(c => c.suit));
    if (suits.size === 4) return { kind: 'dasar', cards: aces };
  }
  return null;
}

// ======================================================================
// findAllRemiCombos
// truf-multiplayer-v3.html L9233-L9244
// ======================================================================
function findAllRemiCombos(hand) {
  const combos = [];
  let remaining = hand.slice();
  while (true) {
    const combo = findOneRemiCombo(remaining);
    if (!combo) break;
    combos.push(combo);
    const usedSet = new Set(combo.cards);
    remaining = remaining.filter(c => !usedSet.has(c));
  }
  return { combos, remaining };
}

// ======================================================================
// findOneDasarInHand
// truf-multiplayer-v3.html L9247-L9273
// ======================================================================
function findOneDasarInHand(hand) {
  const bySuit = { S: [], H: [], D: [], C: [] };
  for (const c of hand) if (c.rank !== 'JOKER' && c.rank !== 'A' && bySuit[c.suit]) bySuit[c.suit].push(c);
  for (const suit of ['S','H','D','C']) {
    const sorted = bySuit[suit].slice().sort((a, b) => REMI_RANK_NUM[a.rank] - REMI_RANK_NUM[b.rank]);
    for (let i = 0; i < sorted.length; i++) {
      const run = [sorted[i]];
      for (let j = i + 1; j < sorted.length; j++) {
        const lastV = REMI_RANK_NUM[run[run.length - 1].rank];
        const nextV = REMI_RANK_NUM[sorted[j].rank];
        if (nextV === lastV + 1) {
          // Reject crossing 10→J boundary
          if (lastV === 10 && nextV === 11) break;
          run.push(sorted[j]);
        } else if (nextV > lastV + 1) break;
      }
      if (run.length >= 3 && isValidDasar(run)) return { kind: 'dasar', cards: run };
    }
  }
  // Also check 4-Aces dasar (special)
  const aces = hand.filter(c => c.rank === 'A');
  if (aces.length === 4) {
    const suits = new Set(aces.map(c => c.suit));
    if (suits.size === 4) return { kind: 'dasar', cards: aces };
  }
  return null;
}

// ======================================================================
// findOnePararelInHand
// truf-multiplayer-v3.html L9274-L9287
// ======================================================================
function findOnePararelInHand(hand) {
  const byRank = {};
  for (const c of hand) {
    if (c.rank === 'JOKER') continue;
    (byRank[c.rank] = byRank[c.rank] || []).push(c);
  }
  for (const rank of Object.keys(byRank)) {
    if (byRank[rank].length >= 3) {
      const cards = byRank[rank].slice(0, 4);
      if (isValidPararel(cards)) return { kind: 'pararel', cards };
    }
  }
  return null;
}

// ======================================================================
// findAllDasarsInHand
// truf-multiplayer-v3.html L9288-L9298
// ======================================================================
function findAllDasarsInHand(hand) {
  const combos = []; let remaining = hand.slice();
  while (true) {
    const c = findOneDasarInHand(remaining);
    if (!c) break;
    combos.push(c);
    const used = new Set(c.cards);
    remaining = remaining.filter(x => !used.has(x));
  }
  return { combos, remaining };
}

// ======================================================================
// findAllPararelsInHand
// truf-multiplayer-v3.html L9299-L9309
// ======================================================================
function findAllPararelsInHand(hand) {
  const combos = []; let remaining = hand.slice();
  while (true) {
    const c = findOnePararelInHand(remaining);
    if (!c) break;
    combos.push(c);
    const used = new Set(c.cards);
    remaining = remaining.filter(x => !used.has(x));
  }
  return { combos, remaining };
}

// ======================================================================
// findOneRemiComboJokerAware (used for end-of-round scoring)
// truf-multiplayer-v3.html L9311-L9369
// ======================================================================
// JOKER-AWARE combo finding (used for end-of-round scoring so that combos
// completed by a joker — e.g. Q♥ + K♥ + Joker = J♥-Q♥-K♥ dasar — count as
// "jadi"). Finds ONE combo: pure dasar → pure pararel → joker-completed dasar
// → joker-completed pararel. Joker-completed combos require ≥2 real
// (non-joker) cards so a single card can't be "made jadi" by jokers alone.
function findOneRemiComboJokerAware(pool, allowPararel, allowJoker) {
  const nonJokers = pool.filter(c => c && c.rank !== 'JOKER');
  const jokers = pool.filter(c => c && c.rank === 'JOKER');
  // 1) pure dasar
  const pd = findOneDasarInHand(nonJokers);
  if (pd) return pd;
  // 2) pure pararel
  if (allowPararel) {
    const pp = findOnePararelInHand(nonJokers);
    if (pp) return pp;
  }
  if (!allowJoker || jokers.length === 0) return null;
  // 3) joker-completed dasar — same suit, exclude A, ≥2 real cards, jokers
  //    fill internal gaps and/or extend within a single band. Windows of
  //    length 3-4 (keep combos compact for stable scoring).
  for (const suit of ['S', 'H', 'C', 'D']) {
    const byRankNum = new Map();
    for (const c of nonJokers) {
      if (c.suit === suit && c.rank !== 'A') byRankNum.set(REMI_RANK_NUM[c.rank], c);
    }
    if (byRankNum.size < 2) continue;
    for (const [bandLow, bandHigh] of [[2, 10], [11, 13]]) {
      for (let lo = bandLow; lo <= bandHigh; lo++) {
        for (let hi = lo + 2; hi <= bandHigh; hi++) {
          const span = hi - lo + 1;
          if (span > 4) break;
          const present = [];
          let missing = 0;
          for (let r = lo; r <= hi; r++) {
            if (byRankNum.has(r)) present.push(byRankNum.get(r));
            else missing++;
          }
          if (present.length < 2) continue;
          if (missing < 1 || missing > jokers.length) continue;
          const cards = present.concat(jokers.slice(0, missing));
          if (isValidDasar(cards)) return { kind: 'dasar', cards };
        }
      }
    }
  }
  // 4) joker-completed pararel — exactly 2 distinct-suit same-rank + 1 joker
  if (allowPararel) {
    const byRank = {};
    for (const c of nonJokers) (byRank[c.rank] = byRank[c.rank] || []).push(c);
    for (const rank of Object.keys(byRank)) {
      const seen = new Set(); const distinct = [];
      for (const c of byRank[rank]) { if (!seen.has(c.suit)) { seen.add(c.suit); distinct.push(c); } }
      if (distinct.length !== 2) continue; // 3+ would be a pure pararel (step 2)
      const cards = distinct.concat(jokers.slice(0, 1));
      if (isValidPararel(cards)) return { kind: 'pararel', cards };
    }
  }
  return null;
}

// ======================================================================
// enumerateOneJokerCandidates
// truf-multiplayer-v3.html L9370-L9420
// ======================================================================
// Enumerate every combo that a SINGLE joker could complete from the given
// non-joker cards. Each candidate = { kind, real:[cards], value } where value
// is the full combo value INCLUDING the joker's substituted rank. Used for
// value-maximising joker allocation.
function enumerateOneJokerCandidates(nonJokers, allowPararel) {
  const cands = [];
  // ---- PARAREL: 2+ distinct-suit same-rank cards + 1 joker (joker = rank)
  if (allowPararel) {
    const byRank = {};
    for (const c of nonJokers) (byRank[c.rank] = byRank[c.rank] || []).push(c);
    for (const rank of Object.keys(byRank)) {
      const seen = new Set(); const distinct = [];
      for (const c of byRank[rank]) { if (!seen.has(c.suit)) { seen.add(c.suit); distinct.push(c); } }
      // 2 distinct + joker = 3-card pararel (3 distinct is already pure)
      if (distinct.length >= 2 && distinct.length <= 3) {
        const real = distinct.slice(0, 3);
        const value = real.reduce((s, c) => s + remiCardValue(c), 0) + remiRankValue(rank);
        cands.push({ kind: 'pararel', real, value });
      }
    }
  }
  // ---- DASAR: same suit, real cards within a 3-4 window with exactly 1 gap
  for (const suit of ['S', 'H', 'C', 'D']) {
    const byRankNum = new Map();
    for (const c of nonJokers) {
      if (c.suit === suit && c.rank !== 'A') byRankNum.set(REMI_RANK_NUM[c.rank], c);
    }
    if (byRankNum.size < 2) continue;
    for (const [bandLow, bandHigh] of [[2, 10], [11, 13]]) {
      for (let lo = bandLow; lo <= bandHigh; lo++) {
        for (let hi = lo + 2; hi <= bandHigh; hi++) {
          const span = hi - lo + 1;
          if (span > 4) break;
          const real = [];
          let missing = 0, jokerRank = null;
          for (let r = lo; r <= hi; r++) {
            if (byRankNum.has(r)) real.push(byRankNum.get(r));
            else { missing++; jokerRank = r; }
          }
          if (missing !== 1) continue;       // exactly 1 joker per combo
          if (real.length < 2) continue;     // ≥2 real cards
          const cards = real.concat([{ rank: 'JOKER' }]);
          if (!isValidDasar(cards)) continue;
          const value = real.reduce((s, c) => s + remiCardValue(c), 0) + remiRankValue(jokerRank);
          cands.push({ kind: 'dasar', real, value });
        }
      }
    }
  }
  return cands;
}

// ======================================================================
// findAllJokerAwareCombos (THE scoring detector)
// truf-multiplayer-v3.html L9422-L9454
// ======================================================================
function findAllJokerAwareCombos(hand, allowPararel, allowJoker) {
  const combos = []; let remaining = hand.slice();
  // 1) Take all PURE combos first (no joker needed) — pure dasars, then
  //    pure pararels. These are free value and don't consume jokers.
  while (true) {
    const nonJokers = remaining.filter(c => c && c.rank !== 'JOKER');
    const pd = findOneDasarInHand(nonJokers);
    const combo = pd || (allowPararel ? findOnePararelInHand(nonJokers) : null);
    if (!combo) break;
    combos.push(combo);
    const used = new Set(combo.cards);
    remaining = remaining.filter(x => !used.has(x));
  }
  // 2) Allocate jokers to the HIGHEST-VALUE completions. Each joker goes to a
  //    distinct combo (no 2 jokers in one combo); cards aren't reused.
  if (allowJoker) {
    let jokers = remaining.filter(c => c && c.rank === 'JOKER');
    let nonJokers = remaining.filter(c => c && c.rank !== 'JOKER');
    while (jokers.length > 0) {
      const cands = enumerateOneJokerCandidates(nonJokers, allowPararel);
      if (cands.length === 0) break;
      // Pick the candidate with the highest total value.
      cands.sort((a, b) => b.value - a.value);
      const best = cands[0];
      const joker = jokers.shift();
      combos.push({ kind: best.kind, cards: best.real.concat([joker]) });
      const usedReal = new Set(best.real);
      nonJokers = nonJokers.filter(c => !usedReal.has(c));
    }
    remaining = nonJokers.concat(jokers); // leftover real cards + unused jokers
  }
  return { combos, remaining };
}

// ======================================================================
// handleRemiLayDown — turunkan combo
// truf-multiplayer-v3.html L10249-L10330
// ======================================================================
async function handleRemiLayDown(room, kind) {
  if (!currentRoom || mySeat == null) return;
  try {
    const snap = await fb.get(fb.ref(fb.db, 'rooms/' + currentRoom));
    if (!snap.exists()) return;
    const r2 = snap.val();
    const c2 = r2.remi || {};
    if (c2.currentPlayer !== mySeat) return;
    const handRaw = (c2.hands && (c2.hands[mySeat] || c2.hands[String(mySeat)])) || [];
    const hand2 = Array.isArray(handRaw) ? handRaw : Object.values(handRaw);
    // Resolve selected indices against current hand
    const selectedIdxs = Array.from(remiSelectedIndices).sort((a, b) => a - b);
    const selectedCards = selectedIdxs.map(i => hand2[i]).filter(Boolean);
    if (selectedCards.length !== selectedIdxs.length) return;
    if (kind === 'dasar' && !isValidDasar(selectedCards)) return;
    if (kind === 'pararel' && !isValidPararel(selectedCards)) return;
    const laidRaw = c2.laidDown || {};
    const myLaidRaw = (laidRaw[mySeat] != null ? laidRaw[mySeat] : laidRaw[String(mySeat)]) || [];
    const myLaid = Array.isArray(myLaidRaw) ? myLaidRaw.slice() : Object.values(myLaidRaw);
    // Enforce: pararel only allowed when THIS player has already laid a dasar
    if (kind === 'pararel' && !myLaid.some(c => c && c.kind === 'dasar')) return;
    // Enforce: joker can only be used when a PURE dasar (no joker) has been
    // laid by THIS player. A pure dasar is the "anchor" — once you have one
    // on the table, jokers may substitute any card in subsequent combos.
    const jokerCount = selectedCards.filter(c => c && c.rank === 'JOKER').length;
    if (jokerCount > 0 && !myLaid.some(co => co && co.kind === 'dasar' && isPureRemiCombo(co))) {
      console.warn('[remi] joker rejected — pure dasar must be laid first');
      return;
    }
    // Rule: at most ONE joker per combo (no 2 jokers in the same combo).
    if (jokerCount > 1) {
      console.warn('[remi] lay rejected — max 1 joker per combo');
      try { showGameToast('Maksimal 1 joker dalam satu combo', 'warn'); } catch (e) {}
      return;
    }
    // Rule: the DEEPEST card from discard pickup (mustLayThisTurn) requires
    // ≥2 of the player's own hand cards in the same combo. Other picked cards
    // (shallower) have no such restriction.
    const hasDeepest = selectedCards.some(c => c && c.mustLayThisTurn);
    if (hasDeepest) {
      const ownCount = selectedCards.filter(c => c && !c.justPicked).length;
      if (ownCount < 2) {
        console.warn('[remi] lay rejected — deepest card combo needs ≥2 own hand cards');
        try { showGameToast('Combo dari kartu terdalam wajib menyertakan min. 2 kartu tangan Anda', 'warn'); } catch (e) {}
        return;
      }
    }
    const newHand = hand2.filter((_, i) => !remiSelectedIndices.has(i));
    // Rule: you can never lay down ALL your cards. After laying, ≥1 card must
    // remain to discard. Reaching 0 cards is only allowed by closing (lay a
    // combo leaving ≥1, then discard that last card).
    if (newHand.length === 0) {
      console.warn('[remi] lay rejected — would leave 0 cards (must keep ≥1 to discard)');
      try { showGameToast('Tidak bisa menurunkan semua kartu: sisakan min. 1 untuk dibuang', 'warn'); } catch (e) {}
      return;
    }
    myLaid.push({ kind, cards: selectedCards, atTurn: Date.now() });
    const updates = {};
    updates[`remi/hands/${mySeat}`] = newHand;
    updates[`remi/laidDown/${mySeat}`] = myLaid;
    Sound.cardReveal();
    remiSelectedIndices.clear();
    await fb.update(fb.ref(fb.db, 'rooms/' + currentRoom), updates);
    // After laying, check if the player is now stuck (e.g., only jokers left
    // while deck is not empty — can't discard anything).
    try {
      const snap2 = await fb.get(fb.ref(fb.db, 'rooms/' + currentRoom));
      if (snap2.exists()) {
        const r3 = snap2.val();
        checkAndResolveStuck(r3.remi || {}, mySeat, r3);
      }
    } catch (e2) { console.error('stuck check after lay failed', e2); }
  } catch (e) { console.error('remi lay down failed', e); }
}

// ============================================================
// REMI handlers — draw deck, draw discard, discard
// ============================================================
let _remiDrawInFlight = false;
// Rank-4 player "shuffles" the deck: each deck click counts toward the 20
// required clicks before the round begins. Pure ceremony (deck is already
// dealt) — replaces the real-life shuffle penalty for the last-place player.

// ======================================================================
// handleRemiDrawDeck — ambil cabutan
// truf-multiplayer-v3.html L10372-L10422
// ======================================================================
async function handleRemiDrawDeck(room) {
  if (!currentRoom || mySeat == null) return;
  // Re-entrancy guard: ignore double-clicks while a draw is processing.
  if (_remiDrawInFlight) { console.warn('[remi] draw already in flight'); return; }
  _remiDrawInFlight = true;
  try {
    // Use a timeout-protected get so a suspended socket can't permanently
    // dead-lock the click — falls back to the listener's freshest room.
    const snap = await fbGetRoomWithTimeout(room);
    if (!snap.exists) return;
    const r2 = snap.val;
    const c2 = r2.remi || {};
    if (c2.currentPlayer !== mySeat) { console.warn('[remi] draw: not my turn', c2.currentPlayer, mySeat); return; }
    if (c2.turnPhase !== 'draw') { console.warn('[remi] draw: wrong phase', c2.turnPhase); return; }
    const deckRaw = c2.deck || [];
    const deck = Array.isArray(deckRaw) ? deckRaw.slice() : Object.values(deckRaw);
    if (deck.length === 0) return;
    const handRaw = (c2.hands && (c2.hands[mySeat] || c2.hands[String(mySeat)])) || [];
    const newHand = (Array.isArray(handRaw) ? handRaw.slice() : Object.values(handRaw));
    const drawn = deck.shift();
    newHand.push(drawn);
    newHand.sort(sortCangkulCardCompare);
    const updates = {};
    updates[`remi/deck`] = deck;
    updates[`remi/hands/${mySeat}`] = newHand;
    updates[`remi/turnPhase`] = 'discard';
    updates[`remi/lastDrawnBy`] = mySeat;
    updates[`remi/lastDrawnCard`] = drawn;
    updates[`remi/lastDrawnFrom`] = 'deck';
    updates[`remi/lastPickupContributors`] = []; // deck draw → no contributors
    updates[`remi/lastDrawnAt`] = fb.serverTimestamp();
    _remiGlowTurn = -1; // allow animation to play for new draw
    remiSelectedIndices.clear();
    Sound.cardReveal();
    await fb.update(fb.ref(fb.db, 'rooms/' + currentRoom), updates);
    // After drawing, check if this player is now stuck (can't discard anything).
    // Re-read fresh state since we just wrote.
    try {
      const snap2 = await fb.get(fb.ref(fb.db, 'rooms/' + currentRoom));
      if (snap2.exists()) {
        const r3 = snap2.val();
        checkAndResolveStuck(r3.remi || {}, mySeat, r3);
      }
    } catch (e2) { console.error('stuck check failed', e2); }
  } catch (e) { console.error('remi draw deck failed', e); }
  finally { _remiDrawInFlight = false; }
}

// Detect if the current player is STUCK — they cannot discard ANY card
// (all cards are Joker/Ace that are blocked by the rules) AND they cannot
// lay any combo to free a discardable card. If stuck, the round ends with

// ======================================================================
// checkAndResolveStuck — stuck detection
// truf-multiplayer-v3.html L10424-L10560
// ======================================================================
function checkAndResolveStuck(c2, seat, room) {
  if (!room || room.host !== myUid) return; // only host resolves
  if (c2.turnPhase !== 'discard') return;
  if (c2.currentPlayer !== seat) return;
  const handRaw = (c2.hands && (c2.hands[seat] || c2.hands[String(seat)])) || [];
  const hand = Array.isArray(handRaw) ? handRaw : Object.values(handRaw);
  if (hand.length === 0) return;

  const deckRaw = c2.deck || [];
  const deckEmpty = (Array.isArray(deckRaw) ? deckRaw : Object.values(deckRaw)).length === 0;
  const myLaidRaw = (c2.laidDown && (c2.laidDown[seat] || c2.laidDown[String(seat)])) || [];
  const myLaidArr = Array.isArray(myLaidRaw) ? myLaidRaw : Object.values(myLaidRaw);
  const ownDasar = myLaidArr.some(co => co && co.kind === 'dasar');
  const isClosing = hand.length === 1;

  // Check if there's at least one legal card to discard.
  const hasLegalDiscard = hand.some(card => {
    if (card.rank === 'JOKER') return deckEmpty || isClosing;
    if (card.rank === 'A') return ownDasar;
    return true; // normal cards are always discardable
  });

  if (hasLegalDiscard) return; // not stuck

  // Check if player can lay a combo to change the situation (e.g., lay a dasar
  // to unlock Ace, or lay cards to reduce hand to 1 for closing).
  // Quick check: can any pure dasar/pararel be formed from the hand?
  const nonJokers = hand.filter(c => c && c.rank !== 'JOKER');
  const pureDasar = findOneDasarInHand(nonJokers);
  const purePararel = findOnePararelInHand(nonJokers);
  if (pureDasar || (purePararel && ownDasar)) {
    // Could lay a combo → might unlock Ace or reduce hand to 1 → not stuck yet.
    // (The UI will guide the player to lay first.)
    return;
  }

  // STUCK! Resolve the round — this player gets minus for cards in hand,
  // but KEEPS the laidDown bonus (already on the table). Everyone else gets 0.
  console.warn('[remi] player at seat', seat, 'is STUCK — cannot discard anything, auto-resolving');
  const players = Object.values(room.players || {}).sort((a, b) => a.seat - b.seat);
  const stuckPlayer = players.find(p => p.seat === seat);
  const stuckName = stuckPlayer ? stuckPlayer.nickname : 'Pemain';

  // Penalty = sum of all card values still in hand (negative).
  let penalty = 0;
  for (const card of hand) penalty += remiCardValue(card);

  const prevTotals = room.totals || {};
  const newTotals = {};
  const handJadi = {};
  const handTidakJadi = {};
  const laidBonus = {};
  const helperDelta = {};
  for (const p of players) {
    const cur = (prevTotals[p.seat] != null ? prevTotals[p.seat] : (prevTotals[String(p.seat)] || 0));
    if (p.seat === seat) {
      handJadi[p.seat] = 0;
      handTidakJadi[p.seat] = -penalty;
      laidBonus[p.seat] = 0;
      helperDelta[p.seat] = 0;
      newTotals[p.seat] = cur - penalty;
    } else {
      handJadi[p.seat] = 0;
      handTidakJadi[p.seat] = 0;
      laidBonus[p.seat] = 0;
      helperDelta[p.seat] = 0;
      newTotals[p.seat] = cur;
    }
  }

  const updates = {};
  updates[`phase`] = 'remi_end';
  updates[`remi/handPenalty`] = {};
  updates[`remi/handJadi`] = handJadi;
  updates[`remi/handTidakJadi`] = handTidakJadi;
  updates[`remi/laidBonus`] = laidBonus;
  updates[`remi/helperDelta`] = helperDelta;
  updates[`remi/closingExtra`] = null;
  updates[`remi/closedBy`] = null;
  updates[`remi/endReason`] = 'stuck';
  updates[`remi/stuckSeat`] = seat;
  updates[`remi/stuckName`] = stuckName;
  updates[`totals`] = newTotals;
  // Check match-over conditions (same as normal resolve).
  const thisRoundNum = c2.roundNumber || 1;
  let capSeat2 = null, capType2 = null;
  for (const p of players) {
    const t = newTotals[p.seat] || 0;
    if (t >= 1000) { capSeat2 = p.seat; capType2 = 'high'; break; }
  }
  if (capSeat2 == null) {
    for (const p of players) {
      const t = newTotals[p.seat] || 0;
      if (t <= -1000) { capSeat2 = p.seat; capType2 = 'low'; break; }
    }
  }
  const matchOver2 = (capSeat2 != null) || thisRoundNum >= 20;
  updates[`remi/matchOver`] = matchOver2;
  updates[`remi/matchOverReason`] = matchOver2 ? ((capSeat2 != null) ? 'points' : 'rounds') : null;
  if (capSeat2 != null) {
    const cp2 = players.find(p => p.seat === capSeat2);
    updates[`remi/matchOverCapType`] = capType2;
    updates[`remi/matchOverCapName`] = cp2 ? cp2.nickname : null;
  }
  fb.update(fb.ref(fb.db, 'rooms/' + currentRoom), updates)
    .catch(e => console.error('[remi] stuck resolve failed', e));
}

// Try to build a combo containing `deepCard` by substituting jokers from
// `hypothetical` into the missing slots. Used when the player has a pure
// dasar already laid (= joker eligibility unlocked).
//
// Covers BOTH combos containing the deepCard:
//   - Pararel: same-rank distinct-suit cards + jokers (3-4 cards total)
//   - Dasar:   same-suit consecutive ranks, jokers fill gaps (≥3 cards)
//
// Returns true if any such valid combo has ≥ minHandInCombo hand cards
// (i.e. cards not in pickedSet) INCLUDING at least one NON-JOKER hand card.
// The non-joker requirement blocks degenerate pickups where the deepest card
// is "completed" using only jokers (e.g. picking K♠ with K♠+joker+joker when
// the player has no supporting spade/K) — that was the reported false
// positive where K♠ could be taken but never sensibly laid.
function tryJokerSubstitutedCombo(deepCard, hypothetical, pickedSet, minHandInCombo) {
  if (deepCard.rank === 'JOKER') return false;
  const jokers = hypothetical.filter(c => c && c.rank === 'JOKER');
  if (jokers.length === 0) return false;
  // Validate a candidate combo: enough hand cards, ≥1 non-joker among them,
  // AND it must leave ≥1 card over for the discard (can't empty the hand by
  // laying — reaching 0 cards is only allowed by closing via a discard).
  const handContribOk = (cards) => {
    if (cards.length >= hypothetical.length) return false; // would leave 0 to discard
    const handCards = cards.filter(c => !pickedSet.has(c));
    if (handCards.length < minHandInCombo) return false;
    return handCards.some(c => c.rank !== 'JOKER');
  };

  // ----- PARAREL — same rank as deepCard, distinct suits + jokers

// ======================================================================
// handleRemiDrawDiscard / handleRemiPickupDiscard
// truf-multiplayer-v3.html L10735-L10828
// ======================================================================
async function handleRemiDrawDiscard(room) {
  return handleRemiPickupDiscard(room, 1);
}
// Multi-depth pickup: take last N discards (most recent N cards). All cards
// above the chosen depth must be taken too (per rule 4). The DEEPEST card
// must be able to immediately form a combo (server-side validated).
async function handleRemiPickupDiscard(room, depth) {
  if (!currentRoom || mySeat == null) return;
  if (_remiDrawInFlight) { console.warn('[remi] pickup already in flight'); return; }
  _remiDrawInFlight = true;
  const N = Math.max(1, Math.min(4, depth || 1));
  try {
    const snap = await fbGetRoomWithTimeout(room);
    if (!snap.exists) return;
    const r2 = snap.val;
    const c2 = r2.remi || {};
    if (c2.currentPlayer !== mySeat) return;
    if (c2.turnPhase !== 'draw') return;
    // Rule: once the deck is exhausted the round ends right after the final
    // discard — no further pickups are allowed (prevents sneaking a pickup
    // during the 1s round-resolve window).
    const deckRawP = c2.deck || [];
    const deckLenP = (Array.isArray(deckRawP) ? deckRawP : Object.values(deckRawP)).length;
    if (deckLenP === 0) { console.warn('[remi] pickup blocked — deck empty, round ending'); return; }
    const discardRaw = c2.discard || [];
    const discard = Array.isArray(discardRaw) ? discardRaw.slice() : Object.values(discardRaw);
    if (discard.length === 0) return;
    const handRaw = (c2.hands && (c2.hands[mySeat] || c2.hands[String(mySeat)])) || [];
    const newHand = (Array.isArray(handRaw) ? handRaw.slice() : Object.values(handRaw));
    const take = Math.min(N, discard.length);

    // Server-side validation: ensure deepest card can form combo with ≥2 hand cards
    const peeked = discard.slice(-take); // [bottom-of-take, ..., top]
    const deepestEntry = peeked[0];
    const deepestCard = (deepestEntry && deepestEntry.card) ? deepestEntry.card : deepestEntry;
    const otherTaken = peeked.slice(1).map(e => (e && e.card) ? e.card : e).filter(Boolean);
    if (deepestCard && !canDeepestFormCombo(deepestCard, newHand, otherTaken, { remi: c2 })) {
      console.warn('[remi] pickup rejected: deepest card cannot form combo or hand contribution < 2');
      return;
    }

    const taken = [];
    for (let i = 0; i < take; i++) {
      const entry = discard.pop();
      const card = (entry && entry.card) ? entry.card : entry;
      const tagged = (entry && entry.by != null)
        ? { ...card, fromDiscardBy: entry.by }
        : { ...card };
      // Only the DEEPEST card (last popped = i === take - 1) MUST be laid down.
      // Shallower cards may stay in hand as the player wishes.
      if (i === take - 1) tagged.mustLayThisTurn = true;
      // Tag every card picked THIS turn so the player can undo the whole
      // pickup if they realise the deepest card can't actually be laid.
      // `justPickedSeq` preserves pop order (0 = top) for exact restore.
      tagged.justPicked = true;
      tagged.justPickedSeq = i;
      taken.push(tagged);
      newHand.push(tagged);
    }
    newHand.sort(sortCangkulCardCompare);
    const updates = {};
    updates[`remi/discard`] = discard;
    updates[`remi/hands/${mySeat}`] = newHand;
    updates[`remi/turnPhase`] = 'discard';
    updates[`remi/lastDrawnBy`] = mySeat;
    updates[`remi/lastDrawnCard`] = taken[taken.length - 1]; // animate the deepest
    updates[`remi/lastDrawnFrom`] = 'discard';
    updates[`remi/lastDrawnAt`] = fb.serverTimestamp();
    // Track which seats' cards were picked up THIS turn (for closing punishment).
    // Only cards picked in the SAME turn as the close count as contributors.
    const pickupContribs = [...new Set(
      taken.map(t => t.fromDiscardBy).filter(s => s != null && s !== mySeat)
    )];
    updates[`remi/lastPickupContributors`] = pickupContribs;
    _remiGlowTurn = -1; // allow animation to play for new draw
    remiSelectedIndices.clear();
    Sound.cardReveal();
    await fb.update(fb.ref(fb.db, 'rooms/' + currentRoom), updates);
    // After pickup, check if this player is now stuck (can't discard anything).
    try {
      const snap2 = await fb.get(fb.ref(fb.db, 'rooms/' + currentRoom));
      if (snap2.exists()) {
        const r3 = snap2.val();
        checkAndResolveStuck(r3.remi || {}, mySeat, r3);
      }
    } catch (e2) { console.error('stuck check failed', e2); }
  } catch (e) { console.error('remi pickup discard failed', e); }
  finally { _remiDrawInFlight = false; }
}

// Undo the current turn's discard-pile pickup: return every card picked this
// turn back onto the discard pile (original order), remove them from hand,
// and revert to the 'draw' phase so the player can choose differently. This
// guarantees the game can never hard-lock if the deepest picked card turns

// ======================================================================
// handleRemiUndoPickup
// truf-multiplayer-v3.html L10830-L10871
// ======================================================================
async function handleRemiUndoPickup(room) {
  if (!currentRoom || mySeat == null) return;
  if (_remiDrawInFlight) return;
  _remiDrawInFlight = true;
  try {
    const snap = await fbGetRoomWithTimeout(room);
    if (!snap.exists) return;
    const r2 = snap.val;
    const c2 = r2.remi || {};
    if (c2.currentPlayer !== mySeat) return;
    if (c2.turnPhase !== 'discard') return;
    const handRaw = (c2.hands && (c2.hands[mySeat] || c2.hands[String(mySeat)])) || [];
    const hand = Array.isArray(handRaw) ? handRaw.slice() : Object.values(handRaw);
    const picked = hand.filter(card => card && card.justPicked === true);
    if (picked.length === 0) { console.warn('[remi] undo: nothing picked this turn'); return; }
    // Cards that stay in hand (not picked this turn)
    const keep = hand.filter(card => !(card && card.justPicked === true));
    // Restore discard order: highest justPickedSeq (deepest, popped last) goes
    // back first; seq 0 (top) goes back last → original bottom→top order.
    picked.sort((a, b) => (b.justPickedSeq || 0) - (a.justPickedSeq || 0));
    const discardRaw = c2.discard || [];
    const discard = Array.isArray(discardRaw) ? discardRaw.slice() : Object.values(discardRaw);
    for (const card of picked) {
      const by = (card.fromDiscardBy != null) ? card.fromDiscardBy : null;
      const clean = { ...card };
      delete clean.justPicked; delete clean.justPickedSeq;
      delete clean.mustLayThisTurn; delete clean.fromDiscardBy;
      discard.push(by != null ? { card: clean, by } : { card: clean });
    }
    const updates = {};
    updates[`remi/hands/${mySeat}`] = keep;
    updates[`remi/discard`] = discard;
    updates[`remi/turnPhase`] = 'draw';
    updates[`remi/lastDrawnBy`] = null;
    updates[`remi/lastDrawnCard`] = null;
    updates[`remi/lastDrawnFrom`] = null;
    remiSelectedIndices.clear();
    Sound.cardDrop();
    await fb.update(fb.ref(fb.db, 'rooms/' + currentRoom), updates);
  } catch (e) { console.error('remi undo pickup failed', e); }
  finally { _remiDrawInFlight = false; }
}

// ======================================================================
// handleRemiDiscard — buang kartu (close detection)
// truf-multiplayer-v3.html L10873-L10974
// ======================================================================
async function handleRemiDiscard(room, idx, card) {
  console.log('[remi] discard attempt', { idx, card, mySeat });
  if (!currentRoom || mySeat == null) { console.warn('[remi] no room or seat'); return; }
  try {
    const snap = await fb.get(fb.ref(fb.db, 'rooms/' + currentRoom));
    if (!snap.exists()) { console.warn('[remi] room not exists'); return; }
    const r2 = snap.val();
    const c2 = r2.remi || {};
    if (c2.currentPlayer !== mySeat) { console.warn('[remi] not my turn, cp=', c2.currentPlayer); return; }
    if (c2.turnPhase !== 'discard') { console.warn('[remi] not discard phase, phase=', c2.turnPhase); return; }
    const handRaw = (c2.hands && (c2.hands[mySeat] || c2.hands[String(mySeat)])) || [];
    const hand = Array.isArray(handRaw) ? handRaw : Object.values(handRaw);
    const deckRawForRule = c2.deck || [];
    const deckLenForRule = (Array.isArray(deckRawForRule) ? deckRawForRule : Object.values(deckRawForRule)).length;
    // Rule enforcement: A and Joker may not be discarded before THIS player
    // has laid their own dasar — EXCEPT in "pemain terakhir" (last-player)
    // edge cases where the player has no other meaningful option:
    //   a) this discard would CLOSE the round (hand=1, going to 0), or
    //   b) the deck is EMPTY (no more draws possible → forced final cycle).
    // Without this exception a player stuck with only a joker/A and no
    // dasar laid would be unable to discard anything, deadlocking the round.
    // Closing no longer requires declaring CEKI — discarding your last card
    // always closes. (CEKI is now purely cosmetic.)
    const isClosingMove = (hand.length === 1);
    // JOKER may be discarded when:
    //   (a) the deck is empty (the last deck-drawer's final discard), OR
    //   (b) it is the CLOSING card (last card) — joker can close flexibly.
    if (card.rank === 'JOKER') {
      if (deckLenForRule !== 0 && !isClosingMove) {
        console.warn('[remi] Joker blocked — only allowed when deck empty OR as the closing card');
        try { showGameToast('Joker hanya boleh dibuang saat cangkulan habis, atau sebagai kartu penutup', 'warn'); } catch (e) {}
        return;
      }
    } else if (card.rank === 'A') {
      // Ace: ONLY discardable when this player has laid their own dasar.
      // No exceptions — unlike joker, ace has no deck-empty or closing bypass.
      const myLaidNow = (c2.laidDown && (c2.laidDown[mySeat] || c2.laidDown[String(mySeat)])) || [];
      const myLaidArrNow = Array.isArray(myLaidNow) ? myLaidNow : Object.values(myLaidNow);
      const ownDasarNow = myLaidArrNow.some(co => co && co.kind === 'dasar');
      if (!ownDasarNow) {
        console.warn('[remi] A blocked, no own dasar');
        try { showGameToast('As hanya boleh dibuang jika sudah turunkan dasar sendiri', 'warn'); } catch (e) {}
        return;
      }
    }
    // Rule enforcement: cards picked up from discard MUST be laid as combo
    // before discard is allowed (rule clarification)
    const pending = pendingPickupCardsInHand(c2, mySeat);
    if (pending.length > 0) { console.warn('[remi] pending pickup cards must be laid first', pending); return; }
    // (CEKI is no longer required to close — discarding your last card closes
    // the round directly.)
    const realIdx = hand.findIndex(x =>
      x.rank === card.rank && x.suit === card.suit &&
      (card.rank !== 'JOKER' || x.color === card.color));
    if (realIdx < 0) return;
    const newHand = hand.slice(); newHand.splice(realIdx, 1);
    // Turn is ending — strip the per-turn pickup tags from cards that stay in
    // hand so they can't be "undone" on a later turn (the undo window is only
    // the turn you picked them in).
    for (const hc of newHand) {
      if (hc && hc.justPicked) { delete hc.justPicked; delete hc.justPickedSeq; }
    }
    const discardRaw = c2.discard || [];
    const discard = (Array.isArray(discardRaw) ? discardRaw.slice() : Object.values(discardRaw));
    // Don't carry per-turn tags into the discard pile copy of the card.
    const discardCard = { ...card };
    delete discardCard.justPicked; delete discardCard.justPickedSeq;
    delete discardCard.mustLayThisTurn;
    discard.push({ card: discardCard, by: mySeat });
    const dir = (c2.direction === -1) ? -1 : 1; // turn direction (±1)
    const nextP = (mySeat + dir + MAX_PLAYERS) % MAX_PLAYERS;
    const updates = {};
    updates[`remi/hands/${mySeat}`] = newHand;
    updates[`remi/discard`] = discard;
    updates[`remi/currentPlayer`] = nextP;
    updates[`remi/turnPhase`] = 'draw';
    updates[`remi/lastDiscardBy`] = mySeat;
    updates[`remi/lastDrawnBy`] = null;
    updates[`remi/lastDrawnCard`] = null;
    updates[`remi/turnCount`] = (c2.turnCount || 0) + 1; // advance the turn counter
    // Turn is over → reset ALL ceki declarations so every player can
    // re-declare fresh each turn. Arm the next player if they pre-declared.
    updates[`remi/cekiArmed/${mySeat}`] = null;
    const cekiAll = c2.cekiDeclared || {};
    const nextDecl = (cekiAll[nextP] != null ? cekiAll[nextP] : cekiAll[String(nextP)]);
    if (nextDecl) {
      updates[`remi/cekiArmed/${nextP}`] = true;
    }
    // Clear ALL declarations so everyone can declare again next turn.
    updates[`remi/cekiDeclared`] = null;
    // Close detection: hand empty after discard → player closed the round.
    if (newHand.length === 0) {
      updates[`remi/closedBy`] = mySeat;
    }
    remiSelectedIndices.clear();
    remiCekiExpanded = false;
    Sound.cardDrop();
    await fb.update(fb.ref(fb.db, 'rooms/' + currentRoom), updates);
  } catch (e) { console.error('remi discard failed', e); }
}

// ============================================================

// ======================================================================
// maybeResolveRemiRound — SCORING + CLOSE LOGIC (KUNCI!)
// truf-multiplayer-v3.html L11289-L11612
// ======================================================================
function maybeResolveRemiRound(room) {
  if (!room || room.host !== myUid) return;
  if (room.game !== 'remi') return;
  if (room.phase !== 'playing') return;
  const c = room.remi; if (!c) return;
  // Don't resolve while the deck is still being "shuffled" by the rank-4 human.
  if (c.shuffling && (c.shuffling.done || 0) < (c.shuffling.need || 20)) return;
  const deckRaw = c.deck || [];
  const deckLen = (Array.isArray(deckRaw) ? deckRaw : Object.values(deckRaw)).length;
  const closed = c.closedBy != null;
  // Deck-empty ending: the round ends only AFTER the player who drew the
  // final deck card has discarded. After that discard, currentPlayer
  // advances and turnPhase flips to 'draw' — but there are no cards left to
  // draw. So we wait for turnPhase==='draw' with an empty deck. If we
  // resolved the instant the deck hit 0 (turnPhase still 'discard'), the
  // last drawer would lose their final discard.
  if (!closed) {
    if (deckLen > 0) return;
    if (c.turnPhase !== 'draw') return; // last drawer hasn't discarded yet
  }
  if (remiResolveScheduled) return;
  remiResolveScheduled = true;
  // Stamp the round number we intend to resolve. If a fresh round has started
  // by the time the setTimeout fires (e.g. host clicked Next Round during the
  // 1s delay), we must NOT write `phase: remi_end` — that would yank the new
  // round straight back into the end modal.
  const intendedRound = (c && c.roundNumber) || 1;
  const intendedSession = (c && c.sessionNumber) || 1;
  setTimeout(async () => {
    try {
      const snap = await fb.get(fb.ref(fb.db, 'rooms/' + currentRoom));
      if (!snap.exists()) return;
      const r2 = snap.val();
      const c2 = r2.remi; if (!c2) return;
      // Guard: if the round/session changed under us, bail. This protects
      // against stale resolve-setTimeouts from a previous round firing into
      // a freshly started round 2/3/...
      if ((c2.roundNumber || 1) !== intendedRound) {
        console.warn('[remi] resolve aborted — round changed', intendedRound, '→', c2.roundNumber);
        return;
      }
      if ((c2.sessionNumber || 1) !== intendedSession) {
        console.warn('[remi] resolve aborted — session changed');
        return;
      }
      // Guard: phase must still be 'playing' (i.e. not already resolved or moved on)
      if (r2.phase !== 'playing') {
        console.warn('[remi] resolve aborted — phase changed to', r2.phase);
        return;
      }
      // Re-verify the resolution condition still holds against the fresh state.
      // The original schedule may have been triggered by a transient empty deck
      // that has since been replenished by a Next Round transition.
      const freshDeckRaw = c2.deck || [];
      const freshDeckLen = (Array.isArray(freshDeckRaw) ? freshDeckRaw : Object.values(freshDeckRaw)).length;
      const freshClosed = c2.closedBy != null;
      if (!freshClosed && (freshDeckLen > 0 || c2.turnPhase !== 'draw')) {
        console.warn('[remi] resolve aborted — condition no longer holds (deckLen=' + freshDeckLen + ', phase=' + c2.turnPhase + ')');
        return;
      }
      const players = Object.values(r2.players || {}).sort((a, b) => a.seat - b.seat);
      const closedBy = c2.closedBy;
      // Per-seat hand penalty (negative) — cards still in hand
      const handPenalty = {};
      // Per-seat laid bonus (positive) — cards already laid down score positively
      const laidBonus = {};
      // Per-seat helper-bonus/penalty — only if someone closed
      const helperDelta = {};
      // New scoring per user spec:
      //   - Cards in hand that COULD form combos ("jadi") = POSITIVE (no need to lay)
      //   - Cards in hand that can't form combos ("tidak jadi") = NEGATIVE
      //   - Cards already laid on table = POSITIVE
      // Card values: 2-10 = 5, J/Q/K = 10, A = 20, Joker = 25
      const handJadi = {};       // positive: cards in hand that form combos
      const handTidakJadi = {};  // negative: cards in hand that don't form combos
      for (const p of players) {
        const handRaw = (c2.hands && (c2.hands[p.seat] || c2.hands[String(p.seat)])) || [];
        const hand = Array.isArray(handRaw) ? handRaw : Object.values(handRaw);
        const myLaidArr = (c2.laidDown && (c2.laidDown[p.seat] || c2.laidDown[String(p.seat)])) || [];
        const myLaidCombos = Array.isArray(myLaidArr) ? myLaidArr : Object.values(myLaidArr);
        const ownDasarLaid = myLaidCombos.some(co => co && co.kind === 'dasar');
        // Joker eligibility: jokers may complete combos only if THIS player has
        // a PURE dasar (laid OR a pure dasar already in hand).
        const pureDasarLaid = myLaidCombos.some(co => co && co.kind === 'dasar' && isPureRemiCombo(co));
        const { combos: pureDasarsInHand } = findAllDasarsInHand(hand);
        const pureDasarInHand = pureDasarsInHand.length > 0;
        const jokerEligible = pureDasarLaid || pureDasarInHand;
        // Pararel "jadi" only counts if this player has a dasar (laid OR a
        // dasar exists in hand — pure or joker-completable).
        const pararelEligible = ownDasarLaid || pureDasarInHand || jokerEligible;

        // JOKER-AWARE combo detection: combos completed by a joker (e.g.
        // Q♥+K♥+Joker = J♥-Q♥-K♥) now count as "jadi", with the joker valued
        // by the rank it substitutes (J♥ = 10, not 25).
        const { combos: jadiCombos, remaining: leftover } =
          findAllJokerAwareCombos(hand, pararelEligible, jokerEligible);
        let jadi = 0;
        for (const combo of jadiCombos) jadi += comboTotalValue(combo);
        let tidakJadi = 0;
        for (const card of leftover) {
          if (card.rank === 'JOKER') {
            // A joker that could NOT be placed into a combo is a DEAD card and
            // is penalised at its full −25 (a single meld can hold only one
            // joker, so a 2nd joker with no separate combo to complete dies).
            tidakJadi += 25;
          } else {
            tidakJadi += remiCardValue(card);
          }
        }
        console.log('[remi] scoring seat', p.seat,
          'hand:', hand.map(c => c.rank + (c.suit || '?') + (c.color ? '(' + c.color + ')' : '')),
          'combos:', jadiCombos.length, 'jokerEligible:', jokerEligible,
          'jadi:', jadi, 'tidakJadi:', -tidakJadi);
        handJadi[p.seat] = jadi;
        handTidakJadi[p.seat] = -tidakJadi;
        handPenalty[p.seat] = jadi - tidakJadi; // net "hand component" — for compat

        const laidRaw = (c2.laidDown && (c2.laidDown[p.seat] || c2.laidDown[String(p.seat)])) || [];
        const myLaid = Array.isArray(laidRaw) ? laidRaw : Object.values(laidRaw);
        let lb = 0;
        // comboTotalValue scores each joker by the rank it substitutes
        // (e.g. joker standing in for J = 10, not 25).
        for (const combo of myLaid) lb += comboTotalValue(combo);
        laidBonus[p.seat] = lb;
        helperDelta[p.seat] = 0;
      }
      // Closing bonus/penalty — per user rule:
      //   • Bonus unit = value of the closer's CLOSING discard (the card that
      //     emptied their hand) × 10.
      //   • A "contributor" is any OTHER player whose discarded card the closer
      //     picked up and used in one of their LAID melds (tagged fromDiscardBy).
      //   • Each unique contributor is penalised −(bonus unit); the closer gains
      //     +(bonus unit) per contributor.
      //   • If nobody fed the closer (e.g. they closed purely off their own
      //     cards / deck draws) there are no contributors → no bonus at all.
      //     This is what previously was phrased as "no bonus from the deck" —
      //     it now falls out naturally instead of being gated on the closer's
      //     final draw source (which wrongly voided the bonus when the closer's
      //     last draw happened to be from the deck even though earlier melds
      //     used cards fed by opponents).
      let closingExtra = {}; // per-seat extra "tarikan" penalty for multi-contributor close
      let closeNoBonus = false; // true → close tanpa bonus exchange (rule 2 atau rule 4)
      if (closedBy != null) {
        // ===== CLOSING BONUS RULES =====
        // 1. Menutup setelah ambil CABUTAN (deck) → TIDAK ada bonus/hukuman + putaran dibalik.
        // 2. Menutup setelah ambil BUANGAN (discard) → cek apakah kartu yang
        //    diambil JADI (masuk combo turunan) atau hanya jadi tutupan.
        // 3. Kartu yang hanya jadi tutupan (dibuang) → penyumbangnya TIDAK kena
        //    + putaran dibalik (sama seperti cabutan).
        // 4. Hanya penyumbang yang kartunya JADI dan TURUN di ronde yang sama
        //    giliran penutupan yang kena hukuman.
        // 5. Penyumbang >1 → hukuman tarikan escalating (-50, -100).
        const closingMethod = c2.lastDrawnFrom || 'deck';
        console.log('[remi-close] closedBy=', closedBy, 'closingMethod=', closingMethod,
          'lastPickupContributors=', c2.lastPickupContributors);
        if (closingMethod === 'discard') {
          const discardArrFinal = Array.isArray(c2.discard)
            ? c2.discard
            : Object.values(c2.discard || {});
          const lastEntry = discardArrFinal[discardArrFinal.length - 1];
          const lastDiscardCard = (lastEntry && lastEntry.card) ? lastEntry.card : lastEntry;
          const lastDiscardValue = lastDiscardCard ? remiCardValue(lastDiscardCard) : 0;
          const bonusUnit = lastDiscardValue * 10;
          // Cards picked THIS closing turn (lastPickupContributors) — fallback
          // ke deteksi langsung dari justPicked tags pada laid combo bila
          // contributors list kosong/null.
          const rawContribs = c2.lastPickupContributors || [];
          const pickupSeatsRaw = Array.isArray(rawContribs) ? rawContribs : Object.values(rawContribs);
          // Normalisasi ke number (Firebase kadang mengembalikan string keys)
          const pickupSeats = new Set(
            pickupSeatsRaw
              .map(s => (typeof s === 'string' ? Number(s) : s))
              .filter(s => s != null && !Number.isNaN(s) && s !== closedBy)
          );
          const closerLaidRaw = (c2.laidDown && (c2.laidDown[closedBy] || c2.laidDown[String(closedBy)])) || [];
          const closerLaid = Array.isArray(closerLaidRaw) ? closerLaidRaw : Object.values(closerLaidRaw);
          const contributors = new Set();
          let totalLaidCards = 0;
          let justPickedLaidCards = 0;
          for (const combo of closerLaid) {
            const cardsArr = Array.isArray(combo.cards) ? combo.cards : Object.values(combo.cards || {});
            for (const card of cardsArr) {
              totalLaidCards++;
              if (card && card.justPicked) justPickedLaidCards++;
              const origin = card ? card.fromDiscardBy : null;
              const originNum = (typeof origin === 'string') ? Number(origin) : origin;
              const closedByNum = (typeof closedBy === 'string') ? Number(closedBy) : closedBy;
              const isOtherContributor = originNum != null && !Number.isNaN(originNum)
                && originNum !== closedByNum;
              if (isOtherContributor) {
                // Hitung sebagai contributor jika:
                //   (a) seat ini di lastPickupContributors (pickupSeats), ATAU
                //   (b) kartu masih ditandai justPicked === true (turunan di
                //       turn yang sama dengan pengambilan kartu — fallback bila
                //       lastPickupContributors hilang dari snapshot).
                if (pickupSeats.has(originNum) || card.justPicked === true) {
                  contributors.add(originNum);
                }
              }
            }
          }
          console.log('[remi-close] pickupSeats=', [...pickupSeats],
            'closerLaid combos=', closerLaid.length,
            'totalLaidCards=', totalLaidCards,
            'justPickedLaidCards=', justPickedLaidCards,
            'detectedContributors=', [...contributors]);
          const contArr = Array.from(contributors).sort((a, b) => {
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
            // Discard pickup tapi card hanya jadi tutupan (rule 4): treat seperti cabutan.
            closeNoBonus = true;
          }
          console.log('[remi] closing via DISCARD · bonusUnit=', bonusUnit,
            'contributors=', contArr, 'closeNoBonus=', closeNoBonus,
            'closeDiscard=', lastDiscardCard);
        } else {
          // Closed via deck draw (rule 2) → no closing bonus/penalty + putaran dibalik
          closeNoBonus = true;
          console.log('[remi] closing via DECK · no closing bonus/penalty · putaran dibalik');
        }
      }

      const prevTotals = r2.totals || {};
      const newTotals = {};
      for (const p of players) {
        const cur = (prevTotals[p.seat] != null ? prevTotals[p.seat] : (prevTotals[String(p.seat)] || 0));
        // Round = hand jadi (+) + hand tidak jadi (-) + laid (+) + helper delta (±)
        const round = (handJadi[p.seat] || 0) + (handTidakJadi[p.seat] || 0)
                    + (laidBonus[p.seat] || 0) + (helperDelta[p.seat] || 0);
        newTotals[p.seat] = cur + round;
      }
      // ----- MATCH-END conditions -----
      //   • This round number reached the MAX of 20 rounds, OR
      //   • A player crossed +1000 or -1000 total points.
      // When met, the match is over after this round's scores are shown.
      const thisRoundNum = c2.roundNumber || 1;
      // Identify a player who crossed +1000 or -1000 (high cap takes priority).
      let capSeat = null, capType = null;
      for (const p of players) {
        const t = newTotals[p.seat] || 0;
        if (t >= 1000) { capSeat = p.seat; capType = 'high'; break; }
      }
      if (capSeat == null) {
        for (const p of players) {
          const t = newTotals[p.seat] || 0;
          if (t <= -1000) { capSeat = p.seat; capType = 'low'; break; }
        }
      }
      const hitPointCap = capSeat != null;
      const hitRoundCap = thisRoundNum >= 20;
      const matchOver = hitPointCap || hitRoundCap;
      const capPlayer = (capSeat != null) ? players.find(p => p.seat === capSeat) : null;
      const capName = capPlayer ? capPlayer.nickname : null;
      // ----- "Babu" (last-place) streak tracking -----
      // After scoring, find ALL seats tied for the lowest total (rank 4).
      // Increment their consecutive-rank-4 streaks, reset everyone else.
      // Emit a one-shot event when any streak crosses a milestone.
      let babuLow = Infinity;
      for (const p of players) {
        const t = newTotals[p.seat] != null ? newTotals[p.seat] : 0;
        if (t < babuLow) babuLow = t;
      }
      const babuSeats = new Set();
      for (const p of players) {
        const t = newTotals[p.seat] != null ? newTotals[p.seat] : 0;
        if (t === babuLow) babuSeats.add(p.seat);
      }
      const prevStreak = (r2.remi && r2.remi.babuStreak) || {};
      const babuStreak = {};
      for (const p of players) {
        const prev = (prevStreak[p.seat] != null ? prevStreak[p.seat] : (prevStreak[String(p.seat)] || 0));
        babuStreak[p.seat] = babuSeats.has(p.seat) ? (prev + 1) : 0;
      }
      // "BABU ABADI" is PERMANENT once earned (10× rank-4 in a row) — keep the
      // existing set and add the seat if it just hit 10.
      const babuAbadi = Object.assign({}, (r2.remi && r2.remi.babuAbadi) || {});
      let babuEvent = (r2.remi && r2.remi.babuEvent) || null;
      for (const seat of babuSeats) {
        const s = babuStreak[seat];
        if (s === 10) { babuAbadi[seat] = true; babuEvent = { seat, type: 'abadi', at: Date.now() }; }
        else if (s === 4) babuEvent = { seat, type: 'sejati', at: Date.now() };
      }

      const updates = {};
      updates[`phase`] = 'remi_end';
      updates[`remi/handPenalty`] = handPenalty;
      updates[`remi/handJadi`] = handJadi;
      updates[`remi/handTidakJadi`] = handTidakJadi;
      updates[`remi/laidBonus`] = laidBonus;
      updates[`remi/helperDelta`] = helperDelta;
      if (Object.keys(closingExtra || {}).length > 0) updates[`remi/closingExtra`] = closingExtra;
      updates[`remi/closedBy`] = closedBy != null ? closedBy : null;
      updates[`remi/endReason`] = closedBy != null ? 'closed' : 'deck_empty';
      // closeNoBonus dipertahankan untuk dashboard info; reversal trigger di SEMUA close.
      updates[`remi/closeNoBonus`] = closedBy != null ? closeNoBonus : false;
      updates[`remi/babuStreak`] = babuStreak;
      updates[`remi/babuAbadi`] = babuAbadi;
      if (babuEvent) updates[`remi/babuEvent`] = babuEvent;
      updates[`totals`] = newTotals;
      // Flag the round-end modal that this is the FINAL round of the match.
      updates[`remi/matchOver`] = matchOver;
      updates[`remi/matchOverReason`] = matchOver ? (hitPointCap ? 'points' : 'rounds') : null;
      updates[`remi/matchOverCapType`] = capType;          // 'high' | 'low' | null
      updates[`remi/matchOverCapName`] = capName || null;  // name of the capped player
      // Applause is triggered by renderRemiEndModal on all clients so everyone
      // hears it (host-only Sound call would miss the other players).
      await fb.update(fb.ref(fb.db, 'rooms/' + currentRoom), updates);
    } catch (e) { console.error('remi resolve failed', e); }
    finally { remiResolveScheduled = false; }
  }, 1000);
}

// ======================================================================
// remiCardValue (point per kartu)
// truf-multiplayer-v3.html L11615-L11620
// ======================================================================
function remiCardValue(card) {
  if (card.rank === 'JOKER') return 25;
  if (card.rank === 'A') return 15;
  if (card.rank === 'K' || card.rank === 'Q' || card.rank === 'J') return 10;
  return 5; // number cards 2-10
}

// ======================================================================
// remiRankValue (joker substitute value)
// truf-multiplayer-v3.html L11622-L11630
// ======================================================================
// Value of a rank when a joker substitutes for it (joker takes the value of
// the card it replaces, per the scoring rule). Rank can be a string ('J')
// or a REMI_RANK_NUM number (11).
function remiRankValue(rank) {
  const n = (typeof rank === 'number') ? rank : REMI_RANK_NUM[rank];
  if (n === 14) return 15;          // A
  if (n >= 11 && n <= 13) return 10; // J/Q/K
  return 5;                          // 2..10
}

// ======================================================================
// comboTotalValue — combo value joker-aware
// truf-multiplayer-v3.html L11632-L11677
// ======================================================================
// Total point value of a laid/known combo where each JOKER is scored by the
// rank it substitutes for (NOT a flat 25). Pararel jokers take the pararel's
// rank; dasar jokers take the missing sequence ranks they fill.
function comboTotalValue(combo) {
  const cardsRaw = (combo && combo.cards) || [];
  const cards = Array.isArray(cardsRaw) ? cardsRaw : Object.values(cardsRaw);
  const nonJokers = cards.filter(c => c && c.rank !== 'JOKER');
  const jokerCount = cards.length - nonJokers.length;
  let total = 0;
  for (const c of nonJokers) total += remiCardValue(c);
  if (jokerCount === 0) return total;

  // 4-Aces special dasar: jokers (shouldn't appear) treated as A
  if (combo.kind === 'pararel' || (nonJokers.length && nonJokers.every(c => c.rank === nonJokers[0].rank))) {
    const r = nonJokers.length ? nonJokers[0].rank : null;
    total += (r ? remiRankValue(r) : 10) * jokerCount;
    return total;
  }
  // DASAR: reconstruct the consecutive rank run and assign jokers to the
  // ranks they fill (internal gaps first, then extend within band).
  const ranks = nonJokers
    .filter(c => c.rank !== 'A')
    .map(c => REMI_RANK_NUM[c.rank])
    .sort((a, b) => a - b);
  if (ranks.length === 0) { total += 10 * jokerCount; return total; }
  const lo = ranks[0], hi = ranks[ranks.length - 1];
  const present = new Set(ranks);
  const assigned = []; // ranks the jokers represent
  let remaining = jokerCount;
  // 1) internal gaps
  for (let r = lo + 1; r < hi && remaining > 0; r++) {
    if (!present.has(r)) { assigned.push(r); present.add(r); remaining--; }
  }
  // 2) extensions within the band
  const inLowerBand = hi <= 10;
  const bandLow = inLowerBand ? 2 : 11;
  const bandHigh = inLowerBand ? 10 : 13;
  let up = hi + 1, down = lo - 1;
  while (remaining > 0 && (up <= bandHigh || down >= bandLow)) {
    if (up <= bandHigh) { assigned.push(up); up++; remaining--; if (remaining <= 0) break; }
    if (down >= bandLow) { assigned.push(down); down--; remaining--; }
  }
  for (const r of assigned) total += remiRankValue(r);
  if (remaining > 0) total += 10 * remaining;
  return total;
}

// ======================================================================
// inHandJokerJadiValue — joker in-hand jadi calculation
// truf-multiplayer-v3.html L11679-L11774
// ======================================================================
// For jokers still in HAND that count as "jadi", determine the value of the
// card each would substitute for. Greedily assigns jokers to: (1) open slots
// in pure pararels (joker = that rank), then (2) extensions of pure dasars
// (joker = the adjacent rank within the band). Leftover jokers default to 10.
// Returns the total substituted value to add.
function inHandJokerJadiValue(jokerCount, dasarCs, pararelCs) {
  if (jokerCount <= 0) return 0;
  let remaining = jokerCount, total = 0;
  const pars = pararelCs.map(co => {
    const cards = Array.isArray(co.cards) ? co.cards : Object.values(co.cards || {});
    return { rank: cards[0] ? cards[0].rank : 'K', cap: Math.max(0, 4 - cards.length) };
  });
  const dass = dasarCs.map(co => {
    const cards = Array.isArray(co.cards) ? co.cards : Object.values(co.cards || {});
    const ranks = cards.filter(c => c.rank !== 'A').map(c => REMI_RANK_NUM[c.rank]).sort((a, b) => a - b);
    return { lo: ranks[0], hi: ranks[ranks.length - 1] };
  });
  // 1) pararel open slots — joker must be the pararel's rank
  for (const p of pars) {
    while (p.cap > 0 && remaining > 0) { total += remiRankValue(p.rank); p.cap--; remaining--; }
  }
  // 2) dasar extensions within the band
  for (const d of dass) {
    if (d.lo == null) continue;
    const inLowerBand = d.hi <= 10;
    const bandLow = inLowerBand ? 2 : 11, bandHigh = inLowerBand ? 10 : 13;
    let up = d.hi + 1, down = d.lo - 1;
    while (remaining > 0 && (up <= bandHigh || down >= bandLow)) {
      if (up <= bandHigh) { total += remiRankValue(up); up++; remaining--; if (remaining <= 0) break; }
      if (down >= bandLow) { total += remiRankValue(down); down--; remaining--; }
    }
  }
  // 3) leftover jokers with no concrete placement → J/Q/K-level default
  total += 10 * remaining;
  return total;
}

// ============================================================
// REMI modals
// ============================================================
let _remiEndApplauseShown = false;
let _matchCapPopupShown = false; // dedup the ±1000 cap popup per match

// Minimizable popup shown when the match ends via the ±1000 point cap.
//   type 'high' (≥1000): "Permainan berakhir karena <name> terlalu jago 1000 Poin"
//   type 'low'  (≤-1000): "buset cupu banget <name> -1000 cuy, reset match!"
function showMatchCapPopup(name, type) {
  const old = document.getElementById('matchCapPopup');
  if (old) old.remove();
  const wrap = document.createElement('div');
  wrap.id = 'matchCapPopup';
  wrap.className = 'match-cap-popup' + (type === 'low' ? ' cap-low' : '');
  const emoji = type === 'low' ? '💀' : '🏆';
  const text = type === 'low'
    ? `buset cupu banget <b>${escapeHtml(name)}</b> -1000 cuy, reset match!`
    : `Permainan berakhir karena <b>${escapeHtml(name)}</b> terlalu jago 1000 Poin`;
  wrap.innerHTML =
    `<div class="cap-emoji">${emoji}</div>` +
    `<div class="cap-text">${text}</div>` +
    `<button class="cap-min-btn">— Sembunyikan</button>`;
  document.body.appendChild(wrap);
  const minBtn = wrap.querySelector('.cap-min-btn');
  // Toggle minimize: clicking the minimized chip restores it.
  minBtn.onclick = (e) => { e.stopPropagation(); wrap.classList.add('minimized'); };
  wrap.onclick = () => { if (wrap.classList.contains('minimized')) wrap.classList.remove('minimized'); };
}

// Show a short celebration video when a player closes the round.
function showRemiCloseVideo() {
  // Remove any existing video overlay
  const old = document.querySelector('.remi-close-video-wrap');
  if (old) old.remove();
  const wrap = document.createElement('div');
  wrap.className = 'remi-close-video-wrap';
  const vid = document.createElement('video');
  vid.src = 'close-celebration.mp4';
  vid.autoplay = true;
  vid.playsInline = true;
  vid.muted = false;
  // Respect the user's SFX volume setting
  try { vid.volume = Math.min(1, Sound.getSfxVol()); } catch (e) { vid.volume = 0.7; }
  if (Sound.isMuted()) vid.muted = true;
  wrap.appendChild(vid);
  document.body.appendChild(wrap);
  // Remove after the video ends, or after 15s max as safety net.
  const cleanup = () => {
    wrap.style.animation = 'remi-close-vid-out 0.3s ease both';
    setTimeout(() => { try { wrap.remove(); } catch (e) {} }, 350);
  };
  vid.addEventListener('ended', cleanup);
  setTimeout(cleanup, 15000);
  // Allow click-to-dismiss
  wrap.addEventListener('click', cleanup);
}
function showRemiCloseDeckGif() {
  const old = document.querySelector('.remi-close-video-wrap');

// ======================================================================
// handleRemiReady — siap untuk next round
// truf-multiplayer-v3.html L12068-L12175
// ======================================================================
async function handleRemiReady() {
  if (!currentRoom || mySeat == null) return;
  try {
    await fb.update(fb.ref(fb.db, 'rooms/' + currentRoom), { [`remi/ready/${mySeat}`]: true });
  } catch (e) { console.error('remi ready failed', e); }
}

// Round-end discard log: show every card thrown this round in order, with who
// discarded it — so players can review the cards that already passed.
function openRemiDiscardLog(room) {
  const overlay = document.getElementById('remiDiscardLogModal');
  const bodyEl = document.getElementById('remiDiscardLogBody');
  if (!overlay || !bodyEl) return;
  const c = (room && room.remi) || {};
  const discardRaw = c.discard || [];
  const discard = Array.isArray(discardRaw) ? discardRaw : Object.values(discardRaw);
  const playersBySeat = {};
  for (const p of Object.values((room && room.players) || {})) playersBySeat[p.seat] = p;
  if (discard.length === 0) {
    bodyEl.innerHTML = '<div style="text-align:center;opacity:0.6;padding:18px;">Belum ada kartu dibuang.</div>';
  } else {
    // Group rows of cards (oldest → newest) with the discarder's name.
    const rowsHtml = discard.map((entry, i) => {
      const card = (entry && entry.card) ? entry.card : entry;
      const by = (entry && entry.by != null) ? entry.by : null;
      const who = (by != null && playersBySeat[by]) ? escapeHtml(playersBySeat[by].nickname) : '—';
      const cardHtml = card ? renderRemiSmallCardEl(card).outerHTML : '';
      return `<div style="display:flex;align-items:center;gap:10px;padding:4px 0;border-bottom:1px solid rgba(212,168,75,0.12);">
        <span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:rgba(244,234,213,0.5);min-width:24px;">${i + 1}.</span>
        <span style="display:flex;">${cardHtml}</span>
        <span style="font-family:var(--font-display);font-size:14px;color:rgba(244,234,213,0.8);">dibuang oleh <b style="color:var(--gold-bright)">${who}</b></span>
      </div>`;
    }).join('');
    bodyEl.innerHTML = `<div style="display:flex;flex-direction:column;">${rowsHtml}</div>`;
  }
  if (overlay.parentElement !== document.body) document.body.appendChild(overlay);
  overlay.style.display = '';
  overlay.style.zIndex = '10000'; // above the end-score panels
  overlay.style.pointerEvents = 'auto';
  overlay.classList.add('show');
  const closeBtn = document.getElementById('remiDiscardLogCloseBtn');
  if (closeBtn) closeBtn.onclick = () => {
    overlay.classList.remove('show');
    overlay.style.display = 'none';
  };
  overlay.onclick = (ev) => { if (ev.target === overlay) { overlay.classList.remove('show'); overlay.style.display = 'none'; } };
}

let _remiTournamentEndShown = false;
function renderRemiTournamentEnd(room) {
  const overlay = document.getElementById('remiTournamentEndModal');
  if (!overlay) return;
  if (room.phase !== 'remi_tournament_end') {
    hideRemiOverlay(overlay);
    if (_remiTournamentEndShown) {
      try { Sound.stopWin(); } catch (e) {}
      _remiTournamentEndShown = false;
    }
    return;
  }
  // Hide round-end modal
  hideRemiOverlay(document.getElementById('remiEndModal'));
  const totals = room.totals || {};
  const players = Object.values(room.players || {});
  const rows = players.map(p => ({
    name: p.nickname,
    total: (totals[p.seat] != null ? totals[p.seat] : (totals[String(p.seat)] || 0)),
    isMe: p.uid === myUid,
  })).sort((a, b) => b.total - a.total);
  const rowsHtml = rows.map((r, idx) => {
    let icon = '';
    if (idx === 0) icon = '👑';
    else if (idx === 1) icon = '🥈';
    else if (idx === 2) icon = '🥉';
    else icon = '💀';
    return `<div class="standings-row${r.isMe ? ' me' : ''}">` +
      `<span class="st-rank">${icon}</span>` +
      `<span class="st-name">${escapeHtml(r.name)}</span>` +
      `<span class="st-score">${r.total}</span>` +
      `<span class="st-unit">poin</span>` +
      `</div>`;
  }).join('');
  // The last-place player gets a playful jab.
  const loser = rows[rows.length - 1];
  const loserMsg = loser
    ? `kali ini si cupu <b>${escapeHtml(loser.name)}</b> kalah lagi, mohon berlatih lebih keras! 💀`
    : 'Terima kasih sudah bermain!';
  const body = document.getElementById('remiTournamentEndBody');
  body.innerHTML = `<div class="end-section"><div class="end-section-title">Klasemen Akhir</div><div class="standings-table">${rowsHtml}</div></div>` +
    `<div class="standings-loser-msg">${loserMsg}</div>`;
  showRemiOverlay(overlay);
  if (!_remiTournamentEndShown) { _remiTournamentEndShown = true; try { Sound.winFanfare(); } catch (e) {} }
  const isHost = room.host === myUid;
  const restartBtn = document.getElementById('remiTournamentRestartBtn');
  if (restartBtn) {
    restartBtn.style.display = isHost ? '' : 'none';
    restartBtn.textContent = '🔄 Rematch';
    restartBtn.onclick = handleRemiRestart;
  }
  const leaveBtn = document.getElementById('remiTournamentLeaveBtn');
  if (leaveBtn) {
    leaveBtn.style.pointerEvents = 'auto';
    leaveBtn.textContent = '🚪 Keluar Match';
    leaveBtn.onclick = (ev) => { if (ev && ev.stopPropagation) ev.stopPropagation(); exitRemiToMain(); };
  }
}

let _remiNextRoundInProgress = false;

// ======================================================================
// handleRemiNextRound — start ronde baru (turn direction flip)
// truf-multiplayer-v3.html L12176-L12289
// ======================================================================
async function handleRemiNextRound() {
  console.log('[remi] handleRemiNextRound called, currentRoom:', currentRoom);
  if (_remiNextRoundInProgress) { console.warn('[remi] next round already in progress'); return; }
  if (!currentRoom) { console.warn('[remi] no currentRoom'); return; }
  // IMMEDIATELY silence applause for the host. Without this, the host
  // has to wait for the Firebase round-trip → listener fire → render
  // before stopWin runs (potentially ≥1 second of unwanted applause
  // bleeding into round 2). Other clients still stop via their listener.
  try { Sound.stopWin(); } catch (e) {}
  _remiEndApplauseShown = false;
  _remiNextRoundInProgress = true;
  try {
    const snap = await fb.get(fb.ref(fb.db, 'rooms/' + currentRoom));
    if (!snap.exists()) { console.warn('[remi] room snap not exists'); return; }
    const r = snap.val();
    if (r.host !== myUid) { console.warn('[remi] not host, r.host=', r.host, 'myUid=', myUid); return; }
    if (r.game !== 'remi') { console.warn('[remi] r.game=', r.game); return; }
    if (r.phase !== 'remi_end') { console.warn('[remi] not in remi_end phase, phase=', r.phase); return; }
    // Gate: every human must have confirmed "Siap" (bots are auto-ready).
    const readyObj = (r.remi && r.remi.ready) || {};
    const humansList = Object.values(r.players || {}).filter(p => p && !p.isBot);
    const everyoneReady = humansList.every(p =>
      !!(readyObj[p.seat] != null ? readyObj[p.seat] : readyObj[String(p.seat)]));
    if (!everyoneReady) { console.warn('[remi] next round blocked — not all players ready'); return; }
    // Determine first player for next round = lowest score.
    // ALL players tied for rank 4 (lowest score) must shuffle.
    const players = Object.values(r.players || {}).sort((a, b) => a.seat - b.seat);
    const totals = r.totals || {};
    let lowest = Infinity;
    for (const p of players) {
      const t = (totals[p.seat] != null ? totals[p.seat] : (totals[String(p.seat)] || 0));
      if (t < lowest) lowest = t;
    }
    const rank4Seats = players.filter(p => {
      const t = (totals[p.seat] != null ? totals[p.seat] : (totals[String(p.seat)] || 0));
      return t === lowest;
    });
    const firstPlayer = rank4Seats[0].seat; // first among the tied-for-last
    // Shuffle "punishment": every HUMAN tied for rank 4 must click the deck
    // 20× each to "shuffle" before the round begins.
    const humanShufflers = rank4Seats.filter(p => !p.isBot).map(p => p.seat);
    const shuffling = humanShufflers.length > 0
      ? { seats: humanShufflers, current: 0, seat: humanShufflers[0], need: 20, done: 0 }
      : null;
    const deck = generateCekiDeck();
    const hands = { 0: [], 1: [], 2: [], 3: [] };
    for (let i = 0; i < 7; i++) for (let s = 0; s < MAX_PLAYERS; s++) hands[s].push(deck.shift());
    hands[firstPlayer].push(deck.shift());
    for (let s = 0; s < MAX_PLAYERS; s++) hands[s].sort(sortCangkulCardCompare);
    const prevRound = (r.remi && r.remi.roundNumber) || 1;
    // Turn direction: flip SETIAP kali ronde ditutup oleh pemain (semua close).
    // Deck-empty / stuck → tidak flip.
    const prevDir = (r.remi && r.remi.direction) || 1;
    const prevClosed = !!(r.remi && r.remi.endReason === 'closed');
    const newDir = prevClosed ? -prevDir : prevDir;
    // CRITICAL: reset host-side scheduling flags BEFORE writing new state so
    // any in-flight setTimeouts from the previous round know to bail out via
    // their round-number guards. Also clear any scheduling sets so the new
    // round's listener can schedule fresh.
    resetHostTrackers();
    remiSelectedIndices.clear();
    _remiCekiSeen.clear();
    _remiEndApplauseShown = false;
    const updates = {};
    updates[`phase`] = 'playing';
    updates[`remi`] = {
      hands,
      deck,
      discard: [],
      laidDown: { 0: [], 1: [], 2: [], 3: [] },
      currentPlayer: firstPlayer,
      turnPhase: 'discard',
      sessionNumber: (r.remi && r.remi.sessionNumber) || 1,
      roundNumber: prevRound + 1,
      turnCount: 0,
      direction: newDir,
      shuffling: shuffling,
      babuStreak: (r.remi && r.remi.babuStreak) || null, // carry last-place streak
      babuAbadi: (r.remi && r.remi.babuAbadi) || null,   // PERMANENT babu-abadi flags
      babuEvent: (r.remi && r.remi.babuEvent) || null,   // keep last event for dedup
      closedBy: null,
      closeNoBonus: null,
      cekiDeclared: null,
      cekiArmed: null,
      handPenalty: null,
      handJadi: null,
      handTidakJadi: null,
      laidBonus: null,
      helperDelta: null,
      closingExtra: null,
      endReason: null,
      lastDrawnBy: null,
      lastDrawnCard: null,
      lastDrawnFrom: null,
      lastDiscardBy: null,
      startedAt: fb.serverTimestamp(),
    };
    console.log('[remi] starting round', prevRound + 1, 'firstPlayer=', firstPlayer, 'deckSize=', deck.length);
    await fb.update(fb.ref(fb.db, 'rooms/' + currentRoom), updates);
  } catch (e) {
    console.error('remi next round failed', e);
  } finally {
    // CRITICAL: always reset the in-progress flag so subsequent Next Round
    // clicks (round 3, 4, ...) can proceed. Without this, only the first
    // Next Round click ever works per session.
    _remiNextRoundInProgress = false;
  }
}

// Remi-specific exit. A leaving player is replaced by a BOT so the remaining
// players can keep going. If the host leaves, the host role migrates to
// another connected human; if no humans remain, the room is closed. Finally
// the local Remi views/modals are torn down and we return to game-select.
let _remiExitInProgress = false;
