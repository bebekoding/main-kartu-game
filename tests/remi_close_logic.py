#!/usr/bin/env python3
"""
Logika close-detection Remi — port faithful dari maybeResolveRemiRound di
truf-multiplayer-v3.html (blok "ATURAN CLOSE BONUS/PUNISHMENT").

Dipakai bersama oleh:
  - tests/remi-close-scenarios.py   (unit test 19 skenario)
  - tests/remi-close-simulations.py (audit simulasi tutupan)

Rule:
  - Cabutan close (lastDrawnFrom='deck'): no bonus, no penalty.
  - Discard close (lastDrawnFrom='discard'):
      bonus_unit = nilai kartu tutupan × 10
        angka(2-10)=5 → 50 · gambar(J/Q/K)=10 → 100 · As=15 → 150 · Joker=25 → 250
      Penyumbang = laid card di combo CLOSER dengan pickupNonce == lastPickupNonce
        (gate "this turn only") DAN fromDiscardBy != closer. Kartu yang diambil
        tapi tidak jadi (tetap di tangan / jadi closing discard) TIDAK dihitung.
      Tarikan by urutan pull di discard (justPickedSeq), per seat ambil terparah:
        pull_depth<=1 → 0 (no tarikan) · seq0 → −100 · seq1 → −50 · seq2+ → 0
        (depth 2 → −100, −50 · depth 3 → −100, −50, 0)
      Closer:     +bonus_unit (sekali, hanya jika ada ≥1 penyumbang)
      Penyumbang: −bonus_unit + extra
      0 penyumbang → no bonus / no penalty.
"""

MAX_PLAYERS = 4


def remi_card_value(card):
    if not card:
        return 0
    if card.get('rank') == 'JOKER':
        return 25
    if card.get('rank') == 'A':
        return 15
    if card.get('rank') in ('K', 'Q', 'J'):
        return 10
    return 5  # number cards 2-10


def resolve_close(state):
    """Port langsung dari logic close detection di maybeResolveRemiRound."""
    closed_by = state.get('closedBy')
    helper_delta = {}
    closing_extra = {}
    close_no_bonus = False
    bonus_unit = 0
    cont_arr = []

    if closed_by is None:
        return {
            'closingMethod': None,
            'bonusUnit': 0,
            'contributors': [],
            'helperDelta': {},
            'closingExtra': {},
            'closeNoBonus': False,
            'reverseNextRound': False,
        }

    closing_method = state.get('lastDrawnFrom') or 'deck'

    if closing_method == 'discard':
        discard = state.get('discard') or []
        last_entry = discard[-1] if discard else None
        last_discard_card = (last_entry.get('card') if isinstance(last_entry, dict) and 'card' in last_entry
                             else last_entry)
        last_discard_value = remi_card_value(last_discard_card) if last_discard_card else 0
        bonus_unit = last_discard_value * 10

        expected_nonce = state.get('lastPickupNonce') or None
        pull_depth = state.get('lastPickupDepth') or 0
        laid_down = state.get('laidDown') or {}
        closer_laid = laid_down.get(closed_by) or laid_down.get(str(closed_by)) or []

        def extra_for_seq(seq):
            if pull_depth <= 1:
                return 0
            if seq == 0:
                return -100
            if seq == 1:
                return -50
            return 0

        # Per seat: track worst (most negative) extra among contributed cards.
        seat_extra = {}
        if expected_nonce and pull_depth > 0:
            for combo_ in closer_laid:
                cards = combo_.get('cards') or []
                for card in cards:
                    if not card:
                        continue
                    if card.get('pickupNonce') != expected_nonce:
                        continue
                    origin = card.get('fromDiscardBy')
                    if origin is None:
                        continue
                    try:
                        origin_num = int(origin)
                    except (TypeError, ValueError):
                        continue
                    if origin_num == closed_by:
                        continue
                    seq = card.get('justPickedSeq', 0) or 0
                    card_extra = extra_for_seq(seq)
                    if origin_num not in seat_extra or card_extra < seat_extra[origin_num]:
                        seat_extra[origin_num] = card_extra

        cont_arr = sorted(seat_extra.keys(), key=lambda s: seat_extra[s])

        if len(cont_arr) == 0:
            close_no_bonus = True
        else:
            for cseat in cont_arr:
                extra = seat_extra[cseat]
                helper_delta[cseat] = helper_delta.get(cseat, 0) - bonus_unit + extra
                if extra != 0:
                    closing_extra[cseat] = extra
            helper_delta[closed_by] = helper_delta.get(closed_by, 0) + bonus_unit
    else:
        # rule: close via cabutan (deck)
        close_no_bonus = True

    return {
        'closingMethod': closing_method,
        'bonusUnit': bonus_unit,
        'contributors': cont_arr,
        'helperDelta': helper_delta,
        'closingExtra': closing_extra,
        'closeNoBonus': close_no_bonus,
        'reverseNextRound': closed_by is not None,
    }
