# DI-1001 DataInsights 前端 SDK 开发任务清单 v1.0

## 基本信息

| 项目 | 内容 |
| --- | --- |
| 功能名称 | 基于 rrweb Fork 构建 DataInsights 浏览器 SDK |
| 需求编号 | DI-1001 |
| 任务总数 | 17 |
| 创建日期 | 2026-10-26 |
| 参考文档 | `proposal.md` v1.2、`design.md` v1.3、`prd/` v1.7 |
| 当前阶段 | Tasks |
| 实现分支 | `futrue-v1` |

## 范围护栏

本任务清单只实现 SDK 边界内能力：授权后录制、隐私、身份与 Session、Replay 事件分段、本地持久化、可靠投递契约、Mock 验证、本地沙箱回放及上游升级保障。

以下能力不进入 DI-1001：生产接收服务、服务端去重/乱序窗口/迟到事件水位线/补偿计算、趋势/漏斗/留存/路径正式语义、服务端 Replay Manifest/对象存储/正式播放器、留存删除传播和法律存证。

## 任务拆分原则

- 每次只实施一个已批准 Task，不顺手修改 rrweb 核心或开展无关重构。
- 每个实现 Task 严格执行 RED → VERIFY RED → GREEN → VERIFY GREEN → REFACTOR。
- 单个 Task 原则上不触达超过 5 个主要文件；新增 fixture、snapshot 和生成产物不计入主要源码文件。
- 首期保持 L0：只新增 `packages/datainsights-browser-sdk`、测试和示例。任何 rrweb 核心改动必须停止当前 Task，先提交独立 ADR 并获得批准。
- 所有测试和诊断必须验证无密码、认证信息、完整身份或事件 payload 泄露。
- 禁止调用 Spec/SGS/OpenSpec 遥测或任何使用统计上报。

## TDD / Verify 约束

> **Iron Law：NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST。**

每个 Task 的 RED 必须因为目标行为尚未实现而失败；编译错误、测试环境错误或拼写错误不算有效 RED。GREEN 只写通过当前测试的最小实现。每个 Task 完成后运行该 Task 定向测试，并在 Checkpoint 运行包级回归。

通用命名规则：类型使用 PascalCase，函数和变量使用有意义的 camelCase，常量使用 UPPER_SNAKE_CASE；禁止拼音、无意义名称、魔法数字、空 catch 和敏感日志。Java/DDD 分层不适用于本 TypeScript 浏览器包，采用 Design 约定的 Public API → Controller → Manager/Adapter → Pipeline/Persistence → Transport 单向依赖。

## 依赖顺序

```text
T01 → T02 → T03
             ├→ T04 → T05
             └→ T06 → T07
T05 + T06 → T08 → T09 → T10 → T11 → T12 → T13
T03 + T13 → T14 → T15
T05 + T06 + T10 → T16
T01..T16 → T17
```

顺序原因：公共类型和授权门禁是所有行为的入口；身份、Session 和隐私录制必须先建立事件语义；Journal/Outbox 必须先于 Transport 删除与恢复策略；回执、调度和对账依赖稳定批次；浏览器入口、回放验证和发布回归最后集成。

## Checkpoint 计划

| Checkpoint | After Tasks | Re-check Focus |
| --- | --- | --- |
| CP-1 | T01-T03 | 包边界、公共 API、授权前零采集和无顶层副作用 |
| CP-2 | T04-T07 | 身份/Session 边界、密码强制保护、rrweb 核心零修改 |
| CP-3 | T08-T10 | 1 秒/20 事件窗口、原子恢复、100 MiB 容量、批次哈希一致性 |
| CP-4 | T11-T13 | 持久化回执删除门槛、重试调度、缺口对账与定向重传 |
| CP-5 | T14-T15 | 本地诊断无遥测、资源释放、Script Tag 生命周期和 CSP |
| CP-6 | T16-T17 | Replay 分层边界、沙箱安全、性能预算、构建产物和上游回归 |

## 任务列表

### Task 01: buildPackage_entry_exportsArtifacts

**任务编号**：DEV-DI-001

- Goal: 创建独立 `@datainsights/browser-sdk` workspace 包、ESM/UMD/类型构建入口和 SSR-safe 空 facade，不修改 rrweb 核心。
- Acceptance:
  - package 名、exports、全局名和构建文件名符合 Design；顶层 import 不访问 DOM。
  - `yarn workspace @datainsights/browser-sdk prepublish` 生成 ESM、UMD 和类型声明。
  - 依赖只使用 rrweb 公共 package exports。
- Verify:
  - Run: `yarn workspace @datainsights/browser-sdk vitest run test/package-entry.test.ts`
  - Expected: SSR import、导出名称和无顶层副作用测试通过。
- Dependencies: 无。
- Files:
  - Create: `packages/datainsights-browser-sdk/package.json`
  - Create: `packages/datainsights-browser-sdk/tsconfig.json`
  - Create: `packages/datainsights-browser-sdk/vite.config.ts`
  - Create: `packages/datainsights-browser-sdk/src/index.ts`
  - Test: `packages/datainsights-browser-sdk/test/package-entry.test.ts`
- [x] RED：先写 package import/exports 测试。
- [x] VERIFY RED：确认因包或导出尚不存在而失败。
- [x] GREEN：创建最小包骨架和构建入口。
- [x] VERIFY GREEN：运行定向测试及 `prepublish`。
- [x] REFACTOR：对齐仓库已有 Vite/package 约定。
- [x] COMMIT：形成仅含包骨架的可审查提交。

### Task 02: validateConfig_unsafeOptions_rejectsWithoutSideEffects

**任务编号**：DEV-DI-002

- Goal: 实现 `SDKResult`、稳定错误码和配置校验，拒绝缺失 appKey、sampleRate、platform、tenantId、长期 secret 与非法选择器。
- Acceptance:
  - 非法配置返回稳定错误码，不抛宿主未捕获异常。
  - 校验失败不注册监听器、不访问存储、不创建 Worker。
  - appKey 仅作为公开应用标识。
- Verify:
  - Run: `yarn workspace @datainsights/browser-sdk vitest run test/config.test.ts`
  - Expected: 合法/非法/未知字段和零副作用用例全部通过。
- Dependencies: T01。
- Files:
  - Create: `src/public/types.ts`
  - Create: `src/config/config.ts`
  - Modify: `src/index.ts`
  - Test: `test/config.test.ts`
- [x] RED：先写配置拒绝和无副作用测试。
- [x] VERIFY RED：确认因校验器缺失而失败。
- [x] GREEN：实现最小 schema、默认值和 Result 映射。
- [x] VERIFY GREEN：运行定向测试。
- [x] REFACTOR：集中常量和错误消息脱敏。
- [x] COMMIT：形成配置契约提交。

### Task 03: enforceConsent_beforeGrant_collectsNothing

**任务编号**：DEV-DI-003

- Goal: 实现 Controller 与生命周期状态机，确保授权前零采集并使 `start()` 受 Transport/IndexedDB 准备状态门控。
- Acceptance:
  - init 只创建无采集状态；未授权 start 返回 `CONSENT_REQUIRED`。
  - 重复 init/start/stop/revoke/destroy 遵守幂等规则。
  - Starting 阶段失败回到 Authorized，不启动 rrweb。
- Verify:
  - Run: `yarn workspace @datainsights/browser-sdk vitest run test/lifecycle.test.ts`
  - Expected: 状态迁移、非法调用、幂等和授权前零采集测试通过。
- Dependencies: T02。
- Files:
  - Create: `src/runtime/state-machine.ts`
  - Create: `src/runtime/client.ts`
  - Create: `src/consent/consent-manager.ts`
  - Modify: `src/index.ts`
  - Test: `test/lifecycle.test.ts`
- [ ] RED：先写授权门禁和状态迁移失败测试。
- [ ] VERIFY RED：确认状态机尚未实现导致预期失败。
- [ ] GREEN：实现最小 Controller/状态机。
- [ ] VERIFY GREEN：运行定向测试。
- [ ] REFACTOR：消除重复转换并保持状态转移显式。
- [ ] COMMIT：形成授权生命周期提交。

### Task 04: manageIdentity_hostOrAnonymous_preservesPrivacy

**任务编号**：DEV-DI-004

- Goal: 实现 host userId 优先、授权后匿名 UUID 兜底、账号切换和身份清理。
- Acceptance:
  - 授权前不读取或生成身份；无 host ID 时只使用 Web Crypto UUID。
  - 禁止 FingerprintJS 和 `Math.random()`；完整 ID 不进入诊断。
  - `identify()`/`clearIdentity()` 对账号切换结果确定。
- Verify:
  - Run: `yarn workspace @datainsights/browser-sdk vitest run test/identity.test.ts`
  - Expected: host/anonymous/clear/授权前存储边界测试通过。
- Dependencies: T03。
- Files:
  - Create: `src/identity/identity-manager.ts`
  - Create: `src/shared/uuid.ts`
  - Modify: `src/runtime/client.ts`
  - Test: `test/identity.test.ts`
- [ ] RED：先写身份来源和授权前存储测试。
- [ ] VERIFY RED：确认身份管理器缺失导致失败。
- [ ] GREEN：实现最小身份逻辑。
- [ ] VERIFY GREEN：运行定向测试。
- [ ] REFACTOR：隔离 Web Crypto 降级实现。
- [ ] COMMIT：形成身份切片提交。

### Task 05: manageSession_navigation_preservesBoundaries

**任务编号**：DEV-DI-005

- Goal: 实现 Journey/Session/Recording/Segment 标识及刷新、SPA、新标签页、空闲与显式结束边界。
- Acceptance:
  - 同标签页刷新/SPA 延续 Session 并新建 Recording；新标签页创建 Session。
  - 30 分钟无有效活动结束 Session；30 分钟连续录制只切 Segment。
  - BroadcastChannel claim 不可用时保守新建 Session。
- Verify:
  - Run: `yarn workspace @datainsights/browser-sdk vitest run test/session-manager.test.ts`
  - Expected: 时间、导航、刷新、标签页冲突和全部 StopReason 测试通过。
- Dependencies: T03、T04。
- Files:
  - Create: `src/session/session-manager.ts`
  - Create: `src/session/tab-claim.ts`
  - Create: `src/runtime/activity-tracker.ts`
  - Modify: `src/runtime/client.ts`
  - Test: `test/session-manager.test.ts`
- [ ] RED：先写刷新/新标签页/30 分钟边界测试。
- [ ] VERIFY RED：确认 Session 管理器缺失导致失败。
- [ ] GREEN：实现最小 Session 状态和活动计时。
- [ ] VERIFY GREEN：运行定向测试。
- [ ] REFACTOR：集中时间常量和 disposer。
- [ ] COMMIT：形成 Session 边界提交。

### Task 06: startRecorder_sensitiveFields_neverLeak

**任务编号**：DEV-DI-006

- Goal: 通过 rrweb 公共 `record` 入口建立 Adapter，并强制密码、hidden、认证信息和客户选择器隐私规则。
- Acceptance:
  - 密码值、hidden token、Cookie、认证 header/body 不进入 emit、日志或队列。
  - 普通业务输入默认录制；客户只能扩大 block/mask/ignore。
  - Canvas、跨域 iframe 和 network plugin 不被开启；rrweb 异常不传播给宿主。
- Verify:
  - Run: `yarn workspace @datainsights/browser-sdk vitest run test/rrweb-privacy.test.ts`
  - Expected: 密码 fixture 不含原值、普通输入存在、强制规则不可覆盖。
- Dependencies: T03、T05。
- Files:
  - Create: `src/recorder/rrweb-adapter.ts`
  - Create: `src/privacy/privacy-policy.ts`
  - Modify: `src/runtime/client.ts`
  - Test: `test/rrweb-privacy.test.ts`
  - Test: `test/fixtures/privacy-form.html`
- [ ] RED：先写真实 rrweb 隐私 fixture 测试。
- [ ] VERIFY RED：确认当前无 Adapter 或发生密码泄露而失败。
- [ ] GREEN：实现最小 Adapter 和强制策略。
- [ ] VERIFY GREEN：运行定向测试。
- [ ] REFACTOR：保持所有 rrweb 配置集中且不可被放宽。
- [ ] COMMIT：形成隐私录制提交。

### Task 07: addCustomEvent_sensitivePayload_sanitizesSafely

**任务编号**：DEV-DI-007

- Goal: 实现自定义事件名称、深度、大小、类型、循环引用和敏感键防护。
- Acceptance:
  - 非 recording 状态不排队；非法 payload 返回 `CUSTOM_EVENT_INVALID`。
  - password/token/cookie/secret 等键值被删除并计数。
  - 原型污染键、DOM、函数、Symbol、BigInt 和超限结构被拒绝。
- Verify:
  - Run: `yarn workspace @datainsights/browser-sdk vitest run test/custom-event.test.ts`
  - Expected: 正常、边界、循环、敏感键和原型污染用例通过。
- Dependencies: T03、T06。
- Files:
  - Create: `src/events/custom-event.ts`
  - Create: `src/events/safe-clone.ts`
  - Modify: `src/runtime/client.ts`
  - Test: `test/custom-event.test.ts`
- [ ] RED：先写 payload 攻击面和大小边界测试。
- [ ] VERIFY RED：确认未实现校验时失败。
- [ ] GREEN：实现最小安全克隆和校验。
- [ ] VERIFY GREEN：运行定向测试。
- [ ] REFACTOR：统一限制常量与错误映射。
- [ ] COMMIT：形成自定义事件提交。

### Task 08: persistJournal_crashWindow_recoversChunks

**任务编号**：DEV-DI-008

- Goal: 实现授权后 IndexedDB Journal，以 1 秒或 20 事件窗口提交并恢复未组批事件。
- Acceptance:
  - start 验证 IndexedDB；不可用时不启动 rrweb。
  - 1 秒/20 条、hidden/pagehide/stop/revoke/destroy 触发尾部提交。
  - 重启后按 appKey/recordingId/sequence 恢复；授权前不打开数据库。
- Verify:
  - Run: `yarn workspace @datainsights/browser-sdk vitest run test/indexeddb-journal.test.ts`
  - Expected: fake-indexeddb 中时间、计数、事务失败和恢复测试通过。
- Dependencies: T05、T06。
- Files:
  - Create: `src/persistence/database.ts`
  - Create: `src/persistence/indexeddb-journal.ts`
  - Modify: `src/runtime/client.ts`
  - Modify: `package.json`
  - Test: `test/indexeddb-journal.test.ts`
- [ ] RED：先写 1 秒/20 条和崩溃恢复测试。
- [ ] VERIFY RED：确认 Journal 缺失导致失败。
- [ ] GREEN：实现最小 schema 和事务提交。
- [ ] VERIFY GREEN：运行定向测试。
- [ ] REFACTOR：封装事务与错误转换，禁止空 catch。
- [ ] COMMIT：形成 Journal 提交。

### Task 09: persistOutbox_atomicMove_preservesUnconfirmedBatches

**任务编号**：DEV-DI-009

- Goal: 将 Journal chunk 原子组装为不可变 Outbox batch，并实现 FIFO、容量核算和跨标签页租约。
- Acceptance:
  - put Outbox 与删除 Journal 在同一事务；失败后至少保留一份数据。
  - journal+outbox 按 appKey 限制 100 MiB，不覆盖最旧数据。
  - 多标签页只有租约持有者消费；租约过期可接管。
- Verify:
  - Run: `yarn workspace @datainsights/browser-sdk vitest run test/indexeddb-outbox.test.ts`
  - Expected: 原子失败、FIFO、容量、租约竞争与接管测试通过。
- Dependencies: T08。
- Files:
  - Create: `src/persistence/indexeddb-outbox.ts`
  - Create: `src/persistence/dispatcher-lease.ts`
  - Modify: `src/persistence/database.ts`
  - Test: `test/indexeddb-outbox.test.ts`
  - Test: `test/dispatcher-lease.test.ts`
- [ ] RED：先写原子迁移和租约竞争测试。
- [ ] VERIFY RED：确认 Outbox/lease 缺失导致失败。
- [ ] GREEN：实现最小原子事务、索引和租约。
- [ ] VERIFY GREEN：运行两个定向测试。
- [ ] REFACTOR：集中容量估算和 lease 时钟。
- [ ] COMMIT：形成 Outbox 提交。

### Task 10: buildBatch_orderedEvents_producesStableHash

**任务编号**：DEV-DI-010

- Goal: 实现批次阈值、连续 sequence、稳定 batchId、规范化序列化、SHA-256 和 previousBatchHash。
- Acceptance:
  - 100 事件/512 KiB/5 秒/segment/stop/manual 任一条件封批。
  - 相同不可变批次重试时 ID、序列、字节和 hash 不变。
  - Worker 与同步降级产生等价 schema；公共类型不泄露 rrweb 内部类型。
- Verify:
  - Run: `yarn workspace @datainsights/browser-sdk vitest run test/batcher-integrity.test.ts`
  - Expected: 阈值、顺序、单事件上限、哈希链和双序列化路径测试通过。
- Dependencies: T08、T09。
- Files:
  - Create: `src/pipeline/batcher.ts`
  - Create: `src/pipeline/serializer.ts`
  - Create: `src/pipeline/serialization.worker.ts`
  - Create: `src/delivery/integrity.ts`
  - Test: `test/batcher-integrity.test.ts`
- [ ] RED：先写稳定字节、sequence 和 hash chain 测试。
- [ ] VERIFY RED：确认组批/哈希尚未实现而失败。
- [ ] GREEN：实现最小组批、规范化和哈希。
- [ ] VERIFY GREEN：运行定向测试。
- [ ] REFACTOR：隔离 Worker 通信与同步降级。
- [ ] COMMIT：形成批次完整性提交。

### Task 11: validateReceipt_mismatchedAck_keepsOutbox

**任务编号**：DEV-DI-011

- Goal: 定义 discriminated Transport 契约并实现持久化回执严格校验。
- Acceptance:
  - 仅 batchId/recordingId/sequence/hash 全匹配且 persisted=true 时删除 Outbox。
  - HTTP 2xx、sendBeacon true、缺失/错误 receipt 均保留批次。
  - `persisted-receipt-v1` 强制实现 reconcile；内置 Transport 标记 test-only。
- Verify:
  - Run: `yarn workspace @datainsights/browser-sdk vitest run test/transport-receipt.test.ts`
  - Expected: 匹配、字段冲突、无回执和 test-only capability 用例通过。
- Dependencies: T09、T10。
- Files:
  - Create: `src/transport/types.ts`
  - Create: `src/delivery/receipt-validator.ts`
  - Create: `src/transport/memory.ts`
  - Modify: `src/persistence/indexeddb-outbox.ts`
  - Test: `test/transport-receipt.test.ts`
- [ ] RED：先写“错误回执绝不删除”测试。
- [ ] VERIFY RED：确认当前无校验器导致失败。
- [ ] GREEN：实现最小类型和 receipt validator。
- [ ] VERIFY GREEN：运行定向测试及类型检查。
- [ ] REFACTOR：用 discriminated union 消除运行时歧义。
- [ ] COMMIT：形成回执门槛提交。

### Task 12: dispatchOutbox_transientFailure_schedulesRecovery

**任务编号**：DEV-DI-012

- Goal: 实现单通道 Dispatcher、有限重试、jitter、circuit 和多触发恢复调度。
- Acceptance:
  - 同一 recording 严格顺序发送；1s/2s/4s ±20% 最多三次。
  - startup/online/scheduled/pagehide/manual 可唤醒；三次失败不删除批次。
  - rejected 标记 blocked 并停止当前 Recording；AbortSignal 可取消所有定时器。
- Verify:
  - Run: `yarn workspace @datainsights/browser-sdk vitest run test/outbox-dispatcher.test.ts`
  - Expected: fake timer 下顺序、jitter、circuit、唤醒、取消和 pagehide 用例通过。
- Dependencies: T11。
- Files:
  - Create: `src/pipeline/outbox-dispatcher.ts`
  - Create: `src/transport/mock-http.ts`
  - Modify: `src/runtime/client.ts`
  - Test: `test/outbox-dispatcher.test.ts`
  - Test: `test/mock-http-transport.test.ts`
- [ ] RED：先写三次失败保留 Outbox 和恢复触发测试。
- [ ] VERIFY RED：确认 Dispatcher 缺失导致失败。
- [ ] GREEN：实现最小调度与状态转换。
- [ ] VERIFY GREEN：运行两个定向测试。
- [ ] REFACTOR：注入 clock/random 使重试确定可测。
- [ ] COMMIT：形成网络恢复提交。

### Task 13: reconcileSequence_missingRanges_resendsAvailableBatches

**任务编号**：DEV-DI-013

- Goal: 实现 startup/online/gap 对账、缺失区间校验和基于 Outbox 的定向重传。
- Acceptance:
  - 合法 missingRanges 只选择交叠的同 recording 批次并复用原 batchId/hash。
  - 非法范围、服务端超前冲突或本地不可恢复缺口返回 `RECONCILIATION_FAILED`。
  - 对账结果自身不能删除未取得有效 receipt 的批次。
- Verify:
  - Run: `yarn workspace @datainsights/browser-sdk vitest run test/reconciliation.test.ts`
  - Expected: 连续、单缺口、多缺口、非法区间和不可恢复用例通过。
- Dependencies: T11、T12。
- Files:
  - Create: `src/delivery/reconciliation.ts`
  - Modify: `src/pipeline/outbox-dispatcher.ts`
  - Modify: `src/transport/mock-http.ts`
  - Test: `test/reconciliation.test.ts`
- [ ] RED：先写 missing ranges 定向选择和不删除测试。
- [ ] VERIFY RED：确认 reconciliation 缺失导致失败。
- [ ] GREEN：实现最小区间校验和重传选择。
- [ ] VERIFY GREEN：运行定向测试。
- [ ] REFACTOR：提取纯区间函数并覆盖边界。
- [ ] COMMIT：形成对账补偿提交。

### Task 14: reportDeliveryState_capacityThresholds_staysLocal

**任务编号**：DEV-DI-014

- Goal: 实现脱敏 DebugInfo、70/90/100% 容量等级、宿主回调和统一 ResourceRegistry。
- Acceptance:
  - warning/critical/full 状态准确；full 停止新增录制且不删除旧数据。
  - DebugInfo/回调不含完整 appKey、身份、URL query、DOM 或 payload。
  - 回调抛错被隔离；SDK 不创建任何遥测请求；destroy 后资源计数归零但保留未确认 Outbox。
- Verify:
  - Run: `yarn workspace @datainsights/browser-sdk vitest run test/diagnostics-resources.test.ts`
  - Expected: 水位、脱敏、回调异常、无网络遥测和资源释放测试通过。
- Dependencies: T03、T09、T13。
- Files:
  - Create: `src/diagnostics/diagnostics.ts`
  - Create: `src/runtime/resource-registry.ts`
  - Modify: `src/runtime/client.ts`
  - Test: `test/diagnostics-resources.test.ts`
- [ ] RED：先写容量状态、敏感字段扫描和资源清零测试。
- [ ] VERIFY RED：确认诊断/Registry 缺失导致失败。
- [ ] GREEN：实现最小本地诊断和 disposer 管理。
- [ ] VERIFY GREEN：运行定向测试。
- [ ] REFACTOR：统一错误摘要和资源注册接口。
- [ ] COMMIT：形成诊断资源提交。

### Task 15: bootstrapScript_missingTransport_failsClosed

**任务编号**：DEV-DI-015

- Goal: 实现 UMD 全局 facade、data-app-key 解析、固定版本资源和缺失 Transport 的 fail-closed 行为。
- Acceptance:
  - 页面只有一个 `window.DataInsights`；Script Tag 不自动授权或启动录制。
  - 未配置 Transport 时 start 返回 `TRANSPORT_NOT_CONFIGURED`，不回退 MemoryTransport。
  - 固定版本、Worker URL 和 CSP 场景可加载；latest 仅文档标记为开发用途。
- Verify:
  - Run: `yarn workspace @datainsights/browser-sdk vitest run test/script-tag.integration.test.ts`
  - Expected: Puppeteer 中全局对象、授权门禁、缺 Transport、重复加载和 CSP 用例通过。
- Dependencies: T03、T10、T14。
- Files:
  - Create: `src/browser-entry.ts`
  - Modify: `vite.config.ts`
  - Create: `test/script-tag.integration.test.ts`
  - Create: `test/html/script-tag.html`
  - Create: `README.md`
- [ ] RED：先写浏览器端缺 Transport 和重复加载测试。
- [ ] VERIFY RED：确认 bootstrap 尚不存在而失败。
- [ ] GREEN：实现最小全局入口和 fail-closed 行为。
- [ ] VERIFY GREEN：运行定向集成测试。
- [ ] REFACTOR：集中 script 属性解析和诊断。
- [ ] COMMIT：形成 Script Tag 提交。

### Task 16: replaySegment_untrustedFixture_rebuildsSandboxed

**任务编号**：DEV-DI-016

- Goal: 验证 RecordingBatch、30 分钟 Segment、恢复全量快照和本地 Sandboxed Rebuild 的回放兼容性。
- Acceptance:
  - 明确 Journal Chunk、RecordingBatch、RecordingSegment 与未来 Replay Chunk/Manifest 的不同职责。
  - segment 切换不改变 sessionId，刷新创建 Recording 并先生成全量快照。
  - iframe sandbox 仅包含 `allow-same-origin`，绝不包含 `allow-scripts`；恶意 fixture 不执行脚本。
- Verify:
  - Run: `yarn workspace @datainsights/browser-sdk vitest run test/replay-segment.integration.test.ts`
  - Expected: 跨 segment 回放、刷新恢复、gap 警告和恶意 DOM 沙箱测试通过。
- Dependencies: T05、T06、T10。
- Files:
  - Create: `test/replay-segment.integration.test.ts`
  - Create: `test/html/sandbox-replay.html`
  - Create: `test/fixtures/replay-segments.json`
  - Create: `test/fixtures/untrusted-replay.json`
  - Create: `examples/local-replay/index.html`
- [ ] RED：先写 segment 恢复和恶意脚本不执行测试。
- [ ] VERIFY RED：确认本地回放验证工具缺失而失败。
- [ ] GREEN：创建最小 fixture 和沙箱回放验证页。
- [ ] VERIFY GREEN：运行定向浏览器测试。
- [ ] REFACTOR：保持本地工具与生产 SDK 边界分离。
- [ ] COMMIT：形成 Replay 验证提交。

### Task 17: verifyRelease_sdkBoundary_passesRegressionBudgets

**任务编号**：DEV-DI-017

- Goal: 收口构建元数据、包内容、兼容矩阵、长期/性能预算和 upstream 升级回归证据。
- Acceptance:
  - 产物注入 SDK/rrweb version 与 commit，package tarball 不含凭证或内部地址。
  - 30 分钟/2 小时、DOM 规模、Mutation、FPS、内存、IndexedDB 和 bundle size 有可重复基准。
  - rrweb 上游原测试、DataInsights 全量测试、类型检查和 build 通过；无 rrweb 核心补丁时不创建空补丁表。
- Verify:
  - Run: `yarn workspace @datainsights/browser-sdk test && yarn workspace @datainsights/browser-sdk check-types && yarn workspace @datainsights/browser-sdk prepublish`
  - Run: `yarn turbo run test check-types --filter=@datainsights/browser-sdk --filter=@rrweb/record --filter=rrweb`
  - Expected: SDK 全量验证与受影响上游回归通过，性能报告无超预算项。
- Dependencies: T01-T16。
- Files:
  - Create: `buildMetadata.ts`
  - Modify: `vite.config.ts`
  - Modify: `package.json`
  - Create: `test/benchmark/sdk-overhead.test.ts`
  - Create: `UPSTREAM_SYNC.md`
- [ ] RED：先建立会因缺元数据/超预算/缺资源释放而失败的发布检查。
- [ ] VERIFY RED：确认发布检查能捕获当前缺口。
- [ ] GREEN：补齐最小构建元数据、基准和发布文档。
- [ ] VERIFY GREEN：运行 SDK 全量及受影响上游回归。
- [ ] REFACTOR：移除重复测试设置并固定可重复基准参数。
- [ ] COMMIT：形成发布与升级保障提交。

## Checkpoint 执行要求

每个 Checkpoint 必须记录以下证据后才允许继续：

- 已完成 Task 的 RED 与 GREEN 命令和结果；
- `yarn workspace @datainsights/browser-sdk check-types`；
- `yarn workspace @datainsights/browser-sdk vitest run`；
- 新增公共 API、schema 或持久化结构是否仍与 `design.md` 一致；
- 是否触碰 rrweb 核心、是否出现范围外后端/分析实现；
- 密码、认证信息、完整身份和事件 payload 是否出现在日志/诊断/fixture 泄露扫描中。

## 风险与阻塞

- Risk: IndexedDB、BroadcastChannel、Worker、Web Crypto 和 pagehide 在浏览器间存在差异；相关任务必须有降级或 fail-closed 测试。
- Risk: 回执/对账契约只有 Mock，不能声称生产端到端持久化 SLA。
- Risk: Replay 数据在 IndexedDB 中受同源 XSS、用户清理和浏览器驱逐影响，不能承诺绝对零丢失。
- Blocker: 任一 Task 发现必须修改 rrweb 核心时，停止实现并创建 L1/L2 ADR 等待批准。
- Blocker: 生产 Transport、后端分析或正式 Replay 服务需求进入时，应新建 OpenSpec Change，不扩张本任务清单。
- Rollback: 独立 package、版本化存储命名空间和固定 CDN 版本允许删除/回退 DataInsights 包而不改变 rrweb 核心。

## 提测与交接准备

- [x] Tasks 经人工批准后才进入 Apply。（用户于 2026-10-26 明确批准按建议顺序开工）
- [ ] 后续创建 `test-cases.md`，覆盖单元、浏览器、异常、隐私、可靠性、性能和上游回归证据。
- [ ] 每个 Task 完成后记录实现摘要、风险点和人工 review 关注点。
- [ ] 不生成服务端分析、正式存储或管理后台测试用例。

## 任务完成定义

- [ ] 每个任务都有明确 Acceptance、Verify、Dependencies 和 Files。
- [ ] 没有“实现整个 SDK”式 XL 任务。
- [ ] 每个任务原则上不超过 5 个主要文件。
- [ ] 依赖顺序和每 2-3 个任务的 Checkpoint 已明确。
- [ ] 所有实现任务要求先看到有效 RED，再进入 GREEN。
- [ ] SDK 与服务端/分析/正式 Replay 平台边界已明确。
- [x] 进入 Apply 前已取得用户对本任务清单的明确批准。（2026-10-26）

## 参考规范

- OpenSpec `proposal.md`、`design.md`、`prd/`
- OpenSpec Task Breakdown Overlay
- Superpowers Test-Driven Development
- rrweb workspace、Vite、Vitest、Puppeteer、Turbo 现有规范
- SGS 编码规范中的 SOLID、安全、渐进修改、异常处理和文档同步原则
