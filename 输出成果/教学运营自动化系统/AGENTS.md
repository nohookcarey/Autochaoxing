# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Confirmed product-direction decisions

- The primary user is a non-technical teacher who wants to finish teaching tasks quickly, not operate scripts or inspect technical task plans.
- Keep the dark left navigation and the expandable course switcher visible.
- Make the main workspace a simple set of task columns: 作业批改、章节测试、签到考勤、成绩与课程建设.
- In 作业批改, prominently expose 扫描待批作业、开始批改、修改作业截止时间.
- Keep AI assistance compact and explanatory; it must explain scope and request confirmation before any write action.
- Keep the side navigation to four teacher-facing entries: 教学任务、课程管理、运行记录、系统设置. Do not add 日历与排程 or 数据工坊: the school already provides calendar services and the user does not need a separate data-workbench surface.
- Store only course name, class allowlist, and enabled modules in the course-profile UI. Course ID, CPI, login credentials, cookies, and student data must never be saved there; real connection parameters belong in a future local, controlled configuration.
- A real task must start with an explicit preflight state. Until course, classes, teacher login, and target page entry are verified, show “未获取” or “需人工登录”, never fabricate an empty result or run a write action.
- The assignment scanner must receive its course name and class allowlist as explicit inputs. It must verify course context, assignment-page context, and a list entry before scanning; an empty list or an unseen target class remains “未获取”, not “确认无数据”.
- The AI chat is a task-intent entry point, not a command shell. Read-only requests may enter preflight; grade and deadline requests must only explain scope and request confirmation, never authorize platform writes from a single chat message.
- Keep local audit records limited to task name, course/class scope, acquisition state, reason, and time. Retain at most 100 records; never persist account credentials, cookies, course IDs/CPI, student data, or signed platform URLs.
- Course connection parameters may be edited only through the local gateway on the same machine. Save them atomically and validate every profile; reject credentials and all nested sensitive fields. A saved profile is “已配置，待核验”, never evidence of a live platform connection.
- Demo mode is a separate, deidentified presentation path: replace course/class labels, hide real connection settings and non-demo audit history, never call the platform, and label every simulated result as an demo result. It must support exporting a deidentified run report and architecture diagram.
- The web workbench and task gateway must both bind to 127.0.0.1 only. Do not expose the local Demo through a LAN address, a public hostname, or a cloud deployment.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
