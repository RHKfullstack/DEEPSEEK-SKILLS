// Registration test for dsh-senior-engineering-skills.
//
//   node tools/plugin-registration-test.mjs
//
// Proves the plugin registers exactly one prefixed prompt section and the six skills it
// claims, and that nothing it registers can break the harness prompt renderer.

import { strict as assert } from "node:assert";

const SECTION_ORDERS = { DEPLOYMENT_PERSONA_PREFIX: 0, PLAN_POLICY: 500, TEAM_POLICY: 600 };

const EXPECTED_SECTION = "dsh-senior-engineering:policy";
const EXPECTED_ORDER = 160;
const EXPECTED_SKILLS = [
  "senior-work-audit",
  "senior-system-hardening",
  "senior-code-review",
  "senior-supply-chain-audit",
  "senior-threat-model",
  "senior-release-gate",
  "senior-test-adequacy",
  "senior-data-migration-safety",
  "senior-architecture-review",
  "senior-reliability-review",
  "senior-performance-audit",
];
// The six carried on every turn, and the five that load only when their trigger fires.
const ALWAYS_ON_SKILLS = EXPECTED_SKILLS.slice(0, 6);
const ON_TRIGGER_SKILLS = EXPECTED_SKILLS.slice(6);

// Section names the harness itself owns; reusing one would throw during assembly.
const HARNESS_SECTION_NAMES = [
  "harness:identity",
  "deployment:persona-prefix",
  "deployment:persona-suffix",
  "team:policy",
  "plan:policy",
];
// Section names the sibling skills plugin owns.
const SIBLING_SECTION_NAMES = [
  "deepseek-harness:skills-policy",
  "deepseek-harness:scale-policy",
];
// Skill names already present in the live catalog.
const EXISTING_SKILL_NAMES = [
  "sandbox-mode",
  "plannable",
  "diagnose-windows-sandbox-acl",
  "dsh-badge",
  "office-docx",
  "office-pptx",
  "office-xlsx",
];

const captured = { sections: [], skills: [] };
const ctx = {
  systemPrompt: {
    getSectionOrder: (name) => SECTION_ORDERS[name],
    section: (section) => {
      captured.sections.push(section);
      return () => {};
    },
  },
  skills: {
    register: (skill) => {
      captured.skills.push(skill);
      return () => {};
    },
  },
  effect: (fn) => {
    fn();
    return () => {};
  },
  on: () => () => {},
  logger: { warn: () => {}, info: () => {} },
};

const mod = await import("../index.js");
mod.apply(ctx);

const results = [];
const check = (label, fn) => {
  try {
    fn();
    results.push(`PASS ${label}`);
  } catch (error) {
    results.push(`FAIL ${label}: ${error.message}`);
    process.exitCode = 1;
  }
};

const section = () => {
  assert.equal(captured.sections.length, 1, `expected 1 section, got ${captured.sections.length}`);
  return captured.sections[0];
};
const policyText = () => {
  const value = section().text;
  return typeof value === "function" ? value() : value;
};

check("plugin name matches the package", () => {
  assert.equal(mod.name, "dsh-senior-engineering-skills");
});
check("inject list covers systemPrompt and skills", () => {
  assert.deepEqual(mod.inject, ["systemPrompt", "skills"]);
});
check("registers exactly one prompt section", () => {
  assert.equal(captured.sections.length, 1);
});
check("the section name is prefixed and unique", () => {
  const value = section();
  assert.equal(value.name, EXPECTED_SECTION);
  assert.ok(!HARNESS_SECTION_NAMES.includes(value.name), "collides with a harness section");
  assert.ok(!SIBLING_SECTION_NAMES.includes(value.name), "collides with a sibling section");
});
check("the section order is 160 and finite", () => {
  assert.equal(section().order, EXPECTED_ORDER);
  assert.ok(Number.isFinite(section().order));
});
check("the section renders through a function and is non-empty", () => {
  assert.equal(typeof section().text, "function");
  assert.ok(policyText().length > 0);
});
check("the section text contains no brace pair", () => {
  assert.ok(!policyText().includes("{{"), "policy text contains {{");
  assert.ok(!policyText().includes("}}"), "policy text contains }}");
});
check("the policy names every skill it governs", () => {
  for (const name of EXPECTED_SKILLS) {
    assert.ok(policyText().includes(name), `policy does not mention ${name}`);
  }
});
check("the policy marks exactly the six core skills as always-on", () => {
  const text = policyText();
  assert.match(text, /Six core skills are always-on/);
  for (const name of ALWAYS_ON_SKILLS) {
    assert.ok(text.includes(name), `the always-on list omits ${name}`);
  }
});
check("the policy routes the five deeper skills to on-trigger loading", () => {
  const text = policyText();
  assert.match(text, /Five deeper skills load on trigger/);
  assert.ok(
    !/All six are always-on/.test(text),
    "the old all-six-always-on sentence is still present",
  );
  for (const name of ON_TRIGGER_SKILLS) {
    assert.ok(text.includes(name), `the on-trigger list omits ${name}`);
  }
});
check("the two lists are disjoint and cover all eleven skills", () => {
  assert.equal(ALWAYS_ON_SKILLS.length, 6);
  assert.equal(ON_TRIGGER_SKILLS.length, 5);
  const overlap = ALWAYS_ON_SKILLS.filter((name) => ON_TRIGGER_SKILLS.includes(name));
  assert.deepEqual(overlap, [], `a skill is in both lists: ${overlap.join(", ")}`);
  assert.equal(new Set(EXPECTED_SKILLS).size, 11);
});
check("every registered skill carries a substantial body", () => {
  for (const name of EXPECTED_SKILLS) {
    const body = captured.skills.find((skill) => skill.name === name);
    assert.ok(body, `${name} was not registered`);
    assert.ok(body.content.length > 1000, `${name} body is suspiciously short`);
  }
});
check("the policy states the precedence order", () => {
  assert.match(policyText(), /sandbox-mode.*outranks/i);
  assert.match(policyText(), /scale policy outranks/i);
});
check("the policy makes the audit a mandatory gate", () => {
  const text = policyText();
  assert.match(text, /## Rule E6 — The audit is a gate, not a self-check/);
  assert.match(text, /audit pass\s+against its FINAL state before it is reported done/i);
  assert.match(text, /that did not\s+author the change/i);
  assert.match(text, /The author's own "I checked it" is not\s+an audit/i);
});
check("the audit gate sits before the precedence rule, which stays last", () => {
  const text = policyText();
  const audit = text.indexOf("## Rule E6 — The audit is a gate");
  const precedence = text.indexOf("## Rule E7 — Precedence");
  assert.ok(audit >= 0 && precedence >= 0, "both rules must exist");
  assert.ok(audit < precedence, "the audit gate must precede the precedence rule");
  assert.equal(
    text.trimEnd().endsWith("load the ones whose trigger fired."),
    true,
    "the precedence rule must remain the closing word",
  );
});
check("registers exactly the eleven expected skills", () => {
  assert.deepEqual(
    captured.skills.map((skill) => skill.name).sort(),
    [...EXPECTED_SKILLS].sort(),
  );
});
check("no skill name collides with an existing catalog name", () => {
  for (const skill of captured.skills) {
    assert.ok(
      !EXISTING_SKILL_NAMES.includes(skill.name),
      `${skill.name} collides with an installed skill`,
    );
  }
});
check("skill names are unique", () => {
  const names = captured.skills.map((skill) => skill.name);
  assert.equal(new Set(names).size, names.length);
});
check("every skill carries description, whenToUse, source, resourceBase and content", () => {
  for (const skill of captured.skills) {
    assert.ok(skill.description?.length > 40, `${skill.name} description too short`);
    assert.ok(skill.whenToUse?.length > 40, `${skill.name} whenToUse too short`);
    assert.equal(skill.source, "dsh-senior-engineering-skills");
    assert.equal(skill.resourceBase?.kind, "directory");
    assert.ok(skill.content?.length > 1000, `${skill.name} body is only ${skill.content?.length} chars`);
  }
});
check("no skill body contains a brace pair", () => {
  for (const skill of captured.skills) {
    assert.ok(!skill.content.includes("{{"), `${skill.name} contains {{`);
    assert.ok(!skill.content.includes("}}"), `${skill.name} contains }}`);
  }
});
check("every skill body cites at least five sources", () => {
  for (const skill of captured.skills) {
    const urls = new Set(skill.content.match(/https?:\/\/[^\s)>\]`"]+/g) ?? []);
    assert.ok(urls.size >= 5, `${skill.name} cites only ${urls.size} URLs`);
  }
});
check("every skill body has the required headings", () => {
  for (const skill of captured.skills) {
    for (const heading of [
      "## When this applies",
      "## When it does not",
      "## Evidence to record",
      "## Failure modes a naive reviewer misses",
      "## Sources",
    ]) {
      assert.ok(skill.content.includes(heading), `${skill.name} is missing "${heading}"`);
    }
  }
});
check("every skill whenToUse names a distinct trigger", () => {
  const triggers = captured.skills.map((skill) => skill.whenToUse);
  assert.equal(new Set(triggers).size, triggers.length);
});

console.log(results.join("\n"));
console.log(
  process.exitCode === 1
    ? `\nFAILED: ${results.filter((line) => line.startsWith("FAIL")).length} check(s)`
    : `\nPASSED: ${results.length} checks`,
);
