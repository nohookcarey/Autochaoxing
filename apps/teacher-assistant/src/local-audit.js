export const RUN_RECORD_STORE_KEY = "learningtong-teaching-operations-run-records-v1";
const MAX_RECORDS = 100;

function sanitizeText(value, limit) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, limit);
}

export function sanitizeRunRecord(record) {
  return {
    id: sanitizeText(record.id, 80),
    taskName: sanitizeText(record.taskName, 80),
    courseName: sanitizeText(record.courseName, 120),
    classNames: Array.isArray(record.classNames) ? record.classNames.map((name) => sanitizeText(name, 80)).filter(Boolean).slice(0, 20) : [],
    state: sanitizeText(record.state, 40),
    detail: sanitizeText(record.detail, 320),
    createdAt: sanitizeText(record.createdAt, 80),
  };
}

export function loadRunRecords(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(RUN_RECORD_STORE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.map(sanitizeRunRecord).filter((record) => record.id && record.taskName && record.state).slice(0, MAX_RECORDS) : [];
  } catch {
    return [];
  }
}

export function prependRunRecord(records, record) {
  return [sanitizeRunRecord(record), ...records].slice(0, MAX_RECORDS);
}
