# Aturan Main Game Remi — Main Kartu

> Versi standalone berisi seluruh aturan, validator combo, dan fungsi scoring untuk game Remi. Di-extract dari `truf-multiplayer-v3.html`.

- **Deck**: 52 kartu standar + 4 JOKER (2 merah + 2 hitam) = **56 kartu**
- **Pemain**: 4 (fixed)
- **Tujuan**: habiskan kartu di tangan dengan menurunkan combo (DASAR / PARAREL) dan menutup (close) ronde.

---

## 1. Konstanta Deck & Rank

```js
const SUITS = ['S', 'H', 'D', 'C'];                // Spades, Hearts, Diamonds, Clubs
const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const MAX_PLAYERS = 4;
const ROUND_CAP   = 20;     // match selesai di ronde ke-20
const SCORE_CAP   = 1000;   // match selesai bila ada player ≥ +1000 atau ≤ −1000

const REMI_RANK_NUM = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
  'J': 11, 'Q': 12, 'K': 13, 'A': 14
};
```

A = 14 untuk sorting, tapi A **TIDAK** dapat membentuk sequence (kecuali kasus khusus 4-Aces).

---

## 2. Poin per Kartu

| Kartu | Nilai |
|-------|-------|
| Angka 2..10 | **5** |
| J / Q / K | **10** |
| A | **15** |
| JOKER | **25** (atau sesuai kartu yang digantikan dalam combo) |

```js
function remiCardValue(card) {
  if (card.rank === 'JOKER') return 25;
  if (card.rank === 'A') return 15;
  if (card.rank === 'K' || card.rank === 'Q' || card.rank === 'J') return 10;
  return 5;
}

// Joker substitute: ambil nilai kartu yang digantikan
function remiRankValue(rank) {
  const n = (typeof rank === 'number') ? rank : REMI_RANK_NUM[rank];
  if (n === 14) return 15;            // A
  if (n >= 11 && n <= 13) return 10;  // J/Q/K
  return 5;                           // 2..10
}
```

---

## 3. Generate Deck

```js
function generateCekiDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ rank: r, suit: s });
  deck.push({ rank: 'JOKER', suit: null, color: 'red' });
  deck.push({ rank: 'JOKER', suit: null, color: 'red' });
  deck.push({ rank: 'JOKER', suit: null, color: 'black' });
  deck.push({ rank: 'JOKER', suit: null, color: 'black' });
  // Fisher-Yates shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
```

---

## 4. Combo Rules

Ada **2 jenis combo** (turunan):

### DASAR (sequence)
- Min **3 kartu**, max **4 kartu**
- Suit **sama**, rank **berurutan** dalam **1 BAND saja**:
  - Number band: `2..10`
  - Face band: `J..K`
- **A TIDAK** dapat ikut sequence (kecuali 4-Aces khusus)
- Special case: **4-Aces** (1 setiap suit) = dasar valid
- Joker dapat substitute (max **1 joker per combo**)

```js
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
  if (nonJokers.some(c => c.rank === 'A')) return false;
  const suit = nonJokers[0].suit;
  if (!nonJokers.every(c => c.suit === suit)) return false;
  const ranks = nonJokers.map(c => REMI_RANK_NUM[c.rank]).sort((a, b) => a - b);
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
  if (high <= 10) { canExtendLow = low - 2;  canExtendHigh = 10 - high; }
  else            { canExtendLow = low - 11; canExtendHigh = 13 - high; }
  return extraJokers <= canExtendLow + canExtendHigh;
}
```

### PARAREL (same-rank set)
- Min **3 kartu**, max **4 kartu**
- Rank **sama**, suit **BERBEDA** (tidak duplikat)
- Joker dapat substitute (max **1 joker per combo**)
- **HANYA** bisa diturunkan kalau player sudah punya dasar (di tangan atau di meja)

```js
function isValidPararel(cards) {
  if (!cards || cards.length < 3 || cards.length > 4) return false;
  const nonJokers = cards.filter(c => c && c.rank !== 'JOKER');
  if (nonJokers.length === 0) return false;
  const rank = nonJokers[0].rank;
  if (!nonJokers.every(c => c.rank === rank)) return false;
  const suits = new Set(nonJokers.map(c => c.suit));
  return suits.size === nonJokers.length;
}
```

### Pure Combo
```js
function isPureRemiCombo(co) {
  if (!co) return false;
  const cards = Array.isArray(co.cards) ? co.cards : Object.values(co.cards || {});
  return cards.length > 0 && !cards.some(c => c && c.rank === 'JOKER');
}
```

---

## 5. Aturan Pembatasan Buangan (Discard)

- **A** hanya boleh dibuang **bila player sudah turunkan dasarnya sendiri** (no exception)
- **JOKER** hanya boleh dibuang bila:
  - (a) cangkulan (deck) sudah habis, **ATAU**
  - (b) kartu tersebut adalah kartu penutup (closing card)
- Kartu yang baru diambil dari buangan (`mustLayThisTurn`) **WAJIB** diturunkan sebagai combo sebelum boleh discard

---

## 6. Aturan Pengambilan Kartu (Draw / Pickup)

Setiap giliran: **DRAW → (LAY combo opsional) → DISCARD**

DRAW dapat dari:
1. **CANGKULAN** (deck) — ambil 1 kartu teratas
2. **BUANGAN** (discard pile) — ambil 1..N kartu dari TOP
   - Kartu **TERDALAM** (deepest) **WAJIB** diturunkan ke combo
   - Combo yang berisi kartu terdalam minimal **≥2 kartu dari tangan sendiri** (rule "min 2 own cards")

Pengambilan ini di-tag dengan:
- `card.fromDiscardBy` = seat asli yang membuang (untuk tracking contributor saat close)
- `card.justPicked` = `true`
- `card.justPickedSeq` = order pengambilan
- `card.mustLayThisTurn` = `true` (hanya kartu terdalam)

---

## 7. Close / Tutupan Rules ⭐ KUNCI

Player **menutup** ronde ketika tangan = 0 kartu (setelah discard terakhir). Setiap close → putaran ronde berikutnya **dibalik** (clockwise ↔ counter-clockwise).

### Rule 1: Close via CABUTAN (Deck)
- Tidak ada bonus untuk closer
- Tidak ada hukuman untuk siapapun
- Putaran dibalik di ronde berikutnya

### Rule 2: Close via BUANGAN (Discard)

Cek kartu yang diambil:

**(a)** Bila kartu hanya **jadi TUTUPAN** (di-discard balik, tidak ada di combo turunan) → sama seperti cabutan: no bonus, no penalty, putaran dibalik.

**(b)** Bila kartu **JADI** (masuk combo turunan di ronde yang sama giliran penutupan):

| Penyumbang ke- | Hukuman |
|----------------|---------|
| 1 | `−(bonus_unit)` |
| 2 | `−(bonus_unit) − 50` |
| 3 | `−(bonus_unit) − 100` |

`bonus_unit = (value closing card) × 10`, dan **closer dapat `+bonus_unit`**.

### Edge case
- **Multi-pick partial-jadi**: closer ambil 3 kartu tapi cuma 2 yang jadi (1 cuma tutupan) → hanya 2 penyumbang yang kena. Penyumbang tutupan **TIDAK** kena.
- **Picked own card**: kartu yang dipick adalah discard milik sendiri (`fromDiscardBy === closer`) → tidak masuk contributor.
- **Joker closing**: bila closing card adalah JOKER (value 25), bonus_unit = 250.

```js
function resolveCloseBonus(state) {
  const closedBy = state.closedBy;
  const helperDelta = {};
  let closingExtra = {};
  let bonusUnit = 0;
  let contArr = [];

  if (closedBy == null) return { helperDelta, closingExtra, bonusUnit, contributors: [] };

  const closingMethod = state.lastDrawnFrom || 'deck';
  if (closingMethod !== 'discard') {
    return { helperDelta, closingExtra, bonusUnit, contributors: [] }; // rule 1
  }

  const discard = Array.isArray(state.discard) ? state.discard : Object.values(state.discard || {});
  const lastEntry = discard[discard.length - 1];
  const lastDiscardCard = (lastEntry && lastEntry.card) ? lastEntry.card : lastEntry;
  bonusUnit = (lastDiscardCard ? remiCardValue(lastDiscardCard) : 0) * 10;

  const rawContribs = state.lastPickupContributors || [];
  const pickupSeatsRaw = Array.isArray(rawContribs) ? rawContribs : Object.values(rawContribs);
  const pickupSeats = new Set(
    pickupSeatsRaw
      .map(s => (typeof s === 'string' ? Number(s) : s))
      .filter(s => s != null && !Number.isNaN(s) && s !== closedBy)
  );

  const closerLaid = (state.laidDown && (state.laidDown[closedBy] || state.laidDown[String(closedBy)])) || [];
  const contributors = new Set();
  for (const combo of closerLaid) {
    const cards = Array.isArray(combo.cards) ? combo.cards : Object.values(combo.cards || {});
    for (const card of cards) {
      const origin = card ? card.fromDiscardBy : null;
      const originNum = (typeof origin === 'string') ? Number(origin) : origin;
      if (originNum == null || Number.isNaN(originNum) || originNum === closedBy) continue;
      if (pickupSeats.has(originNum) || card.justPicked === true) {
        contributors.add(originNum);
      }
    }
  }

  // Urutan clockwise dari closer
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
```

---

## 8. Scoring per Ronde

Round total per pemain dihitung sebagai:

```
round_total =
    handJadi        // POSITIF: kartu di tangan yang jadi combo
  + handTidakJadi   // NEGATIF: kartu di tangan yang tidak jadi
  + laidBonus       // POSITIF: total nilai combo yang sudah diturunkan
  + helperDelta     // ± : close bonus/penalty (lihat resolveCloseBonus)
```

`handJadi` & `handTidakJadi` pakai joker-aware combo detection:
- Pure dasar / pararel dihitung dulu
- Joker mengisi gap / extend combo bila eligible
- Joker eligible bila player punya **PURE DASAR** (di meja atau di tangan)
- Joker di tangan yang tidak masuk combo manapun = **−25** (dead)

### Combo value (joker-aware)

Joker dihargai sesuai rank yang digantikan, **bukan flat 25**:
- Pararel: joker = rank pararel-nya
- Dasar: joker mengisi gap internal dulu, lalu extend dalam band

```js
function comboTotalValue(combo) {
  const cards = Array.isArray(combo.cards) ? combo.cards : Object.values(combo.cards || {});
  const nonJokers = cards.filter(c => c && c.rank !== 'JOKER');
  const jokerCount = cards.length - nonJokers.length;
  let total = 0;
  for (const c of nonJokers) total += remiCardValue(c);
  if (jokerCount === 0) return total;

  // Pararel atau 4-Aces dasar
  if (combo.kind === 'pararel' ||
      (nonJokers.length && nonJokers.every(c => c.rank === nonJokers[0].rank))) {
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

  // 2) Extend dalam band
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
```

---

## 9. Stuck Rule

Setelah draw + lay, bila SEMUA kartu di tangan tidak bisa dibuang (karena A tanpa dasar, joker tanpa deck-empty/closing, dll), ronde berakhir karena **STUCK**.

- Player stuck = minus total nilai kartu di tangan
- Player lain = round delta = 0
- Tidak ada turn reversal untuk stuck end

---

## 10. Rank / Babu System

- Ranking dihitung mulai **RONDE 2** (ronde 1 belum ada ranking)
- Rank 4 = pemain dengan skor TERENDAH (semua yang seri di rank terendah tetap dianggap rank 4)
- Rank 4 berturut **4 kali** → **BABU SEJATI** (event toast, non-permanent)
- Rank 4 berturut **10 kali** → **BABU ABADI** (permanent flag)
- Rank 4 di awal ronde (manusia) **WAJIB klik deck 20× untuk "kocok"** sebelum ronde mulai
- Semua pemain seri rank 4 wajib kocok bergantian

---

## 11. Match-Over Conditions

Match selesai bila SALAH SATU terpenuhi:
1. Ronde mencapai `ROUND_CAP` (20)
2. Ada pemain dengan skor **≥ +1000** → popup "terlalu jago"
3. Ada pemain dengan skor **≤ −1000** → popup "cupu banget"

### Match valid untuk leaderboard ranking:
- Min 10 ronde (atau bila berakhir karena ±1000, semua valid)
- Tidak ada bot di pemain
- Semua pemain terdaftar (username ada)

### Rank points untuk leaderboard:
```js
RANK_POINTS = [4, 3, 2, 1]; // [1st, 2nd, 3rd, 4th]
```

Bonus tiap 5 match selesai = +5 untuk semua pemain valid.

---

## 12. Turn Direction

- Default: **clockwise** (south → west → north → east → south)
- Direction value: `+1` (clockwise) / `−1` (counter-clockwise)
- **Setiap CLOSE** (rule 1 atau 2) → direction di-flip di ronde berikutnya
- Deck-empty / stuck end → direction **tidak berubah**

---

## 13. Deal / Next Round

Tiap ronde:
- Generate fresh 56-card deck
- Bagi **7 kartu** untuk setiap pemain
- Pemain pertama (firstPlayer = rank 4 sebelumnya) dapat **1 kartu tambahan** dari deck (jadi 8 kartu)
- Player pertama mulai di phase `'discard'` (tidak perlu draw)
- Player lain mulai di phase `'draw'` saat giliran mereka
- Reset `laidDown`, `discard`, `helperDelta`, dll.

---

## 14. State Schema (Firebase)

```js
room.remi = {
  hands: { 0: [...], 1: [...], 2: [...], 3: [...] },  // tangan per seat
  deck: [...],                                          // sisa cangkulan
  discard: [{ card, by }, ...],                         // buangan + asal
  laidDown: { 0: [combo, ...], 1: [...], ... },        // combo turunan per seat
  currentPlayer: 0..3,
  turnPhase: 'draw' | 'discard',
  sessionNumber: 1, 2, ...,
  roundNumber: 1..20,
  turnCount: 0..N,
  direction: +1 | -1,
  shuffling: { seats: [], current, seat, need, done } | null,
  babuStreak: { 0..3: streak_count },
  babuAbadi: { 0..3: true },
  babuEvent: { type, seat, ... } | null,
  closedBy: seat | null,
  closeNoBonus: boolean,
  cekiDeclared: { 0..3: true },
  cekiArmed: { 0..3: true },
  handPenalty: { 0..3: value },
  handJadi: { 0..3: value },
  handTidakJadi: { 0..3: value },
  laidBonus: { 0..3: value },
  helperDelta: { 0..3: value },
  closingExtra: { 0..3: extra },
  endReason: 'closed' | 'deck_empty' | 'stuck' | null,
  lastDrawnBy: seat | null,
  lastDrawnCard: card | null,
  lastDrawnFrom: 'deck' | 'discard' | null,
  lastDiscardBy: seat | null,
  lastPickupContributors: [seat, ...],
  matchOver: boolean,
  matchOverReason: 'points' | 'rounds' | null,
};

room.totals = { 0..3: total_score };
```

---

## 15. File Terkait

- **Source utama**: `truf-multiplayer-v3.html` (single-file app)
- **Code standalone**: `docs/remi-rules.js`
- **Test scenarios**: `tests/remi-close-scenarios.py` (14 skenario close, run dengan `python3`)

---

> **Catatan**: Setiap ubah scoring/tutupan/close logic, **WAJIB rerun** `python3 tests/remi-close-scenarios.py` untuk regression check.
