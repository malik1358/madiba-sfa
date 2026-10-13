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
    response.writeHead(result.status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(result.body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const directory = await mkdtemp(path.join(tmpdir(), "missing-invoice-workflow-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const endpoint = `http://127.0.0.1:${server.address().port}/api/cron/missing-invoice-email`;
  assert.ok(script.includes("https://madiba-sfa.vercel.app/api/cron/missing-invoice-email"));
  // Keep real curl retry behavior, but shorten the production backoff for local tests.
  const localScript = script
    .replaceAll("https://madiba-sfa.vercel.app/api/cron/missing-invoice-email", endpoint)
    .replace("--retry-delay 10", "--retry-delay 1");
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
  assert.match(script, /--retry 2\b/);
  assert.match(script, /--retry-delay 10\b/);
  assert.match(script, /--max-time 180\b/);
  assert.doesNotMatch(script, /--retry-all-errors|--fail\b/);
});

test("missing invoice workflow does not retry a successful suppressed send", async (t) => {
  const result = await runWorkflow(t, [success]);
  assert.equal(result.code, 0);
  assert.equal(result.requests.length, 1);
  assert.match(result.output, /succeeded with HTTP 200/);
  assert.match(result.output, /sent_recently/);
});

for (const status of [408, 429, 500, 502, 503, 504]) {
  test(`missing invoice workflow recovers from HTTP ${status}`, async (t) => {
    const result = await runWorkflow(t, [
      { status, body: { success: false, error: "Internal server error." } },
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
}

test("missing invoice workflow still fails after exhausting transient retries", async (t) => {
  const result = await runWorkflow(t, [
    { status: 500, body: { error: "first failure" } },
    { status: 500, body: { error: "second failure" } },
    { status: 500, body: { error: "final failure" } },
  ]);
  assert.equal(result.code, 1);
  assert.equal(result.requests.length, 3);
  assert.match(result.output, /failed with HTTP 500/);
  assert.match(result.output, /"error":"final failure"/);
  assert.doesNotMatch(result.output, /"error":"first failure"|"error":"second failure"/);
});

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

test("missing invoice workflow still rejects a missing cron secret", async (t) => {
  const result = await runWorkflow(t, [success], { CRON_SECRET: "" });
  assert.equal(result.code, 1);
  assert.equal(result.requests.length, 0);
  assert.match(result.output, /CRON_SECRET secret is missing/);
});
