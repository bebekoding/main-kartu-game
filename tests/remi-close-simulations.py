#!/usr/bin/env python3
"""
Simulasi & AUDIT tutupan Remi — memakai logika close yang sama dengan game
(tests/remi_close_logic.py, port dari truf-multiplayer-v3.html).

Menjalankan beragam skenario tutupan:
  1. Cabutan (deck close)
  2. Buangan tapi kartu yang diambil cuma jadi tutupan (no penyumbang)
  3. Buangan dengan 1 penyumbang (single & multi pull)
  4. Buangan dengan >1 penyumbang
  5. Sweep nilai kartu tutupan (angka/gambar/As/Joker)

Setiap simulasi diaudit: helperDelta hasil vs ekspektasi manual.

Run: python3 tests/remi-close-simulations.py
"""

from remi_close_logic import resolve_close, remi_card_value  # noqa: F401

# Seat map: P1=0  P2=1  P3=2 (closer di sebagian besar skenario)  P4=3
P1, P2, P3, P4 = 0, 1, 2, 3
NAMES = {0: 'P1', 1: 'P2', 2: 'P3', 3: 'P4'}


def C(rank, suit):
    return {'rank': rank, 'suit': suit}


def JK():
    return {'rank': 'JOKER', 'color': 'red'}


def contrib(card, from_seat, seq, nonce='N1'):
    """Kartu yang diambil closer turn ini dari `from_seat`, di-lay (penyumbang)."""
    out = dict(card)
    out['fromDiscardBy'] = from_seat
    out['justPickedSeq'] = seq
    out['pickupNonce'] = nonce
    return out


def own(card, seq=None, nonce='N1'):
    """Kartu milik closer sendiri di combo (bukan penyumbang)."""
    out = dict(card)
    if seq is not None:
        out['fromDiscardBy'] = P3  # = closer → di-skip oleh detektor
        out['justPickedSeq'] = seq
        out['pickupNonce'] = nonce
    return out


def combo(kind, cards):
    return {'kind': kind, 'cards': cards}


def de(card, by):
    return {'card': card, 'by': by}


PASS = 0
FAIL = 0


def card_label(card):
    if not card:
        return '—'
    if card.get('rank') == 'JOKER':
        return 'Joker'
    suit_sym = {'S': '♠', 'H': '♥', 'D': '♦', 'C': '♣'}.get(card.get('suit'), card.get('suit', ''))
    return f"{card.get('rank')}{suit_sym}"


def audit(title, closing_card, method, state, expected_delta):
    """Jalankan resolve_close, cetak audit, bandingkan helperDelta vs ekspektasi."""
    global PASS, FAIL
    res = resolve_close(state)
    got = {int(k): v for k, v in res['helperDelta'].items()}
    exp = {int(k): v for k, v in expected_delta.items()}
    # Normalisasi: hanya bandingkan seat dengan nilai != 0
    got_nz = {k: v for k, v in got.items() if v != 0}
    exp_nz = {k: v for k, v in exp.items() if v != 0}
    ok = got_nz == exp_nz
    PASS += 1 if ok else 0
    FAIL += 0 if ok else 1

    val = remi_card_value(closing_card)
    kind = ('angka' if val == 5 else 'gambar' if val == 10 else 'As' if val == 15 else 'Joker')
    print(f"\n{'✅' if ok else '❌'} {title}")
    print(f"   Metode: {method}  ·  Kartu tutupan: {card_label(closing_card)} "
          f"({kind} {val}×10 = bonus_unit {res['bonusUnit']})")
    print(f"   closeNoBonus={res['closeNoBonus']}  contributors={[NAMES[s] for s in res['contributors']]}")
    # Per-seat breakdown
    seats = sorted(set(list(got.keys()) + list(exp.keys()) + [P1, P2, P3, P4]))
    for s in seats:
        g = got.get(s, 0)
        e = exp.get(s, 0)
        role = '(closer)' if g > 0 else '(ditutup)' if g < 0 else ''
        flag = '' if g == e else f'  ← EXPECTED {e:+d}'
        if g != 0 or e != 0:
            print(f"     {NAMES[s]}: helperDelta {g:+d} {role}{flag}")
    if not ok:
        print(f"   ❌ MISMATCH  got={got_nz}  expected={exp_nz}")


# =====================================================================
# SIM 1 — CABUTAN (deck close). Tidak ada bonus / hukuman.
# Closing card K♠ (gambar) — nilainya TIDAK dipakai karena cabutan.
# =====================================================================
audit(
    'SIM 1 — Cabutan (deck close)',
    C('K', 'S'), 'cabutan/deck',
    {
        'closedBy': P3, 'lastDrawnFrom': 'deck',
        'lastPickupNonce': None, 'lastPickupDepth': 0,
        'discard': [de(C('K', 'S'), P3)],
        'laidDown': {P1: [], P2: [], P3: [], P4: []},
    },
    {P1: 0, P2: 0, P3: 0, P4: 0},  # semua 0
)

# =====================================================================
# SIM 2 — BUANGAN tapi kartu yang diambil cuma jadi TUTUPAN (no penyumbang).
# Closer ambil A♥ dari P1, tidak di-lay, malah jadi closing card.
# → tidak ada penyumbang scoring → closeNoBonus, no bonus.
# Closing card A♥ (As, 150) — bonus_unit dihitung tapi tidak dipakai.
# =====================================================================
audit(
    'SIM 2 — Buangan, kartu hanya jadi tutupan (no penyumbang)',
    C('A', 'H'), 'buangan/discard',
    {
        'closedBy': P3, 'lastDrawnFrom': 'discard',
        'lastPickupNonce': 'N1', 'lastPickupDepth': 1,
        'discard': [de({'rank': 'A', 'suit': 'H', 'fromDiscardBy': P1}, P3)],
        'laidDown': {P1: [], P2: [], P3: [], P4: []},  # tidak ada combo dengan nonce N1
    },
    {P1: 0, P2: 0, P3: 0, P4: 0},
)

# =====================================================================
# SIM 3 — BUANGAN, 1 penyumbang, SINGLE PULL (pull_depth=1 → no tarikan).
# Closer ambil 1 kartu (7♠ dari P2), di-lay jadi dasar 7♠8♠9♠, tutup dgn 7♣.
# Closing 7♣ (angka, 50). pull_depth=1 → P2 base only −50. Closer +50.
# =====================================================================
audit(
    'SIM 3 — Buangan, 1 penyumbang, single pull',
    C('7', 'C'), 'buangan/discard',
    {
        'closedBy': P3, 'lastDrawnFrom': 'discard',
        'lastPickupNonce': 'N1', 'lastPickupDepth': 1,
        'discard': [de(C('7', 'C'), P3)],
        'laidDown': {
            P1: [], P2: [], P4: [],
            P3: [combo('dasar', [
                contrib(C('7', 'S'), P2, seq=0),
                own(C('8', 'S')), own(C('9', 'S')),
            ])],
        },
    },
    {P2: -50, P3: +50},
)

# =====================================================================
# SIM 4 — BUANGAN, 1 penyumbang, MULTI PULL (pull_depth=2).
# Closer ambil 2 kartu: K♥(P2) di atas (seq0) + 10♥(own deepest, seq1).
# Lay J♥-Q♥-K♥... pakai K♥ dari P2. Tutup dgn Q♦.
# Closing Q♦ (gambar, 100). P2 seq0 → −100 tarikan. P2 = −100−100 = −200. Closer +100.
# =====================================================================
audit(
    'SIM 4 — Buangan, 1 penyumbang, multi pull (tarikan −100)',
    C('Q', 'D'), 'buangan/discard',
    {
        'closedBy': P3, 'lastDrawnFrom': 'discard',
        'lastPickupNonce': 'N1', 'lastPickupDepth': 2,
        'discard': [de(C('Q', 'D'), P3)],
        'laidDown': {
            P1: [], P2: [], P4: [],
            P3: [combo('dasar', [
                contrib(C('K', 'H'), P2, seq=0),   # dari P2, paling atas
                own(C('J', 'H')), own(C('Q', 'H')),
            ])],
        },
    },
    {P2: -200, P3: +100},
)

# =====================================================================
# SIM 5 — BUANGAN, 2 penyumbang, closing = JOKER (250).
# pull_depth=3: seq0=5♠(P1), seq1=5♥(P2) → pararel, seq2=own deepest.
# Closing Joker → bonus 250. P1 seq0 −100, P2 seq1 −50.
# P1 = −250−100 = −350 · P2 = −250−50 = −300 · Closer +250.
# =====================================================================
audit(
    'SIM 5 — Buangan, 2 penyumbang, closing Joker',
    JK(), 'buangan/discard',
    {
        'closedBy': P3, 'lastDrawnFrom': 'discard',
        'lastPickupNonce': 'N1', 'lastPickupDepth': 3,
        'discard': [de(JK(), P3)],
        'laidDown': {
            P1: [], P2: [], P4: [],
            P3: [combo('pararel', [
                contrib(C('5', 'S'), P1, seq=0),   # P1 paling atas
                contrib(C('5', 'H'), P2, seq=1),   # P2 di tengah
                own(C('5', 'C'), seq=2),           # own deepest
            ])],
        },
    },
    {P1: -350, P2: -300, P3: +250},
)

# =====================================================================
# SIM 6 — BUANGAN, 3 penyumbang, closing = 10♠ (angka, 50).
# pull_depth=3: seq0=3♠(P1), seq1=7♥(P2), seq2=Q♣(P4) di 3 combo berbeda.
# Closing 10♠ (own, angka 50). P1 seq0 −100, P2 seq1 −50, P4 seq2 0.
# P1 = −150 · P2 = −100 · P4 = −50 · Closer +50.
# =====================================================================
audit(
    'SIM 6 — Buangan, 3 penyumbang, closing angka (10)',
    C('10', 'S'), 'buangan/discard',
    {
        'closedBy': P3, 'lastDrawnFrom': 'discard',
        'lastPickupNonce': 'N1', 'lastPickupDepth': 3,
        'discard': [de(C('10', 'S'), P3)],
        'laidDown': {
            P1: [], P2: [], P4: [],
            P3: [
                combo('dasar', [contrib(C('3', 'S'), P1, seq=0), own(C('4', 'S')), own(C('5', 'S'))]),
                combo('dasar', [contrib(C('7', 'H'), P2, seq=1), own(C('8', 'H')), own(C('9', 'H'))]),
                combo('pararel', [contrib(C('Q', 'C'), P4, seq=2), own(C('Q', 'H')), own(C('Q', 'D'))]),
            ],
        },
    },
    {P1: -150, P2: -100, P4: -50, P3: +50},
)

# =====================================================================
# SIM 7 — SWEEP nilai kartu tutupan (1 penyumbang, single pull, no tarikan).
# Membuktikan bonus_unit = nilai × 10 untuk tiap jenis kartu.
# =====================================================================
print("\n" + "=" * 60)
print("SIM 7 — Sweep nilai kartu tutupan (1 penyumbang, single pull)")
print("=" * 60)
for label, card, exp_bonus in [
    ('angka 5♠', C('5', 'S'), 50),
    ('angka 10♥', C('10', 'H'), 50),
    ('gambar J♣', C('J', 'C'), 100),
    ('gambar K♦', C('K', 'D'), 100),
    ('As A♠', C('A', 'S'), 150),
    ('Joker', JK(), 250),
]:
    audit(
        f'SIM 7 — closing {label}',
        card, 'buangan/discard',
        {
            'closedBy': P3, 'lastDrawnFrom': 'discard',
            'lastPickupNonce': 'N1', 'lastPickupDepth': 1,
            'discard': [de(card, P3)],
            'laidDown': {
                P1: [], P2: [], P4: [],
                P3: [combo('dasar', [
                    contrib(C('4', 'C'), P2, seq=0), own(C('5', 'C')), own(C('6', 'C')),
                ])],
            },
        },
        {P2: -exp_bonus, P3: +exp_bonus},
    )

# =====================================================================
# SIM 8 — BUANGAN, closing As, 2 PENYUMBANG (depth=2). Kasus nyata yang
# dilaporkan: tutup pakai As, 2 orang menyumbang.
#   seq0 (P1, paling atas) → tarikan -100 → 150 + 100 = -250
#   seq1 (P2, di bawahnya) → tarikan -50  → 150 + 50  = -200
# Tarikan TETAP AKTIF untuk kedua penyumbang. Closer +150.
# =====================================================================
audit(
    'SIM 8 — Buangan, closing As, 2 penyumbang (depth 2 → -250 & -200)',
    C('A', 'S'), 'buangan/discard',
    {
        'closedBy': P3, 'lastDrawnFrom': 'discard',
        'lastPickupNonce': 'N1', 'lastPickupDepth': 2,
        'discard': [de(C('A', 'S'), P3)],
        'laidDown': {
            P1: [], P2: [], P4: [],
            P3: [
                combo('pararel', [
                    contrib(C('5', 'S'), P1, seq=0),   # paling atas → -100
                    own(C('5', 'H')), own(C('5', 'C')),
                ]),
                combo('dasar', [
                    contrib(C('7', 'S'), P2, seq=1),   # di bawahnya → -50
                    own(C('8', 'S')), own(C('9', 'S')),
                ]),
            ],
        },
    },
    {P1: -250, P2: -200, P3: +150},
)

# =====================================================================
print("\n" + "=" * 60)
print(f"AUDIT SELESAI  ·  Pass: {PASS}  ·  Fail: {FAIL}")
print("=" * 60)
exit(1 if FAIL else 0)
