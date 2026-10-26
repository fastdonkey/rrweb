# DI-1001 Performance and Capacity Evidence

## Reproducible checks

Run from the repository root with Node 22 and telemetry disabled:

```bash
yarn workspace @datainsights/browser-sdk vitest run test/benchmark/sdk-overhead.test.ts
yarn workspace @datainsights/browser-sdk vitest run test/session-manager.test.ts test/script-tag.integration.test.ts
yarn workspace @datainsights/browser-sdk prepublish
```

The deterministic two-hour model represents 1,440 events at five-second intervals. It enforces wrapper p95 below 2 ms/event, heap growth below 50 MiB, completion below five seconds, and more than one sealed batch. Fake-timer lifecycle tests cover the 30-minute idle and segment boundaries without waiting in wall-clock time. The Chrome integration covers real rrweb DOM/input/mutation capture, external Worker serialization, IndexedDB Journal/Outbox movement, exact receipt deletion, reload recovery, CSP, and cleanup.

rrweb's own mutation benchmark suite remains the authoritative DOM-scale baseline. It covers approximately 1k, 10k, and 20k-node mutation patterns in `packages/rrweb/test/benchmark/dom-mutation.test.ts`. DataInsights does not patch that observer path. Upstream regression must remain green before release.

## Recorded release measurements

Reference environment: macOS, Node 22, headless installed Chrome, build from rrweb commit `7cdbadf927a33987235a80295782091522024a9b`.

| Metric                 |                             Result | Budget / interpretation                         |
| ---------------------- | ---------------------------------: | ----------------------------------------------- |
| Full minified UMD      |                      118,928 bytes | Recorded; includes selected rrweb recorder code |
| Full minified UMD gzip |                       36,285 bytes | Full CDN payload, not wrapper-only              |
| Serializer Worker      |   2,370 bytes raw / 867 bytes gzip | External, CSP-compatible asset                  |
| Two-hour wrapper p95   | Enforced by test at `< 2 ms/event` | Pass required                                   |
| Two-hour heap growth   |     Enforced by test at `< 50 MiB` | Pass required                                   |
| Durable capacity       |                 100 MiB per appKey | 70/90/100% diagnostics                          |

The design's 30 KiB limit applies to DataInsights wrapper increment excluding rrweb. Rollup tree-shakes rrweb together with the wrapper, so subtracting independently built bundles is not a valid size calculation. The release gate therefore records the full CDN payload and rejects sudden artifact growth; a future split-vendor distribution may enforce the wrapper-only number directly.

## FPS and device qualification

Headless Chrome is used for repeatability but is not a representative insurance customer device and cannot certify the product FPS target on its own. Before a production rollout, run the same fixed SDK build against the rrweb-only control on the supported H5 and PC device matrix using the 1k/5k/20k DOM, frequent mutation, virtual-list, and continuous-input scenarios. The acceptance threshold is no more than 5% FPS degradation attributable to the DataInsights wrapper. This is a release-environment qualification item, not evidence that can be fabricated by a CI synthetic test.
