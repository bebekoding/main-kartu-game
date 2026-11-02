# Player profiles

Implemented 2026-11-02. The user's explicit choice is **display name only**:
the login username, synthetic Auth email and password remain unchanged.

## Player workflow

- Open **Profil** in game selection or the game lobby.
- Choose a 4–16 character profile username using ASCII letters, numbers or
  keyboard symbols. Any mixture, including letters-only or symbols-only,
  works. Spaces, line breaks, invisible/control characters and non-keyboard
  Unicode characters are rejected. Existing accounts are not renamed or
  forced through a migration; an old display remains until the user saves.
- Pick one of 16 generated anime emblems. Category filters and **Acak pilihan**
  choose from the same fixed collection; no file upload or avatar URL is used.
- Press **Simpan profil**. Cancel discards the current draft. Other connected
  players see the changed display name and avatar without a page refresh.

Profile display names are not login identifiers or unique account keys.
Players keep their Firebase UID, seat, host privileges, saved-game membership,
password-change flow and historical ranking totals. The profile screen shows
the unchanged login username explicitly.

## Storage and permissions

`profiles/{auth.uid}` contains only `displayName`, `avatarId` and `updatedAt`.
Authenticated password-provider users can read public game profiles; only the
matching UID can create or replace its own profile. Rules validate length,
allowed characters, the fixed avatar-ID allowlist and a server timestamp.
Unknown fields, URLs, anonymous writes, cross-account edits and deletions are
rejected. An admin-looking display name grants no administrator permissions.

`scripts/profile-policy.cjs` is installed by `scripts/build-room-rules.cjs`.
Account, login and leaderboard write policies are unchanged. No production
account migration or score rewrite is required.

`player-profiles.js` decorates a copy of a room's player display data without
writing back into the room. This is important for frozen saved games and
immutable ranking records. New joins still keep the original login username
in `players/{uid}/username`; the displayed nickname comes from the profile.
The global ranking view resolves current profile data by UID, including a
read-only account lookup for legacy rows without a UID. Its stored matches,
points, keys and immutable receipts are not changed by profile settings.

`profile-ui.js` handles drafts, errors, focus, categories, persistence and an
authenticated profile subscription. Async responses are bound to both the
account generation and the current editing session. A DOM observer restores
avatars after the existing game renderers replace player-name elements; it
never injects arbitrary HTML, CSS classes or remote image URLs from profile
data. All displayed names are text or escaped at the existing DOMPurify
boundary. Truf, Remi, Cangkul and Tebak Kartu use the same templates.

## Avatar artwork

The fixed four-by-four transparent atlas is
`assets/avatars/anime-emblems-v1.png`. It was generated using the built-in
Imagegen tool. CSS selects a cell from this single image; no image editing or
external avatar service runs when a player changes profile.

See [avatar generation prompt and asset details](PROFILE_AVATARS.md).
Changing the atlas requires a new versioned filename because it is cached as
immutable. Profile JavaScript uses no-store caching.

## Verification

- Unit/UI tests cover name boundaries, symbols, whitespace, template IDs,
  cancellation, network errors, stale account/edit callbacks, safe text,
  avatar restoration and read-only ranking display.
- Actual emulator rules cover ownership, anonymous users, all 16 IDs,
  malicious fields/URLs and preserving accounts, saved rooms and scores.
- Browser checks use two synthetic accounts on the local official emulator.
  A profile was saved, reopened, shown in another player's Remi seat and
  reflected in the leaderboard with unchanged match/point totals. Changing
  an icon from a second tab updates the already paused game without changing
  its host, turn, or pause. The profile dialog is checked at 390 by 844 pixels.
  These are browser checks, not a claim of physical-phone testing.
