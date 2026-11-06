# 保险须知逐项阅读与确认实现计划

> **给代理工作者：** 必需子技能：使用 superpowers-test-driven-development 在当前会话逐任务实现此计划。步骤使用复选框（`- [ ]`）语法跟踪。

**目标：** 在 DataInsights 本地保险 Demo 中加入五份须知逐项打开、滚动到底确认和提交门禁，并通过真实 rrweb 录制与回放验证全过程。

**架构：** HTML 提供一个须知列表容器和一个共享底部弹层；`app.js` 使用固定、去生产化的文档模型维护页面内确认状态，并驱动原生 `disabled` 门禁。rrweb 记录点击、滚动和 DOM 变化，全部完成时只补充一个不含正文或用户数据的自定义事件。

**技术栈：** 原生 HTML/CSS/JavaScript、DataInsights Browser SDK、rrweb、Puppeteer、Vitest。

---

## 文件结构

- `packages/datainsights-browser-sdk/test/insurance-product.e2e.test.ts`：须知流程 RED/GREEN、录制与回放断言。
- `packages/datainsights-browser-sdk/examples/insurance-product/index.html`：须知列表、剩余状态和共享阅读弹层。
- `packages/datainsights-browser-sdk/examples/insurance-product/app.js`：文档模型、到底检测、幂等确认、提交门禁和自定义事件。
- `packages/datainsights-browser-sdk/examples/insurance-product/styles.css`：移动端须知卡片和长文阅读弹层样式。
- `openspec/changes/di-1001/prd/02-sdk-functional-requirements.md`、`prd/04-compatibility-and-acceptance.md`、`tasks.md`、`test-cases.md`：T35 需求与证据。
- `packages/datainsights-browser-sdk/README.md`：本地 Demo 能力说明。

### 任务 1：建立须知流程 RED 测试

**文件：**

- 修改：`packages/datainsights-browser-sdk/test/insurance-product.e2e.test.ts`

- [x] **步骤 1：加入初始提交门禁断言**

在点击录制授权并显示表单后检查五项须知、剩余数量和禁用状态：

```ts
const noticeGate = await page.evaluate(() => ({
  items: document.querySelectorAll('[data-insurance-notice]').length,
  remaining: document.querySelector('#notice-confirmation-status')?.textContent,
  submitDisabled: (
    document.querySelector('#submit-policy') as HTMLButtonElement
  ).disabled,
}));
expect(noticeGate.items).toBe(5);
expect(noticeGate.remaining).toContain('还需确认 5 项');
expect(noticeGate.submitDisabled).toBe(true);
```

- [x] **步骤 2：加入逐项滚动和确认断言**

测试使用非页面展示顺序完成五项：

```ts
const noticeCodes = [
  'health-disclosure',
  'application-notice',
  'policy-terms',
  'exemption-clauses',
  'privacy-authorization',
];
for (const code of noticeCodes) {
  await page.click(`[data-insurance-notice="${code}"]`);
  await page.waitForSelector('#insurance-notice-modal:not([hidden])');
  expect(
    await page.$eval(
      '#confirm-insurance-notice',
      (button) => (button as HTMLButtonElement).disabled,
    ),
  ).toBe(true);
  await page.$eval('#insurance-notice-content', (element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event('scroll'));
  });
  await page.waitForFunction(
    () =>
      !(
        document.querySelector('#confirm-insurance-notice') as HTMLButtonElement
      ).disabled,
  );
  await page.click('#confirm-insurance-notice');
}
```

- [x] **步骤 3：运行并确认 RED**

运行：`PUPPETEER_HEADLESS=true yarn workspace @datainsights/browser-sdk vitest run test/insurance-product.e2e.test.ts`

预期：FAIL，原因是缺少须知 DOM 和交互，而非测试环境或拼写错误。

### 任务 2：实现页面交互并达到 GREEN

**文件：**

- 修改：`packages/datainsights-browser-sdk/examples/insurance-product/index.html`
- 修改：`packages/datainsights-browser-sdk/examples/insurance-product/styles.css`
- 修改：`packages/datainsights-browser-sdk/examples/insurance-product/app.js`

- [x] **步骤 1：添加列表与共享弹层**

在表单提交按钮前增加 `#insurance-notice-list`、`#notice-confirmation-status`；在页面弹层区域增加 `#insurance-notice-modal`，包含标题、版本、`#insurance-notice-content`、关闭按钮和默认禁用的 `#confirm-insurance-notice`。

- [x] **步骤 2：实现固定文档模型**

```js
const insuranceNotices = [
  { code: 'application-notice', title: '投保须知', version: 'v1.0' },
  { code: 'policy-terms', title: '保险条款', version: 'v1.0' },
  { code: 'health-disclosure', title: '健康告知', version: 'v1.0' },
  { code: 'exemption-clauses', title: '免责条款', version: 'v1.0' },
  {
    code: 'privacy-authorization',
    title: '个人信息处理授权书',
    version: 'v1.0',
  },
];
const confirmationOrder = [];
const confirmedNoticeCodes = new Set();
```

每项另带固定 `summary` 和多个去生产化 `sections`。文档代码不读取 URL 或外部响应。

- [x] **步骤 3：实现到底检测和幂等确认**

```js
const reachedBottom =
  content.scrollHeight - content.scrollTop - content.clientHeight <= 2;
```

实现 `openNotice(code)`、`closeNotice()`、`updateNoticeGate()`。关闭未读弹层不确认；已确认项重复打开不重复写入 `confirmationOrder`；关闭后焦点返回入口按钮。

- [x] **步骤 4：实现提交门禁与安全自定义事件**

全部完成时只调用一次：

```js
window.DataInsights.addCustomEvent('insurance-notices-confirmed', {
  noticeVersion: 'local-insurance-notices-v1',
  documentCodes: insuranceNotices.map(({ code }) => code),
  confirmationOrder: [...confirmationOrder],
});
```

表单 `submit` 处理器首先检查 `confirmedNoticeCodes.size === insuranceNotices.length`，失败时不得调用 `DataInsights.stop()`。

- [x] **步骤 5：添加移动端样式**

须知入口使用原生按钮；确认状态同时使用文字和颜色。正文设置固定最大高度、`overflow-y: auto`；弹层打开时锁定背景滚动。

- [x] **步骤 6：运行定向测试确认 GREEN**

运行任务 1 命令，预期保险 E2E 通过。

### 任务 3：补齐录制与回放证据

**文件：**

- 修改：`packages/datainsights-browser-sdk/test/insurance-product.e2e.test.ts`

- [x] **步骤 1：断言录制批次**

```ts
expect(serialized).toContain('insurance-notices-confirmed');
expect(serialized).toContain('health-disclosure');
expect(serialized).not.toContain('NeverRecordInsurancePassword!');
expect(serialized).not.toContain('本模拟文件用于逐项说明');
```

- [x] **步骤 2：断言回放最终状态**

从 replay iframe 读取 `.insurance-notice-item.is-confirmed` 数量和 `#notice-confirmation-status`，预期为五项及“已完成全部阅读确认”。现有速度列表、进度条、`skipInactive=false`、沙箱和零外网断言继续保留。

- [x] **步骤 3：再次运行定向测试**

运行任务 1 命令，预期通过。

### 任务 4：同步文档并完整验证

**文件：**

- 修改：`openspec/changes/di-1001/prd/02-sdk-functional-requirements.md`
- 修改：`openspec/changes/di-1001/prd/04-compatibility-and-acceptance.md`
- 修改：`openspec/changes/di-1001/tasks.md`
- 修改：`openspec/changes/di-1001/test-cases.md`
- 修改：`packages/datainsights-browser-sdk/README.md`

- [x] **步骤 1：记录 DEV-DI-035**

写明它属于本地保险行业验证场景，不把 SDK 核心定位成保险专用；记录五项、滚动门禁、幂等确认、提交门禁、自定义事件与回放断言。

- [x] **步骤 2：运行完整验证**

```bash
PUPPETEER_HEADLESS=true yarn workspace @datainsights/browser-sdk vitest run
yarn workspace @datainsights/browser-sdk check-types
yarn workspace @datainsights/browser-sdk prepublish
```

预期：全部通过，并把真实文件数、测试数和构建体积写入证据。

- [x] **步骤 3：检查边界**

```bash
git diff --check
git diff --name-only
```

预期：无空白错误；没有修改 rrweb 核心源码。

- [x] **步骤 4：保留工作区改动供审查**

本轮不提交 Git，避免混入现有暂存压缩改动。向用户报告新增/修改文件、RED/GREEN 证据和人工浏览入口。
