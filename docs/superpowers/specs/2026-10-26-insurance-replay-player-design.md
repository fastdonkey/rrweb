# DI-1001 Insurance Replay Player Design

## Goal

Replace the local insurance demo's bare `Replayer` view with the repository's
`rrweb-player` UI so a reviewer can see the recorded mobile page and control
playback without any external network dependency.

## Scope

The change is limited to the DI-1001 local insurance recording and replay demo.
It does not add a backend replay service, change the SDK event protocol, or
change recording privacy rules. Password values remain excluded from recorded
events.

## Decision

Use the fork's local `packages/rrweb-player` source and stylesheet. The demo
server builds and serves immutable in-memory player assets alongside the SDK
and replay page. The replay page must not load player code or styles from a CDN.

This is preferred over custom controls around `Replayer` because the maintained
player already supplies synchronized play/pause, seeking, speed, skip-inactive,
and fullscreen behavior. It also keeps the demo aligned with future upstream
rrweb upgrades.

## Playback Experience

- Opening a replay leaves it paused at the beginning.
- The standard controller exposes play/pause, a seekable progress timeline,
  playback speed, skip-inactive, and fullscreen controls.
- The recorded mobile viewport is centered and scaled to fit the available
  browser width without stretching or cropping.
- The player container has a bounded, responsive layout instead of an
  arbitrary large blank canvas.
- Loading, ready, finished, and failure states remain visible outside the
  recorded iframe.

## Architecture and Data Flow

1. The local demo build bundles `rrweb-player` from this repository and emits
   its CSS as local assets.
2. The demo HTTP server exposes the player JavaScript and stylesheet under
   local routes.
3. The replay page fetches the selected recording, orders batches by
   `sequenceStart`, and flattens their events.
4. The page creates `rrwebPlayer` with `autoPlay: false`, the reconstructed
   event stream, responsive dimensions, and the standard controller enabled.
5. Replay lifecycle events update the page status without enabling scripts in
   the reconstructed document.

## Security and Privacy

- The replay document remains isolated in rrweb's sandboxed iframe.
- Original page scripts must not execute during replay.
- No player asset or replay data request may leave `127.0.0.1`/`localhost` in
  the local acceptance test.
- The existing assertion that the password value is absent from stored data is
  retained.

## Error Handling

- Missing recordings and empty event streams show a visible failure status.
- Player asset/build failures fail demo startup or the automated test instead
  of silently falling back to an empty canvas.
- Replay initialization errors are captured in the existing diagnostic global
  used by browser tests.

## Verification

The browser acceptance test will assert that:

- the official player root and controller are rendered;
- play/pause and the seekable timeline are visible;
- the replay starts paused;
- the reconstructed form displays recorded non-password values;
- original page scripts do not execute;
- password plaintext is absent from stored recordings; and
- no non-local HTTP request occurs.

The existing replay segment integration suite remains part of regression
verification.
