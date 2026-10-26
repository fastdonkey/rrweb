# DI-1001 兼容性与验收标准

## 1. 支持矩阵

| 场景 | 验收结果 |
| --- | --- |
| 普通 HTML 页面 | Script Tag 初始化并生成可回放事件 |
| React SPA | 路由和 DOM 更新可录制，销毁无残留 |
| Vue SPA | 路由和 DOM 更新可录制，销毁无残留 |
| Angular SPA | 路由和 DOM 更新可录制，销毁无残留 |
| turbolinks/pjax | 生命周期适配策略可验证 |
| Shadow DOM | 以所选 rrweb 基线能力为准并明确支持边界 |
| 跨域 iframe | 父页面不读取内容；iframe 独立接入可录制 |
| Service Worker | 不修改或破坏客户 Service Worker |
| CSP | 固定版本脚本在声明的 CSP 配置下加载 |
| 禁用 JavaScript | SDK 不工作，文档明确说明 |
| 中国大陆网络 | 只验证 SDK 不绑定单一域名；CDN 部署不属于本期 |

## 2. 浏览器范围

- Chrome、Firefox、Safari 的受支持版本在 Design 阶段按 rrweb 上游和业务客户分布确定；
- 不支持的浏览器必须安全退出或降级，不能破坏宿主页面；
- IE11 不作为默认目标；如业务要求支持，必须作为独立成本评估。

## 3. 功能验收

- [ ] `@datainsights/browser-sdk` 的 ESM 和类型声明构建成功；
- [ ] Script Tag/CDN 构建成功加载，并暴露唯一的 `window.DataInsights` 全局对象；
- [ ] Script Tag 未配置 Transport 时不会回退为内存上送，`start()` 返回可诊断错误；
- [ ] 授权前不会产生 Replay、性能或身份数据，也不会补录授权前行为；
- [ ] 嵌入方在“开始投保”点击后显式调用授权/启动接口，SDK 才开始产生录制事件；
- [ ] 同意后可以录制并用本地播放器回放；
- [ ] `start/stop/destroy` 多次调用符合幂等规则；
- [ ] 同标签页刷新和 SPA 路由切换延续 Session；新标签页使用新的 `sessionId`；
- [ ] 投保完成、取消、退出登录、撤回授权、登录会话失效或连续 30 分钟无有效操作后结束 Session；
- [ ] 同一 `journeyId` 能关联因新标签页或空闲超时产生的多个 Session；
- [ ] 连续录制每 30 分钟形成新 segment 和全量快照，但不改变 `sessionId`；
- [ ] 自定义事件保持调用时间并可在时间轴定位；
- [ ] batchId 和 sequence 可识别重复与缺口；
- [ ] 已授权事件每 1 秒或 20 条持久化，批次写入 IndexedDB 后才进入 Transport，匹配且 `persisted: true` 的回执后才删除；
- [ ] 断网、刷新和浏览器重启后按 FIFO 恢复未确认批次；达到 100 MiB 时停止新增录制且不覆盖旧数据；
- [ ] HTTP 2xx、sendBeacon 已接收或不匹配回执都不会删除 Outbox；仅匹配且 `persisted: true` 的回执可以删除；
- [ ] contentHash、previousBatchHash、sequence 对账和 missing ranges 可发现损坏/缺口并触发定向重传；
- [ ] 70%/90%/100% 容量水位产生本地 warning/critical/stop 状态，不产生遥测上报；
- [ ] 内置 Memory/Download/Mock HTTP Transport 明确标记 `test-only`，不会被描述为生产持久化保证；
- [ ] Transport 失败不会向宿主抛出未捕获异常；
- [ ] rrweb 初始化失败时宿主页面继续工作；
- [ ] 默认脱敏和自定义 block/mask 通过 fixture 检查；
- [ ] `getDebugInfo()` 不包含录制内容或敏感数据。
- [ ] 嵌入方提供用户唯一标识时 SDK 正确关联；未提供时在授权后生成第一方随机 UUID；构建产物不包含 FingerprintJS。

## 4. 资源与性能验收

- [ ] `destroy()` 后监听器、Observer、Worker 和定时器释放；
- [ ] 重复初始化不会产生重复录制；
- [ ] 30 分钟和 2 小时录制无持续不可回收内存增长；
- [ ] 队列达到限制时行为与诊断计数符合策略；
- [ ] 代表性页面上主线程和 FPS 指标达到确认阈值；
- [ ] 大 DOM、虚拟列表和频繁 Mutation 场景有基准结果。

## 5. Fork 与升级验收

- [ ] 记录上游 remote、基线 commit/tag 和本地分支；
- [ ] 保留 MIT License 与版权声明；
- [ ] 原始 rrweb 测试在本地改动后继续通过；
- [ ] DataInsights 独立测试覆盖公共 API 和隐私规则；
- [ ] 每个核心补丁有说明、测试和上游同步影响；
- [ ] 旧事件 fixture 在升级后的播放器中按兼容策略通过；
- [ ] 能从官方 upstream 拉取并评估新版本，不依赖重新 Fork。

## 6. 明确不验收

- 生产服务器收到或持久化事件；
- 租户权限、后端身份和服务端限流；
- ClickHouse 分析、漏斗、留存和路径；
- 正式管理后台、视频导出和实时回放服务；
- yudao-cloud 的任何代码或接口变更。

