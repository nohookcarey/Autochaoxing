# 学习通签到异常登记

用途：
- 采集《自然语言处理》课程各班学生的累计签到异常记录。
- 只保留异常，不记录正常签到。
- 将异常记录回填到课堂考核及成绩记载表 `G:X` 的 `18` 个考勤槽位。

异常口径：
- 公假 = `口`
- 病假 = `小`
- 事假 = `△`
- 旷课 / 缺勤 / 未签到 = `O`
- 迟到 = `迟`
- 早退 = `早退`
- `代签` 不写入成绩表

目录文件：
- `collect_attendance_anomalies.js`：登录学习通并采集异常汇总，输出 `summary.json`
- `fill_attendance_to_gradebooks.py`：把汇总结果写回成绩表，并保留原单元格格式
- `attendance-anomaly-config.example.json`：配置样例

输入：
- 配置 JSON
- 学习通账号通过环境变量传入：`XTX_USERNAME`、`XTX_PASSWORD`
- 各班原始成绩表 `.xls`

输出：
- 采集汇总：`attendance_anomalies_summary.json`
- 回填结果：`attendance_anomalies_write_result.json`
- 各班输出成绩表：按配置中的 `outputPath`

依赖：
- Node.js
- Python 3
- Python 包：`xlrd`、`xlutils`、`xlwt`
- Playwright
- 本机 Chrome，默认路径：
  `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`

运行方式：

```bash
XTX_USERNAME='你的账号' \
XTX_PASSWORD='你的密码' \
node collect_attendance_anomalies.js /path/to/config.json /path/to/attendance_anomalies_summary.json
```

```bash
python3 fill_attendance_to_gradebooks.py /path/to/attendance_anomalies_summary.json /path/to/attendance_anomalies_write_result.json
```

配置要求：
- `classes[].sheetPath` 指向原始成绩表
- `classes[].outputPath` 指向回填后的输出成绩表
- 成绩表回填范围固定为 `G:X`
- `18` 个槽位表示累计异常记录位，不是 `18` 次签到明细

验证建议：
- 先用 `1` 个班做小范围验证
- 看 `summary.json` 里的 `countsByMapped`
- 看 `write_result.json` 里的 `matchedStudentCount`、`writtenCellCount`、`unmatchedStudents`

注意：
- 不要在任何脚本、配置或提交里保存账号密码
- 若某条异常记录没有学号，而成绩表名册里也找不到同名学生，该记录会出现在 `unmatchedStudents`
