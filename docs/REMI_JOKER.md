# Remi joker pickup and scoring

Updated 2026-10-27 following the reported J-heart + joker discard pickup and
2/3/4-diamond end-of-round scoring cases.

Discard pickup enumerates subsets that contain the deepest picked card. It
does not greedily consume every matching natural card. With a pure dasar
already laid, J-heart + joker in hand can take J-diamond and the shallower
J-spade, lay J-heart/J-diamond/joker, then close with J-spade. The same subset
search applies to number sequences with a joker. Pickup still requires two
original hand cards in the deepest card's combo, at least one natural hand
card, one joker at most, and a remaining card to discard. Only the deepest
picked card is required to be laid; fresh-state validation uses the same
predicate as the pickup dialog.

For end-of-round scoring, a joker may complete a new combo or extend a pure
combo if a separate pure dasar anchors it. That anchor can already be on the
table or be another pure dasar in the same player's hand. The target combo
cannot serve as its own anchor. If the anchor is in hand, allocation leaves
at least one such dasar untouched by jokers. An opponent's dasar does not
qualify. A combo still holds at most one joker and obeys the existing rank
bands, distinct-suit pararel limit and four-ace rule.

With another qualifying dasar, both 2/3/5-diamond + joker (joker = 4) and
2/3/4-diamond + joker (joker = 5) score +20 for the hand. They incur no -25
joker penalty. Without another pure dasar, the single 2/3/4-diamond combo
cannot anchor itself: it scores +15 and its unmatched joker remains -25.
Jokers that cannot fit any allowed combo remain penalized at their full value.

Regression tests execute the real app predicates, pickup dialog, pickup/lay/
discard handlers and complete round resolver. They also check closing-card
provenance: the picked J-diamond contributes to the laid combo, while the
shallower J-spade used only as the closing discard is not a scoring contributor.
This change affects client gameplay and scoring only; database permissions and
the unanimous leaderboard approval contract are unchanged.

The browser fixture uses synthetic accounts against the official local RTDB
emulator. Its local turn countdown is disabled to permit controlled clicks;
the pickup, lay, discard, resolver and database validation paths remain active.
