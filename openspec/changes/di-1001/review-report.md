# DI-1001 T17 Review and Delivery Evidence

## Task

- Task ID: DEV-DI-017
- Scope: release metadata, complete recording delivery integration, reload recovery, segment snapshot, package/release checks, performance evidence, and upstream compatibility evidence.
- Core boundary: no rrweb core source file was modified. Product implementation remains under `packages/datainsights-browser-sdk`.

## Implementation Evidence

| Item                    | Evidence                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Real recording pipeline | rrweb events flow through IndexedDB Journal, canonical batching/hash, atomic Outbox, dispatcher, exact persisted receipt, and confirmed deletion |
| Crash/reload recovery   | Journal chunks retain their Recording context and preceding durable hash; a real Chrome reload recovers and delivers the prior Recording         |
| Segment replayability   | 30-minute rotation drains the old segment, rotates `segmentId`, and explicitly calls guarded rrweb `takeFullSnapshot(true)`                      |
| Worker                  | external classic Worker artifact with canonical synchronous fallback and local diagnostic state                                                  |
| Build provenance        | SDK version, rrweb package version, and rrweb source commit `7cdbadf927a33987235a80295782091522024a9b` embedded in artifacts                     |
| Distribution            | ESM/CJS/UMD, declarations, Worker, MIT LICENSE, NOTICE, README; tarball dry-run reviewed                                                         |
| Upstream governance     | merge-based runbook, L0/no-core-patch statement, regression commands, and rollback procedure                                                     |

## Test Evidence

| Case                      | Type                       | Expected                                                     | Result                                                                                                                             |
| ------------------------- | -------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| SDK complete suite        | Unit/integration/browser   | all SDK behavior passes                                      | Passed: 20 files / 131 tests                                                                                                       |
| Real page recording       | Chrome                     | ordinary input/custom event delivered, password absent       | Passed                                                                                                                             |
| Reload recovery           | Chrome                     | prior Recording Journal is delivered after reload            | Passed                                                                                                                             |
| Replay sandbox            | Chrome                     | segment/full snapshot rebuild; malicious script not executed | Passed: 4 tests                                                                                                                    |
| Hash-chain crash boundary | IndexedDB                  | Journal stores last durable batch hash                       | Passed                                                                                                                             |
| Recorder start failure    | Lifecycle                  | prepared resources released, state returns Authorized        | Passed                                                                                                                             |
| Type check                | TypeScript                 | no errors                                                    | Passed                                                                                                                             |
| Release build             | Vite/tsc                   | ESM/CJS/UMD/types/Worker generated                           | Passed                                                                                                                             |
| Tarball                   | npm dry-run                | reviewed files only; no secret/internal URL pattern          | Passed: 22 entries, 716,310-byte packed artifact                                                                                   |
| `@rrweb/record`           | Upstream                   | package tests and type/build remain green                    | Passed: 4 tests; type/build passed                                                                                                 |
| `rrweb` core              | Upstream pinned Chrome 115 | functional regressions remain green                          | 311 passed, 3 skipped; 4 pre-existing macOS ARM image snapshot mismatches remain (WebGL/video pixels). Snapshots were not changed. |

The combined Turbo command is unsafe in this workspace because rrweb and DataInsights browser suites build into the same rrweb `dist` concurrently. It produced missing-artifact races and a loaded-run timing failure. Verification was therefore repeated sequentially; this is recorded in `UPSTREAM_SYNC.md` as the required execution order.

## OCR Scan Findings (advisory)

### Coverage

| mode      | from-to      | total_files | reviewed_files | skipped_files | coverage_rate | degraded_reason |
| --------- | ------------ | ----------: | -------------: | ------------: | ------------: | --------------- |
| workspace | working tree |          28 |             28 |             0 |          100% | none            |

OCR selected 17 production/package files. The remaining 11 test/Markdown files were excluded by OCR rules and reviewed manually. `ocr` 1.13.3 warned that Git 2.39.2 is older than its recommended 2.41.0 minimum, but preview and rule resolution completed.

### Findings overview

No unresolved OCR findings. Manual review found and fixed two correctness issues before this report: hash state advanced before Outbox commit, and recorder-start failure retained prepared references. Both now have regression tests.

## Review Gate Conclusion

| Axis         | Conclusion                                                                                                                                                                                          |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Correctness  | Pass for SDK scope. Atomic move, exact receipt deletion, reload recovery, hash continuity, explicit segment snapshot, and cleanup have automated evidence.                                          |
| Readability  | Pass. Product naming is consistently DataInsights; public/runtime/persistence/transport boundaries remain explicit.                                                                                 |
| Architecture | Pass. L0 isolated package; no rrweb core source patch and no backend implementation.                                                                                                                |
| Security     | Pass for defined SDK boundary. Password/hidden/auth data protections, unsafe custom payload rejection, no long-lived browser secret, artifact scan, and script-disabled replay sandbox are covered. |
| Performance  | Pass for deterministic wrapper budgets and recorded bundle size. Representative H5/PC FPS qualification remains an explicit pre-production environment gate.                                        |

### Must-fix

None within DI-1001 SDK scope.

### Known issues / follow-up

- rrweb upstream has four pixel snapshot mismatches on macOS ARM even with its pinned Chrome 115. They do not touch DataInsights code and were not accepted by updating snapshots.
- Representative-device 1k/5k/20k DOM, virtual-list, mutation, continuous-input, and relative FPS qualification must be run in the target H5/PC release lab as described in `PERFORMANCE.md`.
- Production Transport/backend persistence, legal evidence guarantees, retention propagation, and analytics remain separate changes.

### Human review points

- Confirm the persisted Journal context contains the intended evidence metadata and is acceptable under the embedding application's local-data policy.
- Confirm production CDN publishes both SDK and Worker at immutable versioned URLs.
- Confirm the production Transport contract returns an exact durable receipt and implements reconciliation; HTTP success alone must not acknowledge a batch.
