import assert from "node:assert/strict";
import { DEV_SKILLS, normaliseDevSkills, applyDevSkillCriteria } from "./dev_skills.js";
import { normaliseDevTask, buildDevJobContext, buildDevEngineTag } from "./dev_agent.js";

assert.ok(DEV_SKILLS.code_review);
assert.equal(normaliseDevSkills(null).length, 0);
assert.deepEqual(
  normaliseDevSkills(["code_review", "code_review", "security_review"]).map((s) => s.id),
  ["code_review", "security_review"]
);
assert.throws(() => normaliseDevSkills(["nope"]), /unknown skill/);
assert.throws(
  () => normaliseDevSkills(["code_review","test_hardening","security_review","android_release","web_release"]),
  /at most 4/
);

const applied = applyDevSkillCriteria(
  [{ id: "BASE", text: "base" }],
  normaliseDevSkills(["code_review"])
);
assert.equal(applied.length, 3);
assert.equal(applied[1].id, "KG_SKILL_CODE_REVIEW_1");

const task = normaliseDevTask({
  goal: "Review and harden a change",
  repositoryUrl: "https://github.com/example/repo",
  acceptanceCriteria: [{ id: "BASE", text: "base behavior works" }],
  verificationCommands: ["npm test"],
  skills: ["code_review", "security_review"]
});
assert.deepEqual(task.skills, ["code_review", "security_review"]);
assert.equal(task.acceptanceCriteria.length, 5);
assert.match(buildDevJobContext(task), /skills=code_review,security_review/);
assert.match(buildDevJobContext(task), /skillGuidance\[security_review\]/);
assert.match(buildDevEngineTag(task), /^agents-dev:c5:v1:/);

console.log("dev skills tests passed");
