# DI-1001 Test Cases and Evidence Matrix

## Automated coverage

| Area                     | Positive / boundary evidence                                                                 | Failure / security evidence                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| AppKey and remote config | production/test route parsing, strict schema, cache and expiry                               | unknown environment/region, arbitrary URL, disabled app and invalid response fail closed                 |
| Simplified bootstrap     | real button click records noticeVersion and optional host user ID                            | no recording before click; invalid selector/config and identity callback failures isolated               |
| Config and consent       | valid AppKey, equivalent init, explicit grant/start                                          | endpoint/platform/tenant/secret/sample config rejected; consent-before-start                             |
| Persistence capability   | actual metadata write/read/delete, estimate and persist status                               | missing/open/transaction/read mismatch returns `PERSISTENCE_UNAVAILABLE`; persist denial not misreported |
| Identity and Session     | host/anonymous identity, refresh continuity, journey, segment rotation                       | new-tab conflict, 30-minute idle, clear identity, all stop reasons                                       |
| Recording privacy        | real rrweb ordinary insurance input capture                                                  | password, hidden/auth fields and customer block selectors absent                                         |
| Custom events            | valid insurance submit event                                                                 | cyclic, oversized, sensitive/prototype-polluting payload rejected                                        |
| Journal and Outbox       | 1-second/20-event flush, FIFO, atomic multi-batch move, reload recovery                      | transaction failure preserves Journal, capacity refuses overwrite                                        |
| Delivery integrity       | stable batch ID, sequence, SHA-256/hash chain, exact persisted receipt                       | mismatch/2xx/beacon-like acknowledgement retains Outbox                                                  |
| Recovery                 | startup/online retry, missing-range retransmit, old Recording Journal recovered after reload | exhausted retry, rejected batch, invalid/unrecoverable ranges                                            |
| Browser entry            | fixed Script Tag, external Worker, strict CSP, duplicate load                                | missing Transport fails closed; Worker has synchronous fallback                                          |
| Insurance E2E            | plan, scroll, modal, ordinary form input, submit, delivery and generated-event replay        | no pre-click recording, password absent, zero non-local requests, exact sandbox excludes scripts         |
| Replay                   | cross-segment/full-snapshot fixture and generated insurance events                           | exact sandbox excludes scripts; malicious replay script does not run                                     |
| Release                  | version/commit injection, package docs, type/build artifacts                                 | stable package entry only; credential/internal-address/artifact scan                                     |
| Performance              | deterministic two-hour wrapper p95/heap; 30-minute fake-time boundaries                      | capacity and cleanup assertions                                                                          |

## Final test evidence

| Command / Case                               | Type                          | Expected                                                                                        | Result                                                                                                       |
| -------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `vitest run` for `@datainsights/browser-sdk` | Unit/integration/real browser | all SDK behavior passes                                                                         | Passed: 25 files / 166 tests                                                                                 |
| Insurance product E2E                        | Real Chrome                   | click-gated recording, ordinary fields, password exclusion, exact receipt, empty Outbox, replay | Passed: 1 test                                                                                               |
| Sandboxed replay                             | Real Chrome                   | fixture/generated events rebuild without script execution                                       | Passed: 4 tests                                                                                              |
| IndexedDB capability                         | Unit/integration              | open/write/read/delete and failure boundaries                                                   | Passed: 6 capability tests plus lifecycle integration                                                        |
| `check-types`                                | TypeScript                    | no errors                                                                                       | Passed                                                                                                       |
| `prepublish`                                 | Release build                 | ESM/CJS/UMD/declarations/Worker generated                                                       | Passed; ESM 257.96 kB raw / 55.14 kB gzip                                                                    |
| Release artifact scan                        | Security                      | no password fixture, local token, production reference or long-term secret in dist/umd          | Passed; no matches                                                                                           |
| `@rrweb/record test`                         | Upstream build/test           | recorder dependency remains green                                                               | Passed: 2 files / 4 tests; dependency builds passed                                                          |
| `rrweb test`                                 | Upstream functional/pixel     | functional regressions green; known platform pixel differences recorded                         | 312 passed, 3 skipped, 3 existing macOS ARM video pixel snapshots failed at 5.11%-5.29%; snapshots unchanged |
| Manual `demo:insurance` smoke                | Local manual                  | product, config and recordings routes available on loopback                                     | Passed on `127.0.0.1:4173`                                                                                   |

## Commands

```bash
PUPPETEER_HEADLESS=true yarn workspace @datainsights/browser-sdk vitest run
yarn workspace @datainsights/browser-sdk check-types
yarn workspace @datainsights/browser-sdk prepublish
yarn workspace @rrweb/record test
yarn workspace rrweb test
```

Browser suites run sequentially because their build steps share rrweb `dist` paths. Spec/SGS/OpenSpec telemetry remains disabled and was not invoked.

## Regression notes

- The first full SDK run exposed internal AppKey/remote-config/HTTP helpers as unintended runtime package exports. `src/index.ts` was corrected to preserve only `DataInsights` and `createDataInsights`; the package-entry test and full suite then passed.
- `replay-segment.integration.test.ts` now builds the rrweb release UMD in a child process with the rrweb package as cwd, matching the official build and avoiding API Extractor resolving the SDK package tsconfig from a Vitest worker.
- No rrweb core source file was modified. Upstream pixel snapshots were not updated.

## Known gaps / risks

- iOS Safari, Android Chrome, WeChat/Enterprise WeChat, Alipay, Windows Chrome/Edge and macOS Safari remain Pending until qualifying device/runtime execution is recorded in `COMPATIBILITY.md`.
- Clearing site data, storage eviction, disk failure or a crash before IndexedDB commit can still lose data; the SDK does not promise absolute zero loss.
- These tests prove the SDK and local Mock Config/Collector contract, not production server persistence, legal evidentiary effect, retention deletion, cross-browser qualification or analytics semantics.
- Representative-device FPS and large-DOM qualification remains a pre-production release-lab gate defined in `PERFORMANCE.md`.
