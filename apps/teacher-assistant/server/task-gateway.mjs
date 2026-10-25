import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { CourseImportError, loadCourseImports } from "./course-imports.mjs";
import { CourseProfileError, loadCourseProfiles, saveCourseProfiles } from "./course-profiles.mjs";

const MAX_BODY_BYTES = 16 * 1024;

const ALLOWED_ORIGINS = new Set(["http://127.0.0.1:4173", "http://localhost:4173"]);

export function gatewayListenOptions(env = process.env) {
  const host = env.LOCAL_GATEWAY_HOST ?? "127.0.0.1";
  const port = Number(env.LOCAL_GATEWAY_PORT ?? 4174);
  if (host !== "127.0.0.1" || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("本机网关只能监听127.0.0.1和有效端口。");
  return { host, port };
}

function send(request, response, status, payload) {
  const origin = request.headers.origin;
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
    "access-control-allow-headers": "content-type,x-local-session",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "vary": "Origin",
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) headers["access-control-allow-origin"] = origin;
  response.writeHead(status, headers);
  response.end(JSON.stringify(payload));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let chunks = [], size = 0, failed = false;
    request.on("data", (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { failed = true; chunks = []; reject(new Error("请求内容过大")); }
      else chunks.push(chunk);
    });
    request.on("end", () => {
      if (failed) return;
      const body = Buffer.concat(chunks).toString("utf8");
      try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error("请求不是有效 JSON")); }
    });
    request.on("error", reject);
  });
}

export function createTaskGateway() {
  const token = randomBytes(32).toString("hex");
  const server = createServer(async (request, response) => {
    const port = server.address()?.port;
    if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(request.headers.host)) return send(request, response, 403, { error: "不受信任的本机主机。" });
    const origin = request.headers.origin;
    if (origin !== undefined && !ALLOWED_ORIGINS.has(origin)) return send(request, response, 403, { error: "不受信任的请求来源。" });
    const path = new URL(request.url, "http://127.0.0.1").pathname;
    if (request.method === "OPTIONS") {
      if (!ALLOWED_ORIGINS.has(origin) || !["GET", "POST", "PUT"].includes(request.headers["access-control-request-method"])) return send(request, response, 403, { error: "未授权的跨域请求。" });
      return send(request, response, 204, {});
    }
    if (request.method === "GET" && path === "/api/health") return send(request, response, 200, { status: "ok", scope: "local-only" });
    if (request.method === "GET" && path === "/api/session") {
      if (!ALLOWED_ORIGINS.has(origin)) return send(request, response, 403, { error: "请从本机工作台连接。" });
      return send(request, response, 200, { token });
    }
    const supplied = Buffer.from(String(request.headers["x-local-session"] || "")), expected = Buffer.from(token);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return send(request, response, 401, { error: "本机会话已失效，请重新连接。" });
    if (["PUT", "POST"].includes(request.method) && !/^application\/json(?:;|$)/i.test(request.headers["content-type"] || "")) return send(request, response, 415, { error: "只接受JSON请求。" });
    if (request.method === "GET" && path === "/api/course-profiles") {
      try { return send(request, response, 200, { profiles: loadCourseProfiles() }); }
      catch (error) { return send(request, response, 200, { profiles: [], reason: error instanceof CourseProfileError ? error.message : "无法读取本机课程连接配置。" }); }
    }
    if (request.method === "GET" && path === "/api/course-imports") {
      try { return send(request, response, 200, { imports: loadCourseImports() }); }
      catch (error) { return send(request, response, 200, { imports: [], reason: error instanceof CourseImportError ? error.message : "无法读取本机课程导入档案。" }); }
    }
    if (request.method === "PUT" && path === "/api/course-profiles") {
      try {
        const config = await readJson(request);
        const profiles = saveCourseProfiles(config);
        return send(request, response, 200, { profiles, message: "本机课程连接配置已保存。" });
      } catch (error) {
        const reason = error instanceof CourseProfileError ? error.message : "本机课程连接配置未保存。";
        return send(request, response, 409, { error: reason });
      }
    }
    if (request.method !== "POST" || path !== "/api/tasks/assignment-preflight") return send(request, response, 404, { error: "未开放的本机任务入口" });

    try {
      const { courseKey } = await readJson(request);
      if (!/^[a-z0-9-]+$/i.test(courseKey ?? "")) return send(request, response, 400, { state: "未获取", reason: "课程标识无效。" });
      const profile = loadCourseProfiles().find((item) => item.courseKey === courseKey);
      if (!profile) return send(request, response, 404, { state: "未获取", reason: "本机配置中没有当前课程。" });
      return send(request, response, 200, {
        task: "assignment-preflight",
        state: "需人工登录",
        reason: "课程配置有效。请教师在可见浏览器完成登录与安全验证；本地网关不会自行访问学习通。",
        scope: { courseKey: profile.courseKey, classNames: profile.classNames, entryPoint: profile.entryPoints.assignment },
      });
    } catch (error) {
      const reason = error instanceof CourseProfileError ? error.message : "本机任务网关无法读取请求。";
      return send(request, response, 409, { state: "未获取", reason });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}
