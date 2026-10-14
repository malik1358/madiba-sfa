import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

const workflow = await readFile(new URL("../.github/workflows/missing-invoice-email.yml", import.meta.url), "utf8");
const runBlock = workflow.split("        run: |\n")[1];
assert.ok(runBlock, "workflow must contain the endpoint shell step");
const script = runBlock.replace(/^          /gm, "");

async function runWorkflow(t, responses, env = {}) {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({ url: request.url, method: request.method, headers: request.headers, body });
    const result = responses[Math.min(requests.length - 1, responses.length - 1)];
    if (result.disconnect) {
      request.socket.destroy();
      return;
    }
    response.writeHead(result.status, { "Content-Type": "application/json" });
    response.end(result.raw ?? JSON.stringify(result.body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const directory = await mkdtemp(path.join(tmpdir(), "missing-invoice-workflow-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const endpoint = `http://127.0.0.1:${server.address().port}/api/cron/missing-invoice-email`;
  assert.ok(script.includes("https://madiba-sfa.vercel.app/api/cron/missing-invoice-email"));
  // Execute the actual shell and curl requests without waiting through the production backoff.
  const localScript = script
    .replaceAll("https://madiba-sfa.vercel.app/api/cron/missing-invoice-email", endpoint)
    .replace("sleep 10", "sleep 0");
  const child = spawn("bash", ["-e", "-c", localScript], {
    cwd: directory,
    env: {
      PATH: process.env.PATH,
      CRON_SECRET: "workflow-test-value",
      MISSING_INVOICE_EMAIL_URL: "",
      ...env,
      ...(env.usePrimary ? { MISSING_INVOICE_EMAIL_URL: `${endpoint}?primary=1` } : {}),
    },
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

const success = { status: 200, body: { success: true, skipped: true, reason: "sent_recently" } };

test("missing invoice workflow uses bounded retries and preserves the request timeout", () => {
  assert.match(script, /for attempt in 1 2 3/);
  assert.match(script, /sleep 10/);
  assert.match(script, /--max-time 180\b/);
  assert.doesNotMatch(script, /--retry|--fail\b/);
});

test("missing invoice workflow does not retry a successful suppressed send", async (t) => {
  const result = await runWorkflow(t, [success]);
  assert.equal(result.code, 0);
  assert.equal(result.requests.length, 1);
  assert.match(result.output, /succeeded with HTTP 200/);
  assert.match(result.output, /sent_recently/);
});

test("missing invoice workflow recovers from the observed pre-delivery HTTP 500", async (t) => {
  const result = await runWorkflow(t, [
    { status: 500, body: { success: false, error: "Internal server error." } },
    success,
  ]);
  assert.equal(result.code, 0);
  assert.equal(result.requests.length, 2);
  for (const request of result.requests) {
    assert.equal(request.method, "POST");
    assert.equal(request.headers["x-cron-secret"], "workflow-test-value");
    assert.equal(request.headers["content-type"], "application/json");
    assert.equal(request.body, "{}");
  }
  assert.match(result.output, /succeeded with HTTP 200/);
  assert.doesNotMatch(result.output, /"error":"Internal server error\."/);
});

test("missing invoice workflow still fails after exhausting transient retries", async (t) => {
  const result = await runWorkflow(t, [
    { status: 500, body: { success: false, error: "Internal server error.", attempt: 1 } },
    { status: 500, body: { success: false, error: "Internal server error.", attempt: 2 } },
    { status: 500, body: { success: false, error: "Internal server error.", attempt: 3 } },
  ]);
  assert.equal(result.code, 1);
  assert.equal(result.requests.length, 3);
  assert.match(result.output, /failed with HTTP 500/);
  assert.match(result.output, /"attempt":3/);
  assert.doesNotMatch(result.output, /"attempt":1|"attempt":2/);
});

for (const response of [
  { status: 500, body: { success: false, failedCount: 1, sentCount: 0, error: "Internal server error." } },
  { status: 500, body: { success: false, error: "Server configuration is incomplete." } },
  { status: 500, raw: "<html>Internal server error</html>" },
  { status: 502, body: { error: "Bad gateway" } },
  { status: 504, body: { error: "Gateway timeout" } },
]) {
  test(`missing invoice workflow does not retry an ambiguous failure: ${JSON.stringify(response)}`, async (t) => {
    const result = await runWorkflow(t, [response]);
    assert.equal(result.code, 1);
    assert.equal(result.requests.length, 1);
  });
}

test("missing invoice workflow does not retry unauthorized requests", async (t) => {
  const result = await runWorkflow(t, [{ status: 401, body: { error: "Unauthorized" } }]);
  assert.equal(result.code, 1);
  assert.equal(result.requests.length, 1);
  assert.match(result.output, /failed with HTTP 401/);
});

test("missing invoice workflow preserves the configured URL fallback", async (t) => {
  const result = await runWorkflow(t, [
    { status: 404, body: { error: "Not found" } },
    success,
  ], { usePrimary: true });
  assert.equal(result.code, 0);
  assert.deepEqual(result.requests.map((request) => request.url), [
    "/api/cron/missing-invoice-email?primary=1",
    "/api/cron/missing-invoice-email",
  ]);
  assert.match(result.output, /retrying default endpoint/);
});

test("missing invoice workflow does not use URL fallback after a reported delivery failure", async (t) => {
  const result = await runWorkflow(t, [
    { status: 500, body: { success: false, failedCount: 1, error: "Send marker write failed" } },
    success,
  ], { usePrimary: true });
  assert.equal(result.code, 1);
  assert.equal(result.requests.length, 1);
  assert.doesNotMatch(result.output, /retrying default endpoint/);
});

test("missing invoice workflow aborts without retries or URL fallback after connection loss", async (t) => {
  const result = await runWorkflow(t, [{ disconnect: true }], { usePrimary: true });
  assert.notEqual(result.code, 0);
  assert.equal(result.requests.length, 1);
  assert.doesNotMatch(result.output, /retrying/);
});

test("missing invoice workflow still rejects a missing cron secret", async (t) => {
  const result = await runWorkflow(t, [success], { CRON_SECRET: "" });
  assert.equal(result.code, 1);
  assert.equal(result.requests.length, 0);
  assert.match(result.output, /CRON_SECRET secret is missing/);
});
