# 保险产品页 P1/P2 交互录制压力测试实现计划

> **给代理工作者：** 必需子技能：使用 superpowers-test-driven-development 在当前会话逐任务实现此计划。步骤使用复选框（`- [ ]`）语法跟踪。

**目标：** 在 DataInsights 本地保险产品页加入 P1 复杂 DOM 交互与 P2 浏览器能力边界组件，并用真实 Chrome 验证录制、回放、隐私和零外网行为。

**架构：** 产品页新增独立的 Interaction Lab 模块，状态和监听逻辑放在 `interaction-lab.js`，样式放在 `interaction-lab.css`，避免扩大现有投保 `app.js`。iframe 与 PDF 阅读器模拟使用独立本地页面；新的 E2E 独立于现有投保流程，复用本地 Demo Server 和真实 SDK。

**技术栈：** 原生 HTML/CSS/JavaScript、Canvas 2D、WebGL、sessionStorage、iframe、DataInsights Browser SDK、rrweb、Puppeteer、Vitest。

---

## 文件结构

- 修改 `examples/insurance-product/index.html`：挂载 Interaction Lab 及资源引用。
- 创建 `examples/insurance-product/interaction-lab.css`：实验室布局、组件和能力标签样式。
- 创建 `examples/insurance-product/interaction-lab.js`：P1/P2 状态机、持久化和安全自定义事件。
- 创建 `examples/insurance-product/iframe-lab.html`：同源/跨源 iframe 交互页。
- 创建 `examples/insurance-product/pdf-reader.html`：确定性的本地 PDF 阅读器模拟。
- 修改 `scripts/insurance-demo.mjs`：提供新增静态资源，并允许 `localhost` 访问同一服务以形成跨源边界。
- 创建 `test/insurance-interaction-lab.e2e.test.ts`：真实 Chrome 的 RED/GREEN、录制和回放证据。
- 修改 `openspec/changes/di-1001/tasks.md`、`test-cases.md` 与 Demo README：记录 DEV-DI-036 和验证结果。

### 任务 1：建立 P1 交互 RED

**文件：**

- 创建：`packages/datainsights-browser-sdk/test/insurance-interaction-lab.e2e.test.ts`

- [x] **步骤 1：编写页面结构与 P1 行为断言**

测试启动 `startInsuranceDemoServer({ buildAssets: true })`，使用 390×844 Chrome 页面，拦截并拒绝非 `127.0.0.1` / `localhost` 请求。授权录制后断言：

```ts
expect(
  await page.$$eval('[data-lab-component]', (nodes) => nodes.length),
).toBeGreaterThanOrEqual(10);
await page.click('[data-lab-tab="claims"]');
await page.click('[data-lab-accordion="waiting-period"]');
await page.type('#lab-search', '上海');
await page.keyboard.press('ArrowDown');
await page.keyboard.press('Enter');
expect(
  await page.$eval('#lab-selected-suggestion', (node) => node.textContent),
).toContain('上海');
```

继续覆盖横向下一项、Toast、虚拟列表滚动/选择、上传元数据和 sessionStorage 状态。

- [x] **步骤 2：运行测试确认 RED**

运行：

```bash
PUPPETEER_HEADLESS=true yarn workspace @datainsights/browser-sdk vitest run test/insurance-interaction-lab.e2e.test.ts
```

预期：FAIL，因为页面没有 `#interaction-lab` 和组件 DOM。

### 任务 2：实现 P1 Interaction Lab

**文件：**

- 修改：`packages/datainsights-browser-sdk/examples/insurance-product/index.html`
- 创建：`packages/datainsights-browser-sdk/examples/insurance-product/interaction-lab.css`
- 创建：`packages/datainsights-browser-sdk/examples/insurance-product/interaction-lab.js`
- 修改：`packages/datainsights-browser-sdk/scripts/insurance-demo.mjs`

- [x] **步骤 1：添加实验室结构和资源路由**

在产品页主内容中加入 `#interaction-lab`，引用 `/insurance/interaction-lab.css` 和 `/insurance/interaction-lab.js`。Server 将两个资源加入静态 Map。

- [x] **步骤 2：实现页签、手风琴和搜索联想**

使用 `textContent` / `createElement` 更新 DOM，不拼接用户输入到 `innerHTML`。搜索支持 ArrowUp、ArrowDown、Enter、Escape，并维护 `aria-activedescendant`。

- [x] **步骤 3：实现横向方案、Toast 和虚拟列表**

虚拟列表使用固定 `ITEM_HEIGHT = 48`、`BUFFER = 3`、总数 200；滚动时计算：

```js
const start = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - BUFFER);
const end = Math.min(
  total,
  Math.ceil((scrollTop + clientHeight) / ITEM_HEIGHT) + BUFFER,
);
```

所有索引限制在合法范围，Toast 定时器在替换 Toast 时清除。

- [x] **步骤 4：实现上传元数据和刷新恢复**

只读取 `file.name`、`file.type`、`file.size`，不调用 `FileReader`。sessionStorage 只保存设计状态对象；刷新按钮先持久化再 `location.reload()`。

- [x] **步骤 5：运行定向测试确认 P1 GREEN**

运行任务 1 命令，预期 P1 断言通过，P2 断言仍处于 RED。

### 任务 3：建立并实现 iframe/PDF 边界

**文件：**

- 创建：`packages/datainsights-browser-sdk/examples/insurance-product/iframe-lab.html`
- 创建：`packages/datainsights-browser-sdk/examples/insurance-product/pdf-reader.html`
- 修改：`packages/datainsights-browser-sdk/scripts/insurance-demo.mjs`
- 修改：`packages/datainsights-browser-sdk/test/insurance-interaction-lab.e2e.test.ts`

- [x] **步骤 1：先增加失败断言**

断言页面存在同源、跨源、PDF 三个 iframe；同源 iframe 可输入和计数，跨源 iframe DOM 从父页面读取时抛出 `SecurityError`，PDF 模拟可翻到第 2 页并调整为 125%。

- [x] **步骤 2：运行确认 RED**

预期：FAIL，因为 iframe 资源和路由不存在。

- [x] **步骤 3：实现本地 iframe 页面**

`iframe-lab.html` 包含计数按钮、普通文本输入和可滚动条目，不加载 SDK。父页面同源地址使用当前 origin；跨源地址把 `127.0.0.1` 替换成 `localhost`。

- [x] **步骤 4：实现 PDF 阅读器模拟**

`pdf-reader.html` 包含三页固定文档、上一页/下一页、100%/125%/150% 缩放与页码 DOM 状态，不使用原生 PDF 插件。

- [x] **步骤 5：运行确认 GREEN**

运行定向测试，预期 iframe/PDF 行为通过且请求仍全部为本地地址。

### 任务 4：建立并实现 Canvas/WebGL/权限边界

**文件：**

- 修改：`packages/datainsights-browser-sdk/examples/insurance-product/index.html`
- 修改：`packages/datainsights-browser-sdk/examples/insurance-product/interaction-lab.js`
- 修改：`packages/datainsights-browser-sdk/examples/insurance-product/interaction-lab.css`
- 修改：`packages/datainsights-browser-sdk/test/insurance-interaction-lab.e2e.test.ts`

- [x] **步骤 1：先增加失败断言**

使用 Puppeteer Mouse 在 Canvas 上画两条轨迹，断言段数增加、完成状态出现；点击 WebGL 开始/暂停并验证状态；点击模拟媒体授权并验证没有调用 `getUserMedia`。

- [x] **步骤 2：运行确认 RED**

预期：FAIL，因为能力边界组件未实现。

- [x] **步骤 3：实现 Canvas 状态**

PointerDown 开始新轨迹，PointerMove 仅在按下时绘制，PointerUp 完成当前轨迹。DOM 只记录轨迹段数；`canvas-signature-completed` 只发送 `{ strokeCount }`。

- [x] **步骤 4：实现 WebGL 与权限模拟**

WebGL 使用 requestAnimationFrame 绘制旋转清屏色；暂停和 `visibilitychange` 取消动画。媒体按钮只切换 DOM 状态，不调用浏览器媒体 API。

- [x] **步骤 5：运行确认 GREEN**

运行定向测试，预期 Canvas/WebGL/权限状态通过。

### 任务 5：验证录制、回放和隐私

**文件：**

- 修改：`packages/datainsights-browser-sdk/test/insurance-interaction-lab.e2e.test.ts`

- [x] **步骤 1：先增加录制批次断言**

点击“记录当前实验状态”后停止录制，断言批次包含固定组件状态和 `interaction-lab-checkpoint`；不包含上传文件正文、本机绝对路径或 iframe 自由文本对应的自定义事件。

- [x] **步骤 2：增加回放最终状态断言**

打开 `/replay/:recordingId`，播放至结束后从 replay iframe 检查：选中页签、手风琴、方案卡、Toast 汇总、虚拟列表选择、Canvas 外围状态、WebGL 状态和媒体模拟状态。

- [x] **步骤 3：验证刷新恢复**

在停止前执行真实刷新，等待 SDK 和实验室重新就绪，验证允许持久化的状态恢复、临时搜索候选/文件对象未恢复，并继续归入现有 Trace 契约。

- [x] **步骤 4：运行定向测试确认 GREEN**

运行任务 1 命令，预期全部通过。

### 任务 6：同步 DI-1001 并完整回归

**文件：**

- 修改：`openspec/changes/di-1001/tasks.md`
- 修改：`openspec/changes/di-1001/test-cases.md`
- 修改：`packages/datainsights-browser-sdk/README.md`

- [x] **步骤 1：记录 DEV-DI-036**

写明 P1/P2 Demo 范围、能力边界、隐私约束和真实浏览器验收，不把测试组件提升为 SDK API。

- [x] **步骤 2：运行完整验证**

```bash
PUPPETEER_HEADLESS=true yarn workspace @datainsights/browser-sdk vitest run
yarn workspace @datainsights/browser-sdk check-types
yarn workspace @datainsights/browser-sdk prepublish
git diff --check
```

- [x] **步骤 3：检查侵入边界**

运行 `git diff --name-only -- packages/rrweb packages/rrweb-player packages/types packages/rrdom`，预期无输出。

- [x] **步骤 4：更新 4175 Demo**

只重启 4175，保留 4173/4174 的内存录制；人工入口保持 `http://127.0.0.1:4175/gp/99440765`。

- [x] **步骤 5：保留改动供审查**

不自动提交；用户明确要求后再将本任务文件加入暂存区。
