# DI-1001：基于 rrweb Fork 的 DataInsights 前端 SDK

## 文档状态

- 状态：Confirmed
- 版本：v1.7
- 日期：2026-10-26
- Jira：DI-1001
- 实现分支：`futrue-v1`
- 确认人：用户
- 原始确认时间：2026-10-25T22:33:38+08:00
- 最近确认日期：2026-10-26

## 目标

基于 rrweb 源码 Fork 构建 DataInsights 浏览器 SDK，使客户可以通过一行 `<script>` 或稳定 JavaScript API 完成受控的用户行为录制。本期只交付前端 SDK 与本地验证工具，不建设生产后端。

## 文档导航

1. [范围与产品需求](01-scope-and-product-requirements.md)
2. [SDK 功能需求](02-sdk-functional-requirements.md)
3. [隐私、可靠性与性能](03-privacy-reliability-performance.md)
4. [兼容性与验收标准](04-compatibility-and-acceptance.md)
5. [Fork 与上游升级策略](05-fork-and-upstream-strategy.md)

## 决策状态

Proposal 阶段的 Blocking 决策已经全部关闭。用户已明确确认 PRD v1.7，可作为唯一 `proposal.md` 的需求输入。

已确认：

- 密码字段始终不得录制，其他业务输入默认录制，用于保险业务纠纷中的操作过程核验；
- 用户授权前完全不采集任何数据，包括 Replay、性能指标和身份数据。
- 授权告知与“开始投保”入口由嵌入方实现，SDK 仅在嵌入方显式通知后启动录制；
- 用户标识可由嵌入方提供，未提供时由 SDK 在授权后生成第一方随机 UUID；不使用 FingerprintJS。
- Session 以“开始投保”启动，以显式业务结束、授权撤回、登录会话失效或连续 30 分钟无有效操作结束；同标签页刷新延续，新标签页新建；多个 Session 可通过 `journeyId` 关联同一投保流程；
- 连续录制每 30 分钟进行技术分段，但不因此结束 Session。
- 源码目录为 `packages/datainsights-browser-sdk`，npm 包为 `@datainsights/browser-sdk`，浏览器全局对象为 `window.DataInsights`，并提供 ESM、类型声明和 Script Tag/CDN 构建。
- 每个“客户 × 产品 × 平台 × 环境”使用独立公开 `appKey`；SDK 不重复接收 `platform`，也不接收长期 `appSecret/securityKey`。
- 可靠投递采用方案 A：事件每 1 秒或 20 条形成持久化窗口，写入 IndexedDB 后再投递；重试只是恢复策略之一。
- 完整上送采用分层保障：采集序列、本地持久化、网络恢复、幂等与哈希校验、持久化回执、缺口对账、容量降级共同生效；本期实现 SDK 与 Mock 契约，不建设生产后端。

## 行业规则依据

- Google Analytics 与 PostHog 均采用 30 分钟无活动作为默认 Session 边界；
- NIST 与 OWASP 要求会话具备空闲超时、整体边界和显式结束机制；其登录安全会话规则仅作为边界设计参考，不等同于录制 Session；
- 保险投保录制采用业务流程关联优先：以 `journeyId` 关联同一次投保中的多个录制 Session。

## 来源

- Data-Insights 仓库中的 DI-1001 Draft PRD v1.2；
- 用户提供的 DataInsights 原始行业需求，以及后续明确的保险业务纠纷核验场景；
- 当前 rrweb Fork 的 `main` 基线 `e051ddb`。

