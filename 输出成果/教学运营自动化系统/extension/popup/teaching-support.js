(() => {
  const rubrics = {
    nlp: '自然语言处理实践作业（100分）：任务与数据理解20分；方法选择与实现30分；实验与结果核验30分；可复现说明与反思20分。只根据题目、学生答案和可读取材料评分；未读取附件不推断附件内容。说明扣分依据，不虚构运行结果。题目自带评分标准时优先遵循题目标准。',
    aigc: 'AIGC应用实践作业（100分）：需求与提示词设计25分；成果与任务匹配30分；事实核验与迭代25分；版权、隐私与过程记录20分。只根据题目、学生答案和可读取材料评分；不能因使用AI直接扣分，不把文字流畅当作任务完成。未读取的图片或附件标为待教师核验。题目自带评分标准时优先遵循题目标准。',
  };
  function diagnose(payload) {
    const s = payload?.summary;
    if (payload?.acquisitionState !== '采集到' || !s) return { ok: false, reason: '请先读取当前班级成绩概览；未获取不能当作零人数。' };
    const counts = [s.studentCount, s.excellentCount, s.passCount, s.lowScoreCount];
    if (!counts.every(x => Number.isInteger(x) && x >= 0) || s.studentCount === 0 || s.excellentCount + s.passCount + s.lowScoreCount !== s.studentCount || !Number.isFinite(s.averageScore) || s.averageScore < 0 || s.averageScore > 100 || !s.activeClass) return { ok: false, reason: '成绩汇总人数或均分口径不完整，请重新读取并核对，不生成诊断。' };
    const rate = (s.lowScoreCount / s.studentCount * 100).toFixed(1);
    return { ok: true, facts: `${s.activeClass}：汇总${s.studentCount}人，平均${s.averageScore}分；低于60分${s.lowScoreCount}人（${rate}%），80分及以上${s.excellentCount}人。`, actions: [s.lowScoreCount ? '基础支持：由教师核对低分原因，安排一个分步骤实践任务，并以同一量规复核；不直接认定学生能力不足。' : '基础支持：当前汇总未显示低于60分人数；仍需结合具体作业核对掌握情况。', '巩固实践：围绕本课目标安排一个新情境任务，要求提交成果、操作过程与核验记录。', '拓展实践：提供更复杂的约束条件，要求解释方案选择及局限；不依据汇总自动分配学生。'], limits: '规则生成的教学建议，不是AI推断；综合成绩不能定位具体知识薄弱点，也不能证明教学效果提升。' };
  }
  function report({ diagnosis, courseName, demo, goal, implementation, observation, generatedAt }) {
    if (!diagnosis?.ok) throw new Error('缺少有效成绩汇总');
    const clean = x => String(x || '').replace(/[\r\n]+/g, ' ').slice(0, 1500);
    return [`# 教学支持与实施记录`, '', demo ? '> 模拟演示：以下成绩为模拟数据，不是实际教学成效。' : '> 本次页面采集汇总不是教学效果证明；实施与观察内容由教师填写，仍需独立证据核验。', '', `课程：${clean(courseName)}`, `生成时间：${clean(generatedAt)}`, '', '## 数据依据', diagnosis.facts, '', '## 本课目标（教师填写）', clean(goal) || '未填写', '', '## 教学建议（教师复核后采用）', ...diagnosis.actions.map(x => `- ${x}`), '', diagnosis.limits, '', '## 实施记录（教师填写，未经系统核验）', clean(implementation) || '未记录，不能声称已实施。', '', '## 效果观察（教师填写，未经系统核验）', clean(observation) || '未记录，不能声称有效。', '', '## 后续核验', '- 使用同一任务或等价任务、同一量规记录前后结果、人数与时间。', '- 保存脱敏成果样例；注明数据来源、缺失项与其他可能影响因素。', '- 只记录汇总，不填写学生姓名、学号或账号。'].join('\n');
  }
  globalThis.LearningTongTeachingSupport = Object.freeze({ rubrics, diagnose, report });
})();
