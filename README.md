# Hana Minimal Mode（极简模式 × dsh-routing-suite router-standard）

把 [dsh-routing-suite](https://github.com/yjh051108/dsh-routing-suite) 的 `router-standard`（v1.20.0）**1:1 移植**到 HanaAgent 的极简模式插件：T0 锚定、四阶段渐进工具披露、按任务释放平台工具包、按模型路由、跨版本三档通道适配；全程保留 Hana 原生功能（非破坏原则）。

- **版本**：0.4.7（`manifest.json` / `package.json`）
- **最低 Hana 版本**：0.447.4（`manifest.json` `minAppVersion`）
- **权限**：`full-access`（使用 `extensions/`）
- **依赖**：零 npm 依赖，Node ESM；单测 `node --test`
- **许可**：MIT（`router-core.js` / `stage-engine.js` 移植自 dsh-routing-suite，MIT）

## 目录

- [1. 功能](#1-功能)
- [2. 安装](#2-安装)
- [3. 设置](#3-设置)
- [4. 命令](#4-命令)
- [5. 工具](#5-工具)
- [6. 跨版本兼容矩阵](#6-跨版本兼容矩阵)
- [7. 保留 Hana 功能（非破坏原则）](#7-保留-hana-功能非破坏原则)
- [8. 故障排查](#8-故障排查)
- [9. Changelog](#9-changelog)
- [10. 文件布局](#10-文件布局)

## 1. 功能

- **dsh router-standard v1.20 的 Hana 1:1 移植**：`router-core.js`（分类/band/persona/工具包目录，移植自 `router-core-v34.mjs`）+ `stage-engine.js`（阶段状态机，移植自 `router-bootstrap.mjs`）。保留上游语义：零预解锁（`windowFor(stage) = min(stage + 1, 4)`）、完成信号自动晋级（一次一级）、we-form 阶段声明 + Task 回显、阶段 3 全量释放、用户记忆禁用（memoryMuted）。
- **T0 锚定（确认轮）**：新会话首轮注入固定 RL persona（`You are a helpful software engineer assistant.`）、锚定提示与**能力地图（R37）**；native 档首轮工具面裁剪为仅 `phase_begin`，bridge/legacy 档只保留桥工具，两种档位都额外保留 Hana 的记忆/回忆/状态工具（`search_memory` / `recall_experience` / `current_status`，存在即保留）；输出预算 `bootstrapMaxTokens`（默认 1024）。**锚定轮能力地图**由 `policy.js` 的纯函数 `buildAnchorCapabilityDigest(toolNames)` 从**当轮实际工具列表**生成（核心工作工具 / 记忆与上下文 / 平台包 / MCP 与插件元工具 / 技能），要求模型在确认轮就说明本任务需要哪些工具族——同时地图显式声明 **Hana 原生记忆文档、技能、工作区文件完整、不做任何裁剪**。**锚定之后工具面全量释放**（R29）：需要什么工具就直接调用，不再隐藏、不再返回 "not found"；平台包在调用命中时按需自动打开。决策逻辑在 `policy.js`，注入在 `extensions/router.js`（能力地图为独立标记块 `[router-capabilities]`）。
- **四阶段渐进披露**：了解/对齐 → 拟合方案 → 开发 → 验证；完成信号自动晋级，阶段 3 进入交付闸门。阶段作为**流程指引**注入（`stageText` / `STAGE_GUIDES`），不再裁剪模型工具面；阶段定义与自动晋级在 `stage-engine.js`（`STAGES` / `autoAdvance`）。
- **按任务释放平台工具包**：二轮起按用户消息关键词自动打开 docs/sheets/slides/smartsheet/browser/desktop/media 七类工具包；模型直接调用包内工具时也会**按需自动打开**对应包；`request_tools` 仅用于想提前批量打开包的场景（可选）。包在会话内累计、不回收。关键词分类与包目录在 `router-core.js`（`TOOL_PACKS` / `packsForText`）。
- **按模型路由**：标准流程恒定使用固定 RL persona（v1.20 语义）；`router-core.js` 的 `modelFamily()` 识别 Pro/Flash 家族，仅用于 `router_status` 的状态展示（`weak` 带专用 persona 文本保留在 `router-core.js` 中，供显式覆盖场景参考）。
- **跨版本三档通道**：`compat.js` 在每轮请求时按实际工具列表运行时探测 native / bridge / legacy 三档，不依赖版本号硬编码；升级 Hana 后自动切换。
- **实时生效**：设置变更由 `plugin_config_changed` 总线事件同步（`index.js`），60s 轮询兜底；下一轮请求即生效，无需重启。
- **非破坏**：system 只追加标记块、工具面仅在锚定轮裁剪（锚定后全量，且锚定轮保留记忆/回忆/状态工具）、`networkGuard` 默认关、插件关闭或助手未选中时零干预；**插件从不裁剪 Hana 的记忆/技能上下文**（见 [§7](#7-保留-hana-功能非破坏原则)）。

## 2. 安装

`${HANA_HOME}` 指 Hana 用户数据目录：Windows 默认 `C:\Users\<用户名>\.hanako`，macOS/Linux 为 `~/.hanako`。

### 2.1 开发环（plugins-dev）

1. 把 `hana-minimal-mode` 源码目录复制到开发加载目录（不覆盖正式安装）：

   ```powershell
   Copy-Item -Recurse .\hana-minimal-mode "${HANA_HOME}\plugins-dev\hana-minimal-mode"
   ```

2. Hana → 设置 → 插件 → 权限：开启「**允许 Agent 插件开发工具**」。
3. 在 Hana 中执行 `plugin_dev_reload`（或重启 Hana）加载/重载。
4. 设置 → 插件：确认「Hana Minimal Mode **0.4.7**」出现，并打开「**全权（full-access）**」开关。

### 2.2 手动复制到 plugins

1. 把整个 `hana-minimal-mode` 文件夹复制到正式插件目录：

   ```powershell
   Copy-Item -Recurse .\hana-minimal-mode "${HANA_HOME}\plugins\hana-minimal-mode"
   ```

2. 重启 Hana（或重载插件），在设置 → 插件中打开「**全权（full-access）**」开关。
3. 打开右侧栏「**极简模式**」面板，在下拉中选择助手并点击「注册」（见 [§3](#3-设置)）。

### 2.3 全权开关要求

插件使用 `extensions/`（请求管线扩展），**必须开启 full-access**，否则不会有任何注入/工具过滤行为。插件数据写入 `${HANA_HOME}/plugin-data/hana-minimal-mode/`（会话阶段状态 `stage-state.json`；目标助手运行列表 `routing.json`；注册元数据 `registrations.json`；其余插件配置由 Hana 插件配置存储在 `plugin-data` 下管理）。除面板注册/取消注册时写入上述数据文件外，不写插件安装目录；数据文件升级/重装不丢。

## 3. 设置

### 3.1 原生配置表单（`manifest.json` → `contributes.configuration`，9 项行为开关）

| 键 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | 总开关。关闭后扩展直接放行，零干预。 |
| `routerMode` | enum `auto\|spec\|react\|weak\|mixed` | `"auto"` | 路由模式。`auto` 为标准渐进流程（当前唯一生效路径）；其余值经 `canonicalMode` 规范化后保存并展示。本版路由管线恒定使用 v1.20 标准流程（固定 RL persona + 渐进披露），显式模式暂未接线旧版行为，字段保留给后续覆盖使用。 |
| `stagedUnlock` | boolean | `true` | 四阶段渐进流程指引（了解/对齐 → 拟合方案 → 开发 → 验证，完成信号自动晋级）。阶段是流程状态与文本指引，**不再裁剪工具面**（R29：锚定后全量释放）；关闭时状态机指引停用，工具面同样全量。 |
| `zeroToolAnchor` | boolean | `true` | 首轮锚定（确认轮）：首轮注入 RL persona、锚定提示与**能力地图**（R37，从当轮实际工具列表生成，要求模型说明本任务所需工具族）；native 档首轮仅保留 `phase_begin`，bridge/legacy 档只保留桥工具（`mcp_call` 等，无则工具面为空）；两种档位都额外保留 Hana 的 `search_memory` / `recall_experience` / `current_status`（存在即保留）。**锚定后工具全量释放**，平台包按需自动打开。 |
| `bootstrapMaxTokens` | integer | `1024` | 锚定轮回复的 token 上限；`0` = 不限。仅锚定轮生效。 |
| `dynamicPacks` | boolean | `true` | 二轮起按任务关键词自动释放平台工具包（docs/sheets/slides/smartsheet/browser/desktop/media）。 |
| `postAnchorInjection` | boolean | `true` | 首轮锚定完成后，向模型注入 persona/阶段/工具引导。关闭则**锚定后不再注入**（保留首轮锚定 persona + 提示行为），且不改变工具面（R29 后工具始终全量）。**默认开**。 |
| `networkGuard` | boolean | `false` | 开启时拦截 `exec_command`/`bash`/`pwsh` 中的 curl/wget/ssh 等网络命令（`network-guard.js`，启发式非沙箱）。**默认关**；注意阶段 0 本身含联网检索（`web_search`/`web_fetch`）。 |
| `conversationControl` | boolean | `true` | 允许在对话中说「开启/关闭极简模式」：把**当前助手**设为唯一目标或取消目标，并同步写入 `routing.json`。 |

原生表单共 9 项，全部为行为开关；**助手注册不在原生设置里**，而是在右侧栏「极简模式」面板（§3.2）。9 项默认值三处同源：`manifest.json`、`state.js` 的 `defaultConfig()`、`index.js` 的 `readConfig()`。插件不再改写自己安装目录内的任何文件（R34 移除了 `targetAgent` enum 重写机制）。

### 3.2 目标助手注册（右侧栏「极简模式」面板）

侧边栏面板（`contributes.widget`，路由 `/widget`，UI 在 `routes/widget.js`，接口在 `routes/api.js`）是唯一的注册管理入口，全局**至多一个目标助手**：

- **注册**：从下拉（只列未注册的存活助手，每 5 秒自动刷新）选择助手后点击「注册」；已有目标时先提示将替换，注册即**单选替换**（来源记为 `panel`）。
- **已注册助手**：可折叠（`<details>`）列表显示 0..1 行——助手名(id)、注册时间、来源；每行有「重注册」（只刷新注册时间，不动 `routing.json`）与「删除注册」按钮。
- **两步删除**：第一次点击按钮变为「确认删除」，3 秒内再次点击才执行（不用 `window.confirm`：sandboxed iframe 会拦截）；超时自动还原。
- **后端干净**：切换/清除目标时，旧目标从 `registrations.json` 与 `routing.json` **同时移除**，其会话阶段/别名状态从 `stage-state.json` 删除（`state.clearAgentStages`），内存镜像立即更新。取消注册不修改助手的任何文件。
- **旧多注册收敛**：加载时若发现历史多注册（如 `routing.json` 含两个助手），按 `registrations.json` 中 `registeredAt` 最新者保留（同刻偏好存活助手），其余移除并清理阶段状态。

目标助手运行列表持久化在 `${HANA_HOME}/plugin-data/hana-minimal-mode/routing.json`：

```json
{ "schemaVersion": 1, "targetAgents": ["hanako"] }
```

注册元数据（注册时间/来源）持久化在同目录 `registrations.json`：

```json
{ "schemaVersion": 1, "registrations": { "hanako": { "registeredAt": 1757000000000, "source": "panel" } } }
```

`routing.json` 不存在时，插件加载**仅在有旧配置值时迁移**：把旧配置里的 `targetAgents`（含更早的 `minimalAgentId`）迁移进来，随后按单一目标生成 `registrations.json`（来源 `legacy`）。全新安装没有旧值也没有 `routing.json` 时保持空列表（不注册任何助手），等待用户在面板中注册；之后两个文件始终同步。`/minimal on|off` 与对话开关同样按单选语义写入这两个文件。

## 4. 命令

命令实现于 `commands/minimal.js`（名称 `minimal`，别名 `minimal-mode`，会话范围，owner 权限）：

```text
/minimal status                      # 极简模式 / 目标助手 / 模式 / 通道 / 阶段 / 平台包
/minimal on                          # 注册当前助手为唯一目标（替换旧目标，enabled=true）
/minimal off                         # 清除目标注册（两个文件清空，enabled=false）
/minimal stage <0..3>                # 调试：直接设置当前会话阶段（并置 guided）
/minimal mode <auto|spec|react|weak|mixed>   # 设置 routerMode（经 canonicalMode 校验）
```

- `on`/`off` 依赖会话上下文识别当前助手 id（`agents/<id>/` 路径），写入 `routing.json` + `registrations.json`（单选替换/清除），并清理旧目标的会话阶段状态；不改写任何原生设置。
- `stage` 是调试操作，只改当前会话的阶段状态（持久化到 `stage-state.json`）。
- 对话开关（需 `conversationControl=true`）：说「开启极简模式」把当前助手设为唯一目标；「关闭极简模式」清除注册。由 `extensions/router.js` 的 `input` 事件处理，写入两个数据文件并更新内存镜像，**60s 轮询/重启不会回滚**。

## 5. 工具

### 5.1 元工具（8 个，常驻可调）

实现于 `tools/*.js`，名称定义在 `stage-engine.js` 的 `META_TOOLS`。native 档由宿主加前缀 `hana-minimal-mode_` 直接调用；bridge 档经 `mcp_call` 调用。

| 工具 | 用途 |
| --- | --- |
| `phase_begin` | 确认开启本次会话：置 guided，注入一次开启引导与阶段声明（native 档直调；bridge/legacy 档不强制）。 |
| `phase_advance` | 手动推进一级（不跳级），记录推进理由。 |
| `tools_catalog` | 工具目录：默认列当前阶段工具与已打开包；`query` 可单点查询任意工具/包的状态。 |
| `tools_help` | 查询单工具的状态与所属阶段（不返回参数 schema）。 |
| `router_status` | 状态报告：开关、目标助手、通道、阶段、工具目录、平台包、模型家族、最近晋级记录。 |
| `delivery_check` | 交付闸门：校验交付物文件（存在/非空/UTF-8，读取头部 64KB）+ 证据清单（`file/page/image/run/test/text/external/numeric`；页面交付物需 ≥1 项 `reviewed:true` 的视觉证据）。同时是阶段 2→3 的完成信号。 |
| `request_tools` | 可选：提前批量打开平台工具包（`packs` 数组）。不调用也会在直接调用包内工具时自动打开。 |
| `persona_reconcile` | 调查当前助手 `description.md` 中与极简模式硬约束冲突的句子（默认 survey）；`action:"fix"` 时先做时间戳备份，再只重写冲突句，其余内容保持原样。 |

### 5.2 阶段工具映射表（`stage-engine.js` 的 `STAGES`，逐字）

| 阶段 | 名称 | 阶段工具（流程指引） | 完成信号 |
| --- | --- | --- | --- |
| 0 | 了解/对齐 | `read` `ls` `grep` `find` `web_search` `web_fetch` `current_status` `todo_write` `search_memory` `recall_experience` | `todo_write` |
| 1 | 拟合方案 | `todo_write` `search_memory` `recall_experience` | `todo_write` |
| 2 | 开发 | `write` `edit` `record_experience` `pin_memory` | `delivery_check` |
| 3 | 验证 | `exec_command` `write_stdin` `subagent` | — |

窗口规则（`stage-engine.js` + `policy.js`，R29 语义）：

- **工具面不按阶段裁剪**：锚定轮之后 `policy.allowed` 即全部可用工具（含平台包与宿主工具），`extensions/router.js` 只在锚定轮过滤 `p.tools`；阶段仍是流程状态与文本指引（`stageText` 阶段工具列表 + `STAGE_GUIDES`）。
- 完成信号自动晋级、一次一级：0→1 与 1→2 均需 `todo_write` 调用；2→3 需 `delivery_check`，或（bridge/legacy 档）首次调用阶段 3 工具按需晋级；工具名本身永远不会跳级。模型也可显式调用 `phase_advance`。
- **按需自动打开平台包**：二轮起按任务关键词预开；模型直接调用某个包内工具时（`extensions/router.js` 的 `tool_call`），该包自动加入 `openedPacks` 并放行该调用。
- 阶段文本包含 Task 回显（首条真实用户消息，>160 字符截断）、阶段指引与解锁提示；用户明确表示"不用记忆"时（`memoryMuted`）自动剔除记忆工具提及。
- 平台包：docs（Word/智能文档/知识库）、sheets（在线表格）、slides（PPT）、smartsheet（多维表格）、browser（Playwright）、desktop（Windows 桌面自动化）、media（图片/视频生成）。

## 6. 跨版本兼容矩阵

差异集中在**插件工具的可调用通道**，而非插件子系统 API；因此适配策略是 `compat.js` 的运行时能力探测 + 三档行为，**不依赖版本号硬编码**：

| Hana 版本 | 插件工具暴露方式 | `mcp_call` 桥 | 档位与行为 |
| --- | --- | --- | --- |
| ≤ 0.447.4 ~ 0.448.2 | `[hana_reference]` 文本列表，插件工具不在 native 工具列表 | 存在但**不稳定**（实测报 `Invocation capability must be mcp_call.status`） | **legacy**：锚定轮不裁剪；锚定后工具面全量（R29）；首轮注入 persona + 锚定提示 + 预算；晋级以 native 信号（`todo_write`）为主，阶段 2→3 走"首次调用阶段 3 工具按需晋级"；插件元工具经桥调用依赖 `resolveInvocation` 描述符（0.3.13 起提供；宿主 catalog 可解析时可用） |
| 0.448.3+ | 桥 + catalog 模式 | **修复可靠**（桥引入 `72aa943f`、deferred assembly `db0b61bf`、`37998c28` 起稳定） | **bridge**：`mcp_call` 可靠；锚定后工具面全量（R29）；`delivery_check` 等元工具可经桥调用；晋级以 native 信号为主，阶段 3 同样保留按需晋级兜底 |
| 0.449.0+ | 插件工具进入 native 工具列表 | 保留 | **native**：完整 1:1 —— 首轮裁剪为仅 `phase_begin`；锚定后全量释放；插件元工具直调（工具名 `hana-minimal-mode_*`）；晋级用插件元工具 + native 信号 |

**0.449.0 实机验证（两个真实会话）**：开启内置工具延迟加载（`builtin_tool_defer.enabled=true`）时插件工具走桥——`mcp_call {server:"hana-minimal-mode", tool:"hana-minimal-mode_router_status"}` 携带**前缀** capability `hana-minimal-mode_router_status.read` 调用**成功**；关闭延迟加载时插件工具进入 native 列表（`hana-minimal-mode_*`）——直调 `phase_begin` / `router_status` 时宿主 live 权限校验器要求**裸名** capability，前缀形式被**拒绝**（`Invocation capability must be phase_begin.invoke.` / `Invocation capability must be router_status.read.`）。因此 `resolveInvocation` 按调用栈上下文选择命名空间（见下文），`compat.js` 仍按运行时工具列表自动落档。

探测规则（`compat.js`）：

- 工具列表中任一名以插件前缀 `hana-minimal-mode_` 开头 → `native`；
- 否则含 `mcp_call` / `mcp_search_tools` / `mcp_describe_tool` 之一 → `bridge`；
- 否则 → `legacy`（空列表也是 legacy）。

探测每轮按当轮 `p.tools` 进行，结果缓存在会话状态（`tier`），并在 `/minimal status` 与 `router_status` 中显示为「原生直调 / 桥接 / 兼容」。这是**运行时事实**：升级 Hana 后无需改配置，下一轮自动切换档位。

**更高版本适配（v0.4.5 备注）**：已核对 `v0.447.4 → v0.450.0`（当前最新正式版）之间**插件子系统零代码变更**（`plugin-manager` / `plugin-config` / `plugin-context` / `plugin-runtime` / `plugin-sdk` / `plugin-protocol` / 桥 `tool-catalog-bridge` / 权限层 / 渲染端 `PluginsTab` 均无改动），因此本插件在 0.448.x / 0.449.x / 0.450.x 上按上表自动落到 bridge / native 档即可工作；更高版本沿用运行时探测，无版本号硬编码；若未来宿主出现未知通道，`detectTier` 会安全降级为 legacy（锚定轮后工具面全量、调用即释放），不会因未知版本而失效。

**旧宿主 deferred 桥的 `resolveInvocation`（0.3.13 起；0.4.4 / R42 恢复上下文相关命名空间）**：旧宿主的 deferred 工具桥要求每个延迟插件工具导出同步的 `sessionPermission.resolveInvocation(input)` 描述符（仅 `action` / `kind` / `capability`）；缺失时桥的权限解析器 fail-closed，`mcp_call` 调用报 `TOOL_INVOCATION_RESOLVER_FAILED`（"Tool invocation resolver rejected an unknown action or invalid target."）。0.3.13 起 8 个元工具全部提供该描述符。capability 命名空间是**上下文相关**的，经 0.449.0 两个真实会话实机验证：**native/live 档要求裸工具名 `<tool>.<action>`**——前缀形式被 live 校验器拒绝，报 `Invocation capability must be <tool>.<action>.`（实测 `phase_begin` / `router_status`）；**deferred 桥档要求 catalog 前缀名 `hana-minimal-mode_<tool>.<action>`**——前缀形式经 `mcp_call` 调用成功（实测 `hana-minimal-mode_router_status.read`）。因此描述符按 `new Error().stack` 中的 `resolveBuiltinInvocation` / `tool-catalog-bridge` 帧选择命名空间：命中桥帧返回前缀名，否则返回裸名（0.4.3 / R41 的"统一前缀"假设被实机证伪，0.4.4 / R42 恢复 0.3.13 / R31 的双命名空间解析）。`kind` 分级：读写查询类（`tools_catalog` / `tools_help` / `router_status` / `delivery_check`）为 `read`；plugin-data 写入类（`phase_begin` / `phase_advance` / `request_tools`）为 `routine`（不逐次要求 reviewer 审批）；可重写 `description.md` 的 `persona_reconcile` 为 `review`（reviewer-bound）。

## 7. 保留 Hana 功能（非破坏原则）

- **不整段替换 system**：所有注入均为追加标记块 `[router-persona]` / `[router-bootstrap]` / `[router-stage]` / `[router-decl]` / `[router-proactivity]` / `[tool-pack-hint]` / `[router-capabilities]` / `[anchor-notice]`（`extensions/router.js`），Hana 原有的记忆、技能、身份、工具说明段全部保留（v0.3.6 会整段替换，0.3.9 已改）。
- **不硬删工具**：工具面仅在**锚定轮**裁剪（native 核心 `phase_begin`、bridge/legacy 核心为桥工具）；锚定之后 `p.tools` 全量保留、调用一律放行（R29），不返回 "Tool not found"、不强制经桥。桥工具与元工具常驻。
- **锚定轮保留 Hana 记忆工具（R36）**：锚定轮在裁剪工具面时始终保留 Hana 的记忆/回忆/状态工具——`search_memory` / `recall_experience` / `current_status`（工具实际存在即保留，排在锚定核心之后，不重复）；**Hana 的记忆功能不会因路由而被阻断**。配合"只追加、不裁剪"的注入规则，Hana 的记忆/技能/身份上下文（system 与消息历史）不会被移除或改写（`integration-sim.test.mjs` R36 用例逐消息锁定）。
- **锚定轮保留 Thinking 插件工具（R43）**：锚定轮同时保留 Thinking 插件的工具——`hana-max-thinking_*`（如宿主 native 工具名 `hana-max-thinking_thinking_status`）与兼容裸名 `thinking_status`（工具实际存在即保留，排在记忆工具之后，不重复；匹配逻辑为可单测的 `isAnchorExtraTool(name)`），模型从第一轮即可检查/对齐自己的思考档位（thinking level）。
- **不裁剪上下文**：插件不再提供也不执行任何记忆/技能上下文裁剪——**Hana 的记忆、技能、视觉/图片上下文始终原样保留**；`networkGuard`（默认 `false`）只拦网络类 shell 命令且为启发式。
- **零干预**：`enabled=false`、助手不在目标列表（`routing.json`）、或无法解析会话 key 时，扩展对 payload 原样放行——不注入、不裁剪、不拦截（`integration-sim.test.mjs` 用例锁定）。
- **异常不断管**：扩展处理器全部 try/catch，出错时返回原 payload，绝不阻断 Hana 请求管线。
- **状态外置**：会话阶段/别名状态持久化在 `${HANA_HOME}/plugin-data/hana-minimal-mode/stage-state.json`（`state.js`），目标助手运行列表在 `${HANA_HOME}/plugin-data/hana-minimal-mode/routing.json`（`routing-store.js`），注册元数据在 `registrations.json`（`registration-store.js`）；除此以外不写插件安装目录（插件从不改写自己的 `manifest.json`）。文件损坏或缺失按默认值重建并在下次写入时恢复。
- **保留的 v0.3.x 资产**：七类平台工具包目录、`persona_reconcile`、对话开关、别名桶会话识别（sessionManager 路径 / sessionPath / sessionId 多候选）、网络守卫。

## 8. 故障排查

1. **查状态**：优先执行 `/minimal status`（开关/目标助手/模式/通道/阶段/平台包）或让模型调用 `router_status`（额外含模型家族与最近晋级）。
2. **状态与日志位置**：会话阶段状态在 `${HANA_HOME}/plugin-data/hana-minimal-mode/stage-state.json`（JSON：`buckets` 会话别名桶 + `stages` 每会话阶段）。运行日志见 Hana 的插件日志：加载信息 `hana-minimal-mode v0.4.7 loaded...`、配置同步失败 `config sync failed`、扩展异常 `hana-minimal-mode: ...`。
3. **确认当前通道**：查看本轮 provider 工具列表——有 `hana-minimal-mode_` 前缀工具 = native；没有插件工具但有 `mcp_call` = bridge；两者都没有 = legacy。也可直接看 `/minimal status` 的「通道」行。注意：升级 Hana 后档位变化属预期，无需改配置。
4. **设置不生效**：检查 `enabled` 是否为真、右侧栏「极简模式」面板中是否已注册目标助手（未注册 = 不作用任何助手）、是否开启了 full-access。运行列表可直接查看 `${HANA_HOME}/plugin-data/hana-minimal-mode/routing.json`。设置改动在**下一轮请求**生效（`plugin_config_changed` 事件 + 60s 轮询兜底）；如果事件丢失，最迟 60s 后对齐。
5. **旧会话没反应（busy 会话扩展重绑延迟）**：热重载/重装插件时，正在忙碌的会话可能跳过扩展重绑（宿主设计），该会话不会立即挂上新扩展；新开一个会话或重启 Hana 即可。这是宿主行为，不是插件故障。
6. **首轮没有工具/工具少**：这是 T0 锚定（确认轮）的预期行为；锚定轮 system 中的 `[router-capabilities]` 能力地图列出完整可开放工具面（核心工具/记忆/平台包/MCP/插件元工具/技能），模型据此在确认轮说明本任务所需工具族，锚定之后工具全量释放（R29），不会再被隐藏。bridge/legacy 档首轮只保留桥工具（无桥工具则本轮工具面为空）；Hana 的 `search_memory` / `recall_experience` / `current_status` 在锚定轮始终随核心工具保留（存在即保留），记忆功能不受路由影响。想关闭锚定可设 `zeroToolAnchor=false`。
7. **某个工具调用失败**：R29 后阶段不再拦截任何调用；唯一可能的拒绝来自可选的 `networkGuard`（默认关，拦截 shell 网络命令）。若宿主报 "Tool not found"，说明该工具本来就不在本轮工具列表中（与插件无关）；插件不会在锚定后移除工具。
8. **升级注意（旧配置迁移）**：旧版的 `targetAgents`（含更早的 `minimalAgentId`）会在 `routing.json` 不存在时自动迁移进 `routing.json`，**不回写原生配置**；历史多注册会自动收敛为单选（保留最新注册者）；旧 `allowlist` 键被忽略/移除；`trimContext` 键随裁剪器一并移除，新增 `postAnchorInjection`（默认开）。升级后建议在右侧栏「极简模式」面板确认一次当前目标。

## 9. Changelog

### 0.4.7

- **面板图标严格对齐 Hana 原生图标系统（设计规范级）**：按 Hana 桌面端侧栏图标 1:1 规范绘制——`width/height=14`、`viewBox 0 0 24 24`、`fill=none`、`stroke=currentColor`、**`stroke-width=1.5`**、`stroke-linecap/linejoin=round`（0.4.6 的 2px 线宽与省略尺寸会偏粗、失去与原生图标的视觉一致性）；图形采用 Lucide `zap`（24 网格圆角闪电，与 Hana 原生 `settings` 等同网格、同线重、同视觉密度），深浅主题由 `currentColor` 自适应。
- **版本**：同步 `MODULE_VERSION`（12 处）与 `manifest.json` / `package.json`；测试保持 152。

### 0.4.6

- **面板图标更换为 Hana 风格闪电（面板标识）**：`contributes.widget.icon` 由原来的菜单线条图（stroke 1.5）改为 **Lucide `zap`**，并按 Hana 内联图标规范绘制——`viewBox 0 0 24 24`、`fill=none`、`stroke=currentColor`、`stroke-width=2`、`round` cap/join（与应用自带 `ICON_CHECK` / `ICON_CROSS` 同一规范），随侧栏主题色自动适配深浅色。
- **版本**：同步 `MODULE_VERSION`（12 处）与 `manifest.json` / `package.json`；测试保持 152。

### 0.4.5

- **锚定轮保留 Thinking 插件工具（R43）**：`policy.js` 锚定分支在核心工具与记忆工具之后追加 Thinking 插件的工具——`hana-max-thinking_*`（宿主 native 工具名 `hana-max-thinking_thinking_status`）与兼容裸名 `thinking_status`（工具实际存在即保留、按 live 列表顺序追加、不重复；提取可单测的 `isAnchorExtraTool(name)` 匹配器）。模型从锚定第一轮即可检查/对齐自己的思考档位，任务内容仍不会在确认轮提前启动。
- **测试**：147 → 152（`policy` 新增 4 项：native/bridge 锚定保留 thinking 工具、无 thinking 工具时保持旧结果且无空条目、匹配器与去重；`integration-sim` 新增锚定保留 thinking 工具 1 项）。
- **文档**：§7 新增锚定轮保留 thinking 插件的说明。

### 0.4.4

- **恢复上下文相关 capability 命名空间（R42）**：R41 的"统一前缀"假设被 0.449.0 实机证伪——两个真实会话显示 **native 档（内置工具延迟加载关闭、插件工具 live 直调）的权限校验器要求裸工具名 `<tool>.<action>`**（直调 `hana-minimal-mode_phase_begin` / `hana-minimal-mode_router_status` 报 `Invocation capability must be phase_begin.invoke.` / `Invocation capability must be router_status.read.`），而 **deferred 桥档要求 catalog 前缀名 `hana-minimal-mode_<tool>.<action>`**（`mcp_call` 携带前缀 capability 调用成功）。8 个元工具的 `resolveInvocation` 恢复 R31 的双命名空间解析：按 `new Error().stack` 中的 `resolveBuiltinInvocation` / `tool-catalog-bridge` 帧命中返回前缀名，否则返回裸名；action/kind 映射与其余 `sessionPermission` 字段不变。
- **测试**：`tool-invocation` 恢复双命名空间覆盖（裸命名空间最小 3 键描述符 + 稳定性、命名辅助函数 `resolveBuiltinInvocation` 栈帧下的前缀命名空间 + 稳定性、action/kind 映射、同步不抛错），总数保持 147。
- **文档**：§6 兼容矩阵按 0.449.0 实机结果重写（native 直调已实机验证，不再"待复验"）；`resolveInvocation` 段落移除"统一前缀"表述，改为实测规则。

### 0.4.3

- **统一 capability 命名空间（R41）**：8 个元工具的 `sessionPermission.resolveInvocation` 移除 `new Error().stack` 桥帧探测，恒定返回宿主工具名前缀 capability `hana-minimal-mode_<tool>.<action>`（action/kind 映射不变）。live 调用权限校验器要求 `capability === "<executingToolName>.<action>"`，宿主注册插件工具时使用的就是前缀名（两个宿主版本一致），桥 catalog delegate 存储的同样是前缀名——同一个常量描述符同时通过 native 直调与旧宿主桥两条路径；修复 native 档（内置工具延迟加载关闭时）元工具调用会被 live 校验器以缺少前缀拒绝的潜在缺陷。
- **测试**：`tool-invocation` 更新为统一前缀常量断言（描述符最小化 {action,kind,capability}、跨调用稳定、action/kind 精确映射、同步不抛错），移除桥/裸命名空间切换用例与栈帧辅助函数；总数保持 147。
- **文档**：§6 兼容矩阵新增「0.449+ 原生直调以 `builtin_tool_defer` 关闭为前提」说明；`resolveInvocation` 段落按 R41 语义重写。

### 0.4.2

- **已删除会话残留清理（R40）**：实机审计发现 `stage-state.json` 的 4 条阶段条目中有 2 条指向已被删除的会话文件。`state.js` 新增 `pruneMissingSessions()`——扫描 `stages` 键与别名 `buckets`，仅对「包含 `agents/<id>/` 段（反斜杠归一化）且形如绝对路径（Windows 盘符 `X:\`/`X:/` 或 `/` 开头）」的键做 `existsSync` 检查，文件不存在即删除；相对键（`agents/<id>/sessions/...`）无法对照文件系统、无 `agents` 段的键（如纯 sessionId）一律保留，文件检查异常也按保留处理，避免误删。安全阀：清理后 `stages` 仍超过 500 条（`MAX_STAGES`）时，按时间戳文件名降序保留最新 500 条并丢弃其余（防御性上限，非正常路径）。有变更时只持久化一次，返回删除条目数（stages + buckets）。
- **每次同步执行（`index.js`）**：`_sync` 在 R39 的 `pruneStagesExcept` 之后调用 `pruneMissingSessions()`（独立 try/catch，best-effort）——注册面/面板切换、`plugin_config_changed` 事件与 60s 轮询都会自动清掉已删除会话的残留。
- **测试**：145 → 147（`state` 新增 2 项：失效会话阶段/别名桶删除且相对键、无 agents 段键、存活文件保留；505 条批量残留全部清除。`index-sync` 首个用例扩展：目标助手同时种入存活会话文件与已删除会话路径，`_sync` 后仅存活条目保留，别名桶同理）。

### 0.4.1

- **彻底取消注册/切换清理（R39）**：`_sync` 在目标解析完成后调用新增的 `state.pruneStagesExcept(getTarget(dataDir))`（每次同步都执行）——只保留当前目标助手（`agents/<id>/`）的 `stages` 与别名 `buckets` 条目，其余助手的历史阶段残留一律清除，切换/取消注册后旧助手不再留下可被内置助手读到的状态；`clearAgentStages` 的路径匹配改为锚定正则 `(^|/)agents/<id>/`（id 转义），相对路径键（`agents/<id>/...`）与手机/subagent 路径都能正确清理；`onload` 额外调用 `config-legacy.removeStaleDataFiles(dataDir)`（best-effort）删除 R33 时代遗留、与当前目标相矛盾的 `settings-mirror.json`。
- **测试**：140 → 145（`state` 新增 3 项：路径形态清理、目标清扫、空目标全清；`config-legacy` 新增 2 项：删除 settings-mirror、缺失目录容错；`index-sync` 首个用例扩展相对路径键清理、settings-mirror 删除与每次同步清扫断言）。

### 0.4.0

- **锚定轮能力地图（R37）**：`policy.js` 新增导出纯函数 `buildAnchorCapabilityDigest(toolNames)`——从**当轮实际工具列表**生成紧凑能力地图（英文、单测锁定 < 1200 字符）：核心工作工具（`read`/`write`/`edit`/`ls`/`grep`/`find`/`exec_command`/`write_stdin`/`todo_write`/`subagent`/`web_search`/`web_fetch` 中实际存在的）、记忆与上下文（`search_memory` 等，并声明 `Hana native memory documents/skills/workspace files are intact; nothing is trimmed`）、平台包（按 `TOOL_PACKS` + `matchesToolSpec` 匹配出的包 id + 短标题，如 `docs (Word/智能文档/知识库)`；无匹配时列出全部可用包 id）、MCP/插件工具（`mcp_*` 桥工具与 `hana-minimal-mode_*` 元工具）、技能（沿用 system prompt 中的技能段）。函数不抛错，容忍非字符串/重复/空列表（空列表仍输出标题行、按需开放行与原生上下文声明）。
- **首轮注入能力地图（R37）**：`extensions/router.js` 在锚定轮把 `policy.inject.capabilityMap` 作为独立标记块 `[router-capabilities]` 追加进 system（`appendBlock`/`stripMarker` 幂等，追加式保证不变；`[router-capabilities]` 已加入只追加标记白名单）。锚定轮**仍限制当轮可调用工具**（native 仅 `phase_begin` + 记忆工具；bridge/legacy 仅桥工具 + 记忆工具），但模型可据地图判断并说明本任务所需工具族；地图同时声明 Hana 原生文档/上下文完整且未裁剪。
- **测试**：135 → 138（`policy` 新增 3 项：代表性工具列表能力地图、空/畸形输入容错、锚定注入接线；`integration-sim` 锚定用例新增 `[router-capabilities]` 与 `[Capability map]` 断言并入既有用例，butler 严格 deep-equal 不变）。

### 0.3.18

- **锚定轮保留 Hana 记忆工具（R36）**：`policy.js` 锚定分支在核心工具（native `phase_begin` / bridge 桥工具）之后追加 Hana 的 `search_memory` / `recall_experience` / `current_status`（仅当这些工具存在于当轮工具列表时追加，顺序排在核心之后且不重复）。锚定轮仍不开放 read/ls/grep/edit/exec_command 等工作工具，任务不会在确认轮提前启动；Hana 的记忆/回忆能力不再因路由而被阻断。
- **只追加回归测试（R36）**：`integration-sim.test.mjs` 新增 append-only 用例——payload 的 system 文本含 `HANA-MEMORY-SENTINEL` / `HANA-SKILLS-SENTINEL` 与三段对话，同时覆盖「system 顶层字符串」与「system 角色消息」两种形态；断言哨兵原样保留、消息数不变、除 system 与最后一条 user 消息外逐消息字节级 deep-equal、新增文本只允许 7 个路由标记块；非目标助手（butler）payload 在两种形态下严格 deep-equal 原样返回。另新增锚定轮保留 `search_memory` 的集成用例。
- **明确非破坏措辞**：`routes/widget.js` 底部提示增加「插件不裁剪、不替换 Hana 的原生上下文（记忆/技能/身份），只追加路由标记。」；README §1/§3.1/§7/§8 补充锚定轮保留记忆工具的说明。
- **测试**：130 → 135（新增 `policy` R36 用例 3 项、`integration-sim` R36 锚定记忆 1 项 + append-only 1 项；`widget-render` 的「不裁剪/不替换」断言并入既有用例）。

### 0.3.17

- **旧配置键一次性清理（R35）**：新增纯模块 `config-legacy.js`（仅 `node:fs`/`node:path`），插件加载时（每实例一次、best-effort）直接读取 `plugin-data/hana-minimal-mode/config.json`，从 `global` 中删除与现行面板注册相矛盾的遗留键 `targetAgents` / `targetAgent` / `minimalAgentId` / `allowlist` / `anchorFirstTurn` / `trimContext`——仅在实际删除时按 2 空格 JSON + 尾换行回写；其余键、`agents`/`sessions` 映射与 `schemaVersion` 原样保留。宿主配置存储每次调用都从磁盘读取、无缓存，因此文件级清理安全。
- **桥接指引修正（R35）**：`PROGRESSIVE_DECL` 与 `BOOTSTRAP` 不再声称元工具「never route them through the bridge」；改为版本准确的说明——Hana 0.449+ 元工具为 native 工具，旧宿主上元工具经 `mcp_call` 以完整名称可达（如 `{"server":"hana-minimal-mode","tool":"hana-minimal-mode_router_status","arguments":{}}`）。
- **面板窄宽度自适应（R35）**：`routes/widget.js` CSS 全局 `box-sizing: border-box`（含伪元素）、`html/body` 宽度 100%、无固定面板宽度；所有 flex 行 `flex-wrap: wrap` + `gap: 8px` + `min-width: 0`；select/按钮 `max-width: 100%`；文本 `overflow-wrap: anywhere`；已注册行文本容器省略号截断、操作按钮在窄宽度换行；`<details>/<summary>` 不溢出；新增 `@media (max-width: 340px)` 缩减内边距/字号。主题令牌不变，仅布局调整。
- **测试**：125 → 130（新增 `config-legacy` 4 项、`widget-render` 响应式断言 1 项）。

### 0.3.16

- **恢复侧边栏「极简模式」面板（R34）**：`contributes.widget`（路由 `/widget`）回归，`routes/widget.js` 提供中文面板——注册助手下拉（只列未注册的存活助手，每 5 秒合并刷新并保留用户选择）+「注册」按钮（单选替换，已有目标时提示将替换）；「已注册助手」为可折叠 `<details>` 列表（数量、助手名(id)、注册时间、来源），每行有「重注册」（只刷新注册时间）与「删除注册」；删除采用两步确认（首次点击变「确认删除」，3 秒内再点才执行，不使用 `window.confirm`）。CSS 只使用宿主主题变量（`--bg-card` / `--border` / `--text` / `--text-light` / `--text-muted` / `--accent*` / `--danger` / `--green` / `--shadow` / `--overlay-*` / `--select-arrow` / `--link`）并带亮色回退，支持 `data-theme` / `data-hana-theme` 与 `color-scheme`（`midnight` → dark）。
- **面板接口（`routes/api.js`）**：`/state`（enabled/routerMode/target/registrations/存活助手）、`/set`（行为开关，保留 `canonicalMode` 校验）、`/register`（校验存活助手后经 `target-service.setTarget` 单选替换并清理被替换者阶段状态）、`/unregister`（目标则清空注册，清理该助手阶段状态）、`/reregister`（目标则刷新 `registeredAt`，不动 routing.json）。变更类响应均携带完整状态（enabled/routerMode/target/registrations），面板只做部分合并，不会清空开关/模式控件。全部 best-effort，异常返回 500。
- **移除设置内助手下拉（R34）**：删除 `targetAgent` 配置项、`manifest-enum.js` 的 enum 重写机制、设置镜像 `settings-mirror.json` 与 `_sync` 的 apply-once/回写逻辑；原生设置回到 9 项纯行为开关。已删除助手的目标剪枝改为经 `target-service` 清空注册与阶段状态，不回写原生配置。命令 `/minimal on|off` 与对话开关保持单选替换/清除语义（不再回写设置）。
- **测试**：125 项（删除 `manifest-enum` 4 项与 `index-settings-sync` 设置用例 3 项，新增 `widget-render` 4 项、`api-routing` 6 项、`target-service` 重注册 1 项；`manifest`、`registration-store`、`commands-minimal`、`integration-sim` 断言更新）。

### 0.3.15

- **单选目标（R33）**：`targetAgent` 设置下拉成为唯一目标来源。新增 `target-service.js`：`getTarget` 容错读取、`setTarget` 保证 `routing.json` 与 `registrations.json` 始终至多一个助手、`collapseToSingle` 在加载时把历史双注册按 `registeredAt` 最新者收敛（同刻偏好存活助手）；切换/清除会同时删除旧目标的注册记录与会话阶段状态，并把设置值回写为实际生效值（已删除目标复位为哨兵）。
- **移除面板/整页（R33）**：删除 `contributes.page`、`contributes.widget` 与整个 `routes/`（page/api 及对应测试）；管理全部收敛到原生设置下拉（保留 manifest enum 重写机制与 10 项配置）。
- **命令/对话开关对齐**：`/minimal on|off` 与「开启/关闭极简模式」改为单选替换/清除语义，并尽力回写 `targetAgent` 设置值。
- **测试**：122 项（删除 3 个路由/页面测试文件，新增 `target-service` 8 项与单选/收敛用例；`index-sync`、`index-settings-sync`、`commands-minimal`、`integration-sim` 断言更新）。

### 0.3.14

- **router_status 模型显示修复**：宿主传入对象形态的 `toolCtx.model`（如 `{ provider: "deepseek", id: "deepseek-v4-pro" }`）时不再显示 `[object Object]`，改为显示 `provider/id` 并按 id 识别模型家族；字符串/缺失模型行为不变。

### 0.3.13

- **deferred 桥描述符（R31）**：8 个元工具的 `sessionPermission` 新增同步 `resolveInvocation()`（仅 `action` / `kind` / `capability`），修复旧宿主 deferred 工具桥因缺少描述符而 fail-closed 的 `TOOL_INVOCATION_RESOLVER_FAILED`（`mcp_call` 报 "Tool invocation resolver rejected an unknown action or invalid target."）。
- **双命名空间 capability**：描述符在 `new Error().stack` 上检测 `resolveBuiltinInvocation` / `tool-catalog-bridge`，命中时返回桥前缀命名空间 `hana-minimal-mode_<tool>.<action>`，否则返回裸名 `<tool>.<action>`；native/直调宿主（≥0.449）语义不变。
- **kind 分级**：`tools_catalog` / `tools_help` / `router_status` / `delivery_check` → `read`（`delivery_check` 仅统计/读取文件）；`phase_begin` / `phase_advance` / `request_tools` → `routine`（plugin-data 写入，不逐次要求审批）；`persona_reconcile` → `review`（可重写 `description.md`）。
- **测试**：114 → 119（新增 `tests/tool-invocation.test.mjs` 5 项：描述符存在性、常规栈最小描述符与裸命名空间、桥栈前缀命名空间切换、action/kind 精确映射、同步且不抛错）。
- **文档**：§6 兼容矩阵补充旧宿主 deferred 桥描述符说明。

### 0.3.12

- **主题变量修正（R30）**：面板/整页 CSS 全面改用 Hana 宿主实际提供的主题 CSS 变量——`--bg-card`、`--border`、`--text`、`--text-muted`、`--accent`、`--accent-hover`、`--accent-light`、`--overlay-subtle/light/medium`、`--shadow`、`--danger`、`--green`、`--link`、`--select-arrow`——每处 `var()` 均带亮色回退；midnight 等暗色主题下卡片/输入框/按钮/下拉不再回退为白底深字，暗色主题完整支持。
- **文档元素主题标记**：按 `hana-theme` 查询参数在 `<html>`/`<body>` 写入 `data-theme` 与 `data-hana-theme`，并设置 `color-scheme`（`midnight` → dark，其余 light）。
- **测试**：仍为 114（`page-render` 主题令牌断言由 R29 更新为 R30：两种表面均校验真实变量与 `data-theme`，禁止 `--hana-plugin-*` 残留）。

### 0.3.11

- **按需工具释放（R29）**：锚定轮之后的工具面不再按阶段裁剪——`policy.js` 非锚定分支直接放行全部可用工具；`extensions/router.js` 只在锚定轮过滤 `p.tools`；`tool_call` 移除 "tool locked until phase" 拦截，改为调用命中平台包规格时自动打开该包并放行（调用即释放）。修复实测中"阶段过滤移除工具 → 模型仍调用 → Tool not found / mcp_call 失败环"的问题。
- **提示文本改为信息性**：新增 `[tool-pack-hint]`，说明平台包与工具会在调用时自动打开、`request_tools` 仅是可选的预开方式；`PROGRESSIVE_DECL`/`BOOTSTRAP` 软化元工具指令（阶段自动晋级；原生工具未暴露时无需经桥调用插件工具）。
- **设置项 `trimContext` → `postAnchorInjection`**：删除上下文裁剪器（`trim-context.js` 移除），新开关控制锚定后是否注入 persona/阶段/声明/引导（默认开；关闭仅保留首轮锚定行为）。插件**永不裁剪** Hana 的记忆/技能/视觉上下文。
- **主题适配**：面板/整页 CSS 改用一套带安全回退的主题令牌（0.3.12 修正：宿主不提供 `--hana-plugin-*`，已全部替换为宿主真实变量，见 0.3.12）。
- **测试**：112 → 114（`guards` 拆分为 `network-guard` 净 -2；新增 policy 2 项、integration 1 项、page-render 主题令牌 1 项，并更新阶段/锚定断言）。

### 0.3.10

- **恢复右侧「极简模式」面板**：`contributes.widget`（路由 `/widget`）回归，与管理整页 `/page` 由 `routes/page.js` 提供同一套注册 CRUD UI（内联脚本按路径结尾 `/widget` / `/page` 字符串切片推导接口前缀，无重复实现）。
- **原生设置助手下拉（`targetAgent`）**：插件加载时把当前存活助手列表重写进自己 `manifest.json` 的 `targetAgent.enum`（`manifest-enum.js`，临时文件 + rename、UTF-8 无 BOM），Hana 扫描后原生设置页渲染真实下拉；列表随每次插件重载/重启刷新。
- **下拉 apply-once 语义**：单选即取代整个注册集合（来源 `settings`）、哨兵「（不注册）」清空全部、被移除助手的会话阶段状态清理；同一个设置值不会回滚面板/页面管理的多助手注册（镜像 `<dataDir>/settings-mirror.json`）；未知/已删除 id 忽略该次变更但仍记录已见值。
- **测试**：103 → 112（新增 `manifest-enum` 4 项、`index-settings-sync` 3 项、`registration-store` 镜像 1 项，`manifest` 十项断言 +1）。

### 0.3.9（相对 v0.3.6）

- **会话注册 → 整页注册管理**：不再在会话内自动注册/追加助手；顶部「极简模式」整页提供注册/取消注册/重注册与已注册列表（默认 `hanako`，列表为空 = 不作用任何助手），运行列表持久化在 `routing.json`，元数据在 `registrations.json`。`/minimal on|off` 与对话开关仍会即时增删当前助手并写运行列表。
- **目标列表移出原生 schema**：原生设置表单不再包含助手 id 输入框（Hana 原生表单只渲染静态 schema，无动态选项源）；助手注册在整页进行（§3.2），列表实时刷新、已删除自动排除、新建自动出现；取消注册会清理该助手的会话阶段状态。
- **四阶段渐进披露**：以阶段窗口（零预解锁）取代 v0.3.6 的 `allowlist` + 首轮 after-first-call 释放模型；完成信号自动晋级，阶段 3 全量释放。
- **T0 锚定**：固定 RL persona + 确认轮提示 + `bootstrapMaxTokens`（默认 1024）；native 档首轮仅 `phase_begin`，bridge/legacy 档首轮仅桥工具（无则空工具面），模型无法在锚定轮直接开工。
- **中文 UI**：全部 9 项原生配置的标题/说明、整页「极简模式」界面与 `/minimal` 命令输出中文化。
- **实时生效**：`plugin_config_changed` 总线订阅 + 60s 轮询兜底，设置改动下一轮生效；对话开关落盘，不再被轮询回滚。
- **跨版本三档**：新增 `compat.js` 运行时探测 native/bridge/legacy，取代隐式假设。
- **工具包/阶段映射**：沿用七类平台包目录，映射到新的阶段表（读/规划/写入/验证）；元工具重组为 8 个（旧 `set_minimal_mode`/`router_set_mode` 等控制工具由 `phase_*`/`tools_*` 体系取代）。
- **非破坏注入**：system 只追加标记块，不再整段替换（v0.3.6 会丢弃 Hana 原生段）。
- **默认值调整**：`trimContext` 由开→**关**；取消 v0.3.6 的网络/视觉工具硬拦（阶段 0 本身含 `web_search`/`web_fetch`），shell 网络命令拦截改为可选的 `networkGuard`（默认关）。
- **按模型路由**：固定 RL persona（v1.20 标准）；Pro/Flash 家族识别仅用于状态展示（v0.3.6 的 persona 融合/自动适配不再参与路由）。
- **旧配置迁移**：`targetAgents`（含更早的 `minimalAgentId`）一次性迁移到 `routing.json`，不回写原生配置；`allowlist` 移除。

## 10. 文件布局

```text
hana-minimal-mode/
├── manifest.json        # id/version 0.4.7、minAppVersion 0.447.4、full-access、中文 configuration（9 项行为开关）+ widget（/widget；无 page）
├── package.json         # ESM；node --test 单测（152 用例）
├── index.js             # 生命周期：config 镜像、routing.json 迁移、单选收敛（collapseToSingle/setTarget）、已删除目标剪枝（不回写设置）、R39 阶段清扫（pruneStagesExcept）+ settings-mirror 删除、R40 已删除会话清理（pruneMissingSessions）、plugin_config_changed + 60s 轮询
├── state.js             # 共享单例：默认配置、会话别名桶、阶段持久化（stage-state.json）、按助手清理/目标清扫/已删除会话清理阶段状态（clearAgentStages/pruneStagesExcept/pruneMissingSessions）
├── agent-catalog.js     # 助手目录：bus 映射、agents 目录扫描、墓碑剪枝（纯模块）
├── routing-store.js     # 目标助手持久化：routing.json 解析/读写/旧配置迁移（纯模块）
├── registration-store.js # 注册元数据：registrations.json 读写/增删（纯模块）
├── config-legacy.js     # R35/R39 遗留文件清理：stripLegacyConfigKeys + removeStaleDataFiles（纯模块，node:fs/path）
├── target-service.js    # R33 单选编排：getTarget/setTarget/reregisterTarget/collapseToSingle（版本化内部导入）
├── routes/widget.js     # 侧边栏「极简模式」面板：GET /widget 中文 HTML/内联脚本（无内部导入）
├── routes/api.js        # 面板接口：/state、/set、/register、/unregister、/reregister（版本化内部导入）
├── router-core.js       # router-standard v34 移植：分类/band/persona/模型家族/TOOL_PACKS
├── stage-engine.js      # 四阶段状态机：STAGES/windowFor/autoAdvance/stageText/STAGE_GUIDES
├── compat.js            # 三档通道探测：detectTier/tierLabel/stripPrefix
├── policy.js            # 每轮决策：computePolicy → allowed/inject/anchor/budget/nextPacks；R37 buildAnchorCapabilityDigest（锚定轮能力地图，纯函数）
├── extensions/router.js # Pi SDK 适配：before_provider_request / tool_call / input（对话开关按单选语义）
├── commands/minimal.js  # /minimal status|on|off|stage|mode（on/off 单选替换/清除）
├── tools/               # 8 个元工具（phase_begin/phase_advance/tools_catalog/tools_help/
│                        #   router_status/delivery_check/request_tools/persona_reconcile）
└── network-guard.js     # 可选网络命令守卫（networkGuard，默认关）
```
