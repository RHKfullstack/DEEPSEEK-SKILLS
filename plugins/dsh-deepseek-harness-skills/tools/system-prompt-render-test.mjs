// PART-003 verification: render the WHOLE system prompt the way the running harness does,
// with the plugin's sections mixed into the real harness sections, and prove the assembly
// is not damaged by the new scale policy.
//
//   node tools/system-prompt-render-test.mjs
//
// The renderer functions below are ported verbatim from
// @deepseek-ai/dsh-system-prompt/lib/index.js inside the installed app.asar
// (SECTION_ORDERS lines 10-43, comparePromptSections lines 96-99, renderPrompt line 114,
// interpolate lines 152-177). They are pure and dependency-free, so they port exactly.
// The TEAM_POLICY sentence is quoted verbatim from the real
// @deepseek-ai/dsh-experimental-tool-agent-team POLICY constant in the same archive.

import { strict as assert } from "node:assert";

// --- ported: SECTION_ORDERS --------------------------------------------------------
const SECTION_ORDERS = {
  HARNESS_IDENTITY: -1e3,
  DEPLOYMENT_PERSONA_PREFIX: 0,
  PLAN_POLICY: 500,
  TEAM_POLICY: 600,
  TOOL_SUBAGENT: 2800,
  DEPLOYMENT_PERSONA_SUFFIX: 10200,
};

// --- ported: interpolate -----------------------------------------------------------
const VARIABLE_NAME = /^[a-z][a-z0-9_]*$/;
const GROUP_AT = /^\{\{([^{}]*)\}\}/;
function interpolate(input, variables, kind) {
  const text = input.text;
  let result = "";
  let last = 0;
  for (let open = text.indexOf("{{"); open >= 0; open = text.indexOf("{{", last)) {
    const group = GROUP_AT.exec(text.slice(open));
    if (group === null) {
      if (text.indexOf("}}", open + 2) >= 0) {
        throw new Error(
          `malformed prompt variable reference at "${text.slice(open, open + 16)}…" in ${kind} "${input.name}" (references are complete simple {{name}} groups)`,
        );
      }
      result += text.slice(last, open + 2);
      last = open + 2;
      continue;
    }
    const name = group[0].slice(2, -2);
    if (!VARIABLE_NAME.test(name)) {
      throw new Error(
        `malformed prompt variable reference "{{${name}}}" in ${kind} "${input.name}" (variable names match ${String(VARIABLE_NAME)})`,
      );
    }
    if (!Object.hasOwn(variables, name)) {
      const known = Object.keys(variables);
      throw new Error(
        `unknown prompt variable "{{${name}}}" in ${kind} "${input.name}"; registered variables: ${known.length > 0 ? known.join(", ") : "(none)"}`,
      );
    }
    const value = variables[name];
    if (value === undefined) {
      throw new Error(
        `prompt variable "{{${name}}}" has no value for this assembly (${kind} "${input.name}")`,
      );
    }
    result += text.slice(last, open) + value;
    last = open + group[0].length;
  }
  return result + text.slice(last);
}

// --- ported: comparePromptSections + renderPrompt ----------------------------------
const compareNames = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const comparePromptSections = (a, b) => a.order - b.order || compareNames(a.name, b.name);
function renderPrompt(assembly) {
  return assembly.sections
    .map((section) =>
      section.interpolate === false
        ? section.text
        : interpolate(section, assembly.variables, "section"),
    )
    .filter((text) => text.length > 0)
    .join("\n\n");
}

// --- the plugin's own escaping rule, copied from index.js --------------------------
// Kept in sync by the registration test, which asserts the shipped sections contain no
// surviving "{{" before escaping is even considered.
const escape = (text) => text.replace(/\{\{(?!(?:cwd|model|provider)\}\})/g, "{ {");

// --- mock Cordis context, same shape the registration test uses --------------------
const captured = { sections: [], skills: [], listeners: [] };
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
  on: (event, listener, options) => {
    captured.listeners.push({ event, listener, options });
    return () => {};
  },
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

// --- the real harness sections this prompt is composed of --------------------------
const TEAM_POLICY_FIRST_PARAGRAPH =
  "Agent Teams is available in this session, but create teammates only when the user explicitly asks to use Agent Teams or teammates.";

const harnessSections = [
  {
    name: "harness:identity",
    order: SECTION_ORDERS.HARNESS_IDENTITY,
    text: "You are an AI agent powered by DeepSeek Harness.",
  },
  {
    name: "deployment:persona-prefix",
    order: SECTION_ORDERS.DEPLOYMENT_PERSONA_PREFIX,
    text: "You are a coding agent powered by the {{model}} model.",
  },
  {
    name: "plan:policy",
    order: SECTION_ORDERS.PLAN_POLICY,
    text: "Plan mode is active.",
  },
  {
    name: "team:policy",
    order: SECTION_ORDERS.TEAM_POLICY,
    text: TEAM_POLICY_FIRST_PARAGRAPH,
  },
  {
    name: "tool:subagent",
    order: SECTION_ORDERS.TOOL_SUBAGENT,
    text: "Start independent subagent delegations together in one assistant message and continue useful work while they run.",
  },
  {
    name: "deployment:persona-suffix",
    order: SECTION_ORDERS.DEPLOYMENT_PERSONA_SUFFIX,
    text: "Your working directory is {{cwd}}.",
  },
];

const pluginSections = captured.sections.map((section) => ({
  name: section.name,
  order: section.order,
  text: section.text(),
}));

const variables = { cwd: "C:\\workspace", model: "deepseek-flash", provider: "deepseek-official" };
const sections = [...harnessSections, ...pluginSections].sort(comparePromptSections);

let rendered;
check("the whole prompt renders without throwing", () => {
  rendered = renderPrompt({ sections, variables });
  assert.ok(rendered.length > 0);
});
check("no section was dropped", () => {
  assert.equal(sections.length, harnessSections.length + pluginSections.length);
  assert.equal(
    sections.filter((section) => section.text.length === 0).length,
    0,
    "a section rendered empty and was filtered out",
  );
});
check("every pre-existing harness section still reaches the prompt", () => {
  for (const section of harnessSections) {
    const expected = interpolate(section, variables, "section");
    assert.ok(rendered.includes(expected), `${section.name} text missing from the render`);
  }
});
check("both plugin policy sections reach the prompt", () => {
  assert.ok(rendered.includes("[SKILLS POLICY — DeepSeek Harness Edition]"));
  assert.ok(rendered.includes("[SCALE POLICY — Automatic Agent Escalation]"));
});
check("harness variables still interpolate", () => {
  assert.ok(rendered.includes("powered by the deepseek-flash model"), "{{model}} not substituted");
  assert.ok(rendered.includes("Your working directory is C:\\workspace."), "{{cwd}} not substituted");
  assert.ok(!rendered.includes("{{model}}") && !rendered.includes("{{cwd}}"), "a variable survived");
});
check("the scale section sorts immediately before team:policy", () => {
  const names = sections.map((section) => section.name);
  const scaleIndex = names.indexOf("deepseek-harness:scale-policy");
  const teamIndex = names.indexOf("team:policy");
  assert.ok(scaleIndex >= 0, "scale section missing from the assembly");
  assert.equal(scaleIndex, teamIndex - 1, `order was ${names.join(" > ")}`);
});
check("the scale section still precedes the team policy in the rendered text", () => {
  assert.ok(
    rendered.indexOf("[SCALE POLICY — Automatic Agent Escalation]") <
      rendered.indexOf(TEAM_POLICY_FIRST_PARAGRAPH),
  );
});
check("the skills policy keeps its place before plan:policy", () => {
  const names = sections.map((section) => section.name);
  assert.ok(names.indexOf("deepseek-harness:skills-policy") < names.indexOf("plan:policy"));
});
check("no duplicate section name reached the assembly", () => {
  const names = sections.map((section) => section.name);
  assert.equal(new Set(names).size, names.length);
});

// --- negative controls: the assertions above must be able to fail ------------------
check("NEGATIVE CONTROL: an unknown variable still throws", () => {
  assert.throws(
    () => interpolate({ name: "x", text: "{{not_a_variable}}" }, variables, "section"),
    /unknown prompt variable "{{not_a_variable}}"/,
  );
});
check("NEGATIVE CONTROL: a malformed reference still throws", () => {
  assert.throws(
    () => interpolate({ name: "x", text: "{{ not a variable }}" }, variables, "section"),
    /malformed prompt variable reference/,
  );
});
check("NEGATIVE CONTROL: an unregistered value still throws", () => {
  assert.throws(
    () => interpolate({ name: "x", text: "{{cwd}}" }, {}, "section"),
    /unknown prompt variable/,
  );
});
check("the escape layer neutralises a bare {{ so interpolation cannot throw", () => {
  const hostile = escape("policy mentions {{placeholder}} and keeps {{cwd}}");
  assert.equal(hostile, "policy mentions { {placeholder}} and keeps {{cwd}}");
  assert.ok(!hostile.includes("{{placeholder"));
  assert.equal(
    interpolate({ name: "escaped", text: hostile }, variables, "section"),
    "policy mentions { {placeholder}} and keeps C:\\workspace",
  );
});
check("a policy file containing {{ would fail loudly, not silently", () => {
  const hostileSection = { name: "deepseek-harness:scale-policy", order: 599, text: "bad {{nope}} here" };
  assert.throws(
    () => renderPrompt({ sections: [...harnessSections, hostileSection], variables }),
    /unknown prompt variable "{{nope}}"/,
  );
});

console.log(results.join("\n"));
console.log(
  process.exitCode === 1
    ? `\nFAILED: ${results.filter((line) => line.startsWith("FAIL")).length} check(s)`
    : `\nPASSED: ${results.length} checks`,
);
