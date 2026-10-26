# 众安高保真本地页与真实输入时间轴实现计划

> **给代理工作者：** 必需子技能：使用 superpowers-subagent-driven-development（推荐）或 superpowers-executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法跟踪。

**目标：** 构建完全本地化的众安产品高保真测试页，通过阻断式告知取得录制授权，并让 1x 回放按真实时间逐字还原输入。

**架构：** 官方公开图片保存到演示资源目录并由本地 Node 服务提供，HTML/CSS/JavaScript 只实现测试所需的展示和交互，不加载众安脚本或接口。SDK 录制策略改为 `input: 'all'`；回放默认关闭 `skipInactive` 并使用原始事件时间戳。

**技术栈：** HTML、CSS、JavaScript、rrweb、rrweb-player、Vitest、Puppeteer、Node.js HTTP server

---

### 任务 1：锁定资源与页面验收测试

**文件：**

- 创建：`packages/datainsights-browser-sdk/examples/insurance-product/assets/zhongan/manifest.json`
- 创建：`packages/datainsights-browser-sdk/examples/insurance-product/assets/zhongan/*.{jpg,png}`
- 修改：`packages/datainsights-browser-sdk/test/insurance-product.e2e.test.ts`
- 修改：`packages/datainsights-browser-sdk/scripts/insurance-demo.mjs`

- [ ] **步骤 1：下载公开图片并生成清单**

  将参考页 Banner、购买理由、高保额、免健康告知、理赔、特药、医疗服务和页尾说明图片保存为稳定文件名。清单每项包含：

  ```json
  {
    "local": "hero.jpg",
    "source": "https://open-cdn.zhongan.com/dm/assembler/0336b936a9cc30115fb5c2ed1212a306.jpg",
    "purpose": "product hero",
    "retrievedAt": "2026-10-26"
  }
  ```

- [ ] **步骤 2：编写失败的页面结构测试**

  在 E2E 中断言 `.recording-consent`、`#consent-recording`、`#plan-choice`、`#product-features`、`#claims-guide`、`#faq`、`#insurance-form` 和 `.purchase-bar` 存在；检查全部 `img.currentSrc` 的 host 为 `127.0.0.1`。

- [ ] **步骤 3：运行 RED 测试**

  ```bash
  env PUPPETEER_HEADLESS=true TURBO_TELEMETRY_DISABLED=1 PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin node .yarn/releases/yarn-1.23.0-20220130.1630.cjs workspace @datainsights/browser-sdk vitest run test/insurance-product.e2e.test.ts
  ```

  预期：FAIL，缺少高保真模块与授权弹层。

- [ ] **步骤 4：让服务递归提供本地图片**

  为 `/insurance/assets/zhongan/<filename>` 建立显式资源映射，沿用 `nosniff` 与 `no-store`，并为 jpg/png 返回正确 MIME。

### 任务 2：实现阻断式录制告知状态机

**文件：**

- 修改：`packages/datainsights-browser-sdk/examples/insurance-product/index.html`
- 修改：`packages/datainsights-browser-sdk/examples/insurance-product/styles.css`
- 修改：`packages/datainsights-browser-sdk/examples/insurance-product/app.js`
- 测试：`packages/datainsights-browser-sdk/test/insurance-product.e2e.test.ts`

- [ ] **步骤 1：定义同意前断言**

  页面加载后断言弹层可见、背景不可操作、SDK 状态为 `initialized`、`/recordings` 为空；点击产品页元素不得开始录制。

- [ ] **步骤 2：定义同意后断言**

  点击 `#consent-recording` 后等待弹层消失和 SDK 状态变成 `recording`；首个全量快照序列化内容不得包含 `recording-consent` 或告知文案。

- [ ] **步骤 3：实现弹层和授权入口**

  HTML 使用：

  ```html
  <div class="recording-consent" role="dialog" aria-modal="true">
    <section class="recording-consent__sheet">
      <p class="recording-consent__brand">
        众安保险 · DataInsights 本地测试镜像
      </p>
      <h2>温馨提示，您已进入投保流程：</h2>
      <p>投保过程操作、页面行为将被记录留存，用于销售可回溯、纠纷核验。</p>
      <button id="consent-recording" type="button">同意并继续</button>
    </section>
  </div>
  ```

  SDK bootstrap 的 `startSelector` 改为 `#consent-recording`；同意按钮先隐藏弹层，再让 SDK 生成首个快照。

- [ ] **步骤 4：运行 E2E 确认授权门通过**

  使用任务 1 命令，预期授权相关断言 PASS。

### 任务 3：实现逐字输入与真实 1x 时间轴

**文件：**

- 修改：`packages/datainsights-browser-sdk/src/recorder/rrweb-adapter.ts`
- 修改：`packages/datainsights-browser-sdk/examples/insurance-product/replay.html`
- 修改：`packages/datainsights-browser-sdk/test/rrweb-privacy.test.ts`
- 修改：`packages/datainsights-browser-sdk/test/insurance-product.e2e.test.ts`

- [ ] **步骤 1：编写输入采样 RED 测试**

  ```ts
  expect(buildRecorderOptions(input).sampling.input).toBe('all');
  ```

  E2E 以 120ms 延迟逐字输入姓名，断言至少产生 4 个 `IncrementalSource.Input` 事件，并断言首末输入事件时间戳差不小于 300ms。

- [ ] **步骤 2：运行 RED 测试**

  ```bash
  env TURBO_TELEMETRY_DISABLED=1 PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin node .yarn/releases/yarn-1.23.0-20220130.1630.cjs workspace @datainsights/browser-sdk vitest run test/rrweb-privacy.test.ts test/insurance-product.e2e.test.ts
  ```

  预期：FAIL，当前为 `input: 'last'` 且没有逐字事件。

- [ ] **步骤 3：实现真实输入采样**

  ```ts
  sampling: {
    mousemove: false,
    scroll: 150,
    input: 'all',
    media: 800,
  }
  ```

  保留 `maskInputOptions.password: true` 与密码明文缺失断言。

- [ ] **步骤 4：修正播放器默认时间语义**

  ```js
  skipInactive: false,
  speed: 1,
  speedOption: [1, 2, 4, 8],
  ```

  E2E 断言 skip 开关默认未选中、进度总时长等于末事件时间戳减首事件时间戳，并在 1x 播放时观察输入值逐步变化。

### 任务 4：实现高保真产品内容与交互

**文件：**

- 修改：`packages/datainsights-browser-sdk/examples/insurance-product/index.html`
- 修改：`packages/datainsights-browser-sdk/examples/insurance-product/styles.css`
- 修改：`packages/datainsights-browser-sdk/examples/insurance-product/app.js`
- 测试：`packages/datainsights-browser-sdk/test/insurance-product.e2e.test.ts`

- [ ] **步骤 1：重建移动产品页**

  按参考页顺序实现方案标签、保障清单、价格、购买理由、五个产品特色图文模块、理赔流程、FAQ、风险提示与底部购买栏；桌面仅居中显示 390px 移动画布。

- [ ] **步骤 2：实现交互**

  方案切换更新 `selectedPlan`、价格与保障文案；导航执行 `scrollIntoView`；FAQ 切换 `aria-expanded`；“立即投保”滚动并展开 `#insurance-form`。

- [ ] **步骤 3：扩展本地表单**

  保留现有测试 ID，并加入出生日期、关系、社保状态和支付周期。提交仍先写 `policy-submit` 自定义事件，再等待 `DataInsights.stop('completed')`。

- [ ] **步骤 4：运行 E2E**

  使用任务 1 命令，预期高保真结构、交互、本地资源、逐字输入、隐私与回放断言全部 PASS。

### 任务 5：回归、视觉核验与服务重启

**文件：**

- 验证：`packages/datainsights-browser-sdk/test/**/*.test.ts`

- [ ] **步骤 1：格式化和类型检查**

  ```bash
  yarn prettier --write packages/datainsights-browser-sdk/examples/insurance-product packages/datainsights-browser-sdk/src/recorder/rrweb-adapter.ts packages/datainsights-browser-sdk/test/insurance-product.e2e.test.ts packages/datainsights-browser-sdk/test/rrweb-privacy.test.ts
  yarn workspace @datainsights/browser-sdk check-types
  ```

- [ ] **步骤 2：运行 SDK 全量测试**

  ```bash
  env PUPPETEER_HEADLESS=true TURBO_TELEMETRY_DISABLED=1 PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin node .yarn/releases/yarn-1.23.0-20220130.1630.cjs workspace @datainsights/browser-sdk vitest run
  ```

  预期：全部 PASS，密码明文和非本地请求数量均为零。

- [ ] **步骤 3：重启 4173 服务并视觉核验**

  新建真实节奏录制，截取产品页、告知弹层和回放页截图；确认 1x 逐字输入、完整进度条和本地图片。

- [ ] **步骤 4：提交**

  ```bash
  git add packages/datainsights-browser-sdk docs/superpowers/plans/2026-10-26-zhongan-fidelity-input-timeline.md
  git commit -m "feat(sdk): add high fidelity insurance recording demo"
  ```
