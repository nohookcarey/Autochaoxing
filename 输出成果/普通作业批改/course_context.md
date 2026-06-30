# 学习通作业批改课程上下文模板

用于本机、学习通教师端普通作业批改。复用前填写本学期参数。

## 课程参数

- `courseName`: `待填写课程名称`
- `courseId`: ``
- `cpi`: ``
- `targetClasses`:
  - `待填写班级1`
  - `待填写班级2`

## 固定作业列表入口

- `courseWorkListUrl`:
  - `https://mooc2-ans.chaoxing.com/mooc2-ans/work/list?courseid=&selectClassid=0&cpi=&v=0`

## 固定脚本顺序

1. `login_xuexitong.js`
2. `scan_assignment_pending.js`
3. `collect_assignment_review_basis.js`
4. `batch_grade_assignment.js`

## 复用边界

- 平台仍为学习通教师端普通作业页
- 课程仍为 `待填写课程名称`
- 班级范围仍为 `待填写班级1`、`待填写班级2`
- 浏览器仍允许可见模式操作
- 输出要求仍为“只在对话中输出评分表，不额外生成成绩文件”
