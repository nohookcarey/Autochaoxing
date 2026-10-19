import { useState } from "react";
import { SAMPLE_TEXT, scanDemo, previewDeadline, suggestionDemo, saveTeacherDraft } from "./demo-workflow-core";
import "./demo-walkthrough.css";
import { buildBlueprint } from "./agent-blueprint";

export default function DemoWalkthrough({ onExit }) {
 const [tab, setTab] = useState("扫描任务");
 const [scope, setScope] = useState("演示班 A");
 const [scenario, setScenario] = useState("normal");
 const [scan, setScan] = useState();
 const [title, setTitle] = useState("提示词练习");
 const [date, setDate] = useState("2026-09-20 23:59");
 const [times, setTimes] = useState({"演示班 A":"2026-09-18 23:59","演示班 B":"2026-09-18 23:59"});
 const [preview, setPreview] = useState();
 const [confirmed, setConfirmed] = useState(false);
 const [readback, setReadback] = useState();
 const [rubric, setRubric] = useState("任务明确4分；背景具体3分；格式要求3分。总分10分。");
 const [suggestion, setSuggestion] = useState();
 const [score, setScore] = useState("7");
 const [comment, setComment] = useState("");
 const [draft, setDraft] = useState();
 const [records, setRecords] = useState([]);
 const [goal, setGoal] = useState("AIGC实践：为高职新生制作一页学习清单，提交提示词、成果和核验记录。");
 const [blueprint, setBlueprint] = useState();
 const addRecord = (task, state, detail) => setRecords(r => [{task, state, detail}, ...r].slice(0,20));
 const guides = {
  "核心搭建": ["先明确教学任务，再确定评价标准。", "已有模型接口不等于本次真实调用。", "方案预览不连接平台，不保存密钥。"],
  "扫描任务": ["先确定课程与班级，再读取待批。", "未获取 ≠ 没有待批。", "用三种测试情形检查状态是否准确。"],
  "作业改期": ["精确标题匹配失败时不继续。", "先看新旧时间，不对就取消。", "教师确认后核对结果，其他班级不变。"],
  "评价辅助": ["预设建议用于演示，不调用模型。", "看评分依据，再对照模拟作业。", "教师修改分数与反馈，只存本地草稿。"],
  "任务记录": ["回看范围、状态与教师修订。", "记录是模拟流程，不是平台成效。", "真实使用需重新核验来源与权限。"]
 };
 return <section className="walkthrough">
  <header className="walk-header"><div><small>教学运营助手 · 本地功能演示</small><h1>机器协助，教师决定</h1></div><button onClick={onExit}>返回工作台</button></header>
  <div className="walk-warning">模拟数据 · 不连接学习通 · 评价建议为预设示例，未调用模型</div>
  <nav className="walk-tabs" aria-label="演示任务">{Object.keys(guides).map(t=><button key={t} aria-pressed={tab===t} onClick={()=>setTab(t)}>{t}</button>)}</nav>
  <div className="walk-columns"><article className="walk-main">
   {!["任务记录", "核心搭建"].includes(tab) && <div className="walk-scope"><strong>课程：教学运营演示课程01</strong><label>处理班级<select aria-label="处理班级" value={scope} onChange={e=>{setScope(e.target.value);setScan();setPreview();setReadback();setConfirmed(false);}}><option>演示班 A</option><option>演示班 B</option></select></label></div>}
   {tab==="核心搭建" && <>
    <h2>从教学任务搭建评价辅助流程</h2>
    <p>已有实现：扩展的模型接口、评分卡、教师修订和受控回填。本页仅预览方案，不执行真实调用。</p>
    <label>本课实践任务<textarea aria-label="本课实践任务" value={goal} onChange={e=>{setGoal(e.target.value);setBlueprint();}}/></label>
    <label>搭建评分依据<textarea aria-label="搭建评分依据" value={rubric} onChange={e=>{setRubric(e.target.value);setBlueprint();setSuggestion();setDraft();}}/></label>
    <button className="walk-primary" onClick={()=>setBlueprint(buildBlueprint({goal,rubric}))}>生成搭建方案预览</button>
    {blueprint && <section className="walk-result"><h3>{blueprint.valid?"任务流与关键提示词":"方案未生成"}</h3>{blueprint.valid?<><p>{blueprint.goal}</p><p>评分依据：{blueprint.rubric}</p><ol>{blueprint.steps.map(s=><li key={s}>{s}</li>)}</ol><h3>关键提示词设计摘要</h3><p>{blueprint.prompt}</p><p>{blueprint.boundary}</p></>:<p>{blueprint.reason}</p>}</section>}
    <section className="walk-sample"><strong>真实录制应展示什么？</strong><p>在扩展“AI批改设置”展示模型名（隐藏密钥），选择并修订AIGC实践评分口径；在授权样例中录制模型真实返回、评分依据与教师修订。不要把本页预览当成真实调用。</p><p>当前未证明独立检索知识库；题目、参考答案、评分卡是本流程的上下文依据，不包装为已建成RAG知识库。</p></section>
   </>}
   {tab==="扫描任务" && <>
    <h2>只读扫描：先分清结果状态</h2><label>测试情形<select aria-label="测试情形" value={scenario} onChange={e=>{setScenario(e.target.value);setScan();}}><option value="normal">正常获取待批</option><option value="missing">列表页未加载完整</option><option value="empty">范围内确实无待批</option></select></label>
    <button className="walk-primary" onClick={()=>{const r=scanDemo(scope,scenario);setScan(r);addRecord("只读扫描",r.state,scope+"；"+r.reason);}}>扫描模拟任务</button>
    {scan && <section className={scan.state==="未获取"?"walk-result warning":"walk-result"}><h3>{scan.state}</h3><p>{scan.reason}</p>{scan.rows.map((r,i)=><div className="walk-row" key={i}>{r.map((s,j)=><span key={j}>{s}</span>)}</div>)}</section>}
   </>}
   {tab==="作业改期" && <>
    <h2>只调整指定班级的一项作业</h2><div className="walk-fields"><label>精确作业标题<input aria-label="精确作业标题" value={title} onChange={e=>{setTitle(e.target.value);setPreview();setConfirmed(false);setReadback();}} /></label><label>新的截止时间<input aria-label="新的截止时间" value={date} onChange={e=>{setDate(e.target.value);setPreview();setConfirmed(false);setReadback();}} /></label></div>
    <button className="walk-primary" onClick={()=>{setPreview(previewDeadline(scope,title,date,times[scope]));setConfirmed(false);setReadback();}}>生成修改预览</button>
    {preview && !preview.valid && <div className="walk-result warning"><h3>未执行修改</h3><p>{preview.reason}</p></div>}
    {preview?.valid && <section className="walk-result"><h3>修改预览 · 尚未执行</h3><p>{preview.scope} · {preview.title}</p><p className="walk-big">{preview.original} → {preview.target}</p><p>{preview.untouched}不在本次范围。</p><label className="walk-check"><input type="checkbox" aria-label="确认模拟修改范围" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>我已核对班级、标题和新旧时间</label><div className="walk-buttons"><button onClick={()=>{setPreview();setConfirmed(false);addRecord("作业改期","已取消",scope+"；未修改模拟作业");}}>取消本次修改</button><button className="walk-primary" disabled={!confirmed} onClick={()=>{if(!confirmed)return;const next={...times,[preview.scope]:preview.target};setTimes(next);setReadback({actual:next[preview.scope],other:next[preview.untouched],scope:preview.scope,untouched:preview.untouched});setPreview();setConfirmed(false);addRecord("作业改期","模拟结果一致",preview.scope+"；"+preview.target+"；"+preview.untouched+"不变");}}>确认模拟修改并核对</button></div></section>}
    {readback && <section className="walk-result"><h3>模拟结果核对：与目标一致</h3><p className="walk-big">{readback.scope}：{readback.actual}</p><p>{readback.untouched}：{readback.other}（保持不变）</p><p>读取的是本地模拟状态，不是学习通页面。</p></section>}
   </>}
   {tab==="评价辅助" && <>
    <h2>评价辅助：建议有依据，教师可修订</h2><div className="walk-sample"><strong>模拟作业原文</strong><p>{SAMPLE_TEXT}</p></div><label>评分依据<textarea aria-label="评分依据" value={rubric} onChange={e=>{setRubric(e.target.value);setSuggestion();setDraft();}} /></label>
    <button className="walk-primary" disabled={!rubric.trim()} onClick={()=>{const r=suggestionDemo();setSuggestion(r);setScore(String(r.score));setComment(r.comment);setDraft();}}>展示预设评价建议（非模型调用）</button>
    {suggestion && <section className="walk-result"><h3>预设建议：{suggestion.score} / 10分 · 仅示意</h3>{suggestion.rows.map((r,i)=><div className="walk-row" key={i}>{r.map((s,j)=><span key={j}>{s}</span>)}</div>)}<p>{suggestion.comment}</p></section>}
    {suggestion && <section className="walk-teacher"><h3>教师复核与修订</h3><p>原文已写“面向高职新生”，背景项需重新检查。</p><div className="walk-fields"><label>教师评分<input aria-label="教师评分" value={score} onChange={e=>{setScore(e.target.value);setDraft();}}/></label><label>教师反馈<textarea aria-label="教师反馈" value={comment} onChange={e=>{setComment(e.target.value);setDraft();}}/></label></div><button className="walk-primary" onClick={()=>{const r=saveTeacherDraft(score,comment);setDraft(r);if(r.valid)addRecord("评价辅助",r.state,"预设7分 → 教师"+r.score+"分；仅本地模拟草稿");}}>保存本地模拟草稿</button>{draft && <p className="walk-save">{draft.valid?draft.state:draft.reason}</p>}</section>}
   </>}
   {tab==="任务记录" && <><h2>本轮模拟任务记录</h2>{records.length===0?<p>暂无本轮记录。</p>:records.map((r,i)=><section className="walk-record" key={i}><h3>{r.task} · {r.state}</h3><p>{r.detail}</p></section>)}</>}
  </article><aside className="walk-guide"><h2>观察重点</h2>{guides[tab].map((s,i)=><p key={s}><strong>{i+1}</strong>{s}</p>)}<div>核心观点<br/><b>少做重复定位<br/>多做关键判断</b></div></aside></div>
 </section>;
}
