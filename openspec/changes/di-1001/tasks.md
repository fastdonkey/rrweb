# DI-1001 DataInsights 前端 SDK 开发任务清单 v1.4

## 基本信息

| 项目     | 内容                                                                   |
| -------- | ---------------------------------------------------------------------- |
| 功能名称 | 基于 rrweb Fork 构建 DataInsights 浏览器 SDK                           |
| 需求编号 | DI-1001                                                                |
| 任务总数 | 35（T01-T23 已完成；T24-T28 SDK 待办；T29-T32 后续链路；T33-T35 优先） |
| 创建日期 | 2026-10-26；2026-10-27 增补压缩与 Trace 链路                           |
| 参考文档 | `proposal.md` v1.5、`design.md` v1.7、`prd/` v1.10                     |
| 当前阶段 | 基线 Apply Complete；T33-T35 已实现待提交；压缩主线暂停于 T24          |
| 实现分支 | `futrue-v1`                                                            |

## 范围护栏

本任务清单当前可实施范围只包含 SDK 边界内能力：授权后录制、隐私、身份与 Session、Replay 事件分段、本地持久化、可靠投递契约、Mock 验证、本地沙箱回放、无损压缩编码及上游升级保障。

以下能力不进入 DI-1001 的当前 Apply：生产接收服务、服务端去重/乱序窗口/迟到事件水位线/补偿计算、趋势/漏斗/留存/路径正式语义、服务端 Replay Manifest/对象存储/正式播放器、留存删除传播和法律存证。T29-T32 仅用于保存端到端压缩链路待办，实施前必须建立独立 OpenSpec Change 并重新完成 Proposal、Design 和 Tasks 审批。

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
T05 + T10 → T33  （用户确认优先于 T25 执行）
T06 + T22 → T34  （用户确认优先于 T25 执行）
T22 + T34 → T35  （扩展本地保险复杂交互验证）
T10 + T17 → T24 → T25 → T26 → T27 → T28
T28 → T29 → T30 → T31 → T32  （T29 起必须迁移到后续 OpenSpec Change）
```

顺序原因：公共类型和授权门禁是所有行为的入口；身份、Session 和隐私录制必须先建立事件语义；Journal/Outbox 必须先于 Transport 删除与恢复策略；回执、调度和对账依赖稳定批次；浏览器入口、回放验证和发布回归最后集成。

## Checkpoint 计划

| Checkpoint | After Tasks | Re-check Focus                                              |
| ---------- | ----------- | ----------------------------------------------------------- |
| CP-1       | T01-T03     | 包边界、公共 API、授权前零采集和无顶层副作用                |
| CP-2       | T04-T07     | 身份/Session 边界、密码强制保护、rrweb 核心零修改           |
| CP-3       | T08-T10     | 1 秒/20 事件窗口、原子恢复、100 MiB 容量、批次哈希一致性    |
| CP-4       | T11-T13     | 持久化回执删除门槛、重试调度、缺口对账与定向重传            |
| CP-5       | T14-T15     | 本地诊断无遥测、资源释放、Script Tag 生命周期和 CSP         |
| CP-6       | T16-T17     | Replay 分层边界、沙箱安全、性能预算、构建产物和上游回归     |
| CP-Trace   | T33         | SDK 自动 Trace 生命周期、刷新恢复、终止轮换和批次关联       |
| CP-Pacing  | T34         | 50ms 滚动采样、0.75x 核验速度、默认 1x 和不跳过空闲         |
| CP-Notices | T35         | 五份须知逐项阅读、滚动门禁、幂等确认、提交与回放证据        |
| CP-7A      | T24-T25     | 压缩协议版本、无损往返、Worker/兼容降级和主线程预算         |
| CP-7B      | T26-T28     | IndexedDB 实际占用、压缩传输、回放一致性和真实压缩率        |
| CP-8       | T29-T32     | 后端接收、对象存储、Replay 读取和生命周期；后续 Change 执行 |

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
- [x] RED：先写授权门禁和状态迁移失败测试。
- [x] VERIFY RED：确认状态机尚未实现导致预期失败。
- [x] GREEN：实现最小 Controller/状态机。
- [x] VERIFY GREEN：运行定向测试。
- [x] REFACTOR：消除重复转换并保持状态转移显式。
- [x] COMMIT：形成授权生命周期提交。

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
- [x] RED：先写身份来源和授权前存储测试。
- [x] VERIFY RED：确认身份管理器缺失导致失败。
- [x] GREEN：实现最小身份逻辑。
- [x] VERIFY GREEN：运行定向测试。
- [x] REFACTOR：隔离 Web Crypto 降级实现。
- [x] COMMIT：形成身份切片提交。

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
- [x] RED：先写刷新/新标签页/30 分钟边界测试。
- [x] VERIFY RED：确认 Session 管理器缺失导致失败。
- [x] GREEN：实现最小 Session 状态和活动计时。
- [x] VERIFY GREEN：运行定向测试。
- [x] REFACTOR：集中时间常量和 disposer。
- [x] COMMIT：形成 Session 边界提交。

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
- [x] RED：先写真实 rrweb 隐私 fixture 测试。
- [x] VERIFY RED：确认当前无 Adapter 或发生密码泄露而失败。
- [x] GREEN：实现最小 Adapter 和强制策略。
- [x] VERIFY GREEN：运行定向测试。
- [x] REFACTOR：保持所有 rrweb 配置集中且不可被放宽。
- [x] COMMIT：形成隐私录制提交。

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
- [x] RED：先写 payload 攻击面和大小边界测试。
- [x] VERIFY RED：确认未实现校验时失败。
- [x] GREEN：实现最小安全克隆和校验。
- [x] VERIFY GREEN：运行定向测试。
- [x] REFACTOR：统一限制常量与错误映射。
- [x] COMMIT：形成自定义事件提交。

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
- [x] RED：先写 1 秒/20 条和崩溃恢复测试。
- [x] VERIFY RED：确认 Journal 缺失导致失败。
- [x] GREEN：实现最小 schema 和事务提交。
- [x] VERIFY GREEN：运行定向测试。
- [x] REFACTOR：封装事务与错误转换，禁止空 catch。
- [x] COMMIT：形成 Journal 提交。

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
- [x] RED：先写原子迁移和租约竞争测试。
- [x] VERIFY RED：确认 Outbox/lease 缺失导致失败。
- [x] GREEN：实现最小原子事务、索引和租约。
- [x] VERIFY GREEN：运行两个定向测试。
- [x] REFACTOR：集中容量估算和 lease 时钟。
- [x] COMMIT：形成 Outbox 提交。

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
- [x] RED：先写稳定字节、sequence 和 hash chain 测试。
- [x] VERIFY RED：确认组批/哈希尚未实现而失败。
- [x] GREEN：实现最小组批、规范化和哈希。
- [x] VERIFY GREEN：运行定向测试。
- [x] REFACTOR：隔离 Worker 通信与同步降级。
- [x] COMMIT：形成批次完整性提交。

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
- [x] RED：先写“错误回执绝不删除”测试。
- [x] VERIFY RED：确认当前无校验器导致失败。
- [x] GREEN：实现最小类型和 receipt validator。
- [x] VERIFY GREEN：运行定向测试及类型检查。
- [x] REFACTOR：用 discriminated union 消除运行时歧义。
- [x] COMMIT：形成回执门槛提交。

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
- [x] RED：先写三次失败保留 Outbox 和恢复触发测试。
- [x] VERIFY RED：确认 Dispatcher 缺失导致失败。
- [x] GREEN：实现最小调度与状态转换。
- [x] VERIFY GREEN：运行两个定向测试。
- [x] REFACTOR：注入 clock/random 使重试确定可测。
- [x] COMMIT：形成网络恢复提交。

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
- [x] RED：先写 missing ranges 定向选择和不删除测试。
- [x] VERIFY RED：确认 reconciliation 缺失导致失败。
- [x] GREEN：实现最小区间校验和重传选择。
- [x] VERIFY GREEN：运行定向测试。
- [x] REFACTOR：提取纯区间函数并覆盖边界。
- [x] COMMIT：形成对账补偿提交。

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
- [x] RED：先写容量状态、敏感字段扫描和资源清零测试。
- [x] VERIFY RED：确认诊断/Registry 缺失导致失败。
- [x] GREEN：实现最小本地诊断和 disposer 管理。
- [x] VERIFY GREEN：运行定向测试。
- [x] REFACTOR：统一错误摘要和资源注册接口。
- [x] COMMIT：形成诊断资源提交。

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
- [x] RED：先写浏览器端缺 Transport 和重复加载测试。
- [x] VERIFY RED：确认 bootstrap 尚不存在而失败。
- [x] GREEN：实现最小全局入口和 fail-closed 行为。
- [x] VERIFY GREEN：运行定向集成测试。
- [x] REFACTOR：集中 script 属性解析和诊断。
- [x] COMMIT：形成 Script Tag 提交。

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
- [x] RED：先写 segment 恢复和恶意脚本不执行测试。
- [x] VERIFY RED：确认本地回放验证工具缺失而失败。
- [x] GREEN：创建最小 fixture 和沙箱回放验证页。
- [x] VERIFY GREEN：运行定向浏览器测试。
- [x] REFACTOR：保持本地工具与生产 SDK 边界分离。
- [x] COMMIT：形成 Replay 验证提交。

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
- [x] RED：先建立会因缺元数据/超预算/缺资源释放而失败的发布检查。
- [x] VERIFY RED：确认发布检查能捕获当前缺口。
- [x] GREEN：补齐最小构建元数据、基准和发布文档。
- [x] VERIFY GREEN：运行 SDK 全量及受影响上游回归。（SDK 全绿；rrweb 锁定 Chrome 115 下 311 通过/3 跳过，保留 4 个 macOS ARM 图像快照基线差异，未更新快照。）
- [x] REFACTOR：移除重复测试设置并固定可重复基准参数。
- [x] COMMIT：形成发布与升级保障提交。

### Task 18: resolveAppKey_trustedRoute_returnsValidatedConfig

**任务编号**：DEV-DI-018

- Goal: 由格式化 AppKey 选择受信任配置中心并校验应用配置，禁止客户端填写 endpoint 或构造任意 URL。
- Acceptance:
  - `di_{environment}_{region}_{randomId}` 仅接受已知环境/区域和安全字符。
  - 配置响应校验 appKey、启停状态、版本、主备 Collector、短期凭证和过期时间。
  - 未知路由、过期/非法配置均 fail closed，授权前无录制副作用。
- Verify: `yarn workspace @datainsights/browser-sdk vitest run test/app-key-config.test.ts`
- Dependencies: T02、T11。
- Files: `src/config/app-key.ts`、`src/config/remote-config.ts`、`src/public/types.ts`、`test/app-key-config.test.ts`。
- [x] RED
- [x] VERIFY RED
- [x] GREEN
- [x] VERIFY GREEN
- [x] REFACTOR
- [x] COMMIT

### Task 19: sendResolvedHttpTransport_exactReceipt_preservesDurability

**任务编号**：DEV-DI-019

- Goal: 根据已校验配置创建标准 HTTP Transport，支持精确回执、对账和主备 Collector 切换。
- Acceptance:
  - 只使用 resolver 返回的地址和短期凭证。
  - HTTP 2xx 但回执不匹配时不删除 Outbox。
  - 主节点暂时失败可切换备用节点；AbortSignal 和 destroy 生效。
- Verify: `yarn workspace @datainsights/browser-sdk vitest run test/http-transport.test.ts test/transport-receipt.test.ts`
- Dependencies: T18、T11-T13。
- Files: `src/transport/http.ts`、`src/transport/types.ts`、`test/http-transport.test.ts`。
- [x] RED
- [x] VERIFY RED
- [x] GREEN
- [x] VERIFY GREEN
- [x] REFACTOR
- [x] COMMIT

### Task 20: bootstrap_startSelector_clickStartsRecording

**任务编号**：DEV-DI-020

- Goal: 提供无需 endpoint/Transport/Worker 配置的推荐 `bootstrap()`，由嵌入方按钮真实点击触发授权和录制。
- Acceptance:
  - 页面加载及配置解析完成时不自动授权或录制。
  - 点击 `startSelector` 后记录 noticeVersion，解析可选 userId，并只启动一次。
  - 配置失败、selector 无效、身份回调异常和 destroy 都不影响宿主页面且可诊断。
- Verify: `yarn workspace @datainsights/browser-sdk vitest run test/bootstrap.test.ts test/script-tag.integration.test.ts`
- Dependencies: T18、T19、T03、T15。
- Files: `src/runtime/bootstrap.ts`、`src/runtime/client.ts`、`src/runtime/state-machine.ts`、`src/browser-entry.ts`、`test/bootstrap.test.ts`。
- [x] RED
- [x] VERIFY RED
- [x] GREEN
- [x] VERIFY GREEN
- [x] REFACTOR
- [x] COMMIT

### Task 21: probeIndexedDb_runtimeFailure_failsClosed

**任务编号**：DEV-DI-021

- Goal: 以真实 open/write/read/delete 探测作为录制门禁，并建立自动化/真机兼容矩阵。
- Acceptance:
  - 缺失、拒绝、事务异常或读回不一致均返回 `PERSISTENCE_UNAVAILABLE`，不启动 rrweb。
  - Storage Estimate/Persist 支持状态可诊断；persist 被拒绝不虚报成功。
  - 真机未执行项明确标为 Pending，不用移动 viewport 冒充真机通过。
- Verify: `yarn workspace @datainsights/browser-sdk vitest run test/persistence-capability.test.ts test/indexeddb-journal.test.ts test/indexeddb-outbox.test.ts`
- Dependencies: T08、T09、T20。
- Files: `src/persistence/capability.ts`、`src/persistence/database.ts`、`src/runtime/client.ts`、`test/persistence-capability.test.ts`、`COMPATIBILITY.md`。
- [x] RED
- [x] VERIFY RED
- [x] GREEN
- [x] VERIFY GREEN
- [x] REFACTOR
- [x] COMMIT

### Task 22: recordInsuranceClone_realInteraction_replaysLocally

**任务编号**：DEV-DI-022

- Goal: 提供可人工访问的去生产化保险产品页面、本地 Config/Collector 和真实 rrweb 回放。
- Acceptance:
  - 页面参考指定保险产品的移动端长页面和投保交互，但没有第三方脚本、生产接口、Cookie、Fingerprint 或监控。
  - 使用发布 UMD/Worker、测试 AppKey、Mock Config 和精确持久化回执完成真实录制。
  - 普通保险字段可回放，密码不存在；回放 iframe 不允许脚本；任何非本地请求使测试失败。
  - 提供 `demo:insurance` 和 `test:insurance-e2e` 命令。
- Verify: `yarn workspace @datainsights/browser-sdk vitest run test/insurance-product.e2e.test.ts test/replay-segment.integration.test.ts`
- Dependencies: T20、T21、T16。
- Files: `examples/insurance-product/`、`scripts/insurance-demo.mjs`、`test/insurance-product.e2e.test.ts`、`test/replay-segment.integration.test.ts`、`package.json`。
- [x] RED
- [x] VERIFY RED
- [x] GREEN
- [x] VERIFY GREEN
- [x] REFACTOR
- [x] COMMIT

### Task 23: verifySimplifiedIntegration_fullRegression_evidenceComplete

**任务编号**：DEV-DI-023

- Goal: 更新需求、接入、兼容和测试证据，并完成 SDK/上游顺序回归。
- Acceptance:
  - 推荐示例不含 endpoint 或长期 secret，并说明 AppKey 路由、noticeVersion、本地演示和 fail-closed。
  - SDK 全量、类型、构建、发布产物、保险 E2E 和受影响 rrweb 回归完成。
  - 真机 Pending、既有上游像素差异和后端范围明确记录，不虚报通过。
- Verify: 见 `implementation-plan-v1.4.md` Task 23，所有浏览器构建命令顺序执行。
- Dependencies: T18-T22。
- Files: `README.md`、`prd/`、`proposal.md`、`tasks.md`、`test-cases.md`、`review-report.md`。
- [x] RED
- [x] VERIFY RED
- [x] GREEN
- [x] VERIFY GREEN
- [x] REFACTOR
- [x] COMMIT

### Task 33: generateTraceId_sdkOwned_groupsOneContinuousRecording

**任务编号**：DEV-DI-033
**优先级/范围**：P0 / 当前 SDK，优先于 T25

- Goal: 由 SDK 自动建立一次连续录制的 `traceId`，作为跨页关联与后续数据清洗的原始键。
- Acceptance:
  - `start()` 只允许客户传入可选 `userId`，不接收 `traceId`、`journeyId` 或 `journeyType`。
  - SDK 使用 UUIDv4 自动生成 `traceId`；客户输入无法覆盖。
  - 同标签页手动暂停后继续与同源刷新恢复保持 `traceId`；新标签页保守新建。
  - completed/cancelled/logout/auth-expired/consent-revoked/idle-timeout 结束 Trace，之后再次启动产生新值。
  - `RecordingContext` 和每个 `RecordingBatchV1` 都包含相同 `traceId`；不对其编码保险或其他行业语义。
- Verify: `yarn workspace @datainsights/browser-sdk vitest run test/session-manager.test.ts test/batcher-integrity.test.ts`
- Dependencies: T05、T10。
- Files:
  - Modify: `src/public/types.ts`
  - Modify: `src/session/session-manager.ts`
  - Modify: `src/runtime/client.ts`
  - Modify: `src/pipeline/batcher.ts`
  - Test: `test/session-manager.test.ts`
  - Test: `test/batcher-integrity.test.ts`
- [x] RED：先写 SDK 自动 Trace、刷新继承和终止轮换测试。
- [x] VERIFY RED：定向测试 7 个用例因 `traceId` 缺失按预期失败。
- [x] GREEN：在 Session 持久状态中生成/恢复 Trace，并贯穿运行时和批次上下文。
- [x] VERIFY GREEN：定向 32 tests、SDK 全量 179 tests、类型检查和构建通过。
- [x] REFACTOR：移除客户 `journeyId` 契约，兼容旧 Session 存储并为其自动补生 `traceId`。
- [ ] COMMIT

### Task 34: improveReplayPacing_higherScrollFidelity_offersReviewSpeed

**任务编号**：DEV-DI-034
**优先级/范围**：P0 / 当前 SDK 与本地核验播放器，优先于 T25

- Goal: 降低滚动回放的跳跃感，并提供不伪装为 1x 的慢速人工核验选项。
- Acceptance:
  - rrweb scroll 采样由 150ms 调整为 50ms，`mousemove` 继续关闭，`input: 'all'` 不变。
  - 本地播放器提供 `0.75x/1x/2x/4x/8x`，默认仍为 1x。
  - `skipInactive` 保持 false，播放不改写原始事件时间戳。
  - 不修改 rrweb 核心 Timer，不引入合成滚动插值，不将 0.75x 标识为 1x。
- Verify: `yarn workspace @datainsights/browser-sdk vitest run test/rrweb-privacy.test.ts test/insurance-product.e2e.test.ts`
- Dependencies: T06、T22。
- Files:
  - Modify: `src/recorder/rrweb-adapter.ts`
  - Modify: `examples/insurance-product/replay.html`
  - Test: `test/rrweb-privacy.test.ts`
  - Test: `test/insurance-product.e2e.test.ts`
- [x] RED：先增加 50ms scroll 配置与 0.75x 播放按钮断言。
- [x] VERIFY RED：单元测试因实际仍为 150ms 失败；E2E 因缺少 0.75x 失败。
- [x] GREEN：仅调整 Recorder scroll 节流和本地播放器速度列表。
- [x] VERIFY GREEN：定向 2 files / 6 tests 通过。
- [x] REFACTOR：保持时间语义与 rrweb 核心零侵入，明确不引入视觉插值。
- [ ] COMMIT

### Task 35: confirmInsuranceNotices_scrollGate_replaysFullProcess

**任务编号**：DEV-DI-035
**优先级/范围**：P0 / 本地保险 Demo 与真实浏览器验证

- Goal: 构建保险行业常见的多份须知逐项阅读确认流程，验证 SDK 可以完整录制并回放打开、滚动、确认顺序、状态变化与提交门禁。
- Acceptance:
  - 固定展示投保须知、保险条款、健康告知、免责条款和个人信息处理授权书五项去生产化模拟文件。
  - 每项打开共享底部弹层；未滚动到底不能确认，关闭未读文件不改变状态。
  - 确认幂等并保留首次确认顺序；全部确认前提交按钮禁用，完成后才允许提交。
  - `insurance-notices-confirmed` 自定义事件只出现一次，只含版本、文档代码与确认顺序，不含正文或用户输入。
  - 真实回放最终显示五项已确认；密码保护、播放器速度、进度条、沙箱和零外网断言不回归。
  - 该能力只扩展保险行业 Demo，不修改通用 SDK API 或 rrweb 核心。
- Verify: `yarn workspace @datainsights/browser-sdk vitest run test/insurance-product.e2e.test.ts`
- Dependencies: T22、T34。
- Files:
  - Modify: `examples/insurance-product/index.html`
  - Modify: `examples/insurance-product/styles.css`
  - Modify: `examples/insurance-product/app.js`
  - Test: `test/insurance-product.e2e.test.ts`
  - Docs: `docs/superpowers/specs/2026-10-27-insurance-notice-confirmation-design.md`
- [x] RED：保险 E2E 在应有 5 项须知但实际为 0 项处失败。
- [x] VERIFY RED：失败原因为须知 DOM 和交互尚不存在，不是构建或测试环境错误。
- [x] GREEN：实现固定文档模型、共享弹层、到底检测、幂等确认、提交门禁和脱敏自定义事件。
- [x] VERIFY GREEN：保险 E2E 真实 Chrome 通过。
- [x] REFACTOR：使用单个共享弹层与安全 DOM API，未引入外部资源或 rrweb 核心修改。
- [ ] COMMIT

### Task 36: exerciseComplexBrowserInteractions_recordsBoundariesSafely

**任务编号**：DEV-DI-036
**优先级/范围**：P1/P2 / 本地保险 Demo 与真实浏览器验证

- Goal: 在同一产品页集中构建复杂 DOM 交互和浏览器能力边界，验证 SDK 对过程状态、嵌套上下文及非 DOM 内容的实际录制效果。
- Acceptance:
  - P1 覆盖页签、手风琴、搜索联想、横向滑动、Toast、200 条虚拟列表、文件元数据和刷新恢复。
  - P2 覆盖 Canvas、WebGL、同源/跨源 iframe、本地 PDF 阅读器模拟及权限型媒体边界。
  - Canvas/WebGL 不声明像素或帧可回放；跨源 iframe 保持隔离；媒体组件不调用真实媒体权限 API。
  - 文件上传只展示名称、类型、大小，录制中不得出现文件正文和本机绝对路径。
  - 自定义事件只含固定状态、计数和索引，不含搜索、文件或 iframe 自由文本。
  - 真实回放恢复关键外围 DOM 状态，全部 HTTP(S) 请求仅访问 `127.0.0.1` 或 `localhost`。
  - 只扩展本地 Demo 和测试，不修改 SDK API 或 rrweb 核心。
- Verify: `yarn workspace @datainsights/browser-sdk vitest run test/insurance-interaction-lab.e2e.test.ts`
- Dependencies: T22、T35。
- Files:
  - Create: `examples/insurance-product/interaction-lab.js`
  - Create: `examples/insurance-product/interaction-lab.css`
  - Create: `examples/insurance-product/iframe-lab.html`
  - Create: `examples/insurance-product/pdf-reader.html`
  - Modify: `examples/insurance-product/index.html`
  - Modify: `scripts/insurance-demo.mjs`
  - Test: `test/insurance-interaction-lab.e2e.test.ts`
  - Docs: `docs/superpowers/specs/2026-10-27-insurance-interaction-stress-test-design.md`
- [x] RED：P1 测试因缺少 `#interaction-lab` 失败，P2 测试因缺少 iframe 失败。
- [x] VERIFY RED：两次失败均来自目标组件缺失，构建、浏览器和 SDK 初始化正常。
- [x] GREEN：实现 P1 复杂 DOM 交互、P2 能力边界、状态恢复和安全事件。
- [x] VERIFY GREEN：真实 Chrome 完成录制、停止、刷新恢复与回放断言。
- [x] REFACTOR：虚拟列表相同范围不重复回收节点，复杂逻辑与投保 `app.js` 隔离。
- [ ] COMMIT

## 压缩链路待办

压缩采用无损策略，不允许通过丢弃输入过程、降低关键事件采样、删除全量快照或缩短时间间隔换取体积下降。上传 Batch 与长期存储 Segment 是不同边界：SDK 负责生成可校验的压缩批次，生产服务端后续可在验收后合并并重新编码长期 Segment。

当前先完成 T33-T34，然后恢复 T25-T28。T29-T32 仅记录完整链路，属于后续生产服务端 Change，不因出现在本文件中而获得实施授权。

### Task 24: encodeRecordingBatch_versionedCodec_roundTripsLosslessly

**任务编号**：DEV-DI-024
**优先级/范围**：P0 / 当前 SDK

- Goal: 定义版本化无损录制块协议，并实现 `identity`、`gzip` 编解码及稳定的压缩元数据。
- Acceptance:
  - envelope 明确 `codec`、`codecVersion`、`uncompressedBytes`、`compressedBytes`、`contentHash` 和 payload；压缩 payload 不使用 Base64。
  - `decode(encode(batch))` 与规范化批次字节完全一致；`contentHash` 基于未压缩规范化内容，压缩实现变化不改变业务哈希。
  - gzip 不可用、输入低于阈值或压缩后没有收益时可显式使用 `identity`，不得静默丢弃或修改事件。
  - 解压设置最大输出边界，损坏、截断、未知 codec/version 均返回稳定错误。
- Verify: `yarn workspace @datainsights/browser-sdk vitest run test/compression-codec.test.ts test/batcher-integrity.test.ts`
- Dependencies: T10、T17。
- Files:
  - Create: `src/pipeline/compression-codec.ts`
  - Modify: `src/public/types.ts`
  - Modify: `src/index.ts`
  - Modify: `package.json`
  - Test: `test/compression-codec.test.ts`
- [x] RED：新增 codec 测试并确认因实现缺失而失败。
- [x] VERIFY RED：定向测试以缺少 `compression-codec` 模块失败。
- [x] GREEN：实现 identity/gzip envelope、无损解码、大小和哈希校验。
- [x] VERIFY GREEN：codec/批次定向测试、SDK 全量 171 tests、类型检查和串行构建通过。
- [x] REFACTOR：补充公共类型导出、gzip trailer 限界检查和非法 payload 稳定错误。
- [ ] COMMIT

### Task 25: compressRecording_workerFirst_preservesHostPerformance

**任务编号**：DEV-DI-025
**优先级/范围**：P0 / 当前 SDK

- Goal: 在现有序列化 Worker 中完成批次压缩，提供浏览器原生能力、`fflate` 和同步受控降级路径。
- Acceptance:
  - 优先在 Worker 中使用 `CompressionStream('gzip')`；不支持时使用直接依赖的 `fflate`，最终 `identity` 降级可诊断。
  - Worker 输出可转移 `ArrayBuffer`，不在主线程重复复制完整录制文本；destroy/异常时所有 pending 请求确定完成或失败。
  - 小于可配置阈值的批次不压缩；压缩 CPU、耗时、原始/压缩字节只进入本地脱敏诊断，不产生任何遥测。
  - 与当前同步序列化结果逐字节一致，宿主长任务和事件处理预算不因压缩超标。
- Verify: `yarn workspace @datainsights/browser-sdk vitest run test/compression-worker.test.ts test/batcher-integrity.test.ts test/benchmark/sdk-overhead.test.ts`
- Dependencies: T24。
- Files:
  - Modify: `src/pipeline/serialization.worker.ts`
  - Modify: `src/pipeline/serializer.ts`
  - Modify: `src/runtime/client.ts`
  - Test: `test/compression-worker.test.ts`
  - Test: `test/benchmark/sdk-overhead.test.ts`
- [ ] RED
- [ ] VERIFY RED
- [ ] GREEN
- [ ] VERIFY GREEN
- [ ] REFACTOR
- [ ] COMMIT

### Task 26: persistCompressedJournalOutbox_migratesWithoutDataLoss

**任务编号**：DEV-DI-026
**优先级/范围**：P0 / 当前 SDK

- Goal: 让 Journal/Outbox 持久化压缩二进制录制块，并以实际存储字节执行容量控制和向后兼容迁移。
- Acceptance:
  - 新写入 Journal/Outbox 使用 `Blob` 或可结构化克隆的二进制 payload，不保存同批原始 JSON 副本。
  - Journal → Outbox 仍保持同一事务内“至少保留一份”；崩溃恢复、FIFO、租约和有效回执删除语义不变。
  - 数据库版本迁移可读取既有未压缩记录并惰性转码；迁移中断不得删除旧记录或生成重复 sequence。
  - 100 MiB 水位按真实 `compressedBytes + metadataBytes` 计算，同时保留原始字节诊断；满容量时停止新增而不覆盖旧数据。
- Verify: `yarn workspace @datainsights/browser-sdk vitest run test/indexeddb-compression.test.ts test/indexeddb-journal.test.ts test/indexeddb-outbox.test.ts`
- Dependencies: T25、T08、T09。
- Files:
  - Modify: `src/persistence/database.ts`
  - Modify: `src/persistence/indexeddb-journal.ts`
  - Modify: `src/persistence/indexeddb-outbox.ts`
  - Modify: `src/runtime/client.ts`
  - Test: `test/indexeddb-compression.test.ts`
- [ ] RED
- [ ] VERIFY RED
- [ ] GREEN
- [ ] VERIFY GREEN
- [ ] REFACTOR
- [ ] COMMIT

### Task 27: uploadCompressedBatch_negotiatedEncoding_keepsExactReceipts

**任务编号**：DEV-DI-027
**优先级/范围**：P0 / 当前 SDK

- Goal: 通过受信任配置协商压缩能力，上送压缩二进制批次并保持幂等、回执、重试和对账语义。
- Acceptance:
  - Config 明确服务端接受的 codec/version；未声明支持时发送 `identity`，禁止盲目 gzip 导致生产不兼容。
  - gzip 请求使用二进制 body、`Content-Type: application/json` 和 `Content-Encoding: gzip`；不得把 payload 转为 Base64 JSON。
  - 同一 Outbox 批次重试复用完全相同的压缩字节、batchId、sequence 和 contentHash，不在每次重试重新压缩。
  - 组批同时约束原始大小和压缩后目标大小；pagehide/keepalive 路径目标不超过 60 KiB，超限时在生成稳定批次前安全切分。
  - receipt、reconcile、主备 Collector、AbortSignal 和三次失败保留 Outbox 的行为不变。
- Verify: `yarn workspace @datainsights/browser-sdk vitest run test/compressed-http-transport.test.ts test/http-transport.test.ts test/outbox-dispatcher.test.ts test/reconciliation.test.ts`
- Dependencies: T26、T18、T19。
- Files:
  - Modify: `src/config/remote-config.ts`
  - Modify: `src/transport/http.ts`
  - Modify: `src/transport/types.ts`
  - Modify: `src/pipeline/batcher.ts`
  - Test: `test/compressed-http-transport.test.ts`
- [ ] RED
- [ ] VERIFY RED
- [ ] GREEN
- [ ] VERIFY GREEN
- [ ] REFACTOR
- [ ] COMMIT

### Task 28: replayCompressedRecording_localE2E_provesStorageReduction

**任务编号**：DEV-DI-028
**优先级/范围**：P0 / 当前 SDK 与本地 Mock

- Goal: 在本地保险演示中端到端接收、保存、解压和回放压缩录制，并形成真实体积与兼容证据。
- Acceptance:
  - 本地 Collector 按 codec/version 解压，验证解压上限、contentHash 和精确回执；损坏块不入库且 Outbox 保留。
  - Mock 存储只保存压缩 payload 和最小索引，不保留同一批原始事件副本；调试查看通过显式解压接口完成。
  - 同一真实录制的压缩前后事件、顺序、时间戳、逐字输入、密码保护和最终回放状态一致。
  - 报告每批与整段的 raw/stored bytes、压缩率、编码耗时；目标样本 `storedBytes / rawBytes <= 0.35`，未达到时给出原因而不删除事件。
  - Chromium 自动化通过；CompressionStream、fflate、identity 三条路径均有覆盖，真机状态不虚报。
- Verify: `yarn workspace @datainsights/browser-sdk vitest run test/compression-e2e.test.ts test/insurance-product.e2e.test.ts test/replay-segment.integration.test.ts`
- Dependencies: T27、T22。
- Files:
  - Modify: `scripts/insurance-demo.mjs`
  - Modify: `examples/insurance-product/replay.html`
  - Create: `test/compression-e2e.test.ts`
  - Modify: `test/insurance-product.e2e.test.ts`
  - Create: `COMPRESSION.md`
- [ ] RED
- [ ] VERIFY RED
- [ ] GREEN
- [ ] VERIFY GREEN
- [ ] REFACTOR
- [ ] COMMIT

### Task 29: acceptCompressedIngress_boundedDecode_validatesBeforePersist

**任务编号**：FUTURE-DI-029
**优先级/范围**：P1 / 后续生产接收服务 Change

- Goal: 生产接收服务协商 codec，限界解压并在持久化前完成鉴权、完整性和幂等校验。
- Acceptance: 支持 identity/gzip 版本协商；限制压缩与解压大小、比例和耗时；拒绝压缩炸弹、损坏流和 hash 不一致；同一 batch 幂等回执不变。
- Verify: 服务端契约、模糊、压缩炸弹、重复批次和旧 SDK 兼容测试。
- Dependencies: T28；实施前新建后端 OpenSpec Change。
- Files likely touched: 生产 Collector API、codec registry、幂等仓储、契约测试；具体路径由后续仓库设计确定。
- [ ] TODO：迁移至后续 Change 并完成 Proposal/Design/Tasks 审批。

### Task 30: compactRecordingSegments_zstd_preservesReplayCheckpoints

**任务编号**：FUTURE-DI-030
**优先级/范围**：P1 / 后续存储管道 Change

- Goal: 将可靠接收的小 Batch 合并为可随机访问的 Replay Segment，并以 zstd/gzip 无损存入对象存储。
- Acceptance: DB 只保存 segment 索引和大小/hash/codec 元数据；对象存储不保留重复原始 JSON；合并保持 sequence、时间戳、快照边界和 gap；失败可从已确认 batch 重建。
- Verify: 合并幂等、乱序/迟到输入、对象写入失败、重建和压缩率基准测试。
- Dependencies: T29；实施前新建存储管道 OpenSpec Change。
- Files likely touched: segment compactor、对象存储 adapter、segment metadata migration、集成测试。
- [ ] TODO：迁移至后续 Change 并完成 Proposal/Design/Tasks 审批。

### Task 31: deliverCompressedReplay_manifestRange_decodesCompatibly

**任务编号**：FUTURE-DI-031
**优先级/范围**：P1 / 后续 Replay 服务 Change

- Goal: 通过 Manifest 和分段读取交付压缩 Replay，按需解码且兼容历史 identity/gzip 与新 zstd Segment。
- Acceptance: Manifest 声明 codec/version/raw/stored bytes/hash/sequence；播放器按 checkpoint 拉取而非整段全量加载；损坏或 gap 显式告警；预签名 URL 和租户鉴权不因压缩旁路。
- Verify: 跨 codec、跨版本、Range/分段、损坏数据、长会话内存和播放一致性测试。
- Dependencies: T30；实施前新建 Replay OpenSpec Change。
- Files likely touched: Replay Manifest API、segment reader、播放器 decoder、端到端测试。
- [ ] TODO：迁移至后续 Change 并完成 Proposal/Design/Tasks 审批。

### Task 32: governCompressedData_retentionMigration_observesRealCost

**任务编号**：FUTURE-DI-032
**优先级/范围**：P1 / 后续数据生命周期 Change

- Goal: 建立压缩数据的留存删除、codec 迁移、成本与异常压缩率监控，确保 DB/对象存储容量长期受控。
- Acceptance: 删除覆盖索引、对象、缓存和备份策略；codec 迁移可断点续作且不保留永久双份；按租户统计 raw/stored bytes 和压缩率；异常膨胀、解码失败、孤儿对象可告警和修复。
- Verify: TTL/行权删除、迁移中断恢复、对象孤儿扫描、容量账单和审计测试。
- Dependencies: T30、T31；实施前新建数据生命周期 OpenSpec Change。
- Files likely touched: retention worker、migration job、storage inventory、metrics/audit、灾备测试。
- [ ] TODO：迁移至后续 Change 并完成 Proposal/Design/Tasks 审批。

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
- [x] 已创建 `test-cases.md`，覆盖单元、浏览器、异常、隐私、可靠性、性能和上游回归证据。
- [x] 每个 Task 均有独立提交；T17 在 `review-report.md` 记录实现摘要、风险点和人工 review 关注点。
- [x] 未生成服务端分析、正式存储或管理后台测试用例。
- [x] T24-T28 在进入 Apply 前补充压缩协议 Design 并取得人工批准。（用户于 2026-10-27 明确要求启动前端压缩改造）
- [ ] T29-T32 分别迁移到对应生产服务端 OpenSpec Change，不在 DI-1001 中直接实现。

## 任务完成定义

- [x] 每个任务都有明确 Acceptance、Verify、Dependencies 和 Files。
- [x] 没有“实现整个 SDK”式 XL 任务。
- [x] 每个任务原则上不超过 5 个主要文件。
- [x] 依赖顺序和每 2-3 个任务的 Checkpoint 已明确。
- [x] T01-T23 均按有效 RED 后进入 GREEN。
- [ ] T25-T28 尚未实施，必须按有效 RED 后进入 GREEN；T24 已实现待提交。
- [x] T33 已取得用户优先实施确认（2026-10-27）。
- [x] T34 已取得用户优先实施确认（2026-10-27）。
- [x] SDK 与服务端/分析/正式 Replay 平台边界已明确。
- [x] T01-T23 进入 Apply 前已取得用户明确批准。（2026-10-26）
- [x] T24-T28 的压缩设计与任务拆分已获用户批准进入 Apply。（2026-10-27）

## 参考规范

- OpenSpec `proposal.md`、`design.md`、`prd/`
- OpenSpec Task Breakdown Overlay
- Superpowers Test-Driven Development
- rrweb workspace、Vite、Vitest、Puppeteer、Turbo 现有规范
- SGS 编码规范中的 SOLID、安全、渐进修改、异常处理和文档同步原则
