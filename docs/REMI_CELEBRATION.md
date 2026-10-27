# Remi closing media and music focus

Updated 2026-10-27. `remi-celebration.js` owns one reusable closing audio element.
The current celebration video is retained, with its own audio muted. The same
soundtrack is extracted and normalized into `close-celebration.m4a` for independent
audio playback. Its duration is approximately 15.1 seconds. The existing GIF mode
uses `close-deck.gif` and `close-deck.mp3`; video errors also fall back to the GIF.

When a close occurs, the controller acquires background-music focus before it
plays anything. All BGM elements pause. Room updates may request another mood,
but that mood remains queued until the closing audio emits `ended`. Neither the
old 15-second video timeout nor the GIF's visual timer can interrupt a playing
song. Video and GIF sizes use the viewport, up to 860px wide, with a height limit
and touch-friendly controls. Closing media is above score overlays.

The animation can be minimized without stopping the song. A trusted initial
gesture primes the reusable audio element. If a browser nevertheless rejects
autoplay, a visible `Putar lagu tutupan` button retries playback directly from a
user gesture. BGM remains paused while playback is blocked or a media error is
unresolved. Failed playback offers retry and an explicit skip. No code bypasses
browser or device sound policy; mute and SFX-volume preferences remain effective.

Room end and final standings share an event key, so repeated room renders do not
restart the song. Player and spectator paths use the same controller. Leaving
the room, losing the room or returning to authentication stops closing media and
releases focus without unexpectedly restarting the old room's BGM.

Unit tests execute the real Sound manager and verify full-song ordering, queued
BGM moods, blocked autoplay, retry, decode failure, explicit skip, preferences,
minimization, cancellation, replacement and stale callbacks. Browser checks use
synthetic players and spectators on the local RTDB emulator. They inspect actual
media playback progress and paused BGM before checking BGM recovery after the
song ends. They do not verify physical iPhone/Android speaker output.
