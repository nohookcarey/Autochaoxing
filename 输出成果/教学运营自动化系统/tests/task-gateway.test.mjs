import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import test from "node:test";
import { createTaskGateway } from "../server/task-gateway.mjs";

async function startGateway() {
  const gateway = createTaskGateway();
  await new Promise((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  const { port } = gateway.address();
  return { gateway, url: `http://127.0.0.1:${port}` };
}

test("gateway only exposes allowlisted tasks and controlled local course profiles", async () => {
  const previousPath = process.env.COURSE_CONFIG_PATH;
  const runtimePath = "tests/fixtures/runtime-course-connections.json";
  if (existsSync(runtimePath)) rmSync(runtimePath);
  process.env.COURSE_CONFIG_PATH = "tests/fixtures/course-connections.valid.json";
  const { gateway, url } = await startGateway();
  try {
    const healthy = await fetch(`${url}/api/health`);
    assert.equal(healthy.status, 200);

    const preflight = await fetch(`${url}/api/tasks/assignment-preflight`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ courseKey: "demo-course" }),
    });
    const result = await preflight.json();
    assert.equal(preflight.status, 200);
    assert.equal(result.state, "需人工登录");
    assert.deepEqual(result.scope.classNames, ["演示班"]);
    assert.equal(JSON.stringify(result).includes("100000001"), false);

    const disallowedOrigin = await fetch(`${url}/api/health`, { headers: { origin: "https://example.invalid" } });
    assert.equal(disallowedOrigin.headers.get("access-control-allow-origin"), null);
    const allowedOrigin = await fetch(`${url}/api/health`, { headers: { origin: "http://127.0.0.1:4173" } });
    assert.equal(allowedOrigin.headers.get("access-control-allow-origin"), "http://127.0.0.1:4173");
    const preflightOptions = await fetch(`${url}/api/course-profiles`, { method: "OPTIONS", headers: { origin: "http://127.0.0.1:4173", "access-control-request-method": "PUT" } });
    assert.equal(preflightOptions.status, 204);
    assert.equal(preflightOptions.headers.get("access-control-allow-methods").includes("PUT"), true);

    process.env.COURSE_CONFIG_PATH = runtimePath;
    const saved = await fetch(`${url}/api/course-profiles`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profiles: [{ courseKey: "local-demo", courseName: "本机演示课程", courseId: "300000001", cpi: "400000001", classNames: ["本机演示班"], enabledModules: ["assignment"], entryPoints: { assignment: "教师端普通作业列表" } }] }),
    });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).profiles[0].courseKey, "local-demo");
    const loaded = await fetch(`${url}/api/course-profiles`);
    assert.equal((await loaded.json()).profiles[0].courseName, "本机演示课程");
    const sensitive = await fetch(`${url}/api/course-profiles`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profiles: [{ courseKey: "unsafe", password: "not-allowed" }] }),
    });
    assert.equal(sensitive.status, 409);

    const rejected = await fetch(`${url}/api/tasks/unknown`, { method: "POST" });
    assert.equal(rejected.status, 404);
  } finally {
    await new Promise((resolve) => gateway.close(resolve));
    if (existsSync(runtimePath)) rmSync(runtimePath);
    if (previousPath === undefined) delete process.env.COURSE_CONFIG_PATH;
    else process.env.COURSE_CONFIG_PATH = previousPath;
  }
});
