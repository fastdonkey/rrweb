# DI-1001 T23 Review and Delivery Evidence

## Task

- Task ID: DEV-DI-023
- Scope: simplified AppKey integration, IndexedDB runtime gate, local insurance recording/replay, final documentation, full regression and review evidence.
- Core boundary: no rrweb core source file was modified. Product implementation remains under `packages/datainsights-browser-sdk`; production backend and analytics remain out of scope.

## Implementation evidence

| Item                    | Evidence                                                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Simplified integration  | fixed-version script plus `bootstrap({ appKey, consent, resolveUserId? })`; no endpoint/platform/tenant/long-term secret                  |
| Trusted routing         | AppKey format and allowlisted environment/region select Config; strict response validation supplies Collector nodes and short-lived token |
| Consent gate            | configuration may resolve before consent, but rrweb starts only after the real `startSelector` click and records `noticeVersion`          |
| Persistence gate        | real IndexedDB metadata open/write/read/delete before rrweb; failure closes the database and returns `PERSISTENCE_UNAVAILABLE`            |
| Persistence diagnostics | sanitized available/persisted/quota/usage; persist denial is not reported as success                                                      |
| Real recording pipeline | rrweb events flow through Journal, canonical batching/hash, Outbox, HTTP Transport, exact persisted receipt and confirmed deletion        |
| Insurance demo          | loopback-only de-productionized mobile insurance page, Mock Config/Collector, manual command and generated-event replay                   |
| Replay security         | iframe is exactly `sandbox="allow-same-origin"`; non-local network requests fail E2E; password value is absent                            |
| Fork boundary           | L0 isolated package with no rrweb core source patch; official recorder and rrweb regressions executed sequentially                        |

## Test evidence

| Case                      | Type                        | Expected                                                             | Result                                                                                              |
| ------------------------- | --------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| SDK complete suite        | Unit/integration/browser    | all SDK behavior passes                                              | Passed: 25 files / 166 tests                                                                        |
| Simplified bootstrap      | Unit + real Chrome          | no pre-click recording; click starts once                            | Passed                                                                                              |
| IndexedDB capability      | Unit + lifecycle            | exact round trip; missing/refused/mismatch fail closed               | Passed: 6 focused tests plus client integration                                                     |
| Local insurance recording | Chrome mobile viewport      | plan/modal/form/submit recorded, password absent                     | Passed                                                                                              |
| Delivery receipt          | Chrome + Mock Collector     | matching persisted receipt clears Journal/Outbox                     | Passed                                                                                              |
| Generated replay          | Chrome                      | recorded page values rebuilt without scripts                         | Passed; sandbox `allow-same-origin`                                                                 |
| Zero external network     | Chrome request interception | all HTTP(S) requests local                                           | Passed                                                                                              |
| Type check                | TypeScript                  | no errors                                                            | Passed                                                                                              |
| Release build             | Vite/tsc                    | ESM/CJS/UMD/types/Worker generated                                   | Passed; ESM 257.96 kB / 55.14 kB gzip                                                               |
| Artifact secret scan      | Security                    | no password fixture, local token, production URL or long-term secret | Passed; no matches                                                                                  |
| `@rrweb/record`           | Upstream                    | build and tests remain green                                         | Passed: 2 files / 4 tests                                                                           |
| `rrweb` core              | Upstream on macOS ARM       | functional regressions green; platform pixels tracked                | 312 passed, 3 skipped; 3 existing video pixel snapshots differ by 5.11%-5.29%. Snapshots unchanged. |

The first SDK full-suite run correctly failed because `src/index.ts` exposed four internal AppKey/config/HTTP helpers in addition to the stable facade. This was treated as a must-fix, the exports were removed, the focused package-entry test passed, and the full 166-test suite was rerun successfully.

## OCR Scan Findings (advisory)

### Coverage

| mode      | from-to                            | total_files | reviewed_files | skipped_files | coverage_rate | degraded_reason |
| --------- | ---------------------------------- | ----------: | -------------: | ------------: | ------------: | --------------- |
| workspace | working tree before evidence files |           8 |              8 |             0 |          100% | none            |

OCR 1.13.3 selected `packages/datainsights-browser-sdk/src/index.ts`; it was reviewed against the resolved TypeScript/security rules. Seven Markdown files were excluded by OCR as `unsupported_ext` and manually reviewed. Git 2.39.2 is below OCR's recommended 2.41.0 but preview and rule resolution completed.

### Findings overview

| ID  | Severity | Axis | Location | Summary                    |
| --- | -------- | ---- | -------- | -------------------------- |
| —   | —        | —    | —        | No unresolved OCR findings |

Manual review found one correctness/API-contract issue before this report: unintended internal runtime exports. It was fixed and verified by `package-entry.test.ts` and the full suite.

## Review Gate Conclusion

| Axis         | Conclusion                                                                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Correctness  | Pass for SDK scope. Consent, runtime persistence, delivery receipts, recovery, real recording and real replay have positive and negative evidence.                                          |
| Readability  | Pass. Product naming is consistently DataInsights; AppKey, noticeVersion, endpoint exclusion and local-demo boundaries are documented.                                                      |
| Architecture | Pass. Product code remains an L0 package and uses rrweb public packages; no rrweb core source or backend implementation was added.                                                          |
| Security     | Pass for defined boundary. Password/auth protection, no long-term browser secret, trusted routing, sanitized diagnostics, zero-external-network E2E and script-disabled replay are covered. |
| Performance  | Pass for deterministic wrapper budgets and bundle tracking. Representative device FPS/large-DOM qualification remains an explicit release-lab gate.                                         |

### Must-fix

None unresolved.

### Should-fix / follow-up

- Execute and record the Pending physical-device/WebView compatibility matrix before declaring those runtimes supported.
- Deliver production Config/Collector authentication, durable server persistence, retention/deletion propagation and legal evidence controls in separate changes.
- Rebaseline upstream video pixel snapshots only through the rrweb upstream/platform process; do not change them in DI-1001.

### Security check result

- No password fixture value, local demo token, Zhongan production reference, `appSecret` or `securityKey` was found in SDK `dist`/`umd` artifacts.
- Replay content remains untrusted and is rebuilt in an iframe without `allow-scripts`.
- Local demo binds only `127.0.0.1`; E2E aborts and records every non-local HTTP(S) request.
- AppKey is public routing metadata and not an authentication secret; Collector uses a short-lived token returned by Config.

### Human review points

- Confirm the AppKey environment/region allowlist and future private-deployment same-origin rule match deployment governance.
- Confirm the persisted Journal identity/consent metadata is acceptable under each embedding application's local-data policy.
- Confirm production Config/Collector returns short-lived credentials and exact durable receipts; HTTP success alone must never acknowledge a batch.
- Confirm the compatibility owner and physical-device inventory for the Pending matrix before release claims are made.
