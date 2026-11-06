# DI-1001 SDK 功能需求

## 1. 模块边界

DataInsights 产品层使用独立 workspace 包 `packages/datainsights-browser-sdk`，发布名为 `@datainsights/browser-sdk`，并依赖 rrweb 现有公共包：

```text
@datainsights/browser-sdk Public API
  ├─ configuration / consent / identity
  ├─ lifecycle / diagnostics
  ├─ event pipeline / batching
  ├─ transport abstraction
  └─ rrweb adapter
       ├─ @rrweb/record
       ├─ @rrweb/types
       └─ @rrweb/utils
```

DataInsights 不应把客户直接绑定到 `packages/rrweb`、`packages/record` 或 `packages/browser-client` 的内部文件结构。

## 2. 初始化与配置

- 推荐 Script Tag 接入通过 `bootstrap()` 提供 AppKey、授权入口、告知版本和可选用户 ID 回调；
- AppKey 格式为 `di_{environment}_{region}_{randomId}`，环境/区域只用于受信任配置中心路由，不能把任意 Key 内容拼成 URL；
- 嵌入方不配置 endpoint、platform、tenantId 或长期 secret；配置服务返回 Collector 主备地址、短期上传凭证、配置版本和启停状态；
- JavaScript 高级 API 可提供完整配置对象和自定义 Transport，用于测试或受审集成；
- 重复初始化必须幂等，不能重复注册监听器；
- 配置需要 schema、默认值、未知字段处理和版本标识；
- 本期可定义远程配置 Provider 接口，但不实现生产配置服务；
- `getDebugInfo()` 返回 SDK 版本、rrweb 基线、运行状态、队列统计、配置版本和最近错误，不返回敏感数据。

## 3. 生命周期

| 操作             | 要求                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| `init`           | 仅校验配置并创建不采集数据的单例状态，不得在授权前注册采集器或读取用于采集的页面数据               |
| `start`          | 仅在取得明确授权且持久化队列可用后启动 rrweb；不进行 Session 级采样                                |
| `stop`           | 停止当前录制但保留可再次启动的 SDK 状态                                                            |
| `destroy`        | 停止录制并释放监听器、Worker、定时器、队列和全局引用                                               |
| `consent.grant`  | 由嵌入方在用户点击“开始投保”后调用，记录授权状态并允许启动；授权前产生的页面状态和行为不得追溯采集 |
| `consent.revoke` | 立即停止后续录制；历史数据处置不属于本期                                                           |

`destroy()` 不得删除宿主 Cookie、localStorage 或业务 IndexedDB，也不得删除尚未获得 `accepted` 的 SDK durable outbox；它只关闭 SDK 自有数据库连接和运行资源。

`start()` 在 rrweb 前执行 IndexedDB open/write/read/delete 门禁。缺失、拒绝、事务失败或读回不一致返回 `PERSISTENCE_UNAVAILABLE`；`StorageManager.persist()` 不支持或被拒绝只影响脱敏诊断，不把可写 IndexedDB 误判为不可用。

## 4. 录制能力

- 捕获普通 DOM、增量 DOM、点击、输入、滚动、媒体状态和页面上下文；
- 支持 SPA 路由变化；
- Canvas 默认关闭，WebGL 本期不支持；
- 跨域 iframe 由 iframe 内独立 SDK 录制，父页面不直接读取；
- 文件上传不得读取文件内容；
- 支持定时或按事件数生成全量快照；
- 长会话固定每 30 分钟分段，并保留 segment 信息；
- 暂停后恢复录制时先生成全量快照。

### 4.1 Trace 与 Session 边界

- 用户点击“开始投保”并由嵌入方完成授权/启动调用后创建 Session；
- SDK 自动生成 UUIDv4 `traceId`；启动参数不接收 `traceId`、`journeyId` 或 `journeyType`；
- 同一标签页内的 SPA 路由切换和页面刷新延续当前 Session；刷新恢复后必须先生成可独立回放的全量快照；
- 新标签页创建新的 Session，不与原标签页共用 `sessionId`；
- 投保完成、取消投保、退出登录、撤回授权或嵌入方登录会话失效时，嵌入方应显式结束当前 Session；
- 连续 30 分钟没有有效用户操作时结束当前 Session；用户恢复操作并重新满足启动条件后创建新 Session；
- 同标签页暂停后继续和同源刷新恢复保持 `traceId`；新标签页、明确结束或空闲超时后生成新 `traceId`；
- 业务 Journey ID、行业类型和业务阶段由 DataInsights 后续数据清洗产生，客户前端不填写；
- 连续录制每 30 分钟切换 `segmentId` 并生成恢复回放所需的全量快照；分段属于存储和回放边界，不代表 Session 或投保流程结束。

## 5. 自定义事件

```ts
DataInsights.addCustomEvent('expense_submit', {
  expenseType: 'travel',
});
```

- 事件名称和 payload 必须可校验；
- payload 经过大小、深度、循环引用和敏感字段保护；
- 调用时间戳不能因内部排队而丢失；
- 录制未就绪时的排队上限和丢弃策略必须明确；
- 自定义事件可在回放 fixture 的时间线上定位。

## 6. 身份接口

- SDK 不强制用户唯一标识的来源或格式，但同一嵌入方作用域内必须能够唯一代表对应用户；
- 嵌入方可通过 `identify(userId)` 注入其用户唯一标识；SDK 不负责验证该标识对应的真实身份；
- 嵌入方未提供用户唯一标识时，SDK 在用户授权后生成并保存第一方随机 UUID；
- `clearIdentity()` 用于登出和账号切换；
- 本期不使用 FingerprintJS 或其他浏览器指纹技术；
- 授权前不得读取、生成或持久化上述身份标识。

## 7. 事件与批次契约

```ts
interface RecordingBatch {
  schemaVersion: string;
  sdkVersion: string;
  rrwebVersion: string;
  appKey: string;
  traceId: string;
  recordingId: string;
  sessionId: string;
  segmentId: string;
  batchId: string;
  sequenceStart: number;
  sequenceEnd: number;
  contentHash: string;
  previousBatchHash?: string;
  createdAt: string;
  events: unknown[];
}
```

- 最终类型使用 rrweb 公共类型或 DataInsights 自有稳定类型；
- batchId 在同一 recording 中唯一；
- sequence 区间用于发现缺口和重复；
- `contentHash` 使用 SHA-256 校验规范化批次内容，`previousBatchHash` 在同一 recording 内形成连续哈希链；该机制用于发现损坏、错序和缺口，不等同于服务端签名或防恶意篡改；
- schemaVersion 与 SDK 版本分离；
- 客户、产品、平台和环境由后续平台根据 `appKey` 解析，SDK 和批次不重复声明 `platform`；
- 契约兼容策略在 Design 阶段确定。

## 8. Transport 抽象

```ts
interface Transport {
  readonly capability: 'test-only' | 'persisted-receipt-v1';
  send(batch: RecordingBatch): Promise<TransportResult>;
  reconcile?(recordingId: string): Promise<ReconciliationResult>;
  flush?(): Promise<void>;
  destroy?(): Promise<void>;
}
```

本期提供内存 Transport、文件/下载 Transport 和 Mock HTTP Transport，并实现 IndexedDB durable outbox。事件每 1 秒或 20 条形成持久化窗口；批次持久化后再交给 Transport，仅在校验匹配且 `persisted: true` 的回执后删除。断网、刷新或重新打开页面后按 FIFO 恢复，短暂失败使用有限重试。生产鉴权、服务端状态码策略、租户解析和服务端持久化不属于本期。

`accepted` 必须携带与请求一致的 `batchId`、`recordingId`、sequence 区间、`contentHash` 和 `persisted: true` 回执；普通 HTTP 2xx、请求成功发起或 sendBeacon 接收均不足以删除 Outbox。Transport 可通过 `reconcile` 返回服务端连续序号和缺失区间，SDK 对仍保存在 Outbox 的批次执行定向重传。

Memory、Download、Mock HTTP Transport 均标记为 `test-only`，只验证 SDK 流程，不代表生产持久化保证。Script Tag 未配置 Transport 时不得静默使用 MemoryTransport，`start()` 必须失败并返回可诊断错误。

## 9. 构建产物

- npm 包 `@datainsights/browser-sdk`；
- ESM 产物；
- UMD/IIFE Script Tag/CDN 产物，并暴露 `window.DataInsights`；
- TypeScript 类型声明；
- CJS 仅在现有工具链或明确客户需求需要时提供，不作为已确认的首要发布形态；
- Source Map 策略；
- 固定版本 CDN 文件名及内容哈希；
- 构建产物不得包含测试凭证或内部调试配置。

## 10. 本地保险录制与回放验证

本地保险 Demo 需要覆盖保险行业常见的多文件阅读确认流程：固定展示投保须知、保险条款、健康告知、免责条款和个人信息处理授权书；每份文件必须打开并滚动到底后才能确认，全部确认前禁止提交。确认过程由 rrweb 原生记录，全部完成时可以增加不含条款正文和用户数据的业务自定义事件。该流程只用于验证通用 SDK 对复杂行业页面的录制能力，不把 DataInsights SDK 核心限定为保险专用。

- 提供移动端长页面、计划切换、保障弹窗、投保表单和提交交互；
- 页面与服务只绑定 `127.0.0.1`，不包含生产脚本、接口、Cookie、Fingerprint、监控或外链；
- 真实 UMD/Worker 通过测试 AppKey 解析本地 Mock Config/Collector；
- Collector 返回精确 `persisted: true` 回执，E2E 验证 Journal/Outbox 清空；
- 普通姓名、手机号、证件号、保额、计划和自定义提交事件可回放，密码测试值不得存在；
- Replay iframe 使用精确 `sandbox="allow-same-origin"`，不得允许脚本执行；
- E2E 中任何非本地 HTTP(S) 请求均视为失败。


### 2026-10-30 增量：Canvas 2D / WebGL 画面采样

用户确认两类画布均纳入范围。本节替代前文仅支持外围 DOM 的限制；保留原生 `recordCanvas:false`，通过 `src/recorder/canvas-capture.ts` 扩展，不侵入 rrweb 核心。自定义事件 `datainsights.canvas-frame.v1` 保存节点 id、宽高、context 和内联 WebP/PNG；全量快照携带 `datainsightsCanvasFrames`，支持检查点跳转。

默认 200ms（5fps）采样，静态帧去重，最多8个当前画布、单画布200万像素、单帧URL最多350000字符。沿用宿主授权启动与暂停/停止生命周期，屏蔽区域不采集；stop 清理计时器与 WebGL 钩子。WebGL 在绘制后微任务读取，不修改 preserveDrawingBuffer，也不清除宿主缓冲区。图像随现有事件批次压缩、持久化与重试，不增加独立上传通道。

配套浏览器回放和视频渲染校验图像头部尺寸与协议，仅显示受限位图，保持 iframe 禁止脚本及原生不安全 Canvas 命令关闭。视频标记 CANVAS_SAMPLED。旧录制没有采集到的像素不可补回。跨域污染画布、OffscreenCanvas、跨域 iframe 内画布和超过预算的画布不在本轮支持范围；高频 GPU 动画不承诺逐帧无损，移动设备真实性能和兼容性仍需专门实机验收。

验证：SDK隐私/生命周期13项通过；后端 replay-client + video-renderer 共63项通过，新增真实 Chromium 采集2D/WebGL、屏蔽画布、恢复钩子、检查点跳转与解码MP4像素对照。不能将2D backing buffer读数当成最终可见性证据，必须检查实际截图/视频。
