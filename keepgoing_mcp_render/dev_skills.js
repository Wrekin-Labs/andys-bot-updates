export const DEV_SKILLS = Object.freeze({
  code_review: Object.freeze({
    id: "code_review",
    title: "Deep code review",
    guidance: "Review the changed surface for correctness, regressions, maintainability, edge cases and hidden coupling. Prefer concrete evidence over stylistic opinion.",
    criteria: Object.freeze([
      "Review the final changed surface for correctness, regressions and edge cases.",
      "Document any remaining high-confidence review findings in the handoff."
    ])
  }),
  test_hardening: Object.freeze({
    id: "test_hardening",
    title: "Test hardening",
    guidance: "Strengthen coverage around changed behavior, failure paths and boundary conditions without adding brittle implementation-detail tests.",
    criteria: Object.freeze([
      "Cover important failure and boundary paths for the changed behavior where a test framework exists.",
      "Avoid tests that only mirror implementation details without protecting behavior."
    ])
  }),
  security_review: Object.freeze({
    id: "security_review",
    title: "Security review",
    guidance: "Inspect trust boundaries, auth/authz, input validation, secret handling, injection surfaces, SSRF/path traversal, unsafe execution and external side effects relevant to the change.",
    criteria: Object.freeze([
      "Review relevant trust boundaries and untrusted-input paths.",
      "Document or fix high-confidence security findings before completion."
    ])
  }),
  android_release: Object.freeze({
    id: "android_release",
    title: "Android release",
    guidance: "For Android work, inspect Gradle configuration, run the appropriate build/test/lint path, preserve package/signing compatibility, and produce release artifacts only when signing material is safely available.",
    criteria: Object.freeze([
      "Run the relevant Gradle build/test/lint path for the requested Android change.",
      "Preserve application ID and signing compatibility unless the task explicitly changes them."
    ])
  }),
  web_release: Object.freeze({
    id: "web_release",
    title: "Web release readiness",
    guidance: "Check production build output, runtime configuration assumptions, accessibility basics, responsive behavior and deployment-sensitive regressions before handoff.",
    criteria: Object.freeze([
      "Run the production-equivalent build or validation path.",
      "Review deployment-sensitive configuration and responsive/accessibility regressions relevant to the change."
    ])
  }),
  docs_handoff: Object.freeze({
    id: "docs_handoff",
    title: "Documentation + handoff",
    guidance: "Keep the implementation handoff precise: what changed, why, how it was verified, what remains, and how another engineer can continue safely.",
    criteria: Object.freeze([
      "Document changed behavior, verification evidence and remaining limitations in the handoff."
    ])
  })
});

export function normaliseDevSkills(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error("skills must be an array");
  if (value.length > 4) throw new Error("skills supports at most 4 items");

  const seen = new Set();
  const skills = [];
  for (const raw of value) {
    const key = String(raw || "").trim().toLowerCase();
    if (!key) continue;
    if (seen.has(key)) continue;
    const skill = DEV_SKILLS[key];
    if (!skill) {
      throw new Error("unknown skill: " + key);
    }
    seen.add(key);
    skills.push(skill);
  }
  return skills;
}

export function applyDevSkillCriteria(value, skills) {
  if (!Array.isArray(value)) return value;
  if (!Array.isArray(skills) || !skills.length) return value;

  const additions = [];
  for (const skill of skills) {
    skill.criteria.forEach((text, index) => {
      additions.push({
        id: "KG_SKILL_" + skill.id.toUpperCase() + "_" + (index + 1),
        text
      });
    });
  }
  return [...value, ...additions];
}
