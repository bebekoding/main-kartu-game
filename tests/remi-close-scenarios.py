#!/usr/bin/env python3
"""
Test harness untuk close detection di Remi.
Port dari logic maybeResolveRemiRound (truf-multiplayer-v3.html) ke Python
untuk verifikasi semua skenario close tanpa Firebase / browser.

Rule (revisi terbaru):
  - Cabutan close (lastDrawnFrom='deck'): no bonus, no penalty.
  - Discard close (lastDrawnFrom='discard'):
      bonus_unit = nilai kartu tutupan × 10
      Penyumbang = laid card di combo CLOSER yang punya pickupNonce sama
                   dengan lastPickupNonce (gate "this turn only"). Kartu yang
                   diambil tapi tidak jadi (tetap di tangan atau dibuang
                   sebagai closing card) TIDAK masuk hitungan.
      Schedule extra by URUTAN PULL DI DISCARD (justPickedSeq), BUKAN seat:
          seq 0 (top, paling baru dibuang = ke-1)  → −100
          seq 1 (tengah, ke-2)                      → −50
          seq 2+ (paling dalam, anchor = ke-3+)     → 0
      Per seat: ambil extra terparah (max 1× per seat).
      Special case: pull_depth = 1 → semua extra = 0 (no tarikan, base only).
      Closer:      +bonus_unit (sekali, hanya jika ada ≥1 penyumbang)
      Penyumbang:  −bonus_unit + extra
      Jika 0 penyumbang → no bonus / no penalty.

Run: python3 tests/remi-close-scenarios.py
"""

from remi_close_logic import MAX_PLAYERS, remi_card_value, resolve_close  # noqa: F401


# ===== Test utilities =====
PASS = 0
FAIL = 0
FAILURES = []


def picked(card, from_seat, seq=0, must_lay=False, nonce='N1'):
    out = dict(card)
    out['fromDiscardBy'] = from_seat
    out['justPicked'] = True
    out['justPickedSeq'] = seq
    out['pickupNonce'] = nonce
    if must_lay:
        out['mustLayThisTurn'] = True
    return out


def own(card):
    return dict(card)


def discard_entry(card, by):
    return {'card': card, 'by': by}


def combo(kind, cards):
    return {'kind': kind, 'cards': cards}


def run_test(name, state, expected):
    global PASS, FAIL
    actual = resolve_close(state)
    diffs = {}
    for key, exp_val in expected.items():
        act_val = actual.get(key)
        if act_val != exp_val:
            diffs[key] = (exp_val, act_val)
    if not diffs:
        PASS += 1
        print(f'  ✅ {name}')
    else:
        FAIL += 1
        FAILURES.append((name, diffs, actual, expected))
        print(f'  ❌ {name}')
        for k, (e, a) in diffs.items():
            print(f'     {k:14} expected={e!r}  actual={a!r}')


# =================================================================
# SCENARIO 1: Cabutan (deck) close → no bonus, no penalty
# =================================================================
print('\n📦 Scenario 1: Close via cabutan (deck)')
run_test('cabutan close: no bonus + reversal', {
    'closedBy': 0,
    'lastDrawnFrom': 'deck',
    'lastPickupNonce': None,
    'lastPickupDepth': 0,
    'discard': [discard_entry({'rank': '5', 'suit': '♠'}, 0)],
    'laidDown': {0: [], 1: [], 2: [], 3: []},
}, {
    'closingMethod': 'deck',
    'bonusUnit': 0,
    'contributors': [],
    'helperDelta': {},
    'closingExtra': {},
    'closeNoBonus': True,
    'reverseNextRound': True,
})

# =================================================================
# SCENARIO 2: Discard close, picked card jadi tutupan (no laid)
# =================================================================
print('\n📦 Scenario 2: Close via discard, picked card = tutupan only')
run_test('discard close, no lay (card jadi tutupan)', {
    'closedBy': 0,
    'lastDrawnFrom': 'discard',
    'lastPickupNonce': 'N1',
    'lastPickupDepth': 1,
    'discard': [discard_entry({'rank': 'K', 'suit': '♥', 'fromDiscardBy': 2}, 0)],
    'laidDown': {0: [], 1: [], 2: [], 3: []},
}, {
    'closingMethod': 'discard',
    'bonusUnit': 100,
    'contributors': [],
    'helperDelta': {},
    'closingExtra': {},
    'closeNoBonus': True,
    'reverseNextRound': True,
})

# =================================================================
# SCENARIO 3: 1 contributor, single-pull → no extra tarikan
# closer=1, pull_depth=1, 1 contrib seat 0 (deepest=only=anchor).
# bonus=50 (5♣). helper[0] = -50 (base only), helper[1] = +50.
# =================================================================
print('\n📦 Scenario 3: 1 contributor, single pull (no tarikan)')
run_test('discard close, 1 contributor single-pull (base only)', {
    'closedBy': 1,
    'lastDrawnFrom': 'discard',
    'lastPickupNonce': 'N1',
    'lastPickupDepth': 1,
    'discard': [discard_entry({'rank': '5', 'suit': '♣'}, 1)],
    'laidDown': {
        0: [], 2: [], 3: [],
        1: [combo('dasar', [
            picked({'rank': '7', 'suit': '♠'}, 0, seq=0, must_lay=True),
            own({'rank': '8', 'suit': '♠'}),
            own({'rank': '9', 'suit': '♠'}),
        ])],
    },
}, {
    'closingMethod': 'discard',
    'bonusUnit': 50,
    'contributors': [0],
    'helperDelta': {0: -50, 1: 50},
    'closingExtra': {},
    'closeNoBonus': False,
    'reverseNextRound': True,
})

# =================================================================
# SCENARIO 4: 2 contributors, pull_depth=2.
# closer=2. 5♠ seq 0 (top, P0), 10♦ seq 1 (deepest mustLay, P3).
# bonus=100 (J♦).
# Schedule by tumpukan-position dari atas (konsisten depth apa pun):
#   P0 (seq 0, ke-1) → extra -100 → helper[0] = -100 -100 = -200
#   P3 (seq 1, ke-2) → extra -50  → helper[3] = -100 - 50 = -150
# helper[2 closer] = +100.
# =================================================================
print('\n📦 Scenario 4: 2 contributors, pull_depth=2')
run_test('discard close, 2 contributors (seq 0 = -100, seq 1 = -50)', {
    'closedBy': 2,
    'lastDrawnFrom': 'discard',
    'lastPickupNonce': 'N1',
    'lastPickupDepth': 2,
    'discard': [discard_entry({'rank': 'J', 'suit': '♦'}, 2)],
    'laidDown': {
        0: [], 1: [], 3: [],
        2: [
            combo('pararel', [
                picked({'rank': '5', 'suit': '♠'}, 0, seq=0),
                own({'rank': '5', 'suit': '♥'}),
                own({'rank': '5', 'suit': '♣'}),
            ]),
            combo('dasar', [
                picked({'rank': '10', 'suit': '♦'}, 3, seq=1, must_lay=True),
                own({'rank': 'J', 'suit': '♦'}),
                own({'rank': 'Q', 'suit': '♦'}),
            ]),
        ],
    },
}, {
    'closingMethod': 'discard',
    'bonusUnit': 100,
    'contributors': [0, 3],  # sorted by extra ascending (-100 < -50)
    'helperDelta': {0: -200, 3: -150, 2: 100},
    'closingExtra': {0: -100, 3: -50},
    'closeNoBonus': False,
    'reverseNextRound': True,
})

# =================================================================
# SCENARIO 5: 3 contributors, pull_depth=3.
# closer=0. seq 0 = 3♠ (P1), seq 1 = 7♥ (P2), seq 2 = Q♣ (P3 mustLay).
# bonus=150 (A♣).
# P1 (seq 0) → extra -100 → helper[1] = -150 -100 = -250
# P2 (seq 1) → extra -50  → helper[2] = -150 - 50 = -200
# P3 (seq 2) → extra 0    → helper[3] = -150 + 0  = -150
# helper[0 closer] = +150.
# Contributors sorted by extra ascending: [1 (-100), 2 (-50), 3 (0)].
# =================================================================
print('\n📦 Scenario 5: 3 contributors, pull_depth=3 (full schedule)')
run_test('discard close, 3 contributors (full tarikan schedule)', {
    'closedBy': 0,
    'lastDrawnFrom': 'discard',
    'lastPickupNonce': 'N1',
    'lastPickupDepth': 3,
    'discard': [discard_entry({'rank': 'A', 'suit': '♣'}, 0)],
    'laidDown': {
        1: [], 2: [], 3: [],
        0: [
            combo('dasar', [
                picked({'rank': '3', 'suit': '♠'}, 1, seq=0),
                own({'rank': '4', 'suit': '♠'}),
                own({'rank': '5', 'suit': '♠'}),
            ]),
            combo('dasar', [
                picked({'rank': '7', 'suit': '♥'}, 2, seq=1),
                own({'rank': '8', 'suit': '♥'}),
                own({'rank': '9', 'suit': '♥'}),
            ]),
            combo('pararel', [
                picked({'rank': 'Q', 'suit': '♣'}, 3, seq=2, must_lay=True),
                own({'rank': 'Q', 'suit': '♥'}),
                own({'rank': 'Q', 'suit': '♦'}),
            ]),
        ],
    },
}, {
    'closingMethod': 'discard',
    'bonusUnit': 150,
    'contributors': [1, 2, 3],  # sorted by extra ascending
    'helperDelta': {1: -250, 2: -200, 3: -150, 0: 150},
    'closingExtra': {1: -100, 2: -50},
    'closeNoBonus': False,
    'reverseNextRound': True,
})

# =================================================================
# SCENARIO 6: 3 picks, seat 3 card cuma tutupan. closer=1.
# pull_depth = 3. seq 0 = 8♦ (P3, jadi tutupan, NOT laid).
# seq 1 = 10♥ (P2, laid). seq 2 = 4♣ (P0, laid mustLay).
# bonus = 50 (8♦).
# Contributors: P0 (seq 2, anchor, extra 0), P2 (seq 1, extra -50).
# helper[0] = -50 + 0 = -50
# helper[2] = -50 -50 = -100
# helper[1 closer] = +50
# Sort by extra ascending: [2 (-50), 0 (0)]
# =================================================================
print('\n📦 Scenario 6: 3 picks, 1 cuma tutupan (luput)')
run_test('discard close, 3 picked but top jadi tutupan', {
    'closedBy': 1,
    'lastDrawnFrom': 'discard',
    'lastPickupNonce': 'N1',
    'lastPickupDepth': 3,
    'discard': [discard_entry({'rank': '8', 'suit': '♦', 'fromDiscardBy': 3}, 1)],
    'laidDown': {
        0: [], 2: [], 3: [],
        1: [
            combo('dasar', [
                picked({'rank': '4', 'suit': '♣'}, 0, seq=2, must_lay=True),
                own({'rank': '5', 'suit': '♣'}),
                own({'rank': '6', 'suit': '♣'}),
            ]),
            combo('pararel', [
                picked({'rank': '10', 'suit': '♥'}, 2, seq=1),
                own({'rank': '10', 'suit': '♣'}),
                own({'rank': '10', 'suit': '♠'}),
            ]),
        ],
    },
}, {
    'closingMethod': 'discard',
    'bonusUnit': 50,
    'contributors': [2, 0],
    'helperDelta': {2: -100, 0: -50, 1: 50},
    'closingExtra': {2: -50},
    'closeNoBonus': False,
    'reverseNextRound': True,
})

# =================================================================
# SCENARIO 7: 2 picks dari 1 contributor (seat 0). closer=1.
# pull_depth = 2. seq 0 = 4♥ (P0), seq 1 = 5♥ (P0 mustLay).
# bonus = 50 (9♣).
# P0 extra: max(extra_seq_0=-100, extra_seq_1=0) → -100.
# helper[0] = -50 -100 = -150
# helper[1 closer] = +50
# =================================================================
print('\n📦 Scenario 7: 2 picks 1 contributor, top = -100')
run_test('discard close, 2 cards 1 contributor (worst extra applies)', {
    'closedBy': 1,
    'lastDrawnFrom': 'discard',
    'lastPickupNonce': 'N1',
    'lastPickupDepth': 2,
    'discard': [discard_entry({'rank': '9', 'suit': '♣'}, 1)],
    'laidDown': {
        0: [], 2: [], 3: [],
        1: [combo('dasar', [
            picked({'rank': '4', 'suit': '♥'}, 0, seq=0),
            picked({'rank': '5', 'suit': '♥'}, 0, seq=1, must_lay=True),
            own({'rank': '6', 'suit': '♥'}),
        ])],
    },
}, {
    'closingMethod': 'discard',
    'bonusUnit': 50,
    'contributors': [0],
    'helperDelta': {0: -150, 1: 50},
    'closingExtra': {0: -100},
    'closeNoBonus': False,
    'reverseNextRound': True,
})

# =================================================================
# SCENARIO 8: Picked card stays as tutupan (no laid)
# =================================================================
print('\n📦 Scenario 8: Picked card stays as tutupan (no lay)')
run_test('discard close, picked card became closing discard (no lay)', {
    'closedBy': 2,
    'lastDrawnFrom': 'discard',
    'lastPickupNonce': 'N1',
    'lastPickupDepth': 1,
    'discard': [discard_entry({'rank': '5', 'suit': '♠', 'fromDiscardBy': 0}, 2)],
    'laidDown': {0: [], 1: [], 2: [], 3: []},
}, {
    'closingMethod': 'discard',
    'bonusUnit': 50,
    'contributors': [],
    'helperDelta': {},
    'closingExtra': {},
    'closeNoBonus': True,
    'reverseNextRound': True,
})

# =================================================================
# SCENARIO 9: lastPickupNonce missing → no contributors
# =================================================================
print('\n📦 Scenario 9: lastPickupNonce kosong → no contributors')
run_test('discard close, no pickup nonce → close-no-bonus', {
    'closedBy': 0,
    'lastDrawnFrom': 'discard',
    'lastPickupNonce': None,
    'lastPickupDepth': 0,
    'discard': [discard_entry({'rank': 'K', 'suit': '♦'}, 0)],
    'laidDown': {
        1: [], 2: [], 3: [],
        0: [combo('dasar', [
            picked({'rank': '7', 'suit': '♣'}, 2, seq=0, must_lay=True),
            own({'rank': '8', 'suit': '♣'}),
            own({'rank': '9', 'suit': '♣'}),
        ])],
    },
}, {
    'closingMethod': 'discard',
    'bonusUnit': 100,
    'contributors': [],
    'helperDelta': {},
    'closingExtra': {},
    'closeNoBonus': True,
    'reverseNextRound': True,
})

# =================================================================
# SCENARIO 10: Closer picks own discard — not counted as contributor
# =================================================================
print('\n📦 Scenario 10: Closer picks own discard (no self-contribution)')
run_test('discard close, picked own card (not counted)', {
    'closedBy': 1,
    'lastDrawnFrom': 'discard',
    'lastPickupNonce': 'N1',
    'lastPickupDepth': 1,
    'discard': [discard_entry({'rank': '6', 'suit': '♥'}, 1)],
    'laidDown': {
        0: [], 2: [], 3: [],
        1: [combo('dasar', [
            picked({'rank': '4', 'suit': '♦'}, 1, seq=0, must_lay=True),
            own({'rank': '5', 'suit': '♦'}),
            own({'rank': '6', 'suit': '♦'}),
        ])],
    },
}, {
    'closingMethod': 'discard',
    'bonusUnit': 50,
    'contributors': [],
    'helperDelta': {},
    'closingExtra': {},
    'closeNoBonus': True,
    'reverseNextRound': True,
})

# =================================================================
# SCENARIO 11: Joker as closing card (bonus 250). pull_depth=1.
# Single contributor → no extra. helper[2] = -250, helper[0] = +250.
# =================================================================
print('\n📦 Scenario 11: Joker closing card, single-pull (no tarikan)')
run_test('discard close, JOKER closing card (single contributor)', {
    'closedBy': 0,
    'lastDrawnFrom': 'discard',
    'lastPickupNonce': 'N1',
    'lastPickupDepth': 1,
    'discard': [discard_entry({'rank': 'JOKER', 'suit': 'JOKER', 'color': 'red'}, 0)],
    'laidDown': {
        1: [], 2: [], 3: [],
        0: [combo('dasar', [
            picked({'rank': 'A', 'suit': '♠'}, 2, seq=0, must_lay=True),
            own({'rank': '2', 'suit': '♠'}),
            own({'rank': '3', 'suit': '♠'}),
        ])],
    },
}, {
    'closingMethod': 'discard',
    'bonusUnit': 250,
    'contributors': [2],
    'helperDelta': {2: -250, 0: 250},
    'closingExtra': {},
    'closeNoBonus': False,
    'reverseNextRound': True,
})

# =================================================================
# SCENARIO 12: 2 picks (1 jadi, 1 tutupan). closer=1. pull_depth=2.
# seq 0 = 8♥ (P3, jadi tutupan, NOT laid) → P3 luput.
# seq 1 = J♠ (P0, laid mustLay) → ke-2 → extra -50.
# helper[0] = -50 - 50 = -100, helper[1 closer] = +50.
# =================================================================
print('\n📦 Scenario 12: 2-pick, 1 jadi 1 tutupan')
run_test('discard close, 2 picks (1 jadi 1 tutupan)', {
    'closedBy': 1,
    'lastDrawnFrom': 'discard',
    'lastPickupNonce': 'N1',
    'lastPickupDepth': 2,
    'discard': [discard_entry({'rank': '8', 'suit': '♥', 'fromDiscardBy': 3}, 1)],
    'laidDown': {
        0: [], 2: [], 3: [],
        1: [
            combo('dasar', [
                picked({'rank': 'J', 'suit': '♠'}, 0, seq=1, must_lay=True),
                own({'rank': 'Q', 'suit': '♠'}),
                own({'rank': 'K', 'suit': '♠'}),
            ]),
        ],
    },
}, {
    'closingMethod': 'discard',
    'bonusUnit': 50,
    'contributors': [0],
    'helperDelta': {0: -100, 1: 50},
    'closingExtra': {0: -50},
    'closeNoBonus': False,
    'reverseNextRound': True,
})

# =================================================================
# SCENARIO 13: Cabutan close + closing card = JOKER (no bonus)
# =================================================================
print('\n📦 Scenario 13: Cabutan close + closing card = JOKER (no bonus)')
run_test('cabutan close, joker as closing card', {
    'closedBy': 1,
    'lastDrawnFrom': 'deck',
    'lastPickupNonce': None,
    'lastPickupDepth': 0,
    'discard': [discard_entry({'rank': 'JOKER', 'suit': 'JOKER', 'color': 'red'}, 1)],
    'laidDown': {
        0: [], 2: [], 3: [],
        1: [
            combo('dasar', [
                picked({'rank': '5', 'suit': '♥'}, 2, seq=0, nonce='OLD'),
                own({'rank': '6', 'suit': '♥'}),
                own({'rank': '7', 'suit': '♥'}),
            ]),
        ],
    },
}, {
    'closingMethod': 'deck',
    'bonusUnit': 0,
    'contributors': [],
    'helperDelta': {},
    'closingExtra': {},
    'closeNoBonus': True,
    'reverseNextRound': True,
})

# =================================================================
# SCENARIO 13b: Stale combo (nonce beda) tidak counted. pull_depth=1.
# closer=0. Single fresh card 8♠ at seq 0 (P3, mustLay, anchor).
# Single-pull → no tarikan. helper[3] = -50, helper[0] = +50.
# =================================================================
print('\n📦 Scenario 13b: stale combo (nonce beda) + single fresh pull')
run_test('discard close, stale combo + single fresh pull (no tarikan)', {
    'closedBy': 0,
    'lastDrawnFrom': 'discard',
    'lastPickupNonce': 'N1',
    'lastPickupDepth': 1,
    'discard': [discard_entry({'rank': '4', 'suit': '♣'}, 0)],
    'laidDown': {
        1: [], 2: [], 3: [],
        0: [
            combo('dasar', [
                picked({'rank': 'J', 'suit': '♥'}, 2, seq=2, must_lay=True, nonce='OLD'),
                own({'rank': 'Q', 'suit': '♥'}),
                own({'rank': 'K', 'suit': '♥'}),
            ]),
            combo('pararel', [
                picked({'rank': '8', 'suit': '♠'}, 3, seq=0, must_lay=True, nonce='N1'),
                own({'rank': '8', 'suit': '♥'}),
                own({'rank': '8', 'suit': '♣'}),
            ]),
        ],
    },
}, {
    'closingMethod': 'discard',
    'bonusUnit': 50,
    'contributors': [3],
    'helperDelta': {3: -50, 0: 50},
    'closingExtra': {},
    'closeNoBonus': False,
    'reverseNextRound': True,
})

# =================================================================
# SCENARIO 14: Cabutan close + stale fromDiscardBy in laid combo
# =================================================================
print('\n📦 Scenario 14: Cabutan close + stale fromDiscardBy luput')
run_test('cabutan close TIDAK dapat bonus walau ada combo dengan fromDiscardBy lama', {
    'closedBy': 1,
    'lastDrawnFrom': 'deck',
    'lastPickupNonce': None,
    'lastPickupDepth': 0,
    'discard': [discard_entry({'rank': '6', 'suit': '♣'}, 1)],
    'laidDown': {
        0: [], 2: [], 3: [],
        1: [
            combo('dasar', [
                picked({'rank': '7', 'suit': '♠'}, 0, seq=0, must_lay=True, nonce='OLD'),
                own({'rank': '8', 'suit': '♠'}),
                own({'rank': '9', 'suit': '♠'}),
            ]),
        ],
    },
}, {
    'closingMethod': 'deck',
    'bonusUnit': 0,
    'contributors': [],
    'helperDelta': {},
    'closingExtra': {},
    'closeNoBonus': True,
    'reverseNextRound': True,
})

# =================================================================
# SCENARIO 15: Deck empty, no closer — no reversal
# =================================================================
print('\n📦 Scenario 15: Deck empty, no closer (no reversal)')
run_test('deck empty, no close', {
    'closedBy': None,
    'lastDrawnFrom': 'deck',
    'lastPickupNonce': None,
    'lastPickupDepth': 0,
    'discard': [discard_entry({'rank': '9', 'suit': '♠'}, 2)],
    'laidDown': {0: [], 1: [], 2: [], 3: []},
}, {
    'closingMethod': None,
    'bonusUnit': 0,
    'contributors': [],
    'helperDelta': {},
    'closingExtra': {},
    'closeNoBonus': False,
    'reverseNextRound': False,
})

# =================================================================
# SCENARIO 16: Same seat false-positive guard (nonce mismatch)
# Closer punya kartu lama (nonce OLD) DAN baru ambil kartu turn ini
# yang jadi tutupan (tidak laid). Contributors HARUS empty.
# =================================================================
print('\n📦 Scenario 16: Same-seat false-positive guard')
run_test('seat X kontribusi turn lampau (laid) + turn closing (tutupan) → LUPUT', {
    'closedBy': 0,
    'lastDrawnFrom': 'discard',
    'lastPickupNonce': 'NEW',
    'lastPickupDepth': 1,
    'discard': [discard_entry({'rank': '7', 'suit': '♣', 'fromDiscardBy': 2}, 0)],
    'laidDown': {
        1: [], 2: [], 3: [],
        0: [
            combo('dasar', [
                picked({'rank': '3', 'suit': '♥'}, 2, seq=0, must_lay=True, nonce='OLD'),
                own({'rank': '4', 'suit': '♥'}),
                own({'rank': '5', 'suit': '♥'}),
            ]),
        ],
    },
}, {
    'closingMethod': 'discard',
    'bonusUnit': 50,
    'contributors': [],
    'helperDelta': {},
    'closingExtra': {},
    'closeNoBonus': True,
    'reverseNextRound': True,
})

# =================================================================
# SCENARIO 17 (USER SCENARIO 1 revisi): P3 menutup setelah ambil 3♠
# di turn closing (pull_depth=1). 7♠ dari P1 sudah ter-laid di turn
# lampau (nonce OLD).
# - 7♠ nonce OLD ≠ N1 → P1 LUPUT
# - 3♠ nonce N1, seq 0, single-pull → P2 base only
# closer=2 (P3). bonus = 100 (K closing).
# helper[1 P2] = -100, helper[2 P3] = +100, helper[0 P1] = 0, helper[3 P4] = 0.
# =================================================================
print('\n📦 Scenario 17 (USER S1 revisi): P3 menutup, P1 sumbang turn lampau LUPUT')
run_test('P3 close after pickup single-card, P1 luput karena kontribusi turn lampau', {
    'closedBy': 2,
    'lastDrawnFrom': 'discard',
    'lastPickupNonce': 'N1',
    'lastPickupDepth': 1,
    'discard': [discard_entry({'rank': 'K', 'suit': '♥'}, 2)],
    'laidDown': {
        0: [], 1: [], 3: [],
        2: [
            # combo lama dari putaran 4 (nonce OLD)
            combo('dasar', [
                picked({'rank': '7', 'suit': '♠'}, 0, seq=2, must_lay=True, nonce='OLD'),
                own({'rank': '8', 'suit': '♠'}),
                own({'rank': '9', 'suit': '♠'}),
            ]),
            # combo dari turn closing
            combo('dasar', [
                picked({'rank': '3', 'suit': '♠'}, 1, seq=0, must_lay=True, nonce='N1'),
                own({'rank': '4', 'suit': '♠'}),
                own({'rank': '5', 'suit': '♠'}),
            ]),
        ],
    },
}, {
    'closingMethod': 'discard',
    'bonusUnit': 100,
    'contributors': [1],
    'helperDelta': {1: -100, 2: 100},
    'closingExtra': {},
    'closeNoBonus': False,
    'reverseNextRound': True,
})

# =================================================================
# SCENARIO 18 (USER SCENARIO 2 revisi): P3 menutup ambil 3 kartu di
# turn closing (10♠ top, K♦ middle, 6♠ deepest). 10♠ jadi tutupan,
# K♦ & 6♠ laid. 6♠ originally P2 discarded but P4 re-discarded →
# fromDiscardBy=P4. K♦ fromDiscardBy=P1. 10♠ fromDiscardBy=P2.
# bonus = 50 (10♠ closing).
# Contributors:
#   - K♦ seq 1, fromDiscardBy=0 (P1), extra -50
#   - 6♠ seq 2, fromDiscardBy=3 (P4), extra 0
# helper[0 P1] = -50 -50 = -100
# helper[3 P4] = -50 + 0 = -50
# helper[2 P3 closer] = +50
# helper[1 P2] = 0 (LUPUT)
# =================================================================
print('\n📦 Scenario 18 (USER S2 revisi): P3 ambil 3 kartu, P2 LUPUT total')
run_test('3-pull close, P2 luput (re-discard by P4 + tutupan)', {
    'closedBy': 2,
    'lastDrawnFrom': 'discard',
    'lastPickupNonce': 'N1',
    'lastPickupDepth': 3,
    'discard': [discard_entry({'rank': '10', 'suit': '♠', 'fromDiscardBy': 1}, 2)],
    'laidDown': {
        0: [], 1: [], 3: [],
        2: [
            combo('pararel', [
                picked({'rank': '6', 'suit': '♠'}, 3, seq=2, must_lay=True),  # 6♠ from P4 (re-discard)
                own({'rank': '6', 'suit': '♥'}),
                own({'rank': '6', 'suit': '♦'}),
            ]),
            combo('dasar', [
                picked({'rank': 'K', 'suit': '♦'}, 0, seq=1),  # K♦ from P1
                own({'rank': 'Q', 'suit': '♦'}),
                own({'rank': 'J', 'suit': '♦'}),
            ]),
        ],
    },
}, {
    'closingMethod': 'discard',
    'bonusUnit': 50,
    'contributors': [0, 3],  # sorted: P1 (-50) before P4 (0)
    'helperDelta': {0: -100, 3: -50, 2: 50},
    'closingExtra': {0: -50},
    'closeNoBonus': False,
    'reverseNextRound': True,
})

# =================================================================
print('\n=== SUMMARY ===')
print(f'Total: {PASS + FAIL}  ·  Pass: {PASS}  ·  Fail: {FAIL}')
if FAIL > 0:
    print('\n❌ FAILURES:')
    for name, diffs, actual, expected in FAILURES:
        print(f'  - {name}')
        for k, (e, a) in diffs.items():
            print(f'      {k}: expected={e!r}  actual={a!r}')
    exit(1)
else:
    print('\n✅ All scenarios pass.')
    exit(0)
