# DI-1001 Fork 与上游升级策略

## 1. 已确认原则

- 基于 rrweb 源码构建 DataInsights SDK；
- 尽量减少对 rrweb 原始代码的侵入；
- 后续 rrweb 升级时，DataInsights 能同步和吸收底座能力；
- DataInsights 产品 API 与 rrweb 内部 API 分层；
- 必要核心修改采用最小、可测试、可追踪的补丁。

## 2. 推荐结构

当前 rrweb monorepo 已包含 `packages/browser-client`，但该包绑定 rrweb Cloud 的 WebSocket/HTTP 协议。推荐保留该包不变，并新增独立 DataInsights 产品层：

```text
packages/
  record/                         # 上游维护，优先不改
  replay/                         # 上游维护，优先不改
  rrweb/                          # 上游维护，优先不改
  browser-client/                 # 保留 rrweb Cloud 语义
  datainsights-browser-sdk/        # DataInsights 产品层（已确认）
```

`datainsights-browser-sdk` 复用 rrweb 公共包和扩展点。只有公共扩展点无法满足需求时，才修改 `record`、`rrweb-snapshot`、`types` 或其他核心包。

该目录发布为 npm 包 `@datainsights/browser-sdk`；Script Tag/CDN 产物暴露 `window.DataInsights`。DataInsights SDK 使用独立版本，不与 rrweb 包版本绑定。

## 3. Git 远端模型

建议远端配置：

```text
origin    https://github.com/fastdonkey/rrweb.git
upstream  https://github.com/rrweb-io/rrweb.git
```

- `origin/main`：跟踪 Fork 的稳定基线；
- `upstream/main`：官方上游；
- `futrue-v1`：DI-1001 当前能力开发分支；
- 后续功能使用短生命周期 feature 分支，再合并到 `futrue-v1`；
- 上游同步先在独立同步分支完成构建、测试和兼容评估。

当前仓库已经配置 `upstream` remote；首次同步前仍需显式执行 `git fetch upstream`。

## 4. 上游同步流程

```text
fetch upstream
  → 创建 sync/upstream-<version> 分支
  → 合并或 rebase 官方变更
  → 解决核心补丁冲突
  → 运行 rrweb 原始测试
  → 运行 DataInsights SDK 测试
  → 验证旧事件 fixture 回放
  → 评估依赖、许可证和安全变化
  → 合并到 futrue-v1
```

团队需在 Design 阶段选择 merge 或 rebase 作为统一同步策略。

## 5. 侵入等级

| 等级 | 修改位置 | 要求 |
| --- | --- | --- |
| L0 | 仅新增 DataInsights 包和文档 | 首选 |
| L1 | 使用或补充公开扩展点 | 优先向上游贡献通用改动 |
| L2 | 修改 recorder/snapshot/types 核心 | 必须有 ADR、测试和升级影响说明 |
| L3 | 修改事件协议或破坏兼容性 | 原则上禁止，需单独批准 |

## 6. 核心补丁登记

每个 L2/L3 补丁至少记录：

- 业务原因；
- 修改包和文件；
- 为什么现有扩展点不足；
- 对录制协议和回放的影响；
- 自动化测试；
- 对应上游 issue/PR（如适合贡献）；
- 上游发布后是否可删除本地补丁。

## 7. 发布与版本

- DataInsights SDK 使用自己的 SemVer，不与 rrweb 版本绑定；
- 构建元数据记录 rrweb 基线版本和 commit；
- rrweb 主版本升级触发兼容性评审；
- DataInsights 破坏性 API 变化只在自身主版本升级时发布；
- 发布说明区分 DataInsights 功能变化与 rrweb 底座同步变化。

## 8. 当前仓库事实

| 项目 | 当前值 |
| --- | --- |
| Fork origin | `https://github.com/fastdonkey/rrweb.git` |
| 官方来源 | `upstream = https://github.com/rrweb-io/rrweb.git` |
| 基线分支 | `main` |
| DI-1001 分支 | `futrue-v1` |
| 创建时基线 commit | `e051ddb` |
| rrweb 包版本 | `2.2.0` |
| 包管理器 | Yarn 1.22.19 workspaces + Turbo |

