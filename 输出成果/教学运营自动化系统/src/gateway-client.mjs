const base = "http://127.0.0.1:4174";
const paths = new Set(["/api/course-profiles", "/api/course-imports", "/api/tasks/assignment-preflight"]);
let session;

async function sessionToken() {
  if (!session) session = (async () => {
    const response = await fetch(`${base}/api/session`, { cache: "no-store", credentials: "omit", redirect: "error" });
    if (!response.ok) throw new Error("本机工作台连接未授权。");
    const { token } = await response.json();
    if (!/^[a-f0-9]{64}$/.test(token || "")) throw new Error("本机会话无效。");
    return token;
  })().catch(error => { session = undefined; throw error; });
  return session;
}

export async function gatewayFetch(path, options = {}) {
  if (!paths.has(path)) throw new Error("未开放的本机入口。");
  for (let attempt = 0; attempt < 2; attempt++) {
    const headers = new Headers(options.headers);
    headers.set("x-local-session", await sessionToken());
    const response = await fetch(`${base}${path}`, { ...options, headers, cache: "no-store", credentials: "omit", redirect: "error" });
    // Authentication is checked before any operation; a restarted gateway has not applied this request.
    if (response.status !== 401 || attempt === 1) return response;
    session = undefined;
  }
}
