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
