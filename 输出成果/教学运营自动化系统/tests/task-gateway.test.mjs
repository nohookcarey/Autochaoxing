import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import test from "node:test";
import { request } from "node:http";
import { createTaskGateway, gatewayListenOptions } from "../server/task-gateway.mjs";

async function startGateway() {
  const gateway = createTaskGateway();
  await new Promise((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  const { port } = gateway.address();
  const url = `http://127.0.0.1:${port}`;
  const origin = "http://127.0.0.1:4173";
  const { token } = await (await fetch(`${url}/api/session`, { headers: { origin } })).json();
  const api = (path, options = {}) => fetch(`${url}${path}`, { ...options, headers: { origin, "x-local-session": token, ...options.headers } });
  return { gateway, url, api };
}

test("gateway only exposes allowlisted tasks and controlled local course profiles", async () => {
  const previousPath = process.env.COURSE_CONFIG_PATH;
  const runtimePath = "tests/fixtures/runtime-course-connections.json";
  if (existsSync(runtimePath)) rmSync(runtimePath);
  process.env.COURSE_CONFIG_PATH = "tests/fixtures/course-connections.valid.json";
  const { gateway, url, api } = await startGateway();
  try {
    const healthy = await fetch(`${url}/api/health`);
    assert.equal(healthy.status, 200);

    const preflight = await api("/api/tasks/assignment-preflight", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ courseKey: "demo-course" }),
    });
    const result = await preflight.json();
    assert.equal(preflight.status, 200);
    assert.equal(result.state, "需人工登录");
    assert.deepEqual(result.scope.classNames, ["演示班"]);
    assert.equal(JSON.stringify(result).includes("1001"), false);

    const disallowedOrigin = await fetch(`${url}/api/health`, { headers: { origin: "https://example.invalid" } });
    assert.equal(disallowedOrigin.status, 403);
    assert.equal(disallowedOrigin.headers.get("access-control-allow-origin"), null);
    const allowedOrigin = await fetch(`${url}/api/health`, { headers: { origin: "http://127.0.0.1:4173" } });
    assert.equal(allowedOrigin.headers.get("access-control-allow-origin"), "http://127.0.0.1:4173");
    const preflightOptions = await fetch(`${url}/api/course-profiles`, { method: "OPTIONS", headers: { origin: "http://127.0.0.1:4173", "access-control-request-method": "PUT" } });
    assert.equal(preflightOptions.status, 204);
    assert.equal(preflightOptions.headers.get("access-control-allow-methods").includes("PUT"), true);

    process.env.COURSE_CONFIG_PATH = runtimePath;
    const saved = await api("/api/course-profiles", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profiles: [{ courseKey: "local-demo", courseName: "本机演示课程", courseId: "3001", cpi: "4001", classNames: ["本机演示班"], enabledModules: ["assignment"], entryPoints: { assignment: "教师端普通作业列表" } }] }),
    });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).profiles[0].courseKey, "local-demo");
    const loaded = await api("/api/course-profiles");
    assert.equal((await loaded.json()).profiles[0].courseName, "本机演示课程");
    const sensitive = await api("/api/course-profiles", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profiles: [{ courseKey: "unsafe", password: "not-allowed" }] }),
    });
    assert.equal(sensitive.status, 409);

    const rejected = await api("/api/tasks/unknown", { method: "POST", headers: { "content-type": "application/json" } });
    assert.equal(rejected.status, 404);
  } finally {
    await new Promise((resolve) => gateway.close(resolve));
    if (existsSync(runtimePath)) rmSync(runtimePath);
    if (previousPath === undefined) delete process.env.COURSE_CONFIG_PATH;
    else process.env.COURSE_CONFIG_PATH = previousPath;
  }
});

test("gateway rejects hostile Host/Origin, missing sessions and simple writes before reading config", async () => {
  const { gateway, url, api } = await startGateway();
  try {
    for (const origin of ["https://example.invalid", "null", "http://127.0.0.1:4173.evil.invalid", "http://terminal.local:4173"]) {
      for (const method of ["GET", "PUT", "OPTIONS"]) {
        const response = await fetch(`${url}/api/course-profiles`, { method, headers: { origin } });
        assert.equal(response.status, 403);
      }
    }
    for (const method of ["GET", "PUT", "OPTIONS"]) {
      const status = await new Promise((resolve, reject) => {
        const req = request(`${url}/api/course-profiles`, { method, headers: { host: "rebind.example.invalid", origin: "http://127.0.0.1:4173" } }, res => { res.resume(); resolve(res.statusCode); });
        req.on("error", reject); req.end();
      });
      assert.equal(status, 403);
    }
    assert.equal((await fetch(`${url}/api/session`)).status, 403);
    assert.equal((await fetch(`${url}/api/course-profiles`, { headers: { origin: "http://127.0.0.1:4173" } })).status, 401);
    assert.equal((await api("/api/course-profiles", { headers: { "x-local-session": "wrong" } })).status, 401);
    assert.equal((await api("/api/course-profiles", { method: "PUT", body: "{}" })).status, 415);
    const before = readFileSync("tests/fixtures/course-connections.valid.json", "utf8");
    const response = await api("/api/course-profiles", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ pad: "字".repeat(9000) }) });
    assert.equal(response.status, 409);
    assert.equal(readFileSync("tests/fixtures/course-connections.valid.json", "utf8"), before);
  } finally { await new Promise(resolve => gateway.close(resolve)); }
});

test("gateway cannot be configured to listen outside loopback", () => {
  assert.deepEqual(gatewayListenOptions({}), { host: "127.0.0.1", port: 4174 });
  for (const host of ["0.0.0.0", "::", "example.invalid"]) assert.throws(() => gatewayListenOptions({ LOCAL_GATEWAY_HOST: host }), /127.0.0.1/);
  assert.throws(() => gatewayListenOptions({ LOCAL_GATEWAY_PORT: "not-a-port" }), /有效端口/);
});
