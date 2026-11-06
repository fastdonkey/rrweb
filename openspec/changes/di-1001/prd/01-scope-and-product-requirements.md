# DI-1001 范围与产品需求

## 1. 产品定位

DataInsights SDK 是面向保险业务场景的浏览器端用户行为录制 SDK。底层基于 rrweb 源码 Fork，在其上提供稳定的接入 API、隐私控制、生命周期管理、事件输出、故障隔离和兼容性保障。录制结果用于在客户发生业务纠纷时，为保险公司提供可核验的用户操作过程。

## 2. 用户故事

> 作为客户前端研发，我希望通过一行脚本或少量 JavaScript API 接入用户行为录制，以便在不理解 rrweb 内部实现、且不影响宿主业务的情况下获得可回放的标准事件。

## 3. 本期纳入范围

- rrweb Fork 基线和上游同步机制；
- DataInsights SDK 独立产品层；
- npm 包 `@datainsights/browser-sdk`、ESM、类型声明和 Script Tag/CDN 构建产物；
- 同意控制、录制启动/停止和资源释放；
- rrweb 事件采集、规范化、批次与序列元数据；
- 可插拔 Transport 接口及 Mock、内存或文件测试实现；
- IndexedDB 持久化队列、断网/刷新恢复和有限重试；
- 稳定批次 ID、SHA-256 内容校验、持久化回执校验、序列缺口对账与定向重传契约；
- 脱敏、屏蔽、采样、长会话和故障降级；
- 自定义事件、调试信息和身份接口的前端边界；
- 示例页面、本地播放器与录制 fixture；
- 去生产化保险产品页面、本地 Mock Config/Collector 与真实录制回放 E2E；
- 浏览器、SPA、CSP 和长期运行测试；
- MIT License、NOTICE、本地补丁和升级记录。

## 4. 本期排除范围

- 生产事件接收 API；
- 服务端鉴权、租户解析、限流和配额；
- PostgreSQL、ClickHouse、MinIO/S3、Kafka、Flink、Redis；
- 正式回放控制台、管理后台、实时回放和视频导出；
- 服务端用户映射、数据保留、删除传播和审计；
- 行为分析、漏斗、路径、留存和用户分群；
- yudao-cloud 后端修改或集成。

## 5. 集成形态

### 5.1 Script Tag

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

生产接入应支持固定版本 URL。`latest.js` 只能作为开发或试用别名，不作为可审计的生产默认方式。

`appKey` 是公开路由标识，不是密钥。浏览器端不填写 `endpoint`、`platform`、`tenantId`、`appSecret` 或 `securityKey`；SDK 从 AppKey 的受信任环境/区域提示选择配置中心，再解析 Collector 主备地址与短期凭证。生产接收端仍由后续服务端变更实现。

### 5.2 JavaScript API

```ts
DataInsights.bootstrap(options); // 推荐接入
DataInsights.init(options); // 高级/测试/自定义 Transport
DataInsights.consent.grant(); // 高级 API
DataInsights.start(); // 高级 API
DataInsights.addCustomEvent('expense_submit', payload);
DataInsights.identify(userAlias);
DataInsights.clearIdentity();
DataInsights.stop();
DataInsights.destroy();
DataInsights.getDebugInfo();
```

浏览器全局对象固定为 `window.DataInsights`；方法的同步/异步语义在 Design 阶段确认。DataInsights API 不直接暴露 rrweb 内部类型。

## 6. 角色

| 角色 | 职责 |
| --- | --- |
| SDK 研发 | Fork 治理、公共 API、构建、测试与发布 |
| 客户前端研发 | 集成 SDK、声明隐私选择器、调用业务事件 API |
| 嵌入方业务系统 | 在投保入口第一屏完成醒目告知，并在用户点击“开始投保”后显式通知 SDK 启动录制 |
| 产品/隐私负责人 | 决定同意、脱敏和身份策略 |
| QA | 验证录制、回放、兼容性、性能和资源释放 |
| 后续平台研发 | 消费 SDK 契约，但不属于本期实现团队范围 |

## 7. 主要非功能约束

- SDK 失败不得阻断宿主页面；
- 未取得用户明确授权前，SDK 不得采集 Replay、性能指标或其他数据；
- 密码字段始终不得录制；除密码外的业务输入默认录制，以满足业务纠纷核验需要；
- 认证令牌、Cookie 等非表单认证信息不因上述规则而允许采集；
- 录制数据必须能够由兼容的本地播放器还原；
- 已授权录制的数据应先持久化再投递，避免仅依赖内存和网络重试；
- Fork 必须可同步官方上游，不能形成无法升级的封闭分支；
- 所有本地核心补丁必须有理由、测试和升级影响记录。

## 8. 待确认项

当前不存在阻止生成 Proposal 的 Blocking 待确认项。接口同步/异步语义、Transport 背压、rrweb 升级合并策略等实现决策留待 Design 阶段确认。

## 9. 已确认决策

| 决策 | 确认值 | 确认来源 | 确认日期 |
| --- | --- | --- | --- |
| 默认输入录制与脱敏 | `type="password"` 的密码字段始终不录制；其他业务输入默认录制 | 用户明确确认 | 2026-10-25 |
| 录制业务目的 | 客户发生业务纠纷时，可向保险公司提供可核验的用户操作过程 | 用户明确确认 | 2026-10-25 |
| 授权前行为 | 授权前完全不采集任何数据，包括 Replay 与基础性能指标；取得明确授权后方可启动采集 | 用户明确确认 | 2026-10-25 |
| 授权交互责任 | 嵌入方在投保入口第一屏醒目提示“投保过程操作、页面行为将被记录留存，用于销售可回溯、纠纷核验”；用户点击“开始投保”后，由嵌入方显式触发 SDK 启动 | 用户明确确认 | 2026-10-25 |
| 用户唯一标识 | 不强制标识来源；可使用嵌入方提供的用户唯一标识，未提供时由 SDK 在授权后生成第一方随机 UUID；不使用 FingerprintJS | 用户明确确认 | 2026-10-25 |
| Session 边界 | 点击“开始投保”后创建；同标签页 SPA 路由切换和刷新延续；新标签页创建新 Session；投保完成、取消、退出登录、撤回授权、嵌入方登录会话失效或连续 30 分钟无有效操作时结束 | 用户明确确认 | 2026-10-25 |
| 连续录制关联 | SDK 自动生成 `traceId`，客户无需也不能传入；同标签页与同源刷新恢复延续，结束或超时后新建；业务 Journey/类型由 DataInsights 后续清洗 | 用户明确确认 | 2026-10-27 |
| 长录制分段 | 连续录制每 30 分钟生成新的技术分段 `segmentId`，但不因此结束 Session | 用户明确确认 | 2026-10-25 |
| 包名与发布形态 | 源码目录为 `packages/datainsights-browser-sdk`，npm 包为 `@datainsights/browser-sdk`，浏览器全局对象为 `window.DataInsights`；提供 ESM、类型声明和 Script Tag/CDN 构建 | 用户明确确认 | 2026-10-25 |
| 应用隔离 | 每个“客户 × 产品 × 平台 × 环境”分配独立公开 `appKey`；SDK 不接收重复的 `platform` 字段，长期 `appSecret/securityKey` 不得进入浏览器 | 用户明确确认 | 2026-10-25 |
| 可靠投递 | 采用 IndexedDB 持久化队列；每 1 秒或 20 条事件形成持久化窗口，持久化后投递，仅在匹配且 `persisted: true` 的回执后删除；重试只是恢复策略之一 | 用户明确确认（方案 A） | 2026-10-25 |
| 分层上送质量 | SDK 实现采集序列、本地持久化、网络恢复、幂等/哈希、持久化回执、缺口对账和容量降级；生产后端仅定义契约和 Mock，不纳入本期 | 用户明确确认（方案 A） | 2026-10-26 |
| 简化接入与路由 | AppKey 携带环境/区域提示，SDK 解析受信任配置服务；嵌入方不配置 endpoint，推荐使用 `bootstrap()` | 用户明确确认 | 2026-10-26 |
| IndexedDB 兼容门禁 | 录制前真实执行 open/write/read/delete；失败不启动 rrweb，不提供生产内存降级；真机结果单独记录 | 用户明确确认 | 2026-10-26 |
| 本地真实验证 | 使用去生产化保险页面、本地 Mock Config/Collector 和真实 rrweb 回放；拒绝全部非本地网络请求 | 用户明确确认（方案 A） | 2026-10-26 |

