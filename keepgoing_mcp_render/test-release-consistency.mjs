// Guards against release drift: versions, repository, CI triggers, test and
// syntax-check coverage, migration re-runnability, and stale doc versions.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(resolve(here, p), "utf8").replace(/\r\n/g, "\n");
const pkg = JSON.parse(read("package.json"));
const plugin = JSON.parse(read("plugin.json"));
const version = pkg.version;

// Versions and repository
assert.match(version, /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/);
assert.equal(plugin.version, version);
assert.equal(plugin.repository, "https://github.com/Wrekin-Labs/andys-bot-updates");
for (const doc of ["README.md", "SUBMISSION.md", "LISTING_COPY.md"]) {
  assert.ok(read(doc).includes(version), doc + " mentions the current release " + version);
  assert.doesNotMatch(read(doc), /github\.com\/chipblock2\/andys-bot-updates/, doc + " has no stale repository URL");
}
const server = read("server.js");
assert.ok(server.includes("<h2>" + version + " "), "public changelog has an entry for " + version);
assert.doesNotMatch(read("plugin.json"), /chipblock2\/andys-bot-updates/);

// Every test file runs, every module is syntax-checked.
const files = readdirSync(here);
const testFiles = files.filter((f) => /^test-.*\.mjs$/.test(f));
for (const file of testFiles) {
  assert.ok(pkg.scripts.test.includes("node " + file), "npm test runs " + file);
}
const modules = files.filter((f) => f.endsWith(".js"));
for (const file of modules) {
  assert.ok(pkg.scripts.check.includes("node --check " + file), "npm run check covers " + file);
}
assert.equal(pkg.scripts.verify, "npm run check && npm test");
assert.ok(Object.keys(pkg.dependencies).every((name) => /^\d+\.\d+\.\d+$/.test(pkg.dependencies[name])), "dependencies are pinned exactly");

// CI: current branches and PRs, not one historical branch.
const ciPath = resolve(here, "../.github/workflows/keepgoing-ci.yml");
if (existsSync(resolve(here, "../.github"))) {
  assert.ok(existsSync(ciPath), "keepgoing-ci.yml exists");
  assert.ok(!existsSync(resolve(here, "../.github/workflows/keepgoing-v1.2-ci.yml")), "stale v1.2 workflow removed");
  const ci = readFileSync(ciPath, "utf8");
  assert.match(ci, /"keepgoing-\*\*"/);
  assert.match(ci, /pull_request:/);
  assert.match(ci, /node-version: "24"/);
  assert.match(ci, /npm run verify/);
  assert.match(ci, /permissions:\n\s+contents: read/);
}

// Migrations: re-runnable and least-privilege.
const v15 = read("sql/durable_jobs_v1_5.sql");
assert.match(v15, /create or replace function public\.keepgoing_jobs_guard_update\(\)/);
assert.match(v15, /drop trigger if exists keepgoing_jobs_guard_update on public\.keepgoing_jobs;/);
assert.match(v15, /create index if not exists keepgoing_jobs_recoverable_idx/);
assert.match(v15, /revoke all on function public\.keepgoing_jobs_guard_update\(\) from public, anon, authenticated;/);
assert.doesNotMatch(v15, /\balter table\b[^;]*\b(add|drop) column\b/i, "1.5 migration adds no columns (app works before/after it)");
assert.doesNotMatch(v15, /security definer/i);
assert.match(read("sql/verify_durable_migrations.sql"), /\\ir durable_jobs_v1_5\.sql\n\\ir durable_jobs_v1_5\.sql/, "verification applies the migration twice");

console.log("release consistency tests passed");
