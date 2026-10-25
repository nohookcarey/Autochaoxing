# 仓库目录与迁移说明

2026-10-26：只整理源码和文档位置，不改变扩展运行代码、教师确认规则或现有Release附件。旧Git/PR缓存残留状态不因本次目录迁移改变。

| 位置 | 用途 |
|---|---|
| `apps/teacher-assistant/` | 当前教师助手：扩展、网页工作台、本机服务、配置模板和测试 |
| `legacy/` | 5类旧独立工具，保留原实现与写入限制 |
| `docs/teacher-assistant/` | 使用、版本和验收证据；自动检查配置位于.github/workflows |
| `docs/project/` | 项目与历史决策记录 |
| `scripts/` | 仓库隐私与结构检查 |
| `.github/` | 反馈模板、贡献模板和依赖更新配置 |

原 `输出成果/教学运营自动化系统/` 对应当前主程序；其 `docs/` 已集中到文档区。其余旧业务目录分别迁往 `legacy/assignments`、`chapter-tests`、`chapter-builder`、`deadlines`、`attendance`。文件按Git重命名保留，未删除历史代码或许可证。

已有开发者切换到新目录运行 `npm ci`、`npm test`；根目录运行 `node scripts/verify-public-repository.mjs` 与 `node scripts/verify-repository-layout.mjs`；后者同时检查导航链接、Dependabot项目及正式CI工作流路径。安装版教师继续使用现有Release，无需因目录变化重新安装。源码中的 `extension/` 必须以浏览器扩展方式加载。

【知识库对齐核验】

- 引用依据：既有PRD、项目目录规则、已确认的仓库整理方案及自动沉淀规则。
- 锁定口径：保留旧实现、许可和验证证据，更新路径及入口，不操作真实课程和成绩。
- 变动警示：GitHub源码布局已调整；安装包字节及现场验收边界不变，个人工作区和私有课程脚本不在迁移范围。

完整源码发布使用根目录 `scripts/stage-public-repository.mjs`，主程序中的旧暂存入口转发到该流程。仅导出固定Git提交的完整仓库，包含顶层docs、导航和旧工具；拒绝非空目标、仓库内部目标及不支持的文件类型。未提交内容不进入快照；结果必须通过全仓隐私、模块发布和路径检查。
