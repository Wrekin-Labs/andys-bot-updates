import fs from "node:fs";
import path from "node:path";

const root = path.resolve("plugin");
const manifestPath = path.join(root, "plugin.json");
const mcpPath = path.join(root, "mcp.json");
const skillPath = path.join(root, "skills", "get-started", "SKILL.md");

function fail(message) {
  throw new Error(message);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function requireFile(file) {
  if (!fs.existsSync(file)) fail("Missing required file: " + path.relative(root, file));
}

function validateHttps(name, value) {
  let url;
  try { url = new URL(String(value || "")); }
  catch { fail(name + " must be a valid URL"); }
  if (url.protocol !== "https:") fail(name + " must use HTTPS");
  if (url.username || url.password) fail(name + " must not embed credentials");
  return url;
}

function validateSquareSvg(relativePath) {
  const file = path.join(root, relativePath.replace(/^\.\//, ""));
  requireFile(file);
  const stat = fs.statSync(file);
  if (stat.size > 5 * 1024 * 1024) fail(relativePath + " exceeds 5 MiB");
  const text = fs.readFileSync(file, "utf8");
  const width = Number(text.match(/\bwidth="([0-9.]+)"/)?.[1]);
  const height = Number(text.match(/\bheight="([0-9.]+)"/)?.[1]);
  const view = text.match(/\bviewBox="([^"]+)"/)?.[1]?.trim().split(/\s+/).map(Number);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 48 || height < 48 || width !== height) {
    fail(relativePath + " must have equal numeric width/height >= 48");
  }
  if (!view || view.length !== 4 || view.some((n) => !Number.isFinite(n)) || view[2] !== view[3] || view[2] < 48) {
    fail(relativePath + " must have a square numeric viewBox >= 48");
  }
}

requireFile(manifestPath);
requireFile(mcpPath);
requireFile(skillPath);

const manifest = readJson(manifestPath);
const mcp = readJson(mcpPath);

if (manifest.$schema !== "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json") fail("Unexpected plugin schema");
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.name || "") || String(manifest.name).length > 64) {
  fail("Invalid portable plugin name");
}
if (!manifest.version) fail("Plugin version is required");

const ext = manifest?.extensions?.["com.openai"];
const ui = ext?.interface;
if (!ui) fail("extensions.com.openai.interface is required");
if (!ui.displayName || ui.displayName.length > 30) fail("displayName must be 1-30 characters");
if (!ui.shortDescription || ui.shortDescription.length > 30) fail("shortDescription must be 1-30 characters");
if (!ui.longDescription || ui.longDescription.length > 4000) fail("longDescription must be 1-4000 characters");
if (!ui.developerName || ui.developerName.length > 80) fail("developerName must be 1-80 characters");
if (!ui.category) fail("category is required");

for (const field of ["websiteURL","supportURL","privacyPolicyURL","termsOfServiceURL"]) {
  validateHttps(field, ui[field]);
}
if (new URL(ui.websiteURL).pathname !== "/plugin") {
  fail("websiteURL must use the commerce-neutral /plugin page");
}

const prompts = Array.isArray(ui.defaultPrompt) ? ui.defaultPrompt : [];
if (prompts.length < 1 || prompts.length > 3) fail("defaultPrompt must contain 1-3 prompts");
for (const prompt of prompts) {
  if (!prompt || prompt.length > 128) fail("Each defaultPrompt must be 1-128 characters");
  if (/@KeepGoing|@keepgoing/.test(prompt)) fail("Starter prompts must not contain an app @mention");
}

for (const assetField of ["logo","logoDark","composerIcon","composerIconDark"]) {
  if (!ui[assetField]) fail(assetField + " is required for the KeepGoing package");
  validateSquareSvg(ui[assetField]);
}

const listingText = [
  ui.displayName,
  ui.shortDescription,
  ui.longDescription,
  ...(ui.capabilities || []),
  ...prompts
].join("\n").toLowerCase();

const forbiddenCommerce = [
  /£\s*\d/,
  /\$\s*\d/,
  /\bsubscribe\b/,
  /\bsubscription plan\b/,
  /\bupgrade now\b/,
  /\bbuy now\b/,
  /\bcheckout\b/,
  /\/paypal\//,
  /\/billing\/claim/
];
for (const rule of forbiddenCommerce) {
  if (rule.test(listingText)) fail("Plugin listing contains commerce/upgrade language: " + rule);
}
if (ext?.review?.commerce !== false) fail("review.commerce must be false for the ChatGPT plugin submission");

const positive = ext?.review?.test_cases?.positive;
const negative = ext?.review?.test_cases?.negative;
if (!Array.isArray(positive) || positive.length !== 5) fail("Exactly five positive review cases are required");
if (!Array.isArray(negative) || negative.length !== 3) fail("Exactly three negative review cases are required");
for (const [index, test] of positive.entries()) {
  for (const key of ["description","prompt","tools_triggered","expected_behavior"]) {
    if (!String(test?.[key] || "").trim()) fail("Positive case " + (index + 1) + " missing " + key);
  }
}
for (const [index, test] of negative.entries()) {
  for (const key of ["description","prompt","expected_behavior"]) {
    if (!String(test?.[key] || "").trim()) fail("Negative case " + (index + 1) + " missing " + key);
  }
}

if ("test_credentials" in (ext.review || {}) || "reviewer_instructions" in (ext.review || {})) {
  fail("Reviewer credentials/instructions must not be committed in plugin.json");
}
if ("apps" in ext) fail("App references are not currently accepted for Plugin Directory submission");

if (mcp.$schema !== "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json") fail("Unexpected MCP schema");
const servers = mcp.mcpServers && typeof mcp.mcpServers === "object" ? Object.entries(mcp.mcpServers) : [];
if (servers.length !== 1) fail("KeepGoing submission package must declare exactly one MCP server");
const [serverName, server] = servers[0];
if (serverName !== "keepgoing") fail("MCP server must be named keepgoing");
if (server.type !== "streamable-http") fail("MCP server must use streamable-http");
const serverUrl = validateHttps("MCP server URL", server.url);
if (!serverUrl.pathname.endsWith("/mcp")) fail("MCP server URL must end in /mcp");

const skill = fs.readFileSync(skillPath, "utf8");
if (!/^---\r?\n/.test(skill)) fail("SKILL.md must start with YAML front matter");
if (!/^name:\s*\S+/m.test(skill) || !/^description:\s*.+/m.test(skill)) {
  fail("SKILL.md front matter requires name and description");
}
if (/\b(?:test_credentials|reviewer_instructions)\b/i.test(skill)) {
  fail("Do not put reviewer credentials in skills");
}

const sensitivePatterns = [
  /sk-[A-Za-z0-9_-]{20,}/,
  /gh[pousr]_[A-Za-z0-9]{20,}/,
  /Bearer\s+[A-Za-z0-9._~+\/-]{24,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/
];
function scanDir(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) scanDir(file);
    else {
      const data = fs.readFileSync(file);
      if (data.length > 5 * 1024 * 1024) fail(path.relative(root, file) + " exceeds 5 MiB");
      const text = data.toString("utf8");
      for (const rule of sensitivePatterns) {
        if (rule.test(text)) fail("Potential credential found in " + path.relative(root, file));
      }
    }
  }
}
scanDir(root);

console.log("KeepGoing plugin package validation passed");
console.log(JSON.stringify({
  name: manifest.name,
  version: manifest.version,
  displayName: ui.displayName,
  positiveCases: positive.length,
  negativeCases: negative.length,
  mcpServer: server.url,
  publicationCountries: ext?.publication?.countries || []
}, null, 2));
