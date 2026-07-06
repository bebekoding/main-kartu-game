/**
 * ============================================================
 *  ATURAN MAIN GAME REMI — Main Kartu
 * ============================================================
 *  Versi standalone berisi seluruh aturan, validator combo, dan
 *  fungsi scoring untuk game Remi. Di-extract dari
 *  truf-multiplayer-v3.html agar mudah dibaca / diaudit / di-port.
 *
 *  Deck: 52 kartu standar + 4 JOKER (2 merah + 2 hitam) = 56 kartu
 *  Pemain: 4 (fixed)
 *  Tujuan: habiskan kartu di tangan dengan menurunkan combo
 *          (DASAR / PARAREL) dan menutup (close) ronde.
 * ============================================================
 */

// ============================================================
//  KONSTANTA DECK & RANK
// ============================================================
const SUITS = ['S', 'H', 'D', 'C'];                 // Spades, Hearts, Diamonds, Clubs
const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const MAX_PLAYERS = 4;
const ROUND_CAP   = 20;                             // match selesai di ronde ke-20
const SCORE_CAP   = 1000;                           // match selesai bila ada player ≥ +1000 atau ≤ −1000

// Numeric rank mapping untuk sequence detection di dasar.
// A = 14 tapi A TIDAK dapat membentuk sequence (lihat isValidDasar).
const REMI_RANK_NUM = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
  'J': 11, 'Q': 12, 'K': 13, 'A': 14
};

// ============================================================
//  POIN PER KARTU
// ============================================================
//   - Angka 2..10  = 5
//   - J / Q / K    = 10
//   - A            = 15
//   - JOKER        = 25 (atau nilai kartu yang digantikan, lihat comboTotalValue)
function remiCardValue(card) {
  if (card.rank === 'JOKER') return 25;
  if (card.rank === 'A') return 15;
  if (card.rank === 'K' || card.rank === 'Q' || card.rank === 'J') return 10;
  return 5;
}

// Nilai rank saat joker menggantikannya (joker mengambil nilai kartu
// yang digantikan, sesuai aturan scoring).
function remiRankValue(rank) {
  const n = (typeof rank === 'number') ? rank : REMI_RANK_NUM[rank];
  if (n === 14) return 15;            // A
  if (n >= 11 && n <= 13) return 10;  // J/Q/K
  return 5;                           // 2..10
}

// ============================================================
//  GENERATE DECK (56 kartu)
// ============================================================
function generateCekiDeck() {
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

// ============================================================
//  COMBO RULES
// ============================================================
//
//  Ada 2 jenis combo (turunan):
//
//  ┌─────────────────────────────────────────────────────────┐
//  │ DASAR (sequence)                                        │
//  │   • Min 3 kartu, max 4 kartu                            │
//  │   • Suit sama, rank berurutan dalam 1 BAND saja:       │
//  │       - Number band  : 2..10                           │
//  │       - Face   band  : J..K                            │
//  │   • A TIDAK dapat ikut sequence (kecuali 4-Aces khusus) │
//  │   • Special case: 4-Aces (1 setiap suit) = dasar valid  │
//  │   • Joker dapat substitute (max 1 joker per combo)      │
//  └─────────────────────────────────────────────────────────┘
//  ┌─────────────────────────────────────────────────────────┐
//  │ PARAREL (same-rank set)                                 │
//  │   • Min 3 kartu, max 4 kartu                            │
//  │   • Rank sama, suit BERBEDA (tidak duplikat)            │
//  │   • Joker dapat substitute (max 1 joker per combo)      │
//  │   • HANYA bisa diturunkan kalau player sudah punya     │
//  │     dasar (di tangan atau di meja)                     │
//  └─────────────────────────────────────────────────────────┘

function isValidDasar(cards) {
  if (!cards || cards.length < 3) return false;
  // Special: 4 Aces (1 per suit) adalah dasar valid
  if (cards.length === 4 && cards.every(c => c && c.rank === 'A')) {
    const suits = new Set(cards.map(c => c.suit));
    if (suits.size === 4) return true;
  }
  const nonJokers = cards.filter(c => c && c.rank !== 'JOKER');
  const jokers = cards.length - nonJokers.length;
  if (nonJokers.length === 0) return false;
  // A tidak boleh ada di sequence biasa
  if (nonJokers.some(c => c.rank === 'A')) return false;
  // Suit harus sama
  const suit = nonJokers[0].suit;
  if (!nonJokers.every(c => c.suit === suit)) return false;
  const ranks = nonJokers.map(c => REMI_RANK_NUM[c.rank]).sort((a, b) => a - b);
  // Tidak boleh ada duplikat rank
  for (let i = 1; i < ranks.length; i++) if (ranks[i] === ranks[i - 1]) return false;
  const low = ranks[0], high = ranks[ranks.length - 1];
  if (high - low + 1 > cards.length) return false;
  // Boundary: tidak boleh menyeberang 10 dan J
  if (low <= 10 && high >= 11) return false;
  // Internal gap harus diisi joker
  let internalGaps = 0;
  for (let i = 1; i < ranks.length; i++) internalGaps += (ranks[i] - ranks[i - 1] - 1);
  const extraJokers = jokers - internalGaps;
  if (extraJokers < 0) return false;
  // Joker boleh extend dalam batas band
  let canExtendLow, canExtendHigh;
  if (high <= 10) {
    canExtendLow = low - 2; canExtendHigh = 10 - high;
  } else {
    canExtendLow = low - 11; canExtendHigh = 13 - high;
  }
  return extraJokers <= canExtendLow + canExtendHigh;
}

function isValidPararel(cards) {
  if (!cards || cards.length < 3 || cards.length > 4) return false;
  const nonJokers = cards.filter(c => c && c.rank !== 'JOKER');
  if (nonJokers.length === 0) return false;
  const rank = nonJokers[0].rank;
  if (!nonJokers.every(c => c.rank === rank)) return false;
  const suits = new Set(nonJokers.map(c => c.suit));
  return suits.size === nonJokers.length;  // tidak ada duplikat suit
}

function isPureRemiCombo(co) {
  if (!co) return false;
  const cards = Array.isArray(co.cards) ? co.cards : Object.values(co.cards || {});
  return cards.length > 0 && !cards.some(c => c && c.rank === 'JOKER');
}

// ============================================================
//  ATURAN PEMBATASAN BUANGAN (DISCARD)
// ============================================================
//
//  - A hanya boleh dibuang BILA player sudah turunkan dasarnya
//    sendiri (no exception)
//  - JOKER hanya boleh dibuang bila:
//      (a) cangkulan (deck) sudah habis, ATAU
//      (b) kartu tersebut adalah kartu penutup (closing card)
//  - Kartu yang TADI baru diambil dari buangan (mustLayThisTurn)
//    HARUS diturunkan sebagai combo sebelum boleh discard

// ============================================================
//  ATURAN PENGAMBILAN KARTU (DRAW / PICKUP)
// ============================================================
//
//  Setiap giliran: DRAW → (LAY combo opsional) → DISCARD
//
//  DRAW dapat dari:
//    1. CANGKULAN (deck) - ambil 1 kartu teratas
//    2. BUANGAN (discard pile) - ambil 1..N kartu dari TOP
//       Pengambilan dari buangan ada syarat:
//         - Kartu TERDALAM (deepest) WAJIB diturunkan ke combo
//         - Combo yang berisi kartu terdalam minimal ≥2 kartu
//           dari tangan sendiri (rule "min 2 own cards")
//
//  Pengambilan ini di-tag dengan:
//    - card.fromDiscardBy = seat asli yang membuang (untuk tracking
//      contributor saat ada close)
//    - card.justPicked = true (untuk undo + close detection)
//    - card.justPickedSeq = order pengambilan
//    - card.mustLayThisTurn = true (hanya kartu terdalam)

// ============================================================
//  CLOSE / TUTUPAN RULES
// ============================================================
//
//  Player menutup ronde ketika tangan = 0 kartu (setelah discard
//  terakhir). Setiap close → putaran ronde berikutnya dibalik
//  (clockwise ↔ counter-clockwise).
//
//  ┌──────────────────────────────────────────────────────────┐
//  │ RULE 1: CLOSE VIA CABUTAN (DECK)                         │
//  │   - Tidak ada bonus untuk closer                         │
//  │   - Tidak ada hukuman untuk siapapun                     │
//  │   - Putaran dibalik di ronde berikutnya                  │
//  └──────────────────────────────────────────────────────────┘
//  ┌──────────────────────────────────────────────────────────┐
//  │ RULE 2: CLOSE VIA BUANGAN (DISCARD)                      │
//  │   Cek kartu yang diambil:                                │
//  │     a) Bila hanya jadi TUTUPAN (di-discard balik, tidak  │
//  │        ada di combo turunan) → sama seperti cabutan:     │
//  │        no bonus, no penalty, putaran dibalik.            │
//  │     b) Bila JADI (masuk combo turunan di ronde yang sama │
//  │        giliran penutupan):                               │
//  │           Bonus closer  = (value closing card) × 10      │
//  │           Penyumbang kena hukuman:                       │
//  │             - Penyumbang ke-1: −(bonus_unit)             │
//  │             - Penyumbang ke-2: −(bonus_unit) − 50        │
//  │             - Penyumbang ke-3: −(bonus_unit) − 100       │
//  │           (escalating "tarikan" untuk multi-contributor) │
//  └──────────────────────────────────────────────────────────┘
//
//  Catatan rule 7: Jika closer ambil 3 kartu tapi cuma 2 yang
//  jadi (1 cuma tutupan), HANYA 2 penyumbang yang kena hukuman.
//  Penyumbang tutupan TIDAK kena.

function resolveCloseBonus(state) {
  const closedBy = state.closedBy;
  const helperDelta = {};
  let closingExtra = {};
  let bonusUnit = 0;
  let contArr = [];

  if (closedBy == null) return { helperDelta, closingExtra, bonusUnit, contributors: [] };

  const closingMethod = state.lastDrawnFrom || 'deck';
  if (closingMethod !== 'discard') {
    // Rule 1: cabutan close → no bonus
    return { helperDelta, closingExtra, bonusUnit, contributors: [] };
  }

  // Closing card value (kartu terakhir di discard pile)
  const discard = Array.isArray(state.discard) ? state.discard : Object.values(state.discard || {});
  const lastEntry = discard[discard.length - 1];
  const lastDiscardCard = (lastEntry && lastEntry.card) ? lastEntry.card : lastEntry;
  bonusUnit = (lastDiscardCard ? remiCardValue(lastDiscardCard) : 0) * 10;

  // Penyumbang giliran ini (lastPickupContributors)
  const rawContribs = state.lastPickupContributors || [];
  const pickupSeatsRaw = Array.isArray(rawContribs) ? rawContribs : Object.values(rawContribs);
  const pickupSeats = new Set(
    pickupSeatsRaw
      .map(s => (typeof s === 'string' ? Number(s) : s))
      .filter(s => s != null && !Number.isNaN(s) && s !== closedBy)
  );

  // Cek combo turunan closer: kartu yang diambil dari discard apakah masuk?
  const closerLaid = (state.laidDown && (state.laidDown[closedBy] || state.laidDown[String(closedBy)])) || [];
  const contributors = new Set();
  for (const combo of closerLaid) {
    const cards = Array.isArray(combo.cards) ? combo.cards : Object.values(combo.cards || {});
    for (const card of cards) {
      const origin = card ? card.fromDiscardBy : null;
      const originNum = (typeof origin === 'string') ? Number(origin) : origin;
      if (originNum == null || Number.isNaN(originNum) || originNum === closedBy) continue;
      // Fallback rule: (a) seat ada di lastPickupContributors, ATAU
      //                (b) kartu masih bertanda justPicked === true
      if (pickupSeats.has(originNum) || card.justPicked === true) {
        contributors.add(originNum);
      }
    }
  }

  // Urutan: clockwise dari closer
  contArr = Array.from(contributors).sort((a, b) =>
    ((a - closedBy) + MAX_PLAYERS) % MAX_PLAYERS -
    ((b - closedBy) + MAX_PLAYERS) % MAX_PLAYERS
  );

  const extraPenalty = [0, -50, -100];
  for (let ci = 0; ci < contArr.length; ci++) {
    const cseat = contArr[ci];
    const extra = (ci < extraPenalty.length) ? extraPenalty[ci] : -(50 * ci);
    helperDelta[cseat] = (helperDelta[cseat] || 0) - bonusUnit + extra;
    if (extra !== 0) closingExtra[cseat] = extra;
  }
  if (contArr.length > 0) {
    helperDelta[closedBy] = (helperDelta[closedBy] || 0) + bonusUnit;
  }
  return { helperDelta, closingExtra, bonusUnit, contributors: contArr };
}

// ============================================================
//  SCORING PER RONDE
// ============================================================
//
//  Round total per pemain =
//      handJadi        // POSITIF: kartu di tangan yang jadi combo
//    + handTidakJadi   // NEGATIF: kartu di tangan yang tidak jadi
//    + laidBonus       // POSITIF: total nilai combo yang sudah diturunkan
//    + helperDelta     // ± : close bonus/penalty (lihat resolveCloseBonus)
//
//  handJadi & handTidakJadi pakai joker-aware combo detection:
//  - Pure dasar / pararel dihitung dulu
//  - Joker mengisi gap / extend combo bila eligible
//  - Joker eligible bila player punya PURE DASAR (di meja atau di tangan)
//  - Joker di tangan yang tidak masuk combo manapun = −25 (dead)

function comboTotalValue(combo) {
  const cards = Array.isArray(combo.cards) ? combo.cards : Object.values(combo.cards || {});
  const nonJokers = cards.filter(c => c && c.rank !== 'JOKER');
  const jokerCount = cards.length - nonJokers.length;
  let total = 0;
  for (const c of nonJokers) total += remiCardValue(c);
  if (jokerCount === 0) return total;
  // Pararel atau 4-Aces dasar
  if (combo.kind === 'pararel' || (nonJokers.length && nonJokers.every(c => c.rank === nonJokers[0].rank))) {
    const r = nonJokers.length ? nonJokers[0].rank : null;
    total += (r ? remiRankValue(r) : 10) * jokerCount;
    return total;
  }
  // Dasar: joker mengisi gap internal dulu, lalu extend dalam band
  const ranks = nonJokers
    .filter(c => c.rank !== 'A')
    .map(c => REMI_RANK_NUM[c.rank])
    .sort((a, b) => a - b);
  if (ranks.length === 0) return total + 10 * jokerCount;
  const lo = ranks[0], hi = ranks[ranks.length - 1];
  const present = new Set(ranks);
  const assigned = [];
  let remaining = jokerCount;
  // 1) Internal gaps
  for (let r = lo + 1; r < hi && remaining > 0; r++) {
    if (!present.has(r)) { assigned.push(r); present.add(r); remaining--; }
  }
  // 2) Extend within band
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

// ============================================================
//  STUCK RULE
// ============================================================
//
//  Setelah draw + lay, bila SEMUA kartu di tangan tidak bisa dibuang
//  (karena A tanpa dasar, joker tanpa deck-empty/closing, dll), ronde
//  berakhir karena STUCK.
//  - Player stuck = minus total nilai kartu di tangan
//  - Player lain  = round delta = 0

// ============================================================
//  RANK / BABU SYSTEM
// ============================================================
//
//  - Ranking dihitung mulai RONDE 2 (ronde 1 belum ada ranking)
//  - Rank 4 = pemain dengan skor TERENDAH (semua yang seri di rank
//    terendah tetap dianggap rank 4)
//  - Rank 4 berturut 4 kali → BABU SEJATI (event toast, non-permanent)
//  - Rank 4 berturut 10 kali → BABU ABADI (permanent flag)
//  - Rank 4 di awal ronde (manusia) WAJIB klik deck 20× untuk "kocok"
//  - Semua pemain seri rank 4 wajib kocok bergantian

// ============================================================
//  MATCH-OVER CONDITIONS
// ============================================================
//
//  Match selesai bila SALAH SATU terpenuhi:
//    1. Ronde mencapai ROUND_CAP (20)
//    2. Ada pemain dengan skor ≥ +1000  → popup "terlalu jago"
//    3. Ada pemain dengan skor ≤ −1000  → popup "cupu banget"
//
//  Match valid untuk leaderboard ranking:
//    - Min 10 ronde (atau bila berakhir karena ±1000, semua valid)
//    - Tidak ada bot di pemain
//    - Semua pemain terdaftar (username ada)
//  RANK_POINTS [1st, 2nd, 3rd, 4th] = [4, 3, 2, 1]
//  Bonus tiap 5 match selesai = +5 untuk semua pemain valid

// ============================================================
//  TURN DIRECTION
// ============================================================
//
//  Default: clockwise (south → west → north → east → south)
//  Direction value: +1 (clockwise) / −1 (counter-clockwise)
//  Setiap CLOSE (rule 1 atau 2) → direction di-flip di ronde berikutnya
//  Deck-empty / stuck end → direction tidak berubah

// ============================================================
//  DEAL / NEXT ROUND
// ============================================================
//
//  Tiap ronde:
//    - Generate fresh 56-card deck
//    - Bagi 7 kartu untuk setiap pemain
//    - Pemain pertama (firstPlayer = rank 4 sebelumnya) dapat 1
//      kartu tambahan dari deck (jadi 8 kartu)
//    - Player pertama mulai di phase 'discard' (tidak perlu draw)
//    - Player lain mulai di phase 'draw' saat giliran mereka
//    - reset laidDown, discard, helperDelta, dst.

// ============================================================
//  EXPORT (untuk Node.js / module usage)
// ============================================================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SUITS, RANKS, MAX_PLAYERS, ROUND_CAP, SCORE_CAP, REMI_RANK_NUM,
    remiCardValue, remiRankValue,
    generateCekiDeck,
    isValidDasar, isValidPararel, isPureRemiCombo,
    comboTotalValue,
    resolveCloseBonus,
  };
}
