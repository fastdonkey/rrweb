# DI-1001 简化接入与本地保险回放实现计划

> **给代理工作者：** 必需子技能：使用 superpowers-subagent-driven-development（推荐）或由当前主代理按任务顺序逐项实现。步骤使用复选框（`- [ ]`）语法跟踪。

**目标：** 让嵌入方只提供 AppKey 和授权入口即可完成录制，并提供可本地访问、真实录制和真实回放的去生产化保险产品演示环境。

**架构：** SDK 从格式化 AppKey 解析受信任配置中心路由，获取 Collector 配置后构建标准 HTTP Transport；`bootstrap()` 绑定嵌入方的开始投保按钮，在真实点击时授权并启动现有录制管道。IndexedDB 在启动前执行运行时读写探测。E2E 使用本地 Config、Collector、保险页面和 Replay 服务，禁止全部非本机网络请求。

**技术栈：** TypeScript、Vite、Vitest、Puppeteer、rrweb、IndexedDB、Node HTTP test server。

---

### 任务 18：AppKey 路由和远程配置契约

**文件：**
- 创建：`packages/datainsights-browser-sdk/src/config/app-key.ts`
- 创建：`packages/datainsights-browser-sdk/src/config/remote-config.ts`
- 修改：`packages/datainsights-browser-sdk/src/public/types.ts`
- 修改：`packages/datainsights-browser-sdk/src/index.ts`
- 测试：`packages/datainsights-browser-sdk/test/app-key-config.test.ts`

- [x] **步骤 1：编写 AppKey 路由失败测试**

```ts
expect(parseAppKeyRoute('di_p_cn1_K7J9M2X4')).toEqual({
  ok: true,
  value: { environment: 'production', region: 'cn1' },
});
expect(parseAppKeyRoute('di_p_evil.example_K7J9M2X4')).toMatchObject({
  ok: false,
  error: { code: 'APP_KEY_ROUTE_UNSUPPORTED' },
});
```

- [x] **步骤 2：运行测试并确认 RED**

运行：`yarn workspace @datainsights/browser-sdk vitest run test/app-key-config.test.ts`

预期：FAIL，`app-key.ts` 和解析接口尚不存在。

- [x] **步骤 3：实现固定枚举路由和配置 schema**

```ts
const ROUTES = {
  p: { environment: 'production', origins: { cn1: 'https://config-cn1.datainsights.io' } },
  t: { environment: 'test', origins: { cn1: 'https://config-test-cn1.datainsights.io' } },
} as const;

export interface ResolvedApplicationConfig {
  appKey: string;
  enabled: true;
  configVersion: string;
  collectorUrls: readonly [string, ...string[]];
  uploadToken: string;
  expiresAt: string;
}
```

解析器只允许 `di_(p|t)_<known-region>_<8..64 alphanumeric>`，不得把 Key 的任意片段拼接为 URL。远程响应必须拒绝未知字段、非 HTTPS Collector、过期凭证、AppKey 不一致和 `enabled !== true`。

- [x] **步骤 4：运行定向测试和类型检查**

运行：`yarn workspace @datainsights/browser-sdk vitest run test/app-key-config.test.ts && yarn workspace @datainsights/browser-sdk check-types`

预期：PASS。

- [x] **步骤 5：提交**

```bash
git add packages/datainsights-browser-sdk/src/config packages/datainsights-browser-sdk/src/public/types.ts packages/datainsights-browser-sdk/src/index.ts packages/datainsights-browser-sdk/test/app-key-config.test.ts
git commit -m "feat(sdk): resolve trusted app key configuration"
```

### 任务 19：标准 HTTP Transport

**文件：**
- 创建：`packages/datainsights-browser-sdk/src/transport/http.ts`
- 修改：`packages/datainsights-browser-sdk/src/transport/types.ts`
- 修改：`packages/datainsights-browser-sdk/src/index.ts`
- 测试：`packages/datainsights-browser-sdk/test/http-transport.test.ts`

- [ ] **步骤 1：编写持久化回执、主备切换和对账测试**

测试必须验证：主节点网络失败后使用备用节点；HTTP 200 但回执不匹配时返回 retryable；请求头只包含短期 Bearer token 和公开 AppKey；`reconcile(recordingId)` 使用相同受信任 Collector 列表。

- [ ] **步骤 2：运行测试并确认 RED**

运行：`yarn workspace @datainsights/browser-sdk vitest run test/http-transport.test.ts`

预期：FAIL，标准 Transport 尚不存在。

- [ ] **步骤 3：实现 Fetch Transport**

```ts
export function createHttpTransport(
  config: Readonly<ResolvedApplicationConfig>,
  fetchImpl: typeof fetch = globalThis.fetch,
): PersistedReceiptTransport;
```

`send` POST 到 `${collector}/api/events`，`reconcile` GET `${collector}/api/recordings/{recordingId}/delivery-state`。只接受现有 `PersistedReceipt`/`ReconciliationResult` schema；AbortSignal 必须透传；销毁后不得发出新请求。

- [ ] **步骤 4：运行定向测试和类型检查**

运行：`yarn workspace @datainsights/browser-sdk vitest run test/http-transport.test.ts test/transport-receipt.test.ts && yarn workspace @datainsights/browser-sdk check-types`

预期：PASS。

- [ ] **步骤 5：提交**

```bash
git add packages/datainsights-browser-sdk/src/transport packages/datainsights-browser-sdk/src/index.ts packages/datainsights-browser-sdk/test/http-transport.test.ts
git commit -m "feat(sdk): add resolved http transport"
```

### 任务 20：简化 Bootstrap 与授权入口

**文件：**
- 创建：`packages/datainsights-browser-sdk/src/runtime/bootstrap.ts`
- 修改：`packages/datainsights-browser-sdk/src/runtime/client.ts`
- 修改：`packages/datainsights-browser-sdk/src/runtime/state-machine.ts`
- 修改：`packages/datainsights-browser-sdk/src/browser-entry.ts`
- 修改：`packages/datainsights-browser-sdk/src/public/types.ts`
- 测试：`packages/datainsights-browser-sdk/test/bootstrap.test.ts`
- 测试：`packages/datainsights-browser-sdk/test/script-tag.integration.test.ts`

- [ ] **步骤 1：编写授权前零采集和点击后启动测试**

```ts
const result = await DataInsights.bootstrap({
  appKey: 'di_t_cn1_K7J9M2X4',
  consent: { startSelector: '#start-insurance', noticeVersion: 'notice-v1' },
  resolveUserId: () => 'policy-user-1',
});
expect(result.ok).toBe(true);
expect(DataInsights.getDebugInfo().state).toBe('initialized');
startButton.click();
await waitFor(() => DataInsights.getDebugInfo().state === 'recording');
```

同时覆盖：selector 不存在、重复 bootstrap、配置失败、应用停用、`resolveUserId` 抛错、按钮重复点击和 destroy 后监听器释放。

- [ ] **步骤 2：运行测试并确认 RED**

运行：`yarn workspace @datainsights/browser-sdk vitest run test/bootstrap.test.ts test/script-tag.integration.test.ts`

预期：FAIL，`bootstrap()` 尚不存在。

- [ ] **步骤 3：实现 Bootstrap 编排**

`bootstrap()` 顺序固定为：校验基础参数 → 解析 AppKey 路由 → 获取并校验远程配置 → 推导同目录 Worker URL → 创建 HTTP Transport → 调用现有 `init()` → 注册一次 click listener。click listener 内调用 `consent.grant({ noticeVersion, action: 'start-insurance' })`，解析可选 userId 后调用 `start()`；所有异步失败只进入本地诊断，不阻断宿主 click。

- [ ] **步骤 4：运行浏览器测试和类型检查**

运行：`yarn workspace @datainsights/browser-sdk vitest run test/bootstrap.test.ts test/script-tag.integration.test.ts && yarn workspace @datainsights/browser-sdk check-types`

预期：PASS；授权前没有 IndexedDB、Worker、rrweb 或 Collector 请求。

- [ ] **步骤 5：提交**

```bash
git add packages/datainsights-browser-sdk/src/runtime packages/datainsights-browser-sdk/src/browser-entry.ts packages/datainsights-browser-sdk/src/public/types.ts packages/datainsights-browser-sdk/test/bootstrap.test.ts packages/datainsights-browser-sdk/test/script-tag.integration.test.ts
git commit -m "feat(sdk): bootstrap recording from app key"
```

### 任务 21：IndexedDB 运行时能力探测

**文件：**
- 创建：`packages/datainsights-browser-sdk/src/persistence/capability.ts`
- 修改：`packages/datainsights-browser-sdk/src/persistence/database.ts`
- 修改：`packages/datainsights-browser-sdk/src/runtime/client.ts`
- 修改：`packages/datainsights-browser-sdk/src/public/types.ts`
- 测试：`packages/datainsights-browser-sdk/test/persistence-capability.test.ts`
- 创建：`packages/datainsights-browser-sdk/COMPATIBILITY.md`

- [ ] **步骤 1：编写 open/write/read/delete 和失败门禁测试**

测试必须覆盖：正常 fake-indexeddb、缺少 indexedDB、open 抛错、transaction abort、读回不一致、StorageManager API 缺失、`persist()` 返回 false。探测记录使用 `metadata` store 的随机 key，并在同一探测完成前删除。

- [ ] **步骤 2：运行测试并确认 RED**

运行：`yarn workspace @datainsights/browser-sdk vitest run test/persistence-capability.test.ts`

预期：FAIL，capability probe 尚不存在。

- [ ] **步骤 3：实现探测和诊断结果**

```ts
export interface PersistenceCapability {
  available: boolean;
  persisted: boolean | 'unsupported';
  quota?: number;
  usage?: number;
}

export async function probePersistenceCapability(
  factory?: IDBFactory,
  storage?: Pick<StorageManager, 'estimate' | 'persist' | 'persisted'>,
): Promise<SDKResult<PersistenceCapability>>;
```

探测失败返回 `PERSISTENCE_UNAVAILABLE`；不得降级到内存录制。`persist()` 拒绝只影响诊断，不把正常可写的 IndexedDB 判为不可用。

- [ ] **步骤 4：建立兼容矩阵并运行测试**

`COMPATIBILITY.md` 明确区分 Automated、Manual Passed、Pending，列出 iOS Safari、Android Chrome、微信/企业微信、支付宝、Windows Chrome/Edge、macOS Chrome/Safari。没有实际设备证据的项目必须保持 Pending。

运行：`yarn workspace @datainsights/browser-sdk vitest run test/persistence-capability.test.ts test/indexeddb-journal.test.ts test/indexeddb-outbox.test.ts && yarn workspace @datainsights/browser-sdk check-types`

预期：PASS。

- [ ] **步骤 5：提交**

```bash
git add packages/datainsights-browser-sdk/src/persistence packages/datainsights-browser-sdk/src/runtime/client.ts packages/datainsights-browser-sdk/src/public/types.ts packages/datainsights-browser-sdk/test/persistence-capability.test.ts packages/datainsights-browser-sdk/COMPATIBILITY.md
git commit -m "feat(sdk): gate recording on indexeddb capability"
```

### 任务 22：本地保险产品录制与回放环境

**文件：**
- 创建：`packages/datainsights-browser-sdk/examples/insurance-product/index.html`
- 创建：`packages/datainsights-browser-sdk/examples/insurance-product/styles.css`
- 创建：`packages/datainsights-browser-sdk/examples/insurance-product/app.js`
- 创建：`packages/datainsights-browser-sdk/examples/insurance-product/replay.html`
- 创建：`packages/datainsights-browser-sdk/scripts/insurance-demo.mjs`
- 创建：`packages/datainsights-browser-sdk/test/insurance-product.e2e.test.ts`
- 修改：`packages/datainsights-browser-sdk/package.json`

- [ ] **步骤 1：编写本地网络和真实回放 E2E 测试**

测试启动本地 server、真实 SDK UMD/Worker 和 rrweb UMD，使用移动端 viewport。请求监听器遇到非 `127.0.0.1`/`localhost` 地址立即使测试失败。流程必须执行方案切换、滚动、开始投保、姓名/手机号/证件号/金额/密码输入、提交、stop，并从本地 Collector 读取实际批次。

- [ ] **步骤 2：运行测试并确认 RED**

运行：`yarn workspace @datainsights/browser-sdk vitest run test/insurance-product.e2e.test.ts`

预期：FAIL，本地页面和 demo server 尚不存在。

- [ ] **步骤 3：实现去生产化保险页面与本地服务**

页面参考指定公开产品页的移动端长页面、保障计划、价格卡片、保障详情、告知弹窗和底部“开始投保”入口，不包含众安生产脚本、接口、Cookie、Fingerprint、监控或外链。`insurance-demo.mjs` 提供：

```text
GET  /gp/99440765
GET  /sdk/config?appKey=di_t_cn1_LOCALDEMO1
POST /api/events
GET  /api/recordings/:recordingId/delivery-state
GET  /recordings
GET  /replay/:recordingId
```

Collector 在进程内按 recordingId 保存批次并返回完全匹配的 `persisted: true` 回执；只绑定 `127.0.0.1`，退出时清理内存数据。

- [ ] **步骤 4：验证录制内容和真实回放**

断言批次包含普通姓名、计划切换和提交事件，不包含密码测试值；Outbox 在精确回执后清空；Replay 页面使用 `sandbox="allow-same-origin"` 且实际重建刚才录制的产品页文本。

运行：`yarn workspace @datainsights/browser-sdk vitest run test/insurance-product.e2e.test.ts test/replay-segment.integration.test.ts`

预期：PASS。

- [ ] **步骤 5：增加人工演示命令并提交**

`package.json` 增加：

```json
{
  "scripts": {
    "demo:insurance": "node scripts/insurance-demo.mjs",
    "test:insurance-e2e": "vitest run test/insurance-product.e2e.test.ts"
  }
}
```

```bash
git add packages/datainsights-browser-sdk/examples/insurance-product packages/datainsights-browser-sdk/scripts/insurance-demo.mjs packages/datainsights-browser-sdk/test/insurance-product.e2e.test.ts packages/datainsights-browser-sdk/package.json
git commit -m "test(sdk): add local insurance recording replay demo"
```

### 任务 23：文档、全量回归和交付证据

**文件：**
- 修改：`packages/datainsights-browser-sdk/README.md`
- 修改：`openspec/changes/di-1001/prd/README.md`
- 修改：`openspec/changes/di-1001/prd/01-scope-and-product-requirements.md`
- 修改：`openspec/changes/di-1001/prd/02-sdk-functional-requirements.md`
- 修改：`openspec/changes/di-1001/prd/04-compatibility-and-acceptance.md`
- 修改：`openspec/changes/di-1001/proposal.md`
- 修改：`openspec/changes/di-1001/tasks.md`
- 修改：`openspec/changes/di-1001/test-cases.md`
- 修改：`openspec/changes/di-1001/review-report.md`

- [ ] **步骤 1：更新接入和本地演示文档**

README 的推荐示例不得包含 endpoint、appSecret 或 securityKey；明确 AppKey 路由、配置失败 fail closed、`noticeVersion` 含义、内部演示用途及启动/回放 URL。

- [ ] **步骤 2：运行 SDK 全量验证**

依次运行，禁止与 rrweb 浏览器构建并行：

```bash
yarn workspace @datainsights/browser-sdk vitest run
yarn workspace @datainsights/browser-sdk check-types
yarn workspace @datainsights/browser-sdk prepublish
```

预期：全部通过并生成 ESM/CJS/UMD/types/Worker。

- [ ] **步骤 3：运行受影响上游回归**

```bash
yarn workspace @rrweb/record test
yarn workspace rrweb test
```

预期：功能回归通过；已有平台像素快照差异单独记录且不得更新快照掩盖。

- [ ] **步骤 4：更新测试证据和 Review Gate**

记录正向、边界、异常、隐私、零外网、录制/回放、IndexedDB 探测及回归结果；真机矩阵没有执行的条目保持 Pending。检查构建产物不包含 endpoint 配置示例、长期 secret、测试 token 或众安生产 URL。

- [ ] **步骤 5：提交**

```bash
git add packages/datainsights-browser-sdk/README.md openspec/changes/di-1001
git commit -m "docs(sdk): complete simplified integration evidence"
```
