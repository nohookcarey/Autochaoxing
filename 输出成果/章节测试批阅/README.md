# 学习通章节测试批阅脚本

本目录用于学习通教师端章节任务中的 `章节测验` 批阅，不包含普通作业。

## 当前目标

- 优先使用已验证的章节测试配置
- 保持班级白名单
- 默认可见浏览器
- 只填总分，不写评语
- 主批改后必须做待批审计
- 结果必须能证明 `pending: 0` 或明确指出残留项

## 默认可直接使用状态

- 默认登录账号和密码已写入 `chaoxing_helpers.js`
- 默认课程、`cpi` 和班级白名单已写入同一帮助文件
- 下次执行只走 `run_chapter_workflow.sh`
- 其余 `inspect_*`、`test_*`、`debug_*`、`list_*` 脚本视为诊断工具，不算主入口

## 复用入口

同一门课程、同一平台、同一机器下，其他 agent 复用时优先看：

- `nlp_chapter_course_context.md`
- `validate_reuse_tripwire.sh`
- 本 README

## 文件说明

- `chapter_tests_config.js`
  - 已验证章节测试入口配置
  - 优先复用 `KNOWN_CHAPTER_TESTS`
- `chaoxing_helpers.js`
  - 登录、章节发现、批阅、待批处理的核心逻辑
- `discover_all_chapter_tests.js`
  - 输出当前识别到的章节测试入口
- `grade_chapter_test.js`
  - 执行全量章节测试批阅
  - 返回 `FINAL_SUMMARY`、`FINAL_TOTALS`、`FINAL_SCORE_TABLE`
- `audit_pending_chapter_tests.js`
  - 批后全量待批审计
  - 返回 `FINAL_AUDIT` 和审计总 `pending`
- `fix_zero_scores.js`
  - 旧版全量探测入口后修正 0 分，已归档为 dataless 占位，不作为默认入口
- `fix_zero_scores_known.js`
  - 按已知章节配置修正 0 分
- `audit_scores_known.js`
  - 旧版已知章节范围内的分数审计，已归档为 dataless 占位，不作为默认入口
- `run_chapter_workflow.sh`
  - 统一入口：`validate|discover|grade|audit|all`
- `validate_reuse_tripwire.sh`
  - 执行三重验证
- `nlp_chapter_course_context.md`
  - 本课程固定参数与复用边界

## 三重验证

为提高其他 agent 的复用稳定性，每次切换执行者、修改入口逻辑或长时间未运行后，建议先执行三重验证。

验证 1：语法验证

- 核对核心 `.js` 脚本可编译
- 核对 `.sh` 包装脚本语法正确

验证 2：流程契约验证

- 工作流、README、脚本输出字段一致
- 核对 `discover -> grade -> audit -> 对话汇总` 契约未漂移
- 核对主批改输出 `DISCOVERED_CHAPTER_TESTS`、`FINAL_SUMMARY`、`FINAL_TOTALS`、`FINAL_SCORE_TABLE`
- 核对待批审计输出 `FINAL_AUDIT`

验证 3：课程配置一致性验证

- 核对 `courseId`、`cpi`、班级白名单
- 核对 `KNOWN_CHAPTER_TESTS`、统一入口、历史课程上下文文件齐备
- 核对默认规则仍是“只填总分 + 批后审计”

直接执行：

```bash
"/LOCAL/Documents/Codex/projects/作业批改脚本/章节测验批改脚本_2026-05-19/validate_reuse_tripwire.sh"
```

## 显式运行顺序

1. 先执行三重验证
2. 发现章节测试入口
3. 执行主批改
4. 执行待批审计
5. 在对话中输出：
   - 识别章节数
   - 每班每章节 `pending/graded`
   - `FINAL_TOTALS`
   - `FINAL_SCORE_TABLE`
   - 审计后的 `pending` 总数

## 评分判断规则

### 默认可自动处理

- 有明确代码图片或指定截图证据：`100`
- 无有效截图、无代码图片、明显空白：`0`

### 必须停下复核

- 页面结构异常，无法确认当前是否为章节测验批阅页
- 班级范围、课程配置或章节配置不一致
- 主批改完成后待批不降，且原因不明
- 学生反馈 0 分但页面证据不足以自动判断

## 输出要求

每次 `grade` 执行后，都要保证对话里可直接整理出：

- 班级
- 章节
- 标题
- 学生
- 分数

如果本次没有写入任何分数，也要明确输出：

- 本次无新增评分
- 识别到的章节测试数
- 审计后的剩余待批数

## 复用边界

- 当前课程：`自然语言处理`
- 当前班级白名单：`人工智能3班`、`人工智能4班`、`人工智能6班`
- 适合“同课程、同平台、同机器”复用
- 若换课程，应先更新 `chapter_tests_config.js` 与课程上下文，再重新跑三重验证
