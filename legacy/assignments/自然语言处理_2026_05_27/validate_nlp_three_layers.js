const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = __dirname;
const { COMMON, ASSIGNMENTS } = require(path.join(ROOT, "nlp_2026_05_27_used_params.js"));
const AUDIT_FILE = fs.existsSync(path.join(ROOT, "audit_assignment_reviews.js"))
  ? "audit_assignment_reviews.js"
  : "regrade_screenshot_submissions.js";

const COVERAGE_MATRIX = {
  "grade_pending_nlp_2026_05_27.js": ASSIGNMENTS.map((item) => String(item.workListId)),
  [AUDIT_FILE]: ASSIGNMENTS
    .filter((item) => ["关键词提取计算作业", "任务一"].includes(item.name))
    .map((item) => String(item.workListId)),
  "regrade_screenshot_submissions.js": ASSIGNMENTS
    .filter((item) => ["关键词提取计算作业", "任务一"].includes(item.name))
    .map((item) => String(item.workListId)),
};

function read(fileName) {
  const filePath = path.join(ROOT, fileName);
  const metadata = execFileSync("ls", ["-lO", filePath], { encoding: "utf8" });
  if (metadata.includes("dataless")) {
    throw new Error(`${fileName} 是 dataless 文件，请先恢复为本地真实文件`);
  }
  return fs.readFileSync(filePath, "utf8");
}

function unique(values) {
  return [...new Set(values)];
}

function validateCatalogLayer() {
  const errors = [];
  const warnings = [];

  if (!COMMON.courseName) errors.push("COMMON.courseName 不能为空");
  if (!Array.isArray(COMMON.targetClasses) || COMMON.targetClasses.length === 0) {
    errors.push("COMMON.targetClasses 必须是非空数组");
  }
  if (!Array.isArray(ASSIGNMENTS) || ASSIGNMENTS.length === 0) {
    errors.push("ASSIGNMENTS 必须是非空数组");
  }

  const courseIds = unique(ASSIGNMENTS.map((item) => item.courseId));
  const cpis = unique(ASSIGNMENTS.map((item) => item.cpi));
  if (courseIds.length !== 1) errors.push(`courseId 不一致: ${courseIds.join(", ")}`);
  if (cpis.length !== 1) errors.push(`cpi 不一致: ${cpis.join(", ")}`);

  const keySet = new Set();
  for (const item of ASSIGNMENTS) {
    for (const field of [
      "name",
      "className",
      "classId",
      "workListId",
      "workId",
      "courseId",
      "cpi",
      "scoreType",
      "score",
      "action",
    ]) {
      if (item[field] === "" || item[field] === undefined || item[field] === null) {
        errors.push(`${item.className}/${item.name} 缺少字段 ${field}`);
      }
    }

    const hasComment = !(item.comment === "" || item.comment === undefined || item.comment === null);
    const noCommentByDesign = typeof item.scoringRuleNote === "string" && item.scoringRuleNote.includes("不写评语");
    if (!hasComment && !noCommentByDesign) {
      errors.push(`${item.className}/${item.name} 缺少字段 comment`);
    }

    if (!Number.isFinite(Number(item.score))) {
      errors.push(`${item.className}/${item.name} score 不是数字`);
    }
    if (!/^\d+$/.test(String(item.classId))) {
      errors.push(`${item.className}/${item.name} classId 非纯数字`);
    }
    if (!/^\d+$/.test(String(item.workListId))) {
      errors.push(`${item.className}/${item.name} workListId 非纯数字`);
    }
    if (!/^\d+$/.test(String(item.workId))) {
      errors.push(`${item.className}/${item.name} workId 非纯数字`);
    }

    const key = `${item.className}::${item.name}::${item.workListId}`;
    if (keySet.has(key)) {
      errors.push(`存在重复配置 ${key}`);
    }
    keySet.add(key);

    if (!COMMON.targetClasses.some((clazz) => item.className.includes(clazz))) {
      warnings.push(`${item.className}/${item.name} 不在 COMMON.targetClasses 显式范围内`);
    }
  }

  return {
    layer: "catalog",
    ok: errors.length === 0,
    errors,
    warnings,
    summary: {
      assignmentCount: ASSIGNMENTS.length,
      courseIds,
      cpis,
    },
  };
}

function validateCoverageLayer() {
  const errors = [];
  const warnings = [];
  const workListIds = ASSIGNMENTS.map((item) => String(item.workListId));
  const titles = unique(ASSIGNMENTS.map((item) => item.name));

  for (const [fileName, expectedIds] of Object.entries(COVERAGE_MATRIX)) {
    const content = read(fileName);
    for (const workListId of expectedIds) {
      if (!content.includes(workListId)) {
        errors.push(`${fileName} 未覆盖 workListId=${workListId}`);
      }
    }
    const expectedTitles = unique(
      ASSIGNMENTS.filter((item) => expectedIds.includes(String(item.workListId))).map((item) => item.name)
    );
    for (const title of expectedTitles) {
      if (!content.includes(title)) {
        warnings.push(`${fileName} 未直接出现作业名 ${title}`);
      }
    }
  }

  const unknownIdPattern = /workListId["']?\s*[:=]\s*["'](\d+)["']/g;
  const knownIds = new Set(workListIds);
  for (const [fileName, expectedIds] of Object.entries(COVERAGE_MATRIX)) {
    const found = [];
    const content = read(fileName);
    unknownIdPattern.lastIndex = 0;
    let match = unknownIdPattern.exec(content);
    while (match) {
      found.push(match[1]);
      match = unknownIdPattern.exec(content);
    }
    for (const id of unique(found)) {
      if (!knownIds.has(id)) {
        warnings.push(`${fileName} 含未在参数文件登记的 workListId=${id}`);
      } else if (!expectedIds.includes(id)) {
        warnings.push(`${fileName} 含超出当前职责范围的 workListId=${id}`);
      }
    }
  }

  return {
    layer: "coverage",
    ok: errors.length === 0,
    errors,
    warnings,
    summary: {
      coverageFiles: Object.keys(COVERAGE_MATRIX),
      trackedWorkListIds: workListIds,
    },
  };
}

function validateSafeguardLayer() {
  const errors = [];
  const warnings = [];
  const gradeScript = read("grade_pending_nlp_2026_05_27.js");
  const auditScript = read(AUDIT_FILE);
  const regradeScript = read("regrade_screenshot_submissions.js");
  const discoverScript = read("discover_nlp_assignments.js");

  if (!gradeScript.includes("img.ans-ued-img") && !regradeScript.includes("img.ans-ued-img")) {
    errors.push("缺少截图型作答识别逻辑");
  }
  if (!regradeScript.includes("总分为0,确认要提交批阅结果吗？")) {
    errors.push("缺少 0 分二次确认处理逻辑");
  }
  if (!auditScript.includes("score <= 75")) {
    errors.push("缺少低分复核入口");
  }
  if (
    !auditScript.includes("未交|数据错误|异常") &&
    !auditScript.includes("!detail.answerText && detail.imageCount === 0") &&
    !read("nlp_2026_05_27_used_params.js").includes("文件异常或无效")
  ) {
    errors.push("缺少异常状态复核条件");
  }
  if (!discoverScript.includes("待批")) {
    errors.push("缺少待批清零验收逻辑");
  }
  if (!gradeScript.includes("scoreKeyword") || !gradeScript.includes("scoreTask1") || !gradeScript.includes("scoreBioReview")) {
    errors.push("缺少按题型分支评分逻辑");
  }
  if (!gradeScript.includes("expectedClassName") || !gradeScript.includes("expectedTitleIncludes")) {
    warnings.push("主批改脚本缺少足够明确的班级/作业名保护");
  }

  return {
    layer: "safeguard",
    ok: errors.length === 0,
    errors,
    warnings,
    summary: {
      checkedFiles: [
        "grade_pending_nlp_2026_05_27.js",
        AUDIT_FILE,
        "regrade_screenshot_submissions.js",
        "discover_nlp_assignments.js",
      ],
    },
  };
}

const layers = [
  validateCatalogLayer(),
  validateCoverageLayer(),
  validateSafeguardLayer(),
];

const result = {
  ok: layers.every((layer) => layer.ok),
  courseName: COMMON.courseName,
  checkedAt: new Date().toISOString(),
  layers,
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) {
  process.exitCode = 1;
}
