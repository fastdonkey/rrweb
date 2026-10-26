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

本仓库提供去生产化的移动端保险页面、Mock Config/Collector 和真实 rrweb 回放。它只绑定 `127.0.0.1`，不包含众安生产脚本、接口、Cookie、Fingerprint、监控或外链。

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

测试拒绝所有非本地 HTTP(S) 请求，并验证点击前无录制、普通保险字段被记录、密码值缺失、精确回执清空 Outbox，以及生成的真实事件在 `sandbox="allow-same-origin"` 且不允许脚本的 iframe 中回放。

## 录制与回放对象边界

| 对象                    | 所属层             | 职责                                                                |
| ----------------------- | ------------------ | ------------------------------------------------------------------- |
| Journal Chunk           | SDK 本地持久化     | 以 1 秒或 20 事件为窗口缩小崩溃损失，不是网络或回放协议             |
| RecordingBatch          | SDK 投递协议       | 携带连续 sequence、稳定 batchId、内容哈希和原始 rrweb 事件          |
| RecordingSegment        | SDK 录制生命周期   | 30 分钟连续录制切段；保持 sessionId/recordingId，并以全量快照开始   |
| Replay Chunk / Manifest | 后续服务端与播放器 | 面向对象存储、范围读取、播放器索引和生命周期管理；不在 DI-1001 实现 |

`examples/insurance-product` 和 `examples/local-replay` 都是本地验证工具，不是生产播放器。所有 Replay 数据均视为不可信输入；iframe 必须保持精确的 `sandbox="allow-same-origin"`，不得增加 `allow-scripts`。
