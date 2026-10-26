# DataInsights Browser SDK

DataInsights 是基于 rrweb 的浏览器端投保过程录制 SDK。SDK 不展示授权 UI；嵌入方必须在投保入口第一屏醒目告知用户，并在用户点击“开始投保”后调用授权与启动 API。

## Script Tag 接入

生产环境必须固定具体版本，禁止使用 `latest`：

```html
<script>
  window.DataInsightsTransport = createReviewedDataInsightsTransport();
</script>
<script
  src="https://cdn.example.com/datainsights/0.1.0/datainsights-browser-sdk.js"
  data-app-key="customer-product-h5-production"
  data-worker-url="https://cdn.example.com/datainsights/0.1.0/serialization.worker.js"
></script>
```

`appKey` 是公开的应用路由标识，不是密钥。浏览器中禁止放置 `appSecret` 或 `securityKey`。Transport 必须在 SDK 脚本执行前通过 `window.DataInsightsTransport` 配置；缺失时 `start()` 返回 `TRANSPORT_NOT_CONFIGURED`，不会降级到内存录制。

```js
document
  .querySelector('#start-insurance')
  .addEventListener('click', async () => {
    window.DataInsights.consent.grant({
      noticeVersion: 'insurance-notice-v1',
      action: 'start-insurance',
    });
    await window.DataInsights.start({ userId: hostUserId, journeyId });
  });
```

脚本本身不会自动授权或启动录制。普通业务输入默认录制；密码、hidden 字段、`.rr-sensitive` 和 `[data-di-block]` 永不录制。宿主页面中的 XSS 仍可能访问已授权的页面数据，接入方必须独立落实 CSP 与 XSS 防护。

## CSP

至少允许固定版本 CDN：

```text
script-src 'self' https://cdn.example.com;
worker-src 'self' https://cdn.example.com;
connect-src 'self' https://ingest.example.com;
```

Worker 加载失败时 SDK 使用等价的同步序列化降级路径。不要依赖 `blob:` Worker，也不要把 `latest` URL 用于生产。

## 可靠投递边界

rrweb 事件先以 1 秒或 20 条的窗口写入 IndexedDB Journal，再原子转入 Outbox。只有 Transport 返回字段完全匹配且 `persisted: true` 的回执时才删除 Outbox。页面刷新后，新 Recording 会按 appKey 先恢复上一个 Recording 未组批的 Journal；长录制切换 segment 时显式生成 rrweb 全量快照。

上送仍受浏览器清理站点数据、存储驱逐、同源 XSS 和页面被强制终止等边界影响，因此 SDK 承诺“分层尽可能不丢失”，不宣称绝对零丢失。生产 Transport 必须由后续受审的服务端持久化实现提供。

## 录制与回放对象边界

| 对象                    | 所属层             | 职责                                                                |
| ----------------------- | ------------------ | ------------------------------------------------------------------- |
| Journal Chunk           | SDK 本地持久化     | 以 1 秒或 20 事件为窗口缩小崩溃损失，不是网络或回放协议             |
| RecordingBatch          | SDK 投递协议       | 携带连续 sequence、稳定 batchId、内容哈希和原始 rrweb 事件          |
| RecordingSegment        | SDK 录制生命周期   | 30 分钟连续录制切段；保持 sessionId/recordingId，并以全量快照开始   |
| Replay Chunk / Manifest | 后续服务端与播放器 | 面向对象存储、范围读取、播放器索引和生命周期管理；不在 DI-1001 实现 |

`examples/local-replay` 仅用于验证 fixture 的 Sandboxed Rebuild，不是生产播放器。所有 Replay 数据均视为不可信输入；iframe 必须保持精确的 `sandbox="allow-same-origin"`，不得增加 `allow-scripts`。
