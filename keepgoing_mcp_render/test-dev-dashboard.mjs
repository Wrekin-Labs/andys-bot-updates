import assert from "node:assert/strict";
import { renderDevDashboard } from "./dev_dashboard.js";

const html = renderDevDashboard();

assert.match(html, /KeepGoing Command Center/);
assert.match(html, /Agent fleet/);
assert.match(html, /data-view="spaces"/);
assert.match(html, /data-view="knowledge"/);
assert.match(html, /data-view="playbooks"/);
assert.match(html, /data-view="integrations"/);
assert.match(html, /data-tab="diff"/);
assert.match(html, /changes\.patch/);
assert.match(html, /DEV_PROGRESS_JSON:/);
assert.match(html, /\/dev\/api\/tasks/);
assert.match(html, /\/dev\/api\/jobs/);
assert.match(html, /sessionStorage\.getItem\("kg_dev_token"\)/);
assert.doesNotMatch(html, /<script\s+src=/i);
assert.doesNotMatch(html, /https?:\/\/[^"']+\.js/i);
assert.match(html, /Remote push, merge, deploy, production writes, payments and secret operations remain approval-gated/);
const script = html.split("<script>")[1]?.split("</script>")[0];
assert.ok(script, "inline dashboard script missing");
assert.doesNotThrow(() => new Function(script));

console.log("dev dashboard tests passed");
