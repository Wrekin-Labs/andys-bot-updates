import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const plugin = JSON.parse(readFileSync(resolve(here, "plugin.json"), "utf8"));
const mcp = JSON.parse(readFileSync(resolve(here, "mcp.json"), "utf8"));

assert.equal(plugin.$schema, "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
assert.equal(plugin.name, "keepgoing");
assert.equal(plugin.version, "1.2.0-beta.17");
assert.equal(plugin.extensions?.["com.openai"]?.interface?.displayName, "KeepGoing");
assert.equal(plugin.extensions?.["com.openai"]?.interface?.category, "Productivity");
assert.equal(plugin.extensions?.["com.openai"]?.interface?.composerIcon, "./assets/keepgoing-icon.png");
assert.equal(plugin.extensions?.["com.openai"]?.interface?.logo, "./assets/keepgoing-icon.png");
assert.ok(existsSync(resolve(here, "assets/keepgoing-icon.png")));
assert.equal(mcp.$schema, "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json");
assert.equal(mcp.mcpServers?.keepgoing?.type, "streamable-http");
assert.equal(mcp.mcpServers?.keepgoing?.url, "https://keepgoing-mcp.onrender.com/mcp");
console.log("plugin package tests passed");
