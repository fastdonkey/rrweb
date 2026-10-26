# 保险回放播放器实现计划

> **给代理工作者：** 必需子技能：使用 superpowers-subagent-driven-development（推荐）或 superpowers-executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法跟踪。

**目标：** 将保险演示的空白裸回放画布替换为本仓库 `rrweb-player` 标准播放器，并提供默认暂停、播放/暂停、进度拖动、倍速、跳过静止和全屏能力。

**架构：** 演示服务启动时分别构建 SDK 与本仓库的 `rrweb-player`，将播放器 UMD 脚本和 CSS 作为本地内存资源提供。回放页面加载这些资源，将有序事件流交给 `rrwebPlayer`，按录制的 390×844 移动视口配置响应式播放器，并继续通过 rrweb iframe 隔离原页面脚本。

**技术栈：** TypeScript、Vitest、Puppeteer、Vite、Svelte、rrweb-player、Node.js HTTP server

---

### 任务 1：用浏览器测试定义标准播放器行为

**文件：**

- 修改：`packages/datainsights-browser-sdk/test/insurance-product.e2e.test.ts`

- [ ] **步骤 1：编写失败的测试**

  在进入回放页后等待播放器根节点，并断言标准控制器、进度滑块、倍速按钮、默认暂停状态和回放 iframe：

  ```ts
  await page.waitForSelector('#replay-root .rr-player');
  const playerUi = await page.evaluate(() => ({
    hasController: Boolean(document.querySelector('.rr-controller')),
    hasProgress: Boolean(
      document.querySelector('[role="slider"][aria-label="Playback position"]'),
    ),
    speeds: [...document.querySelectorAll('.rr-controller__btns button')]
      .map((button) => button.textContent?.trim())
      .filter((text) => /^\d+x$/.test(text ?? '')),
    paused: (window as any).__REPLAY_PLAYER__
      ?.getReplayer()
      .service.state.matches('paused'),
  }));
  expect(playerUi).toMatchObject({
    hasController: true,
    hasProgress: true,
    speeds: ['1x', '2x', '4x', '8x'],
    paused: true,
  });
  ```

  保留现有表单值、密码排除、iframe sandbox 和无外网请求断言；通过播放器内部 iframe 读取姓名和保额。

- [ ] **步骤 2：运行测试确认失败**

  运行：

  ```bash
  env PUPPETEER_HEADLESS=true TURBO_TELEMETRY_DISABLED=1 PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin node .yarn/releases/yarn-1.23.0-20220130.1630.cjs workspace @datainsights/browser-sdk vitest run test/insurance-product.e2e.test.ts
  ```

  预期：FAIL，原因是 `.rr-player`、`.rr-controller` 和进度滑块尚不存在。

### 任务 2：向本地演示服务加入 rrweb-player 资源

**文件：**

- 修改：`packages/datainsights-browser-sdk/scripts/insurance-demo.mjs`
- 测试：`packages/datainsights-browser-sdk/test/insurance-product.e2e.test.ts`

- [ ] **步骤 1：构建本仓库播放器**

  在 `prepareAssets()` 中使用播放器自己的 Vite 配置执行构建：

  ```js
  await viteBuild({
    configFile: path.resolve(
      repositoryRoot,
      'packages/rrweb-player/vite.config.ts',
    ),
  });
  ```

- [ ] **步骤 2：读取并暴露本地资源**

  扩展 `readAssets()`，加入本地路由：

  ```js
  [
    '/player/rrweb-player.js',
    path.resolve(repositoryRoot, 'packages/rrweb-player/umd/rrweb-player.js'),
  ],
  [
    '/player/style.css',
    path.resolve(repositoryRoot, 'packages/rrweb-player/dist/style.css'),
  ],
  ```

  保持 `Cache-Control: no-store`，确保本地修改刷新后立即生效。

- [ ] **步骤 3：运行 RED 测试确认失败点前移**

  运行任务 1 的命令。预期仍 FAIL，但播放器脚本和样式请求均返回 200，不再因资源缺失失败。

### 任务 3：使用 rrweb-player 渲染响应式回放页

**文件：**

- 修改：`packages/datainsights-browser-sdk/examples/insurance-product/replay.html`
- 测试：`packages/datainsights-browser-sdk/test/insurance-product.e2e.test.ts`

- [ ] **步骤 1：加载本地播放器资源**

  将裸 `/rrweb.js` 依赖替换为：

  ```html
  <link rel="stylesheet" href="/player/style.css" />
  <script src="/player/rrweb-player.js"></script>
  ```

- [ ] **步骤 2：创建默认暂停的播放器**

  将 `new rrweb.Replayer(...)` 替换为：

  ```js
  const player = new rrwebPlayer({
    target: document.querySelector('#replay-root'),
    props: {
      events,
      width: 390,
      height: 844,
      autoPlay: false,
      showController: true,
      skipInactive: true,
      speedOption: [1, 2, 4, 8],
    },
  });
  window.__REPLAY_PLAYER__ = player;
  ```

  使用 `player.getReplayer()` 监听 `FullsnapshotRebuilded` 和 `Finish`，继续更新 `__REPLAY_READY__`、`__REPLAY_FINISHED__` 和页面状态。默认暂停场景下，测试只等待全量快照重建；点击播放后再等待完成。

- [ ] **步骤 3：修正页面与播放器布局**

  让 `#replay-root` 横向滚动但不制造全屏空白；让 `.rr-player` 在窄屏时以 transform 或播放器 resize 机制保持等比显示，并将控制栏置于画布下方。页面外层最大宽度围绕 390px 录制视口加控制区设置，桌面浏览器中居中展示。

- [ ] **步骤 4：运行定向测试确认通过**

  运行任务 1 的命令。预期：1 个测试 PASS，控制器和进度条可见，默认暂停，点击播放后表单内容正确呈现。

- [ ] **步骤 5：提交垂直切片**

  ```bash
  git add packages/datainsights-browser-sdk/scripts/insurance-demo.mjs packages/datainsights-browser-sdk/examples/insurance-product/replay.html packages/datainsights-browser-sdk/test/insurance-product.e2e.test.ts
  git commit -m "fix(sdk): add controls to insurance replay"
  ```

### 任务 4：回归验证并更新运行服务

**文件：**

- 验证：`packages/datainsights-browser-sdk/test/insurance-product.e2e.test.ts`
- 验证：`packages/datainsights-browser-sdk/test/replay-segment.integration.test.ts`

- [ ] **步骤 1：运行浏览器与分段回放回归**

  ```bash
  env PUPPETEER_HEADLESS=true TURBO_TELEMETRY_DISABLED=1 PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin node .yarn/releases/yarn-1.23.0-20220130.1630.cjs workspace @datainsights/browser-sdk vitest run test/insurance-product.e2e.test.ts test/replay-segment.integration.test.ts
  ```

  预期：两个测试文件全部 PASS。

- [ ] **步骤 2：格式与工作树检查**

  ```bash
  env TURBO_TELEMETRY_DISABLED=1 PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin node .yarn/releases/yarn-1.23.0-20220130.1630.cjs prettier --write packages/datainsights-browser-sdk/scripts/insurance-demo.mjs packages/datainsights-browser-sdk/examples/insurance-product/replay.html packages/datainsights-browser-sdk/test/insurance-product.e2e.test.ts
  git diff --check
  ```

  预期：Prettier 成功，`git diff --check` 无输出。

- [ ] **步骤 3：重启并探测本地演示服务**

  停止旧的 `demo:insurance` 进程，重新运行该脚本，并检查
  `http://127.0.0.1:4173/gp/99440765` 返回 200。用户创建一条新录制后，回放页应显示完整播放器。
