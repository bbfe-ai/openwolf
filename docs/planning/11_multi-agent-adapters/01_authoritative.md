# 11 · openwolf 跨 Agent 适配器 — 权威方案

> 单一真相源。回答"做什么 / 为什么 / 取舍"。执行细节见 `02_checklist.md`。
> 起始 2026-07-10 | 分支 `feat/context-optimization`

## §1 背景与目标

openwolf 当前是"Token-conscious AI brain for **Claude Code** projects"——硬绑定 Claude Code。本主线目标:**在保持现有 Claude Code 支持零回归的前提下,新增 codex 与 opencode 适配器**,让 openwolf 的 anatomy 索引 / cerebrum / memory / buglog / 检索 / prune 能力跨 agent 工作。

核心目标仍延续主线 10:**节约 token 的前提下避免记录爆炸**——跨 agent 适配不得放松这一约束(配置门控默认关、无损归档、检索层不索引 anatomy)。

## §2 硬约束(行为保持 / 不回归)

| # | 约束 | 验证手段 |
|---|------|----------|
| C1 | **现有 Claude Code 支持零回归** | 主线 10 的 G0/G-size/G-prune/G-retrieval/G-config 门禁在 Claude 路径全绿;A/B fixture 复跑不变 |
| C2 | **anatomy.md 永不进检索层** | 硬规则 6,适配器同样适用 |
| C3 | **配置门控默认关**(memory log_edits / buglog auto_detect) | 新 agent 路径默认关,行为与 Claude 路径一致 |
| C4 | **记录爆炸防御不放松** | prune 无损归档 + buglog rolling cap 在新 agent 路径同样生效 |
| C5 | **零原生依赖** | openwolf 零 native build 原则不变;不引入 better-sqlite3/FTS5 |

## §3 三层绑定诊断(已亲验 `文件:行号`)

openwolf 对 Claude Code 的依赖分三层。三层都需各 agent 写 adapter,工作量随层递增:

### 层 1 — Hook 注册点
- **Claude**(现状):`init.ts:48-118` `HOOK_SETTINGS` 写进 `.claude/settings.json` 的 `hooks.{SessionStart,PreToolUse,PostToolUse,Stop}` 块,command = `node "$CLAUDE_PROJECT_DIR/.wolf/hooks/*.js"`。
- **Codex**:`~/.codex/config.toml` 的 `[[hooks.<Event>]]` 表 **或** `.codex/hooks.json`(`codex-rs/hooks/src/engine/discovery.rs:116-156`)。事件名 `HOOK_EVENT_NAMES`(`codex-rs/hooks/src/lib.rs:19-30`)10 个,**与 Claude 同名超集**(PreToolUse/PostToolUse/SessionStart/Stop 全在,多 PermissionRequest/PreCompact 等)。matcher 语法 exact/pipe/regex/`*` **完全一致**。
- **OpenCode**:**无 config hooks 字段**。只有 plugin 系统——进程内 TS/JS 模块,经 `opencode.json` 的 `"plugin"` 字段注册(`packages/plugin/src/index.ts:74` `Plugin = (input) => Hooks`),返回 `Hooks` 对象(`:222-335`)。**非 subprocess**,动态 `import()` 加载。

### 层 2 — 项目根定位(env)
- **Claude**:`$CLAUDE_PROJECT_DIR` env(`shared.ts:7`)。
- **Codex**:envelope 含 `cwd`(`schema.rs:282`)字段,且 `current_dir(cwd)`(`command_runner.rs:61`)——hook 进程 cwd 已是项目根。可用 `process.cwd()` 或 envelope 的 `cwd`。
- **OpenCode**:plugin `Hooks` 的 `tool.execute.before/after` input 含 `sessionID/callID` 但**无 cwd**;`event` hook 收 `{id,type,properties}`,session 事件可能带 directory。需 plugin 注册时拿到 ctx.directory。

### 层 3 — Tool 事件 schema(stdin / payload)
这是工作量分水岭。openwolf hook 核心逻辑依赖 `{tool_name, tool_input:{file_path, old_string, new_string, content}}`:

| | 文件读 | 文件写/改 | 字段命名 | 复用度 |
|---|---|---|---|---|
| **Claude** | `Read`→`{file_path}` | `Edit`→`{file_path,old_string,new_string}` | snake_case | (基线) |
| **Codex** | **无专用 Read 工具**(走 Bash cat,无干净 file_path) | `apply_patch`→`{"command":"<V4A patch text>"}`(`apply_patch.rs:505-509`)。tool_name=`apply_patch`(Edit/Write 是 matcher 别名) | envelope camelCase,tool_input 是 patch 文本 | **低**——需 V4A 解析器 |
| **OpenCode** | `read`→`{filePath}` | `edit`→`{filePath,oldString,newString,replaceAll?}`(`edit.ts:47-56`);`write`→`{filePath,content}` | **camelCase** | **高**——仅字段名映射 |

**stdin 交付对比:**
- Codex:`stdin.write_all(input_json)`(`command_runner.rs:84-85`),**与 Claude 完全同构**(独立进程收 JSON blob)。
- OpenCode:plugin 函数调用(进程内),**无 stdin**。

## §4 适配架构(接缝先行)

核心设计:**openwolf hook 本体零改动,新增「agent 适配层」做归一化**。归一化产物 = Claude 形状的 `{tool_name, tool_input:{file_path,old_string,new_string,content}}`,再喂给现有 hook 逻辑。

```
                ┌─ Claude Code ──→ .claude/settings.json ──→ hook.js (原始 stdin) ──────────────────┐
agent event ────┤                                                                                  ├─→ 归一化 {tool_name,tool_input} ──→ openwolf 核心逻辑(不动)
                ├─ Codex ────────→ .codex/hooks.json ──→ hook.js(stdin, apply_patch) ──[V4A 解析]─┤
                └─ OpenCode ─────→ opencode plugin ──→ [camelCase→snake 映射] ─────────────────────┘
```

### 三条适配轨:

**轨 A — Codex 适配器(工作量:中)**
- A1 注册点:`openwolf init --agent codex` 写 `.codex/hooks.json`(或追加 `~/.codex/config.toml` 的 `[[hooks.*]]`),command 指向 `.wolf/hooks/*.js`,事件 PreToolUse/PostToolUse/SessionStart/Stop。
- A2 归一化:hook.js 入口检测 envelope 的 `hook_event_name`(Codex envelope 有此字段 `schema.rs:284`)→ 判定为 Codex 来源 → 对 `apply_patch` 的 `tool_input.command` 跑 V4A patch 解析器,提取 `file_path + old_string + new_string`,转成 Claude 形状再进 post-write 逻辑。
- A3 项目根:用 envelope 的 `cwd` 字段或 `process.cwd()` 替代 `$CLAUDE_PROJECT_DIR`。
- A4 缺口:文件读(Codex 走 Bash)无干净 file_path —— pre-read/post-read 在 Codex 路径降级为 best-effort(不崩,不记)或 matcher Bash 解析 cat 命令(可选增强,P2 后)。

**轨 B — OpenCode 适配器(工作量:中高)**
- B1 注册点:`openwolf init --agent opencode` 生成一个**进程内 TS plugin shim**(`.wolf/adapters/opencode-plugin.ts`),注册到 `opencode.json` 的 `"plugin": ["./.wolf/adapters/opencode-plugin.ts"]`。
- B2 shim 形态:导出 `Hooks` 对象,实现 `event` hook(全事件)或 `tool.execute.before/after`(精粒度)。shim 内把 `{tool, input:{filePath,oldString,newString}}` 映射成 Claude 形状 `{tool_name, tool_input:{file_path,old_string,new_string}}`,然后**spawn openwolf node hook 进程**把 JSON 写它 stdin(复用现有 hook.js)。
- B3 备选:外部 SSE 消费(openwolf 起进程连 opencode HTTP event stream)——零进程内耦合,但需 openwolf 长驻进程,偏离"短命 hook 进程"模型。**Decision Log D2 否决备选,选 shim**(保持短命进程模型一致)。
- B4 session 边界:OpenCode 无干净 session end,用 `step.started`/`step.ended` 事件映射 SessionStart/Stop 边界(Stop 降级为 step.ended 触发 prune)。

**轨 C — 共用核心 + agent 探测(工作量:小,接缝先行)**
- C1 `shared.ts` 加 `detectAgent()`:按 env/标志判断当前来源(CLAUDE_PROJECT_DIR→claude;envelope 有 turn_id/cwd→codex;被 plugin shim spawn 时带 `OPENWOLF_AGENT=opencode` env→opencode)。返回归一化所需上下文。
- C2 新增 `src/hooks/adapters/` 目录:`codex-v4a.ts`(V4A patch 解析)、`normalize.ts`(任一来源→Claude 形状)。hook 入口先 normalize 再走原逻辑——**纯增量接缝,零行为变更**,Claude 路径走原 stdin 直通。

### 接缝先行序(C2 先行,因纯增量零下游):
1. **C1/C2 接缝**:`detectAgent` + `normalize` 空壳(只识别 claude 直通,其他 noop)→ Claude 路径行为不变,G0 全绿。
2. **A 轨 codex**:实现 V4A 解析 + `.codex/hooks.json` 注册。
3. **B 轨 opencode**:实现 TS shim + camelCase 映射。
4. **C3 收口**:`openwolf init` 加 `--agent` 选项,按需写各自注册点。

## §5 Decision Log

| # | 日期 | 取舍 | 理由 | 否决的备选 |
|---|------|------|------|-----------|
| D1 | 2026-07-10 | Codex 文件读走 Bash,不做硬解析 | Codex 无专用 Read 工具,解析 `cat <file>` 命令字符串脆弱且收益低(anatomy 已是省 token 主力,读事件是次要) | 对 Bash 命令做 cat 解析(脆、收益低) |
| D2 | 2026-07-10 | OpenCode 用进程内 TS shim 转发,非外部 SSE 消费 | 保持 openwolf"短命 hook 进程"模型一致;SSE 需长驻进程,引入生命周期/重启/端口管理复杂度,违背零依赖轻量原则 | 外部 SSE 消费(长驻进程) |
| D3 | 2026-07-10 | 适配层独立目录 `src/hooks/adapters/`,不污染现有 hook | tsconfig.hooks.json `rootDir:src/hooks` 约束;adapter 放 hooks 子目录可被 hook import,CLI 跨目录复用。保持 hook 本体零改动降低 C1 回归风险 | 改写现有 hook 内联分支(回归面大) |
| D4 | 2026-07-10 | `openwolf init --agent <claude|codex|opencode>` 单选,不默认全装 | 三 agent 注册点互斥(写不同配置文件),全装会让 agent 重复触发;用户显式选目标 agent。`openwolf init` 不带 flag 默认 claude(零回归) | 默认全装 |
| D5 | 2026-07-10 | V4A 解析器自己写,不引外部 patch 库 | 零原生依赖原则;V4A grammar 简纯文本(`apply_patch.lark`:`*** Begin Patch`/`*** Update File:`/`@@`/` -`/`+`/`*** End Patch`),纯 JS 解析足够;引库增依赖面 | 引 unified-diff 库 |
| D6 | 2026-07-10 | 两个 agent(codex+opencode)都做完,留在 feat/context-optimization 分支不合并不发版 | 用户拍板(2026-07-10):要完整多 agent 支持;合并发版待 review。与主线10 现状一致(6 commit 未合 main) | 先做 codex 再 opencode / 只做 codex / 合并发版 |
| D7 | 2026-07-10 | T2.4 getWolfDir 不加 codex 分支,落现有 `CLAUDE_PROJECT_DIR || process.cwd()` 回退;stale-leak 边角 DEFERRED | **实跑证伪**(codex-cwd-test 6/6,commit 3a777c3,非源码论断):codex spawn hook 进程 cwd=项目根(command_runner.rs:49-65 `.current_dir(cwd)`,config/mod.rs:805),且 codex 不设 `$CLAUDE_PROJECT_DIR`(项目级 source.env 空 discovery.rs:103-112),故现有回退对 codex 已落 process.cwd()=项目根,.wolf 解析正确——**无需改码**。anchor 计划的 `envelope.cwd` 冗余:envelope.cwd==request.cwd==process.cwd()(pre_tool_use.rs:170-186,Q4)。stale-leak 边角(codex 从 Claude 会话内调起,`CLAUDE_PROJECT_DIR` 被继承)实测会解析到错误项目——真实但窄;修法(`OPENWOLF_AGENT=codex` 命令串 + getWolfDir 忽略 stale env)会让 hook 引入 spawn 失败风险换窄边角消除,simplicity-first 不做,记 §7 DEFERRED | 改 getWolfDir 加 codex 分支用 envelope.cwd(前提证伪:envelope.cwd==process.cwd());命令串设 `OPENWOLF_AGENT=codex` 防边角(引入 spawn 失败风险) |
| D8 | 2026-07-10 | **OPEN·待新会话定案**:opencode camelCase→snake 映射放哪 | T2.5 接线后发现锚点(T3.1/T3.2 "shim 内映射 + `OPENWOLF_AGENT=opencode`")有 **false-green**:`readNormalizedStdin`→`detectAgent(env)→"opencode"`→`normalizeToolEvent("opencode",…)` 现返回 `[]`(noop)→ hook 对 shim 预映射输入 no-op → e2e 假绿(同型 codex 接线前陷阱,铁律二)。**推荐 Design B**:映射放 `normalize.ts` opencode 分支(同 `normalizeCodex` 做 V4A 解析),shim 只 transport(spawn+env+raw 事件);seam 干净、映射点单一可测。需改 T3.2 锚点("shim 内映射"→"normalize 内映射")。定案前勿开工 T3.1 | Design A:按锚点字面 shim 预映射,但须补 `normalize.ts` opencode 分支 `[]`→passthrough 防假绿;映射逻辑跨 shim+normalize 两处 |

## §6 量化目标(验收)

| 指标 | Claude 基线(主线10实测) | Codex 目标 | OpenCode 目标 |
|------|------------------------|-----------|--------------|
| 相同 20-edit 负载 memory.md 增长 | 0(门控关) | 0(门控关) | 0(门控关) |
| buglog 假阳性 | 0(门控关) | 0(门控关) | 0(门控关) |
| stop 触发 prune(无 daemon) | ✅ | ✅ | ✅(step.ended 映射) |
| `search` 定位非整读 | ✅ | ✅ | ✅ |
| Claude 路径 A/B fixture 回归 | n/a | 不变 | 不变 |

## §7 遗留 / 延后

- Codex Bash 命令解析增强(从 cat 命令提取 file_path 记读事件)→ P2 后评估,D1 已记录。
- **Codex stale-`CLAUDE_PROJECT_DIR`-leak 边角(D7)**:codex 从 Claude 会话内调起时,父进程 `CLAUDE_PROJECT_DIR` 被继承,hook 会把 .wolf 解析到错误项目(codex-cwd-test §2 实测)。窄场景,暂不修;若实际命中再回访修法(`OPENWOLF_AGENT=codex` 命令串 + agent-aware getWolfDir 忽略 stale env)。
- OpenCode SSE 备选若 shim 方案有性能问题再回访(D2)。
- 其他 agent(gemini-cli / cursor / aider)非本主线范围,适配层为它们预留 normalize 扩展点。

## §8 亲验证据索引(阶段0,防幻觉)

| 断言 | 证据 `文件:行号` |
|------|-----------------|
| Codex apply_patch payload 是 `{"command":V4A}` | `codex-rs/core/src/tools/handlers/apply_patch.rs:505-509,537-540` |
| Codex stdin 交付 JSON blob | `codex-rs/hooks/src/engine/command_runner.rs:84-85` |
| Codex envelope 是 Claude 超集(多 turn_id) | `codex-rs/hooks/src/schema.rs:270-291`(PreToolUseCommandInput) |
| Codex 10 事件名含 Claude 全集 | `codex-rs/hooks/src/lib.rs:19-30` HOOK_EVENT_NAMES |
| Codex hook config 在 .codex/ | `codex-rs/hooks/src/engine/discovery.rs:116-156` |
| OpenCode plugin 是进程内 Hooks 对象 | `packages/plugin/src/index.ts:74,222-335` |
| OpenCode tool.execute.before/after 有 args | `packages/plugin/src/index.ts:266-281` |
| OpenCode edit 参数 camelCase | `packages/opencode/src/tool/edit.ts:47-56` |
| openwolf Claude hook 注册点 | `openwolf/src/cli/init.ts:48-118` |
| openwolf 项目根 env | `openwolf/src/hooks/shared.ts:7` |
