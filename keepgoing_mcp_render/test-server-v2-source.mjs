import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./server.js", import.meta.url), "utf8");
assert.match(source, /buildStartDevTaskArgs/);
assert.match(source, /server\.registerTool\("start_dev_task"/);
assert.match(source, /name: "start_dev_task"/);
assert.match(source, /acceptanceCriteria/);
assert.match(source, /verificationCommands/);
console.log("server v2 source tests passed");
