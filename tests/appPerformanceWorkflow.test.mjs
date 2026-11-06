import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

const workflow = await readFile(new URL("../.github/workflows/app-performance.yml", import.meta.url), "utf8");
const runBlock = workflow.split("        run: |\n")[1];
assert.ok(runBlock, "workflow must contain the endpoint shell step");
const script = runBlock.replace(/^          /gm, "");

async function runWorkflow(t, result, env = {}) {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({ url: request.url, method: request.method, headers: request.headers, body });
    if (result.disconnect) {
      request.socket.destroy();
      return;
    }
    const isBuildInfo = request.url === "/api/build-info";
    response.writeHead(isBuildInfo ? (result.buildStatus ?? 200) : (result.status ?? 200), {
      "Content-Type": "application/json",
    });
    response.end(isBuildInfo ? "{}" : (result.raw ?? JSON.stringify(result.body)));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const child = spawn("bash", ["-e", "-c", script.replaceAll("https://madiba-sfa.vercel.app", origin)], {
    env: { PATH: process.env.PATH, CRON_SECRET: "workflow-test-value", ...env },
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  return { code, output, requests };
}

for (const emailed of [false, true]) {
  test(`a recorded slowdown warns without failing (emailed: ${emailed})`, async (t) => {
    const result = await runWorkflow(t, {
      body: {
        success: true,
        status: "slower",
        metrics: { customers_count_ms: 730 },
        slower: ["customers_count_ms"],
        emailed,
      },
    });
    assert.equal(result.code, 0);
    assert.match(result.output, /::warning::App performance is slower/);
    assert.match(result.output, new RegExp(`"emailed":${emailed}`));
    assert.doesNotMatch(result.output, /An email was requested/);
    assert.equal(result.requests.length, 2);
    const request = result.requests[1];
    assert.equal(request.url, "/api/cron/app-performance");
    assert.equal(request.method, "POST");
    assert.equal(request.headers["x-cron-secret"], "workflow-test-value");
    assert.equal(request.headers["content-type"], "application/json");
    assert.ok(Number.isFinite(JSON.parse(request.body).external_build_info_ms));
  });
}

for (const status of ["baseline", "collecting", "steady"]) {
  test(`a ${status} check succeeds with formatted JSON`, async (t) => {
    const result = await runWorkflow(t, { raw: JSON.stringify({ status, success: true }, null, 2) });
    assert.equal(result.code, 0);
    assert.doesNotMatch(result.output, /::warning::|::error::/);
  });
}

for (const response of [
  { body: { success: true, status: "error", errors: { customers: "timeout" } } },
  { body: { success: false, status: "steady" } },
  { body: { success: true, status: "unknown" } },
  { body: { success: true } },
  { body: { status: "steady" } },
  { raw: "<html>Bad gateway</html>" },
  { status: 401, body: { success: false, error: "Unauthorized" } },
  { status: 500, body: { success: false, error: "Unable to store performance history" } },
  { buildStatus: 503, body: { success: true, status: "steady" } },
  { disconnect: true },
]) {
  test(`a genuine or invalid check failure stays fatal: ${JSON.stringify(response)}`, async (t) => {
    const result = await runWorkflow(t, response);
    assert.notEqual(result.code, 0);
    assert.doesNotMatch(result.output, /::warning::/);
  });
}

test("a missing cron secret fails before making requests", async (t) => {
  const result = await runWorkflow(t, { body: { success: true, status: "steady" } }, { CRON_SECRET: "" });
  assert.equal(result.code, 1);
  assert.equal(result.requests.length, 0);
  assert.match(result.output, /CRON_SECRET secret is missing/);
});
