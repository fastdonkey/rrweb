# DataInsights Browser SDK

DataInsights 是基于 rrweb 的浏览器端投保过程录制 SDK。SDK 不展示授权 UI；嵌入方必须在投保入口第一屏醒目告知用户，并把“开始投保”按钮交给 SDK 作为明确的授权与录制触发点。

## 推荐接入

生产环境必须固定具体版本，禁止使用 `latest`：

```html
<script src="https://cdn.datainsights.io/sdk/0.1.0/datainsights-browser-sdk.min.js"></script>
<script>
  DataInsights.bootstrap({
    appKey: 'di_p_cn1_K7J9M2X4',
    consent: {
      startSelector: '#start-insurance',
      noticeVersion: 'insurance-notice-v1',
    },
    resolveUserId: () => window.currentUser?.id,
  });
</script>
```

接入方只需提供：

- `appKey`：公开的应用路由标识，格式为 `di_{environment}_{region}_{randomId}`；每个客户产品平台和环境使用独立 Key。
- `startSelector`：嵌入方“开始投保”入口的明确选择器。页面加载和远程配置完成都不会自动授权或录制。
- `noticeVersion`：用户点击时所见告知文案的版本标识，用于把录制与告知版本关联，不是服务地址或密钥。
- `resolveUserId`：可选。返回嵌入方作用域内的用户唯一标识；缺失或空值时，SDK 在授权后使用第一方随机 UUID。

浏览器端不配置 `endpoint`、`platform`、`tenantId`、`appSecret` 或 `securityKey`。AppKey 只包含环境和区域路由提示；SDK 从内置受信任映射选择配置中心，再获取 Collector 主备地址和短期上传凭证。未知路由、配置校验失败、应用停用或 Transport 无法建立时均 fail closed，不启动录制。

高级测试或自定义 Transport 场景仍可使用 `init()`、`consent.grant()` 和 `start()`；普通生产接入优先使用 `bootstrap()`。

## 授权与隐私

嵌入方负责展示告知，例如：

> 投保过程操作、页面行为将被记录留存，用于销售可回溯、纠纷核验。

SDK 在用户点击 `startSelector` 前不访问 IndexedDB、不生成身份、不启动 rrweb，也不补录授权前行为。普通业务输入默认录制；`type="password"`、hidden 字段、`.rr-sensitive` 和 `[data-di-block]` 永不录制。宿主页面中的 XSS 仍可能访问已授权的页面数据，接入方必须独立落实 CSP 与 XSS 防护。

## IndexedDB 运行时门禁

IndexedDB 是 Journal/Outbox 可靠投递的必要能力，不提供生产内存降级。每次首次录制前，SDK 都会真实执行数据库 open、metadata 写入、精确读回和删除：

- 任一步失败返回 `PERSISTENCE_UNAVAILABLE`，rrweb 不启动；
- `navigator.storage.persist()` 被拒绝只记录为诊断状态，不虚报持久化成功；
- `getDebugInfo().persistence` 只暴露 `available`、`persisted`、`quota` 和 `usage`，不包含录制内容；
- 真机支持状态见 [COMPATIBILITY.md](COMPATIBILITY.md)，未验证设备保持 Pending。

## 可靠投递边界

rrweb 事件先以 1 秒或 20 条的窗口写入 IndexedDB Journal，再原子转入 Outbox。只有 Collector 返回字段完全匹配且 `persisted: true` 的回执时才删除 Outbox。页面刷新后，新 Recording 会按 AppKey 恢复上一个 Recording 未组批的 Journal；长录制切换 segment 时显式生成 rrweb 全量快照。

上送仍受浏览器清理站点数据、存储驱逐、同源 XSS、磁盘故障和页面在事务提交前被强制终止等边界影响，因此 SDK 承诺“分层尽可能不丢失”，不宣称绝对零丢失。生产 Collector 和法律存证能力属于后续服务端变更。

## CSP

至少允许固定版本 CDN 与配置/Collector 域名：

```text
script-src 'self' https://cdn.datainsights.io;
worker-src 'self' https://cdn.datainsights.io;
connect-src 'self' https://config-cn1.datainsights.io https://collector.example.com;
```

Worker 加载失败时 SDK 使用等价的同步序列化路径。不要依赖 `blob:` Worker，也不要把 `latest` URL 用于生产。

## 本地保险产品录制与回放

本仓库提供去生产化的移动端保险页面、Mock Config/Collector 和真实 rrweb 回放。页面包含投保须知、保险条款、健康告知、免责条款和个人信息处理授权书五项逐项阅读流程，只有滚动到底并完成全部确认后才能提交，用于验证点击、长内容滚动、状态门禁和确认顺序的录制效果。

页面还提供独立的“复杂交互录制实验室”：页签、手风琴、键盘搜索联想、横向滑动、Toast、虚拟长列表、文件元数据和刷新恢复属于完整 DOM 验证；Canvas、WebGL、同源/跨源 iframe、PDF 阅读器模拟和权限型媒体用于展示 rrweb 默认能力边界。Canvas 2D/WebGL 新增 5fps 位图采样扩展，静态帧去重，支持配套 DataInsights 回放及 MP4 渲染，不等同于原生 GPU/60fps 重演；上传不读取文件正文；媒体组件不申请真实摄像头或麦克风权限。

Demo 只绑定本机回环地址，不包含众安生产脚本、接口、Cookie、Fingerprint、监控或外链。

```bash
yarn workspace @datainsights/browser-sdk demo:insurance
```

启动后访问：

- 产品页：`http://127.0.0.1:4173/gp/99440765`
- 录制列表：`http://127.0.0.1:4173/recordings`
- 回放页：`http://127.0.0.1:4173/replay/{recordingId}`

自动化验证：

```bash
PUPPETEER_HEADLESS=true yarn workspace @datainsights/browser-sdk test:insurance-e2e
```

测试拒绝所有非本地 HTTP(S) 请求，并验证点击前无录制、五份须知逐项阅读确认、复杂交互状态、上传正文缺失、跨源 iframe 隔离、媒体权限零调用、普通保险字段被记录、密码值缺失、精确回执清空 Outbox，以及生成的真实事件在 `sandbox="allow-same-origin"` 且不允许脚本的 iframe 中回放。

## 录制与回放对象边界

| 对象                    | 所属层             | 职责                                                                |
| ----------------------- | ------------------ | ------------------------------------------------------------------- |
| Journal Chunk           | SDK 本地持久化     | 以 1 秒或 20 事件为窗口缩小崩溃损失，不是网络或回放协议             |
| RecordingBatch          | SDK 投递协议       | 携带连续 sequence、稳定 batchId、内容哈希和原始 rrweb 事件          |
| RecordingSegment        | SDK 录制生命周期   | 30 分钟连续录制切段；保持 sessionId/recordingId，并以全量快照开始   |
| Replay Chunk / Manifest | 后续服务端与播放器 | 面向对象存储、范围读取、播放器索引和生命周期管理；不在 DI-1001 实现 |

`examples/insurance-product` 和 `examples/local-replay` 都是本地验证工具，不是生产播放器。所有 Replay 数据均视为不可信输入；iframe 必须保持精确的 `sandbox="allow-same-origin"`，不得增加 `allow-scripts`。


### 上传令牌自动刷新（T25）

标准 bootstrap / HTTP transport 复用原 AppKey 的 `/sdk/config`，在30分钟令牌到期前5分钟刷新；并发调用和迟到的401共用当前刷新结果。401最多刷新一次并重传相同批次正文，不修改batchId、hash、identity或Outbox命名空间。二次401、网络或配置失败保留未确认数据，刷新按1s起指数退避、上限60s，单次刷新超时10s；不会请求delivery-state或capabilities完成刷新。

上传或配置接口403会暂停该transport的上送并保留Outbox，不自动换Key。管理员恢复授权后应明确销毁并重新初始化原AppKey实例；旧Key被撤销或宽限期届满时不允许新Key自动认领其队列。停止录制可继续处理同实例待传数据，destroy会释放刷新定时器并取消刷新请求。配置源在初始化时固定，私有化/本地demo刷新复用原可信配置源。

本次仅令牌生命周期，关闭声明持久化、按需补传查询预算及HTTP gzip分别由T26/T27实现。后端任务及联调证据见Data-Insights仓库 `openspec/planning/trace-backend/tasks.md` 的T25。

### 持久化关闭声明（T26）

SDK 在停止录制时先持久化尾批及其最终序号/哈希，再把关闭声明与尾批放入同一个 IndexedDB 事务。关闭队列复用现有 metadata store，不需要升级数据库。刷新页面或普通 `stop()` 只关闭当前 Recording；`stop('completed')` 等终结原因同时声明 Trace 的已知 Recording 成员。BFCache 保留页不提前关闭，异常退出没有成功提交声明时维持“结束未知”。

关闭队列在启动、online 和每30秒尝试发送，保留原closeId及正文；只有完全匹配的 `{accepted:true,closeId}` 才清队列。401复用令牌刷新，403/永久格式拒绝暂停保留，网络错误/旧服务404不删除。客户自定义transport可以实现可选 `sendClose`；未实现时声明仅本地保留。后台仍须验证数据边界，收到关闭声明不等于录制已完整或可以完整回放。

成员账本缺失的历史Trace不自动生成关闭声明。新封批使用UUID；历史本地demo中拼接形式的batchId不自动迁移、改hash或删除，需要受控恢复。关闭头与成员账本当前保守保留，未做长期自动GC。浏览器强杀无法保证尚未提交的内存数据；本地事务失败时停止操作返回失败，应重试，不能伪造成功关闭。

验证：在本包目录运行 `vitest run test/durable-close.test.ts test/durable-close.e2e.test.ts`。浏览器用例使用本地保险页面和受控关闭接口，导出 `target/t26-browser-contract.json`；Data-Insights 的 BrowserCloseCompatibilityTest 校验其哈希和最终边界，Kafka/OSS/MySQL关闭消费通过后端独立集成测试验证。

### 按需补传确认与 HTTP gzip（T27）

正常上传收到匹配的持久化回执就清除对应Outbox，不追加delivery-state/reconcile查询。仅页面重开或online恢复且存在至少两个待确认批次时启用可选v2查询：按Recording分组、每请求最多100条元数据、每轮最多3次（含重试），响应后至少间隔1秒，30秒内合并重复触发。候选集合冻结；新批次继续上传。UNKNOWN/失败/预算外项回原重试队列，不轮询等待STORED。

STORED只有完整匹配batchId、recordingId、序号范围和hash才清队列。CONFLICT/DELETED以及永久格式拒绝保留原数据并持久标记停止重传，通知诊断；后续正常批次不因旧坏数据被阻塞。该标记没有自动删除或人工解封界面。应用授权403仍暂停实例并保留数据；可选能力/查询接口403本身不会停掉仍合法的普通上传。

能力协商按AppKey（含环境）和configVersion单飞缓存，失败也缓存；同版本token刷新不重复探测。404/失败兼容普通JSON，closeV2未声明时只保留关闭队列。状态查询和能力请求分别计数，100批正常上传可有一次能力请求，但状态查询应为0。客户无需增加接入参数。

服务声明gzipHttp后，对≥1KiB且压缩更小的JSON使用Content-Encoding:gzip；先用CompressionStream，不支持时回退已内置fflate。压缩不修改batchId/hash/原JSON字节，首次上传可以保持JSON。415回退相同原文一次，并在当前配置版本停用gzip；400/422不绕过内容校验。Retry-After同时支持秒数和HTTP日期，不通过切换collector绕过429/503限流。生产移动设备上的同步压缩回退CPU开销仍需部署压测。

验证入口：`vitest run test/backend-contract.integration.test.ts`；后端真实gzip、刷新和Kafka→MySQL/OSS幂等命令见Data-Insights `openspec/planning/trace-backend/tasks.md` T27。当前为工作区补丁和构建产物，发布前须记录外部SDK提交及发行版本。
