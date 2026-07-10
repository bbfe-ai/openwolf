# 11 · openwolf 跨 Agent 适配器 — 可执行清单

> 执行台账。当前在哪看 §2 看板,怎么验看 §1 门禁,做什么看 §4 逐任务。
> 权威方案见 `01_authoritative.md`。

## 0. 子 agent 执行守则

1. **一任务一 commit**,message 前缀 `refactor(T<id>):` / `feat(T<id>):`,正文引用任务号。
2. **精确 stage**:`git add <精确文件>`,禁 `git add .`/`-A`(本仓库 feat/context-optimization 分支有 pnpm-lock.yaml 等 WIP,勿卷入)。
3. **commit hash 真值回填**:先提交拿真 hash 再回填完成确认,绝不占位。
4. **重采基线**:任何门禁基线变更单独 `chore: 重采基线 (原因)` 提交。
5. **不碰 Claude 现有路径**:C1 零回归是硬约束;动现有 hook 逻辑前先确认是接缝增量。
6. **adapter 代码落 `src/hooks/adapters/`**:受 `tsconfig.hooks.json` rootDir=`src/hooks` 约束,放子目录才能被 hook import。
7. **动手前 premise re-check**:Grep/Read 重新定位锚点,行号会漂移。
8. **跨仓只读**:codex/opencode 源码(`D:/100-CodeSpace/04-GitHub/{codex,opencode}`)只读不改,本主线所有改动落在 openwolf 仓。

## 1. 全局门禁

| Gate | 命令 | 何时跑 |
|------|------|--------|
| G0-build | `pnpm build`(含 `tsc && pnpm build:hooks`)+ 从零 `rm -rf dist` 全绿 | 每任务 |
| G0-hooks-single | `tsc -p tsconfig.hooks.json`(单独 hook 编译,验 adapter 子目录不破 rootDir) | 改 adapter 的任务 |
| G-regress-claude | 主线10 A/B fixture 复跑:20-edit + stop,断言 memory 不增/buglog 不增/prune 归档/search 命中不含 anatomy | 每 Phase 收尾 + 动现有 hook 的任务 |
| G-codex-e2e | codex 适配器就绪后:用 `.codex/hooks.json` 注册,跑 codex 真实会话或模拟 envelope(apply_patch stdin),断言归一化 + 不爆炸 | A 轨任务 |
| G-opencode-e2e | opencode 适配器就绪后:加载 plugin shim,跑模拟 tool.execute 事件,断言映射 + 不爆炸 | B 轨任务 |
| G-config | grep 确认新 agent 路径的门控字段(log_edits/auto_detect/consolidation_*)在 hooks 有读取点 | 收尾 |

## 2. 总进度看板

> 状态:☐ 待办 / ◐ 部分 / ☑ 完成 / ⊘ 阻塞或 N/A。状态唯一来源。

| Phase | 任务 | 状态 | 备注 |
|-------|------|------|------|
| P0 门禁 | T0.1 G-regress-claude fixture 脚本化(复用主线10 A/B) | ☐ | 把 .ab-test driver 固化为可复跑脚本 |
| P0 门禁 | T0.2 基线快照:Claude 路径 memory/buglog/search 基线值 | ☐ | G-regress-claude 的零 diff 基线 |
| P1 接缝 | T1.1 detectAgent() + normalize 接缝空壳(claude 直通) | ☐ | 纯增量零行为变更 |
| P1 接缝 | T1.2 adapters 目录 +  tsconfig 验证 | ☐ | G0-hooks-single |
| P2 codex | T2.1 V4A patch 解析器 `adapters/codex-v4a.ts` | ☐ | D5 自写 |
| P2 codex | T2.2 Codex envelope 归一化(apply_patch→Claude 形状) | ☐ | 依赖 T2.1 |
| P2 codex | T2.3 `openwolf init --agent codex` 写 .codex/hooks.json | ☐ | D4 单选 |
| P2 codex | T2.4 项目根 cwd 适配(替代 $CLAUDE_PROJECT_DIR) | ☐ | envelope.cwd |
| P2 codex | T2.5 G-codex-e2e 实跑验证 | ☐ | |
| P3 opencode | T3.1 TS plugin shim `adapters/opencode-plugin.ts` | ☐ | D2 shim 非 SSE |
| P3 opencode | T3.2 camelCase→snake_case 字段映射 | ☐ | edit.ts:47-56 |
| P3 opencode | T3.3 step 事件映射 SessionStart/Stop 边界 | ☐ | B4 |
| P3 opencode | T3.4 `openwolf init --agent opencode` 写 plugin 注册 | ☐ | |
| P3 opencode | T3.5 G-opencode-e2e 实跑验证 | ☐ | |
| P4 收口 | T4.1 init --agent 选项总装(三 agent 单选) | ☐ | |
| P4 收口 | T4.2 文档/README/协议文案加多 agent 说明 | ☐ | 4 处副本同步 |
| P4 收口 | T4.3 全 G 回归 + version bump + DONE.md | ☐ | |

### 量化 DONE 快照(当前)

| 指标 | Claude(基线,主线10) | Codex | OpenCode |
|------|----------------------|-------|----------|
| 20-edit memory 增长 | 0 ☑ | — | — |
| buglog 假阳性 | 0 ☑ | — | — |
| stop prune 无 daemon | ✅ ☑ | — | — |
| search 定位非整读 | ✅ ☑ | — | — |

**下一个可执行任务:T0.1**(把 A/B driver 固化为 G-regress-claude 可复跑脚本)。

## 3. Phase 总览(不带状态列,状态以 §2 为准)

### P0 门禁搭建
- 目标:把 Claude 路径行为基线固化成可复跑回归脚本,作为 C1 零回归的门。
- 风险:无 fixture 则后续 adapter 改动无法证未回归。
- 前置:主线10 已完成(Claude 路径全绿)。
- 关键 ratchet:Claude 路径 memory/buglog/search 基线值锁定。

### P1 接缝先行
- 目标:detectAgent + normalize 空壳,纯增量,Claude 直通零变更。
- 风险:动 hook 入口若引入分支可能影响 Claude;故 normalize 对 claude 来源 noop。
- 前置:P0。

### P2 Codex 适配器
- 目标:V4A 解析 + 注册 + cwd 适配,codex 会话跑通且不爆炸。
- 风险:V4A 格式 corner case(multiple files / Replace / context lines);文件读降级(D1)。
- 前置:P1。

### P3 OpenCode 适配器
- 目标:TS plugin shim + 字段映射 + session 边界映射。
- 风险:进程内 shim 与 openwolf node 进程的 spawn/stdio 桥接;step 边界不准致 prune 时机错。
- 前置:P1。

### P4 收口
- 目标:init --agent 总装 + 文档同步 + 全回归 + 发版。
- 前置:P2、P3。

## 4. 逐 Phase 任务(六段锚点)

### T0.1 G-regress-claude fixture 脚本化
- 上游:主线10 的 `.ab-test/ab-test.mjs`(已删,需重建为仓内 fixtures)
- 下游:所有后续任务都靠它证 C1 零回归;改 Claude 路径必跑
- 处理点:在 `test/regress-claude.mjs`(或类似)固化 A/B driver 的 v1.1.0 Claude 路径部分——setup .wolf + 20 edit + stop + 断言;断言值写死成基线(memory_rows==1 after prune / buglog_count==0 / archive 含 2020 block / search 不含 anatomy)
- 验证点:`node test/regress-claude.mjs` exit 0;改一行 hook 逻辑后跑应仍绿(否则基线漂移告警);断言逐条打印 PASS/FAIL 不是只 exit 0
- 回滚点:纯新增测试脚本,可单文件删
- 门禁:G0-build(确保 dist 在)

### T0.2 基线快照
- 上游:T0.1
- 下游:G-regress-claude 的零 diff 对照
- 处理点:T0.1 断言值即基线;额外把 Claude 路径 anatomy/cerebrum/memory/buglog 字节值记入 `test/baselines/claude.json`
- 验证点:基线 JSON 字段齐全;re-run 两次值一致
- 回滚点:T0.1
- 门禁:T0.1 跑通

### T1.1 detectAgent() + normalize 接缝空壳
- 上游:`shared.ts:7` getWolfDir(现有 env 读取)
- 下游:所有 adapter 任务(T2/T3);hook 入口(`post-write.ts`/`pre-read.ts`/`stop.ts` 等)将调 normalize
- 处理点:`src/hooks/adapters/normalize.ts` 新增 `detectAgent(env, input)` + `normalizeToolEvent(agent, input)`;claude 来源直通返回原 input;codex/opencode 暂返回 null(noop,后续任务填)。`shared.ts` export detectAgent。**不动现有 hook 主逻辑**,只加可调用接缝
- 验证点:`tsc -p tsconfig.hooks.json` 绿;Claude 路径 A/B 复跑(T0.1)零 diff(证明 normalize 对 claude 是 noop);grep 确认 normalize 对 codex/opencode 分支返回 null 未被任何主逻辑消费
- 回滚点:纯增量新增文件 + shared.ts 加 export,可 revert
- 门禁:G0-build + G0-hooks-single + G-regress-claude

### T1.2 adapters 目录 + tsconfig 验证
- 上游:T1.1
- 下游:T2/T3 的 adapter 文件落点
- 处理点:确认 `src/hooks/adapters/` 编译产物落 `dist/hooks/adapters/`;tsconfig.hooks.json 无需改(rootDir=src/hooks 已含子目录)
- 验证点:`ls dist/hooks/adapters/` 有 normalize.js;`tsc -p tsconfig.hooks.json` 无 rootDir 报错
- 回滚点:T1.1
- 门禁:G0-hooks-single

### T2.1 V4A patch 解析器
- 上游:T1.2(adapters 目录就位)
- 下游:T2.2 归一化消费
- 处理点:`src/hooks/adapters/codex-v4a.ts` 新增 `parseV4APatch(command: string): Array<{filePath, oldString, newString}>`;解析 `*** Begin Patch` / `*** File: <path>` / `*** Replace: N` / 上下文行(old/new)块;参考 `codex-rs/core/src/tools/handlers/apply_patch.rs` 的格式(只读)
- 验证点:**能当场证伪偷工**——构造 3 个 V4A 样本(单文件单替换 / 多文件 / 带 context 行),断言解析出 filePath/oldString/newString 逐字段相等(字节 parity),不是只"解析不崩";写进 `test/v4a-fixtures`
- 回滚点:纯新增,可删
- 门禁:G0-build + G0-hooks-single

### T2.2 Codex envelope 归一化
- 上游:T2.1
- 下游:T2.3 注册 + T2.5 验证
- 处理点:在 `normalize.ts` 填 codex 分支:`detectAgent` 用 envelope 的 `hook_event_name`/`turn_id` 判定 codex;`normalizeToolEvent` 对 tool_name=apply_patch 调 parseV4APatch,产出多个 Claude 形状事件(多文件 patch → 多事件);cwd 用 envelope.cwd
- 验证点:构造 codex PreToolUse envelope JSON(stdin 形状,schema.rs:270-291),喂给 normalize,断言输出 Claude 形状 `{tool_name:'Edit',tool_input:{file_path,old_string,new_string}}`;对非 apply_patch 工具(Bash 等)返回 null 不崩
- 回滚点:T1.1 normalize 空壳,可回退
- 门禁:G0-build + G0-hooks-single

### T2.3 `openwolf init --agent codex` 写 .codex/hooks.json
- 上游:T2.2
- 下游:T2.5
- 处理点:`init.ts` 加 `--agent` 选项(D4);agent=codex 时不写 .claude/settings.json,改写 `<project>/.codex/hooks.json`,事件 PreToolUse(matcher apply_patch)/PostToolUse/SessionStart/Stop,command 指向 `.wolf/hooks/*.js`;hookFiles 白名单已含现有 hook(codex 复用同 hook.js,靠 normalize 分流)
- 验证点:`openwolf init --agent codex` 在 tmp 项目生成 `.codex/hooks.json` 且内容含 4 事件 + command 指向 .wolf/hooks;`--agent claude`(默认)仍写 .claude/settings.json 不变(G-regress-claude)
- 回滚点:init.ts --agent 分支,可 revert;claude 路径不动
- 门禁:G0-build + G-regress-claude

### T2.4 项目根 cwd 适配
- 上游:T2.2
- 下游:T2.5
- 处理点:`shared.ts` getWolfDir 加 codex 分支:无 $CLAUDE_PROJECT_DIR 时用 envelope.cwd(从 stdin 解析)或 process.cwd();hook 入口把 cwd 透传
- 验证点:codex 路径下 getWolfDir 返回 envelope.cwd/.wolf;claude 路径不变(G-regress-claude)
- 回滚点:shared.ts 分支
- 门禁:G0-build + G-regress-claude

### T2.5 G-codex-e2e 实跑验证
- 上游:T2.3 + T2.4
- 下游:P4 收口
- 处理点:构造 codex 会话模拟——喂 apply_patch 的 PreToolUse/PostToolUse envelope JSON 到 hook.js stdin,跑 20 edit + SessionStart + Stop;断言 memory 不增(门控关)/buglog 不增/stop 触发 prune 归档/search 命中不含 anatomy;**断言 V4A 解析出的 file_path 与构造的 patch 一致**
- 验证点:量化指标对齐 §6 目标表 codex 列;逐断言 PASS/FAIL;exit 0
- 回滚点:T2.x 各任务
- 门禁:G-codex-e2e

### T3.1 TS plugin shim
- 上游:T1.2
- 下游:T3.2/T3.3/T3.5
- 处理点:`src/hooks/adapters/opencode-plugin.ts` 导出 `Plugin`(packages/plugin/src/index.ts:74 形状)实现 Hooks;`tool.execute.before/after` hook 收 {tool, args},spawn `node .wolf/hooks/{pre,post}-write.js`,把映射后 JSON 写 stdin;带 `OPENWOLF_AGENT=opencode` env 让 detectAgent 识别
- 验证点:tsc 绿;shim 能被 opencode 加载(最小:导出 Hooks 对象含 tool.execute.after);spawn 出的 node 进程收到正确 JSON(日志断言)
- 回滚点:纯新增
- 门禁:G0-build

### T3.2 camelCase→snake_case 字段映射
- 上游:T3.1
- 下游:T3.5
- 处理点:shim 内映射 edit{filePath,oldString,newString}→{file_path,old_string,new_string};write{filePath,content}→{file_path,content};read{filePath}→{file_path};tool 字符串映射 edit/write/read→Edit/Write/Read(对齐 Claude tool_name)
- 验证点:构造 opencode tool.execute.after 事件(edit/write/read 各一),断言映射后 JSON 字段名 == Claude 形状(字节 parity on field names)
- 回滚点:T3.1
- 门禁:G0-build

### T3.3 step 事件映射 SessionStart/Stop 边界
- 上游:T3.1
- 下游:T3.5
- 处理点:shim 的 `event` hook 监听 session.next.step.started→触发 session-start.js;step.ended→触发 stop.js(含 prune);无干净 session end(B4)用 step.ended 近似
- 验证点:模拟 step.started/step.ended 事件序列,断言对应 hook 进程被 spawn 且 stop 跑了 prune
- 回滚点:T3.1
- 门禁:G0-build

### T3.4 `openwolf init --agent opencode` 写 plugin 注册
- 上游:T3.1
- 下游:T3.5
- 处理点:init.ts agent=opencode 时:拷 shim 到 `.wolf/adapters/opencode-plugin.ts`;写/追加 `opencode.json` 的 `"plugin": ["./.wolf/adapters/opencode-plugin.ts"]`;不写 .claude
- 验证点:`openwolf init --agent opencode` 生成 shim + opencode.json plugin 字段;claude 路径不变
- 回滚点:init.ts 分支
- 门禁:G0-build + G-regress-claude

### T3.5 G-opencode-e2e 实跑验证
- 上游:T3.2 + T3.3 + T3.4
- 下游:P4
- 处理点:模拟 opencode 事件序列(step.started + 20× tool.execute.after(edit/write)+ step.ended)喂 shim,断言 memory 不增/buglog 不增/prune 归档/search;字段映射正确
- 验证点:量化指标对齐 §6 opencode 列;逐断言 PASS/FAIL
- 回滚点:T3.x
- 门禁:G-opencode-e2e

### T4.1 init --agent 选项总装
- 上游:T2.3 + T3.4
- 下游:T4.2
- 处理点:init.ts --agent 选项校验(只接受 claude|codex|opencode,默认 claude);三路径各自只写自己注册点不互染;help 文本
- 验证点:三 agent 各 init 一遍,cross-check 注册点文件互斥;无 --agent 默认 claude 零回归
- 回滚点:T2.3/T3.4 分支
- 门禁:G0-build + G-regress-claude

### T4.2 文档/协议文案同步
- 上游:T4.1
- 下游:T4.3
- 处理点:README.md 加多 agent 安装段(claude/codex/opencode);OPENWOLF.md/claude-rules-openwolf.md 协议副本(templates ×2 + init.ts/update.ts 内嵌 ×2,共 4 处)加 agent 无关说明;docs/ 若有安装页同步
- 验证点:grep 4 处协议副本都含多 agent 说明;无残留"只支持 Claude"独断表述(README 标题保留 Claude 主定位但加兼容说明)
- 回滚点:纯文档
- 门禁:G0-build

### T4.3 全 G 回归 + version bump + DONE.md
- 上游:T4.1 + T4.2
- 下游:发版(用户放行)
- 处理点:跑全部门禁(G0/G-regress-claude/G-codex-e2e/G-opencode-e2e/G-config);package.json 1.1.0→1.2.0;产 DONE.md 收口
- 验证点:全 G 绿;量化快照表 §2 codex/opencode 列填实;version bump
- 回滚点:各任务
- 门禁:全部
