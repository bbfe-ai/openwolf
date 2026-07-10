<!-- openwolf:v2 -->
# OpenWolf

本项目使用 OpenWolf 做上下文管理,但不强制每次操作都查 .wolf 文件。

**按需查阅**(非强制):
- `.wolf/anatomy.md` — 项目文件地图,在不熟悉的区域操作前可查阅
- `.wolf/cerebrum.md` — 跨会话经验,遇到反复错误或需要确认项目约定时查阅
- `.wolf/buglog.json` — 历史故障记录,修复 bug 前可搜索已有解决方案

**记录原则**(高质量、低频率):
- 只记录 durable 经验:用户纠正、项目约定、架构决策
- 只记录真实 bug:测试失败、构建失败、运行时错误
- 禁止记录一次性环境问题、自动检测的重构、stack trace
- auto-bug-detection 已默认禁用,所有记录必须是有意识的决定

详细规则见 `.claude/rules/openwolf.md`。
