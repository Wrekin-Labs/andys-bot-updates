// Artifact finalisation, coding-workspace safety and provider error classification.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createAgentsEngine, normaliseCodingWorkspace, buildAgentEnvironment, looksSensitiveWorkspacePath } from "./agents_engine.js";
import { artifactManifest, ARTIFACT_READ_MAX_BYTES, CODING_WORKSPACE_INSTRUCTIONS } from "./v12_service.js";

const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");

function streamResponse(chunks, { status = 200, headers = {} } = {}) {
  let i = 0;
  let cancelled = false;
  return {
    ok: status < 300,
    status,
    headers: new Headers(headers),
    body: {
      getReader() {
        return {
          async read() {
            if (cancelled || i >= chunks.length) return { done: true, value: undefined };
            return { done: false, value: chunks[i++] };
          },
          async cancel() { cancelled = true; }
        };
      }
    },
    async json() { return {}; },
    async text() { return Buffer.concat(chunks).toString("utf8"); }
  };
}

function engineWith(metadata, contentResponse) {
  return createAgentsEngine({
    apiKey: "sk-test",
    fetchImpl: async (url) => {
      if (url.endsWith("/content")) return contentResponse;
      return { ok: true, status: 200, json: async () => metadata };
    }
  });
}

// ---- bounded, checksummed reads
{
  const text = "diff --git a/f b/f\n+ok\n";
  const engine = engineWith(
    { id: "art_1", path: "/workspace/outputs/changes.patch", size_bytes: Buffer.byteLength(text) },
    streamResponse([Buffer.from(text.slice(0, 5)), Buffer.from(text.slice(5))])
  );
  const result = await engine.readArtifactText("sess_1", "art_1");
  assert.equal(result.text, text);
  assert.equal(result.sha256, sha256(text));
  assert.equal(result.byteLength, Buffer.byteLength(text));
}
{
  // Metadata lies (claims 10 bytes) but the body streams far more: stop at the cap.
  const big = Buffer.alloc(64 * 1024, 0x61);
  const engine = engineWith(
    { id: "art_2", path: "/workspace/outputs/log.txt", size_bytes: 10 },
    streamResponse([big, big, big])
  );
  await assert.rejects(() => engine.readArtifactText("sess_1", "art_2", { maxBytes: 100_000 }), /exceeds the readable text size limit/);
}
{
  const engine = engineWith(
    { id: "art_3", path: "/workspace/outputs/log.txt", size_bytes: 10 },
    streamResponse([Buffer.from("x")], { headers: { "content-length": "5000000" } })
  );
  await assert.rejects(() => engine.readArtifactText("sess_1", "art_3"), /exceeds/);
}
{
  const engine = engineWith(
    { id: "art_4", path: "/workspace/outputs/data.json", size_bytes: 3 },
    streamResponse([Buffer.from([0x7b, 0x00, 0x7d])])
  );
  await assert.rejects(() => engine.readArtifactText("sess_1", "art_4"), /not readable as text/, "binary content is refused, not mangled");
}
{
  const engine = engineWith(
    { id: "art_5", path: "/workspace/outputs/r.md", size_bytes: 3 },
    { ok: false, status: 500, headers: new Headers(), text: async () => "internal trace with sk-live-secret", json: async () => ({}) }
  );
  await assert.rejects(
    () => engine.readArtifactText("sess_1", "art_5"),
    (error) => !/sk-live-secret/.test(error.message) && error.status === 500,
    "upstream error bodies are not echoed"
  );
}
{
  const engine = engineWith({ id: "art_6", path: "/workspace/outputs/archive.zip", size_bytes: 3 }, streamResponse([]));
  await assert.rejects(() => engine.readArtifactText("sess_1", "art_6"), /not readable as text/);
  await assert.rejects(() => engine.readArtifactText("sess_1", "../art"), /valid artifact id/);
}

// ---- deterministic manifest
{
  const rows = [
    { id: "b", path: "/workspace/outputs/z.md", size_bytes: 5, turn_id: "t2" },
    { id: "a", path: "/workspace/outputs/a.patch", size_bytes: 7, turn_id: "t1" },
    { id: "a", path: "/workspace/outputs/a.patch", size_bytes: 7, turn_id: "t1" },
    { id: "c", path: "/workspace/outputs/../../etc/shadow", size_bytes: 1 },
    { id: "d", path: "/workspace/project/src/x.js", size_bytes: 1 },
    { id: "e", path: "/workspace/outputs/big.log", size_bytes: ARTIFACT_READ_MAX_BYTES + 1 },
    { id: "f", path: "/workspace/outputs/shot.png", size_bytes: 10 },
    { id: "../g", path: "/workspace/outputs/ok.txt", size_bytes: 1 }
  ];
  const first = artifactManifest(rows);
  const second = artifactManifest([...rows].reverse());
  assert.deepEqual(first, second, "manifest is independent of provider ordering");
  assert.deepEqual(first.artifacts.map((a) => a.artifact_id), ["a", "e", "f", "b"]);
  assert.equal(first.totalBytes, 7 + 5 + ARTIFACT_READ_MAX_BYTES + 1 + 10);
  const byId = Object.fromEntries(first.artifacts.map((a) => [a.artifact_id, a]));
  assert.equal(byId.a.readable, true);
  assert.equal(byId.e.readable, false, "oversized text is listed but flagged unreadable");
  assert.equal(byId.f.readable, false);
  assert.equal(byId.f.mime_type, "image/png");
  assert.equal(byId.b.name, "z.md");
}

// ---- coding workspace safety
assert.match(CODING_WORKSPACE_INSTRUCTIONS, /untrusted data/);
assert.match(CODING_WORKSPACE_INSTRUCTIONS, /changes\.patch/);
assert.match(CODING_WORKSPACE_INSTRUCTIONS, /must not claim that changes were pushed/);
for (const path of [
  ".env", "config/.env.production", ".npmrc", ".netrc", ".git-credentials", "keys/server.pem", "certs/a.p12",
  "deploy/keystore.jks", "home/.ssh/config", ".aws/credentials", "gcp/service-account-prod.json", "infra/main.tfstate",
  "credentials.json"
]) {
  assert.equal(looksSensitiveWorkspacePath(path), true, path);
  assert.throws(() => normaliseCodingWorkspace({ enabled: true, files: [{ path, content: "x" }] }), /not allowed|safe relative project path/, path);
}
for (const path of ["src/index.js", "README.md", "docs/environment.md", "test/fixtures/key_points.txt"]) {
  assert.equal(looksSensitiveWorkspacePath(path), false, path);
}
for (const path of ["../x", "/etc/passwd", "a//b", ".git/config", "src/.GIT/hooks/pre-commit", "a/./b", "-rf", "a\\..\\b", "dir/"]) {
  assert.throws(() => normaliseCodingWorkspace({ enabled: true, files: [{ path, content: "x" }] }), /safe relative project path/, path);
}
assert.throws(() => normaliseCodingWorkspace({ enabled: true, files: [{ path: "a.txt", content: "a\0b" }] }), /UTF-8 text/);
assert.throws(() => normaliseCodingWorkspace({ enabled: true, files: Array.from({ length: 9 }, (_, i) => ({ path: "f" + i, content: "" })) }), /at most 8/);
assert.throws(() => normaliseCodingWorkspace({ enabled: true, repositoryUrl: "https://user:tok@github.com/a/b" }), /without credentials/);
assert.throws(() => normaliseCodingWorkspace({ enabled: true, repositoryUrl: "https://gitlab.com/a/b" }), /github\.com/);
assert.throws(() => normaliseCodingWorkspace({ enabled: true, repositoryUrl: "https://github.com/a/b", repositoryRef: "main;rm -rf /" }), /safe Git ref/);
assert.throws(() => normaliseCodingWorkspace({ enabled: true, repositoryUrl: "https://github.com/a/b", repositoryRef: "--upload-pack=x" }), /safe Git ref/);
const env = buildAgentEnvironment({ enabled: true, repositoryUrl: "https://github.com/acme/app", repositoryRef: "v1.2.3", files: [{ path: "src/my file.js", content: "x" }] });
assert.throws(() => normaliseCodingWorkspace({ enabled: true, files: [{ path: "src/it's.js", content: "x" }] }), /safe relative/, "shell metacharacters are rejected outright");
assert.equal(env.network.access, "restricted");
assert.ok(!env.network.allowed_domains.some((d) => d.includes("*")), "no wildcard egress");
const commands = env.setup_commands.map((c) => c.command).join("\n");
assert.match(commands, /git clone --filter=blob:none --no-checkout 'https:\/\/github\.com\/acme\/app\.git' \/workspace\/project/);
assert.match(commands, /dest='\/workspace\/project\/src\/my file\.js'/, "paths are shell-quoted");
assert.match(commands, /escaped project workspace/, "symlink escape guard present");
assert.doesNotMatch(commands, /--recurse-submodules|lfs/, "no submodule/LFS fetch from hostile repos");

// ---- provider error classification and timeouts
{
  const rateLimited = createAgentsEngine({ apiKey: "sk", fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ error: { message: "slow down" } }) }) });
  await assert.rejects(() => rateLimited.getSession("sess_1"), (e) => e.code === "provider_rate_limited" && e.retryable === true);
  const rejected = createAgentsEngine({ apiKey: "sk", fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({}) }) });
  await assert.rejects(() => rejected.getSession("sess_1"), (e) => e.code === "provider_rejected" && e.retryable === false);
  const down = createAgentsEngine({ apiKey: "sk", fetchImpl: async () => { throw new TypeError("fetch failed"); } });
  await assert.rejects(() => down.getSession("sess_1"), (e) => e.code === "provider_unreachable");
  const hanging = createAgentsEngine({
    apiKey: "sk",
    timeoutMs: 1_000,
    fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "TimeoutError" })));
    })
  });
  const started = Date.now();
  // AbortSignal.timeout timers are unref'd; keep the test process alive the way
  // the HTTP server does in production.
  const keepAlive = setInterval(() => {}, 100);
  await assert.rejects(() => hanging.getSession("sess_1"), (e) => e.code === "provider_timeout");
  clearInterval(keepAlive);
  assert.ok(Date.now() - started < 5_000, "timeout fires promptly");
}

console.log("artifact and workspace tests passed");
