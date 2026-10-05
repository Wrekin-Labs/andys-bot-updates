export const DEV_PLAYBOOKS = Object.freeze({
  bugfix: Object.freeze({
    id: "bugfix",
    title: "Bug fix + regression",
    guidance: "Reproduce first, isolate the root cause, make the smallest safe fix, add regression coverage, and prove the affected path is healthy.",
    criteria: Object.freeze([
      "Reproduce the reported failure or record why reproduction is not possible before editing.",
      "Add or update regression coverage for the fixed behavior where the repository has a test framework.",
      "Re-run the affected verification path successfully."
    ])
  }),
  feature: Object.freeze({
    id: "feature",
    title: "Feature + tests",
    guidance: "Trace the existing architecture before editing, implement the smallest coherent feature, cover the new behavior, and review the final diff.",
    criteria: Object.freeze([
      "Follow the existing architecture and conventions unless the task explicitly changes them.",
      "Add automated coverage for the new behavior where the repository has a test framework.",
      "Run the relevant build and tests successfully."
    ])
  }),
  audit: Object.freeze({
    id: "audit",
    title: "Security / quality audit",
    guidance: "Investigate broadly, rank findings by impact and confidence, repair only evidence-backed findings, and keep unresolved findings visible.",
    criteria: Object.freeze([
      "Rank findings by impact and confidence before changing code.",
      "Implement only findings supported by concrete evidence.",
      "Verify every implemented fix and document material unfixed findings."
    ])
  }),
  refactor: Object.freeze({
    id: "refactor",
    title: "Refactor safely",
    guidance: "Preserve behavior, work in small reviewable steps, avoid unrelated cleanup, and use tests or characterization checks to prove parity.",
    criteria: Object.freeze([
      "Preserve externally observable behavior unless the task explicitly requests a behavior change.",
      "Keep the refactor scoped and avoid unrelated cleanup.",
      "Run parity or regression checks successfully."
    ])
  }),
  ci_repair: Object.freeze({
    id: "ci_repair",
    title: "CI repair",
    guidance: "Reproduce the failing check, fix the root cause without weakening coverage, and re-run the CI-equivalent command plus nearby checks.",
    criteria: Object.freeze([
      "Reproduce the failing CI command locally when possible.",
      "Fix the root cause rather than deleting, skipping, or weakening valid tests.",
      "Re-run the failed CI-equivalent command and relevant adjacent checks successfully."
    ])
  }),
  dependency_update: Object.freeze({
    id: "dependency_update",
    title: "Dependency update",
    guidance: "Assess compatibility first, keep the dependency change set minimal, follow required migrations, and verify the repository after the update.",
    criteria: Object.freeze([
      "Identify compatibility and breaking-change risks before updating.",
      "Use the smallest dependency change set that achieves the requested outcome.",
      "Run relevant build/tests and document material migration changes."
    ])
  })
});

export function normaliseDevPlaybook(value) {
  if (value == null || String(value).trim() === "") return null;
  const key = String(value).trim().toLowerCase();
  const playbook = DEV_PLAYBOOKS[key];
  if (!playbook) {
    throw new Error("playbook must be one of: " + Object.keys(DEV_PLAYBOOKS).join(", "));
  }
  return playbook;
}

export function applyDevPlaybookCriteria(value, playbook) {
  if (!playbook) return value;
  if (!Array.isArray(value)) return value;
  const additions = playbook.criteria.map((text, index) => ({
    id: "KG_" + playbook.id.toUpperCase() + "_" + (index + 1),
    text
  }));
  return [...value, ...additions];
}
