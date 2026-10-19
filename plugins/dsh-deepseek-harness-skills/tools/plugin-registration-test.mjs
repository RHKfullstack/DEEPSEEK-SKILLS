// PART-002 verification: does the edited plugin register the intended prompt sections and
// nothing else, and does it survive a harness whose section table is missing?
//
//   node tools/plugin-registration-test.mjs
//
// Run from the plugin root. Exits 0 on PASS, 1 on FAIL.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

// The skills policy is plain prompt text, so its always-on split is asserted directly.
const skillsPolicyText = () =>
  readFileSync(new URL("../prompts/skills-policy.md", import.meta.url), "utf8");

// Values copied verbatim from SECTION_ORDERS in
// @deepseek-ai/dsh-system-prompt/lib/index.js inside the installed app.asar, so the mock
// resolves the same placement the running harness does. If the harness table ever moves,
// this file is the place that shows the difference.
const SECTION_ORDERS = {
  HARNESS_IDENTITY: -1e3,
  DEPLOYMENT_PERSONA_PREFIX: 0,
  PLAN_POLICY: 500,
  TEAM_POLICY: 600,
  PTC_ONLY: 800,
  FILE_REFERENCE: 900,
  TOOL_BASH: 1e3,
  TOOL_PWSH: 1010,
  TOOL_READ: 1100,
  TOOL_WRITE: 1200,
  TOOL_EDIT: 1300,
  TOOL_GLOB: 1400,
  TOOL_GREP: 1500,
  TOOL_JOBS: 1600,
  TOOL_PTY: 1700,
  TOOL_WEB_SEARCH: 2e3,
  TOOL_WEB_FETCH: 2100,
  TOOL_LSP: 2200,
  TOOL_SESSION_QUERY: 2300,
  TOOL_GOAL: 2400,
  TOOL_WORKFLOW: 2600,
  TOOL_RALPH: 2700,
  TOOL_SUBAGENT: 2800,
  TOOL_REPORT: 2900,
  TOOL_COMPUTER_USE: 3e3,
  MCP_SERVERS: 3100,
  TOOLS_SDK: 5e3,
  DELIVERABLE_FILE_REFERENCES: 9e3,
  STRUCTURED_OUTPUT: 9900,
  HARNESS_SOURCE: 1e4,
  WEB_SURFACE: 10100,
  DEPLOYMENT_PERSONA_SUFFIX: 10200,
};

// Section names the harness itself owns. Reusing any of these would make
// SystemPrompt.section() throw "prompt section ... is already registered".
const HARNESS_SECTION_NAMES = [
  "harness:identity",
  "deployment:persona-prefix",
  "deployment:persona-suffix",
  "team:policy",
  "plan:policy",
  "tool:subagent",
  "file-reference",
];

const makeCtx = (getSectionOrder) => {
  const state = { sections: [], skills: [], effects: 0, disposers: [], listeners: [] };
  const ctx = {
    systemPrompt: {
      ...(getSectionOrder === undefined ? {} : { getSectionOrder }),
      section: (section) => {
        state.sections.push(section);
        return () => {};
      },
    },
    skills: {
      register: (skill) => {
        state.skills.push(skill);
        return () => {};
      },
    },
    effect: (fn) => {
      state.effects += 1;
      state.disposers.push(fn());
      return () => {};
    },
    on: (event, listener, options) => {
      state.listeners.push({ event, listener, options });
      return () => {};
    },
    logger: { warn: () => {}, info: () => {} },
  };
  return { ctx, state };
};

const mod = await import("../index.js");

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

// --- plugin shape -----------------------------------------------------------------
check("plugin name is dsh-deepseek-harness-skills", () => {
  assert.equal(mod.name, "dsh-deepseek-harness-skills");
});
check("inject list is unchanged", () => {
  assert.deepEqual(mod.inject, ["systemPrompt", "skills"]);
});

// --- the live harness case --------------------------------------------------------
const live = makeCtx((name) => SECTION_ORDERS[name]);
mod.apply(live.ctx);

const scalePolicySection = () =>
  live.state.sections.find((s) => s.name === "deepseek-harness:scale-policy");
const scalePolicyText = () => {
  const section = scalePolicySection();
  assert.ok(section, "scale-policy section missing");
  return section.text();
};

check("registers exactly three prompt sections", () => {
  assert.equal(live.state.sections.length, 3);
});
check("registers exactly three skills", () => {
  assert.deepEqual(
    live.state.skills.map((skill) => skill.name).sort(),
    ["organizer", "plannable", "sandbox-mode"],
  );
});
check("registers exactly one system-prompt/assemble listener, prepended", () => {
  assert.equal(live.state.listeners.length, 1, "expected exactly one listener registration");
  const [listener] = live.state.listeners;
  assert.equal(listener.event, "system-prompt/assemble");
  assert.equal(listener.options?.prepend, true, "the rewrite must run last, so it must be prepended");
  assert.equal(typeof listener.listener, "function");
});
check("every section name is plugin-owned, not a harness name", () => {
  for (const section of live.state.sections) {
    assert.ok(
      !HARNESS_SECTION_NAMES.includes(section.name),
      `"${section.name}" collides with a harness-owned section name`,
    );
  }
});
check("section names are unique", () => {
  const names = live.state.sections.map((section) => section.name);
  assert.equal(new Set(names).size, names.length);
});
check("orders are finite numbers", () => {
  for (const section of live.state.sections) {
    assert.ok(Number.isFinite(section.order), `${section.name} order ${section.order}`);
  }
});
check("skills-policy keeps order 150", () => {
  const section = live.state.sections.find((s) => s.name === "deepseek-harness:skills-policy");
  assert.ok(section, "skills-policy section missing");
  assert.equal(section.order, 150);
});
check("scale-policy sits immediately before TEAM_POLICY", () => {
  const section = live.state.sections.find((s) => s.name === "deepseek-harness:scale-policy");
  assert.ok(section, "scale-policy section missing");
  assert.equal(section.order, SECTION_ORDERS.TEAM_POLICY - 1);
});
check("every section renders text through a function", () => {
  for (const section of live.state.sections) {
    assert.equal(typeof section.text, "function", `${section.name} text is not a function`);
  }
});
check("every section renders non-empty text", () => {
  for (const section of live.state.sections) {
    assert.ok(section.text().length > 0, `${section.name} rendered empty`);
  }
});
check("live text is stable across assemblies", () => {
  for (const section of live.state.sections) {
    assert.equal(section.text(), section.text());
  }
});
check("scale policy removes the explicit-request gate", () => {
  const text = scalePolicyText();
  assert.ok(
    !/create teammates only when the user explicitly asks/i.test(text),
    "the old gate wording is still present in the scale policy",
  );
  assert.match(text, /explicit user request is removed at assembly time/i);
});
check("scale policy says nobody has to ask", () => {
  const text = scalePolicyText();
  assert.match(text, /Nobody has to ask/i);
  assert.match(text, /nothing here ever\s+waits for the user/i);
});
check("scale policy routes both LARGE and HEAVY to a team", () => {
  const text = scalePolicyText();
  assert.match(text, /LARGE runs as an Agent Team automatically/i);
  assert.match(text, /HEAVY runs as an Agent Team automatically/i);
});
check("scale policy states that starting the team is part of the task", () => {
  const text = scalePolicyText();
  assert.match(text, /create the first shared task and spawn the first teammate BEFORE/i);
  assert.match(text, /LARGE or HEAVY turn that ends with no shared task/i);
});
check("scale policy Rule S7 names the five that engage together", () => {
  const text = scalePolicyText();
  assert.match(text, /## Rule S7 — Project mode: the five engage together/);
  for (const part of [
    "`plannable`",
    "`sandbox-mode`",
    "the senior bar",
    "the audit",
    "the team",
  ]) {
    assert.ok(text.includes(part), `Rule S7 does not name ${part}`);
  }
});
check("scale policy Rule S7 makes the auditor someone other than the author", () => {
  const text = scalePolicyText();
  assert.match(text, /a teammate or `subagent` that did NOT write the code/i);
  assert.match(text, /normally a\s+teammate named `auditor`/i);
  assert.match(text, /The author's own "I checked it" is not\s+an audit/i);
});
check("scale policy Rule S7 gates delivery on the audit", () => {
  const text = scalePolicyText();
  assert.match(text, /no audit finding recorded against the final\s+state is not finished/i);
});
check("scale policy keeps the SMALL single-agent floor next to Rule S7", () => {
  const text = scalePolicyText();
  assert.match(text, /## Rule S2 — SMALL stays single-agent/);
  assert.match(text, /Rule S2 still holds: a SMALL job\s+engages none of this/i);
});
check("skills policy names the nine always-on skills", () => {
  const text = skillsPolicyText();
  assert.match(text, /Nine skills are always-on/);
  for (const name of [
    "sandbox-mode",
    "plannable",
    "organizer",
    "senior-work-audit",
    "senior-system-hardening",
    "senior-code-review",
    "senior-supply-chain-audit",
    "senior-threat-model",
    "senior-release-gate",
  ]) {
    assert.ok(text.includes(`\`${name}\``), `the always-on list omits ${name}`);
  }
});
check("skills policy routes the five deeper senior skills to on-trigger loading", () => {
  const text = skillsPolicyText();
  assert.match(text, /deeper senior skills are \*\*not\*\* always-on/);
  for (const name of [
    "senior-test-adequacy",
    "senior-data-migration-safety",
    "senior-architecture-review",
    "senior-reliability-review",
    "senior-performance-audit",
  ]) {
    assert.ok(text.includes(`\`${name}\``), `the on-trigger list omits ${name}`);
  }
});
check("scale policy keeps SMALL single-agent", () => {
  const text = scalePolicyText();
  assert.match(text, /do not spawn teammates and do not call `subagent` or `subagent_fork`/i);
});
check("scale policy names the Agent Team and Agent loop surfaces", () => {
  const text = scalePolicyText();
  assert.match(text, /team_task_create/);
  assert.match(text, /spawn_teammate/);
  assert.match(text, /maxParallelToolCalls/);
  assert.match(text, /`workflow` tool keeps its own restriction/);
});
check("scale policy contains no unescaped brace pairs", () => {
  assert.ok(!scalePolicyText().includes("{{"), "scale policy text contains {{");
});

// --- degraded harness: no getSectionOrder at all ----------------------------------
const noApi = makeCtx(undefined);
mod.apply(noApi.ctx);
check("missing getSectionOrder degrades to the literal fallback", () => {
  const section = noApi.state.sections.find((s) => s.name === "deepseek-harness:scale-policy");
  assert.ok(section, "scale-policy section missing");
  assert.equal(section.order, 599);
});

// --- degraded harness: table lost the TEAM_POLICY key -----------------------------
const noKey = makeCtx(() => undefined);
mod.apply(noKey.ctx);
check("unknown TEAM_POLICY key degrades to the literal fallback", () => {
  const section = noKey.state.sections.find((s) => s.name === "deepseek-harness:scale-policy");
  assert.ok(section, "scale-policy section missing");
  assert.equal(section.order, 599);
  assert.ok(Number.isFinite(section.order));
});

console.log(results.join("\n"));
console.log(
  process.exitCode === 1
    ? `\nFAILED: ${results.filter((line) => line.startsWith("FAIL")).length} check(s)`
    : `\nPASSED: ${results.length} checks`,
);
