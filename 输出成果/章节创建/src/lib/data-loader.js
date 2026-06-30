import fs from "node:fs/promises";

function ensureString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} 必须是非空字符串`);
  }

  return value.trim();
}

function ensureStringArray(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} 必须是非空数组`);
  }

  return value.map((item, index) => ensureString(item, `${label}[${index}]`));
}

function ensureStringMap(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`);
  }

  const entries = Object.entries(value);
  if (entries.length === 0) {
    throw new Error(`${label} 不能为空对象`);
  }

  return Object.fromEntries(
    entries.map(([key, item]) => [
      ensureString(key, `${label} 的键名`),
      ensureString(item, `${label}.${key}`)
    ])
  );
}

export async function loadChapterPlan(inputPath) {
  const raw = await fs.readFile(inputPath, "utf8");
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("章节输入必须是非空数组");
  }

  return parsed.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`第 ${index + 1} 条记录不是对象`);
    }

    return {
      sourceTitle: ensureString(item.sourceTitle, `第 ${index + 1} 条记录的 sourceTitle`),
      targetParentTitle: ensureString(item.targetParentTitle, `第 ${index + 1} 条记录的 targetParentTitle`),
      targetTitle: ensureString(item.targetTitle, `第 ${index + 1} 条记录的 targetTitle`),
      expectedCode: item.expectedCode ? ensureString(item.expectedCode, `第 ${index + 1} 条记录的 expectedCode`) : "",
      copyCards: item.copyCards !== false,
      tabs: item.tabs ? ensureStringArray(item.tabs, `第 ${index + 1} 条记录的 tabs`) : undefined,
      cardContents: item.cardContents
        ? ensureStringMap(item.cardContents, `第 ${index + 1} 条记录的 cardContents`)
        : undefined,
      placeholderTitles: item.placeholderTitles
        ? ensureStringArray(item.placeholderTitles, `第 ${index + 1} 条记录的 placeholderTitles`)
        : undefined
    };
  });
}
