# 学习通作业截止日期批量修改脚本

用于学习通教师端普通作业列表页，按班级范围批量修改作业截止日期。

## 目录用途

- `login_xuexitong.js`
  - 登录并进入目标课程作业列表页
- `scan_deadline_targets.js`
  - 必要时先跳到目标课程作业列表页，再扫描生成目标作业清单
- `update_assignment_deadline.js`
  - 对单条作业执行截止日期修改并回读验证
- `deadline_update_config.template.json`
  - 配置模板
- `run_deadline_workflow.sh`
  - 统一入口：`login|scan|update|validate`
- `validate_deadline_update_tripwire.sh`
  - 三重验证

## 默认使用方式

1. 先执行 `validate`。
2. 再执行 `login`，确认已进入目标课程作业列表页。
3. 执行 `scan`，确认目标作业清单。
4. 在 `update_assignment_deadline.js` 顶部 `CONFIG` 填写 `expectedTitle`、`expectedClassName` 和目标日期。
5. 执行 `update`，脚本会自动从列表定位到匹配作业的修改页。
6. 回读成功后，再逐步扩大执行范围。

## 开批前门槛

1. 课程名称、`courseId`、`cpi` 已确认。
2. 目标班级范围已确认。
3. 目标日期已确认。
4. 三重验证已通过。
5. 已承诺逐条回读与列表页抽查。

## 联机入口约定

- `scan_deadline_targets.js` 默认优先使用 `XTX_DEADLINE_COURSE_WORK_LIST_URL`。
- 若未显式传入，则回退到脚本内置的课程作业列表地址。
- 只有在已到达真实作业列表页并能识别 `[id^=work]` 项时，才继续扫描。
- `login_xuexitong.js` 仅从 `XTX_USERNAME`、`XTX_PASSWORD` 环境变量读取登录信息。
- 课程列表地址可通过 `XTX_DEADLINE_COURSE_WORK_LIST_URL` 配置。

## 真实脚本仓库规则

- 这里放真实脚本，不把脚本复制回知识库。
- 知识库只保留工作流、说明页、风险边界和入口。
- 旧版或过时脚本应移入 `学习通/归档`。
