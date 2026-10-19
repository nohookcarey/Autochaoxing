import { useEffect, useMemo, useState } from "react";
import DemoWalkthrough from "./DemoWalkthrough";
import {
  IconAlertTriangle, IconArrowRight, IconBook2, IconChevronDown, IconChevronUp,
  IconClipboardCheck, IconFileText, IconMessageCircle2, IconNotebook, IconPencil,
  IconDownload, IconPlus, IconReportAnalytics, IconSchool, IconSend, IconSettings, IconShieldCheck,
  IconSparkles, IconUserCheck, IconX,
} from "@tabler/icons-react";
import { acquisitionStates, buildAssignmentPreflight, buildRunRecord } from "./task-preflight";
import { resolveAssistantIntent } from "./assistant-intents";
import { loadRunRecords, prependRunRecord, RUN_RECORD_STORE_KEY } from "./local-audit";
import { DEMO_MODE_STORE_KEY, buildArchitectureSvg, buildDemoReport, createDemoReadResult, createDemoRunRecord, createDemoWritePlan, createDemoWriteResult, demoCourseFor, downloadArtifact } from "./demo-mode";

const COURSE_STORE_KEY = "learningtong-teaching-operations-courses-v1";
const initialCourses = [
  { key: "course-01", name: "本机课程档案 01", classNames: ["待连接班级"], modules: ["assignment"], connection: "未核验" },
  { key: "course-02", name: "本机课程档案 02", classNames: ["待连接班级"], modules: ["assignment"], connection: "未核验" },
  { key: "course-03", name: "本机课程档案 03", classNames: ["待连接班级"], modules: ["assignment"], connection: "未核验" },
];
const moduleOptions = [["assignment", "作业待批核验"]];
const primaryNav = [[IconClipboardCheck, "教学任务"], [IconBook2, "课程管理"], [IconReportAnalytics, "运行记录"], [IconSettings, "系统设置"]];
const taskGroups = [
  { key: "assignment", title: "作业待批核验", subtitle: "已接入：本机配置检查与只读扫描前核验", icon: IconFileText, tone: "blue", actions: [["扫描待批作业", "先核验课程、班级、登录与作业页面入口", "scan", true]] },
];
const demoResults = {
  scan: "已准备待批扫描。接入真实课程前，需要先完成课程连接核验与本轮只读门禁。",
  grade: "已生成批改范围预览。请先核对班级和评分依据，再确认开始批改。",
  deadline: "已准备截止时间修改预览。系统会先列出受影响的作业与班级。",
  "chapter-scan": "已准备章节测试检查。当前仅用于查看，不会修改测试成绩。",
  "chapter-result": "已整理章节测试结果摘要，可继续查看详细情况。",
  "attendance-scan": "已准备签到异常采集任务：只读取异常记录，不会回填成绩表。",
  "attendance-result": "已打开最近一次考勤汇总结果。",
  score: "已打开成绩处理状态，涉及写入时会先显示预览并请您确认。",
  content: "已打开课程资料管理入口，可继续选择章节或资料任务。",
};

function mergeCourseProfiles(courses, profiles) {
  const existingByKey = new Map(courses.map((course) => [course.key, course]));
  const configuredKeys = new Set(profiles.map((profile) => profile.courseKey));
  const configuredCourses = profiles.map((profile) => ({
    ...(existingByKey.get(profile.courseKey) ?? {}),
    key: profile.courseKey,
    name: profile.courseName,
    classNames: profile.classNames,
    modules: (profile.enabledModules ?? []).filter((key) => key === "assignment"),
    connection: "作业页已核验",
  }));
  const customCourses = courses.filter((course) => !course.key.startsWith("course-") && !configuredKeys.has(course.key));
  return [...configuredCourses, ...customCourses];
}

function loadCourses() {
  try { const stored = window.localStorage.getItem(COURSE_STORE_KEY); return stored ? JSON.parse(stored) : initialCourses; } catch { return initialCourses; }
}
function taskEnabled(course, taskKey) { return course.modules.includes(taskKey); }
function availableModules(course) { return course.modules.filter((key) => key === "assignment"); }

function TaskButton({ action, tone, disabled, onClick }) {
  const [label, detail, key, primary] = action;
  return <button className={`task-action ${tone} ${primary ? "is-primary" : ""}`} disabled={disabled} onClick={() => onClick({ label, detail, key, primary })} type="button"><span>{disabled ? "此课程未启用" : label}</span><IconArrowRight size={19} stroke={2} /></button>;
}

function CourseEditor({ course, onClose, onSave }) {
  const [name, setName] = useState(course?.name ?? "");
  const [classes, setClasses] = useState(course?.classNames.join("、") ?? "");
  const [modules, setModules] = useState(course?.modules?.filter((key) => key === "assignment") ?? ["assignment"]);
  const toggleModule = (key) => setModules((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  function submit(event) {
    event.preventDefault();
    const classNames = classes.split(/[、,，\n]/).map((item) => item.trim()).filter(Boolean);
    if (!name.trim() || classNames.length === 0 || modules.length === 0) return;
    onSave({ key: course?.key ?? `course-${Date.now()}`, name: name.trim(), classNames, modules, connection: course?.connection ?? "未核验" });
  }
  return <div className="modal-backdrop" role="presentation"><form className="course-editor" onSubmit={submit}>
    <div className="editor-header"><div><p className="eyebrow">本机课程档案</p><h2>{course ? "编辑课程" : "添加课程"}</h2></div><button aria-label="关闭" className="close-button" onClick={onClose} type="button"><IconX size={22} /></button></div>
    <label>课程名称<input autoFocus onChange={(event) => setName(event.target.value)} placeholder="例如：职业课程名称" value={name} /></label>
    <label>使用班级<input onChange={(event) => setClasses(event.target.value)} placeholder="多个班级请用顿号或逗号分隔" value={classes} /></label>
    <fieldset><legend>启用的教学任务</legend><div className="module-checks">{moduleOptions.map(([key, label]) => <label className="module-check" key={key}><input checked={modules.includes(key)} onChange={() => toggleModule(key)} type="checkbox" /><span>{label}</span></label>)}</div></fieldset>
    <p className="editor-note">课程 ID、CPI 和登录信息不在此页面保存；真实连接参数后续仅写入本机受控配置。</p>
    <div className="editor-actions"><button className="secondary-button" onClick={onClose} type="button">取消</button><button className="primary-button" type="submit">保存课程</button></div>
  </form></div>;
}

function CourseManagement({ activeCourse, courses, onEdit, onNew, onSelect, onVerify }) {
  return <><header className="page-header"><div><p className="eyebrow">本机课程档案</p><h1>课程管理</h1><p>先配置课程和班级范围，再进入教学任务。真实连接信息单独受控保存。</p></div><button className="primary-button add-course" onClick={onNew} type="button"><IconPlus size={19} />添加课程</button></header>
    <section className="course-manager-note"><IconShieldCheck size={22} /><p>当前课程：<strong>{activeCourse.name}</strong>。连接状态只在完成现场登录和页面核验后更新。</p></section>
    <section className="course-cards" aria-label="课程档案">{courses.map((course) => <article className={`course-card ${activeCourse.key === course.key ? "is-current" : ""}`} key={course.key}>
      <div className="course-card-top"><span className="course-card-icon"><IconSchool size={24} /></span><div><h2>{course.name}</h2><p>{course.classNames.join("、")}</p></div>{activeCourse.key === course.key && <span className="current-tag">当前使用</span>}</div>
      <div className="course-card-meta"><span>连接状态：<strong className={course.connection === "已核验" ? "verified" : "unverified"}>{course.connection}</strong></span><span>已启用 {availableModules(course).length} 类任务</span></div>
      <div className="course-module-tags">{moduleOptions.filter(([key]) => availableModules(course).includes(key)).map(([, label]) => <span key={label}>{label}</span>)}</div>
      <div className="course-card-actions"><button className="secondary-button" onClick={() => onEdit(course)} type="button"><IconPencil size={16} />编辑</button>{activeCourse.key !== course.key && <button className="plain-button" onClick={() => onSelect(course)} type="button">切换到此课程</button>}</div>
    </article>)}</section></>;
}

function TaskPreflight({ preflight, onClose, onRecord }) {
  const state = acquisitionStates[preflight.state];
  return <div className="modal-backdrop" role="presentation"><section aria-labelledby="preflight-title" className="task-preflight">
    <div className="editor-header"><div><p className="eyebrow">只读扫描前核验</p><h2 id="preflight-title">{preflight.taskName}</h2></div><button aria-label="关闭" className="close-button" onClick={onClose} type="button"><IconX size={22} /></button></div>
    <div className="preflight-scope"><span>课程</span><strong>{preflight.courseName}</strong><span>班级</span><strong>{preflight.classNames.join("、")}</strong></div>
    <div className="acquisition-state"><IconShieldCheck size={21} /><div><strong>{state.label}</strong><p>{state.description}</p></div></div>
    <ol className="preflight-steps">{preflight.steps.map((step) => <li className={step.done ? "is-done" : ""} key={step.label}><span>{step.done ? "已确认" : "待确认"}</span><div><strong>{step.label}</strong><p>{step.detail}</p></div></li>)}</ol>
    <p className="editor-note">本操作不会读取学生详情、提交评分或修改学习通数据。完成登录和页面核验后，才会启用实际扫描。</p>
    <div className="editor-actions"><button className="secondary-button" onClick={onClose} type="button">暂不处理</button><button className="primary-button" onClick={onRecord} type="button">检查本机配置并记录</button></div>
  </section></div>;
}

function DemoResultModal({ result, onClose, onExportArchitecture, onExportReport }) {
  return <div className="modal-backdrop" role="presentation"><section aria-labelledby="demo-result-title" className="demo-result-modal">
    <div className="editor-header"><div><p className="eyebrow">脱敏演示结果 · 未连接学习通</p><h2 id="demo-result-title">{result.taskName}</h2></div><button aria-label="关闭" className="close-button" onClick={onClose} type="button"><IconX size={22} /></button></div>
    <div className="result-badges"><span>{result.state}</span><span>{result.risk}</span><span>{result.courseName}</span></div>
    <p className="result-summary">{result.summary}</p><p className="result-evidence">证据：{result.evidence}</p>
    <div className="demo-metrics">{result.metrics.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
    <div className="result-table"><div className="result-table-head"><span>范围</span><span>结果</span><span>说明</span></div>{result.rows.map(([scope, state, detail]) => <div className="result-table-row" key={`${scope}-${state}`}><span>{scope}</span><strong>{state}</strong><span>{detail}</span></div>)}</div>
    <div className="demo-downloads"><button className="secondary-button" onClick={onExportReport} type="button"><IconDownload size={16} />导出运行报告</button><button className="secondary-button" onClick={onExportArchitecture} type="button"><IconDownload size={16} />导出架构图</button><button className="primary-button" onClick={onClose} type="button">完成</button></div>
  </section></div>;
}

function DemoWritePreview({ plan, onClose, onConfirm }) {
  const [confirmed, setConfirmed] = useState(false);
  return <div className="modal-backdrop" role="presentation"><section aria-labelledby="demo-write-title" className="task-preflight">
    <div className="editor-header"><div><p className="eyebrow">脱敏演示 · 写入预演</p><h2 id="demo-write-title">{plan.taskName}</h2></div><button aria-label="关闭" className="close-button" onClick={onClose} type="button"><IconX size={22} /></button></div>
    <div className="preflight-scope"><span>课程</span><strong>{plan.courseName}</strong><span>班级</span><strong>{plan.classNames.join("、")}</strong><span>风险</span><strong>{plan.risk}</strong></div>
    <div className="acquisition-state"><IconAlertTriangle size={21} /><div><strong>演示预演，未执行真实写入</strong><p>{plan.preview}</p></div></div>
    <ol className="preflight-steps"><li className="is-done"><span>已确认</span><div><strong>写前范围</strong><p>{plan.impact}</p></div></li><li><span>待确认</span><div><strong>模拟写入与独立回读</strong><p>确认后仅生成脱敏演示结果，不会连接学习通。</p></div></li></ol>
    <label className="demo-confirm"><input checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" />我已了解这是演示，不会修改真实课程。</label>
    <div className="editor-actions"><button className="secondary-button" onClick={onClose} type="button">取消</button><button className="primary-button" disabled={!confirmed} onClick={onConfirm} type="button">确认并演示回读</button></div>
  </section></div>;
}

function RunRecords({ records }) { return <><header className="page-header"><div><p className="eyebrow">本机运行留痕</p><h1>运行记录</h1><p>保留最近 100 条核验记录，不保存账号、课程连接参数或学生数据。</p></div></header>{records.length === 0 ? <section className="empty-state"><IconNotebook size={36} /><h2>还没有运行记录</h2><p>先在教学任务中发起一次只读扫描前核验。</p></section> : <section className="run-records" aria-label="运行记录列表">{records.map((record) => <article className="run-record" key={record.id}><div><p>{record.createdAt}</p><h2>{record.taskName}</h2><span>{record.courseName} · {record.classNames.join("、")}</span>{record.detail && <p className="run-record-detail">原因：{record.detail}</p>}</div><strong className="record-state">{record.state}</strong></article>)}</section>}</>; }
function SettingsPage({ activeCourse, demoMode, onConfigured, onToggleDemoMode }) {
  const [profiles, setProfiles] = useState([]);
  const [draft, setDraft] = useState(undefined);
  const [message, setMessage] = useState("正在检查本机课程连接配置…");
  const makeDraft = (profile) => ({
    courseKey: activeCourse.key,
    courseName: activeCourse.name,
    courseId: profile?.courseId ?? "",
    cpi: profile?.cpi ?? "",
    classNames: profile?.classNames?.join("、") ?? activeCourse.classNames.join("、"),
    entryPoint: profile?.entryPoints?.assignment ?? "教师端普通作业列表",
  });
  async function loadProfiles() {
    try {
      const response = await fetch("http://127.0.0.1:4174/api/course-profiles");
      const result = await response.json();
      const currentProfiles = result.profiles ?? [];
      setProfiles(currentProfiles);
      setDraft(makeDraft(currentProfiles.find((item) => item.courseKey === activeCourse.key)));
      setMessage(result.reason ? `尚未配置：${result.reason}` : "本机连接配置已读取。保存后仍需在可见浏览器完成登录与页面核验。");
    } catch {
      setDraft(makeDraft());
      setMessage("本机任务网关未启动，当前无法读取或保存连接配置。");
    }
  }
  useEffect(() => { if (demoMode) { setDraft(undefined); setMessage("演示模式不会读取或展示真实课程连接配置。"); return; } loadProfiles(); }, [activeCourse.key, demoMode]);
  async function saveProfile(event) {
    event.preventDefault();
    const classNames = draft.classNames.split(/[、,，\n]/).map((item) => item.trim()).filter(Boolean);
    const nextProfile = { courseKey: activeCourse.key, courseName: activeCourse.name, courseId: draft.courseId.trim(), cpi: draft.cpi.trim(), classNames, enabledModules: availableModules(activeCourse), entryPoints: { assignment: draft.entryPoint.trim() } };
    const nextProfiles = profiles.some((item) => item.courseKey === activeCourse.key) ? profiles.map((item) => item.courseKey === activeCourse.key ? nextProfile : item) : [...profiles, nextProfile];
    try {
      const response = await fetch("http://127.0.0.1:4174/api/course-profiles", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ profiles: nextProfiles }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "本机配置未保存。");
      setProfiles(result.profiles);
      setMessage("本机连接配置已保存。下一步请在可见浏览器登录并完成页面核验。");
      onConfigured();
    } catch (error) {
      setMessage(`未保存：${error.message}`);
    }
  }
  return <><header className="page-header"><div><p className="eyebrow">本地安全设置</p><h1>系统设置</h1><p>在本机维护课程连接参数；账号、密码、Cookie 和学生信息不在此处保存。</p></div></header><section className="demo-mode-card"><div><p className="eyebrow">简历与面试展示</p><h2>脱敏演示模式</h2><p>{demoMode ? "已启用：任务会使用模拟课程与脱敏结果，不连接学习通。" : "未启用：真实课程仍默认只读，需要本轮门禁后才能采集。"}</p></div><button className={demoMode ? "secondary-button" : "primary-button"} onClick={onToggleDemoMode} type="button">{demoMode ? "退出演示模式" : "开启演示模式"}</button></section>{demoMode ? <section className="empty-state demo-safe-state"><IconShieldCheck size={36} /><h2>真实连接配置已隐藏</h2><p>演示模式只展示模拟课程、班级和任务结果，不读取、不保存真实课程连接参数。</p></section> : <section className="connection-panel"><div className="connection-panel-heading"><IconShieldCheck size={24} /><div><h2>{activeCourse.name} · 本机课程连接</h2><p>{message}</p></div></div>{draft && <form className="connection-form" onSubmit={saveProfile}><label>课程 ID<input inputMode="numeric" onChange={(event) => setDraft({ ...draft, courseId: event.target.value })} placeholder="仅填写数字" value={draft.courseId} /></label><label>CPI<input inputMode="numeric" onChange={(event) => setDraft({ ...draft, cpi: event.target.value })} placeholder="仅填写数字" value={draft.cpi} /></label><label className="form-wide">班级白名单<input onChange={(event) => setDraft({ ...draft, classNames: event.target.value })} placeholder="多个班级请用顿号或逗号分隔" value={draft.classNames} /></label><label className="form-wide">作业页面入口说明<input onChange={(event) => setDraft({ ...draft, entryPoint: event.target.value })} value={draft.entryPoint} /></label><div className="connection-actions"><span>保存后只代表参数格式有效，不能替代本轮登录和页面核验。</span><button className="primary-button" type="submit">保存本机连接配置</button></div></form>}</section>}</>; }

export function App() {
  const [courses, setCourses] = useState(loadCourses);
  const [activeCourseKey, setActiveCourseKey] = useState(courses[0]?.key ?? "");
  const [courseOpen, setCourseOpen] = useState(true);
  const [activeNav, setActiveNav] = useState("教学任务");
  const [editorCourse, setEditorCourse] = useState(undefined);
  const [editorOpen, setEditorOpen] = useState(false);
  const [preflight, setPreflight] = useState(undefined);
  const [runRecords, setRunRecords] = useState(() => loadRunRecords(window.localStorage));
  const [demoMode, setDemoMode] = useState(() => window.localStorage.getItem(DEMO_MODE_STORE_KEY) === "true");
  const [demoResult, setDemoResult] = useState(undefined);
  const [walkthroughOpen, setWalkthroughOpen] = useState(false);
  const [demoWritePlan, setDemoWritePlan] = useState(undefined);
  const [notice, setNotice] = useState({ title: "今天先做什么？", body: "选择一个教学任务开始。系统会先说明要处理的范围，再执行操作。", type: "idle" });
  const [question, setQuestion] = useState("");
  const [aiReply, setAiReply] = useState("告诉我您想做什么，我会先说明操作步骤和影响，再请您确认后执行。");
  const activeCourse = useMemo(() => courses.find((course) => course.key === activeCourseKey) ?? courses[0], [activeCourseKey, courses]);
  const displayCourse = useMemo(() => demoMode ? demoCourseFor(activeCourse) : activeCourse, [activeCourse, demoMode]);
  const currentCourseText = useMemo(() => `${displayCourse.name} · ${displayCourse.classNames.join("、")}`, [displayCourse]);
  useEffect(() => { window.localStorage.setItem(COURSE_STORE_KEY, JSON.stringify(courses)); }, [courses]);
  useEffect(() => {
    if (demoMode) return undefined;
    let active = true;
    fetch("http://127.0.0.1:4174/api/course-profiles")
      .then((response) => response.json())
      .then((result) => { if (active && Array.isArray(result.profiles) && result.profiles.length) setCourses((current) => mergeCourseProfiles(current, result.profiles)); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [demoMode]);
  useEffect(() => { window.localStorage.setItem(RUN_RECORD_STORE_KEY, JSON.stringify(runRecords)); }, [runRecords]);
  useEffect(() => { window.localStorage.setItem(DEMO_MODE_STORE_KEY, String(demoMode)); }, [demoMode]);
  function chooseCourse(course) { setActiveCourseKey(course.key); setActiveNav("教学任务"); }
  function handleTask(task) {
    if (demoMode) { launchDemoTask(task.key); return; }
    if (task.key === "scan") {
      setPreflight(buildAssignmentPreflight(activeCourse));
      return;
    }
    setNotice({ title: task.label, body: demoResults[task.key], type: task.primary ? "success" : "info" });
    setAiReply(`已为“${task.label}”整理好下一步：${task.detail}。${task.key === "grade" || task.key === "deadline" ? "这项操作涉及写入，我会在执行前请您确认。" : "这项操作只查看信息，不会修改平台数据。"}`);
  }
  function askAssistant() {
    const input = question.trim();
    if (!input) return;
    const intent = resolveAssistantIntent(input);
    setQuestion("");
    setAiReply(intent.reply);
    if (intent.navigateTo) {
      setActiveNav(intent.navigateTo);
      setNotice({ title: intent.taskLabel, body: `已根据您的描述打开${intent.taskLabel}。`, type: "info" });
      return;
    }
    if (intent.key === "scan") {
      if (demoMode) { launchDemoTask(intent.key); return; }
      setPreflight(buildAssignmentPreflight(activeCourse));
      setNotice({ title: intent.taskLabel, body: `已为“${activeCourse.name}”准备只读扫描前核验。`, type: "info" });
      return;
    }
    if (intent.write) {
      setNotice({ title: intent.taskLabel, body: `${intent.reply}当前不会执行写入。`, type: "info" });
      return;
    }
    if (intent.key !== "unknown") setNotice({ title: intent.taskLabel, body: `${intent.reply}当前不会修改平台数据。`, type: "info" });
  }
  function showDemoResult(result) {
    setDemoResult(result);
    setRunRecords((current) => prependRunRecord(current, createDemoRunRecord(result)));
    setNotice({ title: `${result.taskName} · 演示完成`, body: `${result.state}：${result.summary}`, type: "success" });
    setAiReply(`已完成“${result.taskName}”的脱敏演示。结果为“${result.state}”，没有连接学习通或处理任何真实学生数据。`);
  }
  function launchDemoTask(taskKey) {
    if (taskKey === "grade" || taskKey === "deadline") {
      setDemoWritePlan(createDemoWritePlan(taskKey, displayCourse));
      return;
    }
    showDemoResult(createDemoReadResult(taskKey, displayCourse));
  }
  function completeDemoWrite() {
    const result = createDemoWriteResult(demoWritePlan);
    setDemoWritePlan(undefined);
    showDemoResult(result);
  }
  function exportDemoReport() {
    const records = runRecords.filter((record) => record.id.startsWith("demo-"));
    downloadArtifact("学习通教学运营自动化系统-脱敏运行报告.md", buildDemoReport(records), "text/markdown;charset=utf-8");
  }
  function toggleDemoMode() {
    const nextMode = !demoMode;
    setDemoMode(nextMode);
    if (nextMode) {
      setPreflight(undefined); setEditorOpen(false); setDemoResult(undefined); setDemoWritePlan(undefined);
      setNotice({ title: "脱敏演示模式已开启", body: "当前仅显示模拟课程与脱敏结果，不连接学习通。", type: "success" });
      setAiReply("演示模式已开启。您可以点击“扫描待批作业”，或直接说“扫描待批作业”体验脱敏的只读前核验流程。");
    } else {
      setNotice({ title: "已退出演示模式", body: "已恢复本机课程视图。真实任务仍默认只读，需先完成本轮门禁。", type: "info" });
      setAiReply("已恢复本机课程视图。真实任务会先确认课程、班级、登录和页面入口。" );
    }
  }
  function saveCourse(course) {
    setCourses((current) => current.some((item) => item.key === course.key) ? current.map((item) => item.key === course.key ? course : item) : [...current, course]);
    setActiveCourseKey(course.key); setEditorOpen(false); setNotice({ title: "课程已保存", body: `“${course.name}”的班级范围与可用教学任务已保存到本机。`, type: "success" });
  }
  function prepareVerification(course) {
    setActiveCourseKey(course.key); setActiveNav("教学任务");
    setNotice({ title: "准备连接核验", body: `请先在可见浏览器中登录并进入“${course.name}”教师端。系统随后将只读确认课程、班级和页面入口。`, type: "info" });
    setAiReply(`“${course.name}”尚未完成连接核验。下一步只会确认课程范围、班级白名单和页面入口，不会读取学生详情或修改平台数据。`);
  }
  async function recordPreflight() {
    let state = preflight.state;
    let detail = "";
    try {
      const response = await fetch("http://127.0.0.1:4174/api/tasks/assignment-preflight", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ courseKey: activeCourse.key }),
      });
      const result = await response.json();
      state = Object.keys(acquisitionStates).find((key) => acquisitionStates[key].label === result.state) ?? "pending";
      detail = result.reason ?? "本机任务网关未返回状态原因。";
    } catch {
      state = "pending";
      detail = "本机任务网关未启动，尚未检查课程连接配置。";
    }
    const record = buildRunRecord(preflight, { state, detail });
    setRunRecords((current) => prependRunRecord(current, record));
    setNotice({ title: "扫描前核验已记录", body: `“${preflight.courseName}”当前状态为“${record.state}”。${detail}`, type: "info" });
    setAiReply(`已记录“${preflight.taskName}”的范围。当前没有读取到任何平台数据，因此不会显示“无待批作业”。${record.state === "需人工登录" ? "请先在可见浏览器中完成教师端登录。" : "请先检查本机课程连接配置和任务网关。"}`);
    setPreflight(undefined);
  }
  function renderWorkspace() {
    if (demoMode && walkthroughOpen && activeNav === "教学任务") return <DemoWalkthrough onExit={() => setWalkthroughOpen(false)} />;
    if (activeNav === "课程管理") return demoMode ? <section className="empty-state demo-safe-state"><IconShieldCheck size={36} /><h2>演示课程已脱敏</h2><p>演示模式不展示或编辑真实课程档案。请从教学任务体验模拟课程、AI 对话和风险确认流程。</p></section> : <CourseManagement activeCourse={activeCourse} courses={courses} onEdit={(course) => { setEditorCourse(course); setEditorOpen(true); }} onNew={() => { setEditorCourse(undefined); setEditorOpen(true); }} onSelect={chooseCourse} onVerify={prepareVerification} />;
    if (activeNav === "运行记录") return <RunRecords records={demoMode ? runRecords.filter((record) => record.id.startsWith("demo-")) : runRecords} />;
    if (activeNav === "系统设置") return <SettingsPage activeCourse={activeCourse} demoMode={demoMode} onConfigured={() => setCourses((current) => current.map((course) => course.key === activeCourse.key ? { ...course, connection: "已配置，待核验" } : course))} onToggleDemoMode={toggleDemoMode} />;
    return <><header className="page-header"><div><p className="eyebrow">当前课程：{currentCourseText}</p><h1>教学任务</h1><p>快速处理日常教学任务，把更多时间留给学生。</p></div><button className="course-pill" onClick={() => setCourseOpen(true)} type="button"><IconBook2 size={21} /><span>{currentCourseText}</span><IconChevronDown size={19} /></button></header>
      <section className="task-grid" aria-label="教学任务">{taskGroups.filter((group) => taskEnabled(activeCourse, group.key)).map((group) => { const Icon = group.icon; return <article className={`task-column ${group.tone}`} key={group.key}><header className="task-column-header"><span className="task-icon"><Icon size={31} stroke={1.85} /></span><div><h2>{group.title}</h2><p>{group.subtitle}</p></div></header><div className="task-actions">{group.actions.map((action) => <TaskButton action={action} key={action[2]} onClick={handleTask} tone={group.tone} />)}</div></article>; })}</section>
      {demoMode && <section className="demo-mode-card"><div><h2>脱敏功能演示：扫描、改期与评价辅助</h2><p>按完整流程检查结果、核对目标，并由教师修订预设评价建议。</p></div><button className="primary-button" type="button" onClick={() => setWalkthroughOpen(true)}>开始完整功能演示（模拟）</button><button className="secondary-button" type="button" onClick={() => launchDemoTask("deadline")}>查看改期预览（模拟）</button></section>}
      <section className={`task-feedback ${notice.type}`} aria-live="polite">{notice.type === "success" ? <IconShieldCheck size={23} /> : notice.type === "info" ? <IconSparkles size={23} /> : <IconNotebook size={23} />}<div><strong>{notice.title}</strong><p>{notice.body}</p></div></section>
      <section className="ai-panel" aria-label="AI 助手"><img alt="AI 助手头像" className="assistant-avatar" src="/assets/ai-assistant-avatar.png" /><div className="ai-copy"><div className="ai-heading"><IconMessageCircle2 size={22} /><h2>AI 助手</h2></div><p>{aiReply}</p></div><div className="ai-composer"><input aria-label="向 AI 助手提问" onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => event.key === "Enter" && askAssistant()} placeholder="例如：如何批改作业？" value={question} /><button aria-label="提交问题" onClick={askAssistant} type="button"><IconSend size={19} /></button></div><div className="confirmation-note"><IconAlertTriangle size={20} />写入操作将先请您确认</div></section>
    </>;
  }
  return <main className="app-shell"><aside className="sidebar"><div className="brand"><span className="brand-dot" aria-hidden="true" /><div><strong>教学运营</strong><span>{demoMode ? "脱敏演示模式" : "本地模式"}</span></div></div><nav aria-label="主导航" className="main-nav">{primaryNav.map(([Icon, label]) => <button className={`nav-item ${activeNav === label ? "is-active" : ""}`} key={label} onClick={() => setActiveNav(label)} type="button"><Icon size={21} stroke={1.9} /><span>{label}</span></button>)}</nav><section className="course-switcher" aria-label="课程切换"><button className="section-title" onClick={() => setCourseOpen(!courseOpen)} type="button"><span>课程切换</span>{courseOpen ? <IconChevronUp size={18} /> : <IconChevronDown size={18} />}</button>{courseOpen && <div className="course-list">{courses.map((course) => { const shownCourse = demoMode ? demoCourseFor(course) : course; return <button className={`course-item ${activeCourse.key === course.key ? "is-selected" : ""}`} key={course.key} onClick={() => chooseCourse(course)} type="button"><IconSchool size={20} stroke={1.9} /><span><strong>{shownCourse.name}</strong><small>{shownCourse.classNames.join("、")}</small></span></button>; })}</div>}</section><div className="local-status"><span className="status-dot" aria-hidden="true" /><span>{demoMode ? "演示数据 · 未连接平台" : "本地存储 · 已连接"}</span></div></aside><section className="workspace">{renderWorkspace()}</section>{editorOpen && <CourseEditor course={editorCourse} onClose={() => setEditorOpen(false)} onSave={saveCourse} />}{preflight && <TaskPreflight onClose={() => setPreflight(undefined)} onRecord={recordPreflight} preflight={preflight} />}{demoResult && <DemoResultModal onClose={() => setDemoResult(undefined)} onExportArchitecture={() => downloadArtifact("学习通教学运营自动化系统-架构图.svg", buildArchitectureSvg(), "image/svg+xml") } onExportReport={exportDemoReport} result={demoResult} />}{demoWritePlan && <DemoWritePreview onClose={() => setDemoWritePlan(undefined)} onConfirm={completeDemoWrite} plan={demoWritePlan} />}</main>;
}
