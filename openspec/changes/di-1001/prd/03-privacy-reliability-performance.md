# DI-1001 隐私、可靠性与性能要求

## 1. 隐私基线

- 密码、认证令牌、Cookie、请求正文和隐藏安全字段不得录制；
- `type="password"` 的输入值必须在进入事件、缓冲区和 Transport 之前完成屏蔽，任何配置不得关闭该规则；
- 除密码及上述认证信息外，业务表单输入默认录制，用于保险业务纠纷中的操作过程核验；
- 未取得用户明确授权前，不启动 Replay、PerformanceObserver 或其他数据采集能力；
- 授权告知和“开始投保”交互由嵌入方负责；SDK 仅响应嵌入方在用户点击后的显式授权与启动调用，不自行推断用户已经授权；
- Canvas 默认关闭；
- 支持 block、mask 和 ignore 选择器；
- 隐私规则必须先于事件进入 Transport 生效；
- 调试日志和 `getDebugInfo()` 不得泄露录制内容；
- 默认输入脱敏策略已确认；额外敏感字段的客户可配置屏蔽能力仍需保留。

保险业务可能涉及保单号、理赔金额、事故说明、银行账户、手机号、身份证信息、附件名称和审批意见等敏感字段。根据已确认的纠纷核验目标，这些普通业务输入默认参与录制；SDK 必须同时提供客户可配置的 block、mask 和 ignore 规则，以便客户按自身合规政策扩大屏蔽范围。

## 2. 录制配置候选

```ts
{
  maskAllInputs: false,
  maskInputOptions: { password: true },
  blockClass: 'rr-sensitive',
  sampling: {
    mousemove: false,
    scroll: 50,
    input: 'last',
    media: 800,
  },
  checkoutEveryNms: 60_000,
  checkoutEveryNth: 1_000,
  recordCanvas: false,
}
```

该候选配置反映已确认的默认输入策略：密码始终屏蔽，其他业务输入默认录制。SDK 仍需支持客户通过 block、mask 和 ignore 选择器增加屏蔽范围；认证令牌、Cookie、请求正文和隐藏安全字段不属于允许录制的业务输入。

回放默认使用 1x 并保持 `skipInactive=false`，不修改原始事件时间戳。播放器可额外提供明确标注的 0.75x 人工核验速度，但不得将 0.75x 标识为 1x。

## 3. 故障隔离

- rrweb 初始化失败：停止 Replay，返回可诊断状态；
- recorder 回调失败：隔离单个事件或停止当前录制，不影响宿主页面；
- Worker 不可用：降级到受限同步处理或降低功能；
- Transport 失败：已持久化批次保留在 durable outbox，执行有限重试并等待后续恢复，不无限重试或无限增长内存；
- SDK 内部错误不得调用 `preventDefault()` 阻止宿主错误传播；
- SDK 自身 console 输出应可关闭并默认限频。

## 4. 缓冲与资源上限

- 内存队列必须有事件数和字节数双重上限；
- 已授权事件每 1 秒或累计 20 条时形成一个持久化窗口，以先到者为准；页面隐藏或关闭时立即尝试提交尾部窗口；
- 已封闭批次必须先进入 IndexedDB durable outbox，再交给 Transport；只有匹配且 `persisted: true` 的回执才允许删除；
- 断网、刷新或浏览器重启后，在满足恢复条件时按 FIFO 继续发送；指数退避重试只是恢复策略之一；
- 网络恢复、下一次授权启动、周期调度、页面隐藏和 pagehide 均可触发投递；页面退出通道没有可校验回执时保留 Outbox 数据，后续使用同一 batchId 重传；
- SDK 仅在校验服务端持久化回执后删除 Outbox；回执不完整、不匹配或仅为普通 HTTP 成功时按未确认处理；
- 恢复连接后执行序列对账，根据服务端连续 sequence 和 missing ranges 定向重传；批次 SHA-256 与前序哈希用于发现损坏、错序和缺口；
- 内存队列上限为 5,000 个事件或 10 MiB，IndexedDB 持久队列按 `appKey` 计算上限为 100 MiB；达到上限时停止新增录制并产生明确诊断，不静默覆盖或丢弃旧数据；
- 持久队列达到 70%/90% 时分别产生 warning/critical 本地状态，100% 时停止新增录制；状态只通过 `getDebugInfo()` 和宿主回调暴露，不进行网络遥测；
- SDK 在授权后尝试申请持久存储；浏览器拒绝、清理站点数据、存储驱逐、磁盘故障及持久化窗口提交前的进程崩溃仍可能造成数据损失，产品不得宣称绝对零丢失；
- `destroy()` 关闭数据库连接和运行资源，但不删除尚未 accepted 的持久化批次。

## 5. 资源释放

`destroy()` 至少验证：

1. rrweb 停止函数已调用；
2. SDK 自建监听器已移除；
3. Mutation/Performance Observer 已断开；
4. Worker、WebSocket 或测试 Transport 已关闭；
5. interval、timeout 和 animation frame 已取消；
6. 内存队列和 DOM 引用已释放；
7. 销毁后不再发出事件。

## 6. 性能目标

- SDK 体积、初始化时间、主线程长任务、内存增长和事件吞吐均需要建立基线；
- “FPS 下降不超过 5%”是目标，需要在代表性设备和页面上验证；
- mousemove 关闭、scroll 节流等优化需要以事件量和体验实测证明；
- Web Worker 优先承担可序列化计算，但必须有不支持 Worker 的路径；
- 长会话至少覆盖 30 分钟、2 小时和持续 SPA 操作测试；
- 不依赖非标准 `performance.memory` 作为唯一保护机制。

## 6.1 Session 超时与生命周期约束

- 30 分钟空闲边界用于录制 Session 划分，不替代嵌入方自身的登录安全超时；
- 嵌入方登录会话先失效时，录制必须同步停止；
- 浏览器关闭事件不可靠，SDK 只能 best effort 结束与 flush，不能将 `beforeunload` 作为唯一的 Session 终止依据；
- 新 Session 必须使用新的 `sessionId`、`recordingId` 和 `traceId`；跨 Trace 的业务归并由 DataInsights 后续数据清洗处理；
- 浏览器指纹不得用于判断两个 Session 是否属于同一用户或同一投保流程。

## 7. 安全测试

- 密码与客户配置的敏感选择器内容不出现在事件 fixture；普通业务输入应出现在录制 fixture 并可正确回放；
- 授权前不产生 Replay、性能或身份数据；授权后不得补录授权前的页面状态或操作；
- 授权前不生成第一方 UUID；本期构建和运行产物不得包含 FingerprintJS；
- URL 查询参数按白名单或清洗规则处理；
- 自定义事件不能通过超大对象或循环引用拖垮页面；
- 原型污染、DOM 注入和序列化异常不会突破 SDK 边界；
- Script Tag 构建支持客户 CSP 策略，并记录所需指令；
- 构建产物与依赖执行许可证和漏洞检查。

