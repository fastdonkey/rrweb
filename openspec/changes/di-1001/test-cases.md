# DI-1001 Test Cases and Evidence Matrix

## Automated coverage

| Area                 | Positive / boundary evidence                                                                 | Failure / security evidence                                                  |
| -------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Config and consent   | valid appKey, equivalent init, explicit grant/start                                          | unknown fields, secret/platform/sample config rejected; consent-before-start |
| Identity and Session | host/anonymous identity, refresh continuity, journey, segment rotation                       | new-tab conflict, 30-minute idle, clear identity, all stop reasons           |
| Recording privacy    | real rrweb ordinary input capture                                                            | password, hidden/auth fields and customer block selectors absent             |
| Custom events        | valid insurance event                                                                        | cyclic, oversized, sensitive/prototype-polluting payload rejected            |
| Journal and Outbox   | 1-second/20-event flush, FIFO, atomic multi-batch move, reload recovery                      | transaction failure preserves Journal, capacity refuses overwrite            |
| Delivery integrity   | stable batch ID, sequence, SHA-256/hash chain, exact persisted receipt                       | mismatch/2xx/beacon-like acknowledgement retains Outbox                      |
| Recovery             | startup/online retry, missing-range retransmit, old Recording Journal recovered after reload | exhausted retry, rejected batch, invalid/unrecoverable ranges                |
| Browser entry        | fixed Script Tag, external Worker, strict CSP, duplicate load                                | missing Transport fails closed; Worker has synchronous fallback              |
| Replay               | cross-segment/full-snapshot fixture and gap warning                                          | exact sandbox excludes scripts; malicious replay script does not run         |
| Release              | version/commit injection, package docs, type/build artifacts                                 | credential/internal-address artifact scan                                    |
| Performance          | deterministic two-hour wrapper p95/heap; 30-minute fake-time boundaries                      | capacity and cleanup assertions                                              |

## Commands

```bash
PUPPETEER_HEADLESS=true yarn workspace @datainsights/browser-sdk vitest run
yarn workspace @datainsights/browser-sdk check-types
yarn workspace @datainsights/browser-sdk prepublish
yarn workspace @rrweb/record test
yarn workspace rrweb test
yarn turbo run check-types --filter=@datainsights/browser-sdk --filter=@rrweb/record --filter=rrweb
```

Browser suites must run sequentially because their build steps share rrweb `dist` paths.

## Scope limits

These tests prove the SDK and local Mock Transport contract. They do not prove production server persistence, legal evidentiary effect, retention deletion, cross-browser device qualification, or analytics semantics. Production Transport and representative-device FPS qualification require separate delivery evidence.
