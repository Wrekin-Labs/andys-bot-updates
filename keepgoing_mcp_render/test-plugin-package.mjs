import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const plugin = JSON.parse(readFileSync(resolve(here, "plugin.json"), "utf8"));
const mcp = JSON.parse(readFileSync(resolve(here, "mcp.json"), "utf8"));
const packaged = JSON.parse(readFileSync(resolve(here, "plugin/plugin.json"), "utf8"));
const packagedMcp = JSON.parse(readFileSync(resolve(here, "plugin/mcp.json"), "utf8"));

assert.equal(plugin.$schema, "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
// Directory updates must preserve the existing registered plugin identity.
assert.equal(plugin.name, "app-6abc15dcb6688191bc5156ae089435dc");
assert.equal(plugin.version, "1.2.0-beta.24");
assert.equal(plugin.extensions?.["com.openai"]?.interface?.displayName, "KeepGoing");
assert.equal(plugin.extensions?.["com.openai"]?.interface?.category, "Productivity");
assert.ok(plugin.extensions?.["com.openai"]?.interface?.shortDescription.length <= 30);
assert.equal(plugin.extensions?.["com.openai"]?.interface?.supportURL, "https://keepgoing-mcp.onrender.com/support");
assert.equal(plugin.extensions?.["com.openai"]?.interface?.brandColor, "#5F50E6");
assert.equal(plugin.extensions?.["com.openai"]?.interface?.brandColorDark, "#A99FFF");
assert.equal(plugin.extensions?.["com.openai"]?.review?.test_cases?.positive?.length, 5);
assert.equal(plugin.extensions?.["com.openai"]?.review?.test_cases?.negative?.length, 3);
assert.equal(plugin.extensions?.["com.openai"]?.review?.commerce, false);
assert.deepEqual(plugin.extensions?.["com.openai"]?.publication?.countries, ["GB"]);
assert.equal(plugin.extensions?.["com.openai"]?.interface?.composerIcon, "./plugin/assets/composer-icon.svg");
assert.equal(plugin.extensions?.["com.openai"]?.interface?.logo, "./plugin/assets/logo.svg");
assert.ok(existsSync(resolve(here, "plugin/assets/composer-icon.svg")));
assert.ok(existsSync(resolve(here, "plugin/assets/logo.svg")));
assert.equal(mcp.$schema, "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json");
assert.equal(mcp.mcpServers?.keepgoing?.type, "streamable-http");
assert.equal(mcp.mcpServers?.keepgoing?.url, "https://keepgoing-mcp.onrender.com/mcp");
console.log("plugin package tests passed");

assert.equal(plugin.extensions?.["com.openai"]?.interface?.websiteURL, "https://keepgoing-mcp.onrender.com/plugin");

assert.equal(packaged.name, plugin.name);
assert.equal(packaged.version, plugin.version);
assert.equal(packaged.description, plugin.description);
assert.equal(packaged.extensions?.["com.openai"]?.interface?.displayName, plugin.extensions?.["com.openai"]?.interface?.displayName);
assert.equal(packaged.extensions?.["com.openai"]?.interface?.shortDescription, plugin.extensions?.["com.openai"]?.interface?.shortDescription);
assert.equal(packaged.extensions?.["com.openai"]?.interface?.longDescription, plugin.extensions?.["com.openai"]?.interface?.longDescription);
assert.equal(packaged.extensions?.["com.openai"]?.interface?.websiteURL, plugin.extensions?.["com.openai"]?.interface?.websiteURL);
assert.equal(packaged.extensions?.["com.openai"]?.review?.commerce, false);
assert.equal(packaged.extensions?.["com.openai"]?.review?.test_cases?.positive?.length, 5);
assert.equal(packaged.extensions?.["com.openai"]?.review?.test_cases?.negative?.length, 3);
assert.deepEqual(packagedMcp, mcp);
