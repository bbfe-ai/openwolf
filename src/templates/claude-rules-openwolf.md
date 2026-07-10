---
description: OpenWolf context governance — selective, not mandatory
globs: **/*
---

<!-- openwolf:v2 -->

## OpenWolf 使用原则

本项目使用 OpenWolf 做项目上下文管理,但**不强制每次操作都查 .wolf 文件**。遵循以下精简规则:

### 读取文件时
- **不需要**在每次读文件前检查 `.wolf/anatomy.md`。anatomy.md 是参考文档,在**不熟悉的项目区域**或**需要全局文件地图**时按需查阅。
- 熟悉区域直接用 `glob`/`grep`/`read_file` 工具,不经过 anatomy.md。

### 写代码时
- **不需要**在每次生成代码前检查 `.wolf/cerebrum.md`。只在以下场景查阅:
  - 遇到反复出现的同类错误
  - 需要确认项目约定或用户偏好
  - 跨会话恢复上下文

### 记录经验时(高质量、低频率)
- **用户纠正你的方式** → 记录到 `.wolf/cerebrum.md` 的 Do-Not-Repeat 或 User Preferences
- **发现非显而易见的项目约定** → 记录到 cerebrum.md 的 Key Learnings
- **重大架构决策** → 记录到 cerebrum.md 的 Decision Log

### 记录 Bug 时(仅真实 Bug)
- **只在以下情况记录 bug**:测试失败、构建失败、运行时错误、用户明确报告问题
- **不要**因为"编辑文件超过两次"就记录 bug
- **不要**记录自动检测的重构、代码风格修改、类型标注等——这些不是 bug
- 记录前**先搜索 `.wolf/buglog.json`** 看是否已有同类记录
- auto-bug-detection 已禁用,bug 记录必须是**有意识的人工/agent 决定**

### 禁止行为
- 禁止把一次性环境错误(PowerShell 语法、临时端口冲突)当 durable 经验记录
- 禁止把 stack trace、raw log、完整命令输出写进 cerebrum.md 或 buglog.json
- 禁止把 API key、token、密码等敏感信息写入任何 .wolf 文件
- 禁止在每次文件操作后都更新 anatomy.md——只在新增/删除/重命名文件时更新
