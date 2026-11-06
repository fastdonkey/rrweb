# DI-1001 Test Cases and Evidence Matrix

## Automated coverage

| Area                     | Positive / boundary evidence                                                                                                          | Failure / security evidence                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| AppKey and remote config | production/test route parsing, strict schema, cache and expiry                                                                        | unknown environment/region, arbitrary URL, disabled app and invalid response fail closed                                                           |
| Simplified bootstrap     | real button click records noticeVersion and optional host user ID                                                                     | no recording before click; invalid selector/config and identity callback failures isolated                                                         |
| Config and consent       | valid AppKey, equivalent init, explicit grant/start                                                                                   | endpoint/platform/tenant/secret/sample config rejected; consent-before-start                                                                       |
| Persistence capability   | actual metadata write/read/delete, estimate and persist status                                                                        | missing/open/transaction/read mismatch returns `PERSISTENCE_UNAVAILABLE`; persist denial not misreported                                           |
| Identity, Trace, Session | host/anonymous identity, SDK-owned trace, refresh continuity, segment rotation                                                        | host trace override ignored, terminal stop rotates trace, new-tab conflict, 30-minute idle                                                         |
| Recording privacy        | real rrweb ordinary insurance input capture                                                                                           | password, hidden/auth fields and customer block selectors absent                                                                                   |
| Custom events            | valid insurance submit event                                                                                                          | cyclic, oversized, sensitive/prototype-polluting payload rejected                                                                                  |
| Journal and Outbox       | 1-second/20-event flush, FIFO, atomic multi-batch move, reload recovery                                                               | transaction failure preserves Journal, capacity refuses overwrite                                                                                  |
| Delivery integrity       | stable batch ID, sequence, SHA-256/hash chain, exact persisted receipt                                                                | mismatch/2xx/beacon-like acknowledgement retains Outbox                                                                                            |
| Recovery                 | startup/online retry, missing-range retransmit, old Recording Journal recovered after reload                                          | exhausted retry, rejected batch, invalid/unrecoverable ranges                                                                                      |
| Browser entry            | fixed Script Tag, external Worker, strict CSP, duplicate load                                                                         | missing Transport fails closed; Worker has synchronous fallback                                                                                    |
| Insurance E2E            | plan, five notice documents, scroll-to-confirm gate, modal, form input, submit, delivery, 0.75x/1x replay                             | close-before-read does not confirm, submit stays gated, password absent, no idle skipping, zero non-local requests, sandbox excludes scripts       |
| Interaction Lab E2E      | tabs, accordion, autocomplete, carousel, Toast, virtual list, upload metadata, refresh, Canvas/WebGL state, iframe and PDF simulation | file body/path absent, cross-origin iframe isolated, media permissions never requested, Canvas/WebGL limitations explicit, zero non-local requests |
| Replay                   | cross-segment/full-snapshot fixture and generated insurance events                                                                    | exact sandbox excludes scripts; malicious replay script does not run                                                                               |
| Release                  | version/commit injection, package docs, type/build artifacts                                                                          | stable package entry only; credential/internal-address/artifact scan                                                                               |
| Performance              | deterministic two-hour wrapper p95/heap; 30-minute fake-time boundaries                                                               | capacity and cleanup assertions                                                                                                                    |

## Final test evidence

| Command / Case                               | Type                          | Expected                                                                                                                      | Result                                                                                                       |
| -------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `vitest run` for `@datainsights/browser-sdk` | Unit/integration/real browser | all SDK behavior passes                                                                                                       | Passed: 27 files / 180 tests                                                                                 |
| Insurance product E2E                        | Real Chrome                   | click-gated recording, five notice confirmations, ordinary fields, password exclusion, exact receipt, empty Outbox and replay | Passed: 1 test                                                                                               |
| Interaction Lab E2E                          | Real Chrome                   | P1/P2 state, capability boundaries, upload privacy, refresh restoration and replay                                            | Passed: 1 test                                                                                               |
| Sandboxed replay                             | Real Chrome                   | fixture/generated events rebuild without script execution                                                                     | Passed: 4 tests                                                                                              |
| IndexedDB capability                         | Unit/integration              | open/write/read/delete and failure boundaries                                                                                 | Passed: 6 capability tests plus lifecycle integration                                                        |
| `check-types`                                | TypeScript                    | no errors                                                                                                                     | Passed                                                                                                       |
| `prepublish`                                 | Release build                 | ESM/CJS/UMD/declarations/Worker generated                                                                                     | Passed; ESM 258.07 kB raw / 55.20 kB gzip                                                                    |
| Release artifact scan                        | Security                      | no password fixture, local token, production reference or long-term secret in dist/umd                                        | Passed; no matches                                                                                           |
| `@rrweb/record test`                         | Upstream build/test           | recorder dependency remains green                                                                                             | Passed: 2 files / 4 tests; dependency builds passed                                                          |
| `rrweb test`                                 | Upstream functional/pixel     | functional regressions green; known platform pixel differences recorded                                                       | 312 passed, 3 skipped, 3 existing macOS ARM video pixel snapshots failed at 5.11%-5.29%; snapshots unchanged |
| Manual `demo:insurance` smoke                | Local manual                  | product, config and recordings routes available on loopback                                                                   | Passed on `127.0.0.1:4173`                                                                                   |

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
- The insurance E2E now verifies five de-productionized notice documents, scroll-to-bottom gating, close-without-confirmation, non-default confirmation order, idempotent re-reading, one sanitized completion event, submit gating and final replay state.
- The Interaction Lab E2E verifies deterministic P1/P2 interactions, upload-content exclusion, same-origin behavior, cross-origin isolation, no real media permission calls, refresh restoration and replayed boundary state.

## Known gaps / risks

- iOS Safari, Android Chrome, WeChat/Enterprise WeChat, Alipay, Windows Chrome/Edge and macOS Safari remain Pending until qualifying device/runtime execution is recorded in `COMPATIBILITY.md`.
- Clearing site data, storage eviction, disk failure or a crash before IndexedDB commit can still lose data; the SDK does not promise absolute zero loss.
- These tests prove the SDK and local Mock Config/Collector contract, not production server persistence, legal evidentiary effect, retention deletion, cross-browser qualification or analytics semantics.
- Representative-device FPS and large-DOM qualification remains a pre-production release-lab gate defined in `PERFORMANCE.md`.


### 2026-10-30 增量：Canvas 2D / WebGL 画面采样

用户确认两类画布均纳入范围。本节替代前文仅支持外围 DOM 的限制；保留原生 `recordCanvas:false`，通过 `src/recorder/canvas-capture.ts` 扩展，不侵入 rrweb 核心。自定义事件 `datainsights.canvas-frame.v1` 保存节点 id、宽高、context 和内联 WebP/PNG；全量快照携带 `datainsightsCanvasFrames`，支持检查点跳转。

默认 200ms（5fps）采样，静态帧去重，最多8个当前画布、单画布200万像素、单帧URL最多350000字符。沿用宿主授权启动与暂停/停止生命周期，屏蔽区域不采集；stop 清理计时器与 WebGL 钩子。WebGL 在绘制后微任务读取，不修改 preserveDrawingBuffer，也不清除宿主缓冲区。图像随现有事件批次压缩、持久化与重试，不增加独立上传通道。

配套浏览器回放和视频渲染校验图像头部尺寸与协议，仅显示受限位图，保持 iframe 禁止脚本及原生不安全 Canvas 命令关闭。视频标记 CANVAS_SAMPLED。旧录制没有采集到的像素不可补回。跨域污染画布、OffscreenCanvas、跨域 iframe 内画布和超过预算的画布不在本轮支持范围；高频 GPU 动画不承诺逐帧无损，移动设备真实性能和兼容性仍需专门实机验收。

验证：SDK隐私/生命周期13项通过；后端 replay-client + video-renderer 共63项通过，新增真实 Chromium 采集2D/WebGL、屏蔽画布、恢复钩子、检查点跳转与解码MP4像素对照。不能将2D backing buffer读数当成最终可见性证据，必须检查实际截图/视频。
