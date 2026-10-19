// Verifies the surgical rewrite of the Agent Teams prohibition in the assembled prompt.
//
//   node tools/team-policy-rewrite-test.mjs
//
// The TEAM_POLICY text below is the real POLICY constant of
// @deepseek-ai/dsh-experimental-tool-agent-team (lib/index.js) inside the installed
// app.asar, reproduced verbatim. The first sentence is the gate this plugin removes.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const GATE =
  "Agent Teams is available in this session, but create teammates only when the user explicitly asks to use Agent Teams or teammates.";

const TEAM_POLICY = `Agent Teams is available in this session, but create teammates only when the user explicitly asks to use Agent Teams or teammates.

The Team Lead and all teammates share the same working directory and filesystem. Edits are immediately visible to every member. Split write work into disjoint scopes, record expected write scopes on shared tasks, and use task dependencies when work must be ordered. Write-scope overlap is advisory, not a lock.

Prefer read/edit/write for file changes. If a file operation returns FS_STALE_VERSION, read the current file, rebase your intended change onto the new content, and retry. Bash, formatters, code generators, and scripts are not fully protected by the filesystem version guard; coordinate them explicitly and have the Lead review the final diff and run tests.

Use the target returned by spawn_teammate or list_agents for send_message and interrupt_agent, or as owner when assigning or filtering shared tasks. send_message steers a running target at its nearest step boundary and starts or resumes an inactive target. inactive means no turn is executing; it does not describe task completion, success, failure, or waiting for other agents. provisioning means member creation is in progress; failed means member creation failed. A delivered peer item starts with its stable message id and sender name. A successful send is already durable even when its result says queued; do not resend it. Shared-task workflow is list, get, claim with the current revision, perform the work, then complete. Task readiness never starts an owner. Before wait_agent, use list_agents and make sure another required member is running or provisioning; use send_message first when the required member is inactive. wait_agent observes only changes after that call starts, never wakes a member, and returns noProgress immediately when no other member can produce a change. Re-list after wakeup or timeout. The Lead must wait for required teammates before giving the final answer.`;

const OVERRIDE = readFileSync(new URL("../prompts/team-policy-override.md", import.meta.url), "utf8").trim();

// --- mock ctx that captures the listener -------------------------------------------
const captured = { listeners: [] };
const ctx = {
  systemPrompt: {
    getSectionOrder: () => 600,
    section: () => () => {},
  },
  skills: { register: () => () => {} },
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

const listener = captured.listeners.find((entry) => entry.event === "system-prompt/assemble")?.listener;

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

const OTHER_SECTION = { name: "harness:identity", order: -1000, text: "You are an AI agent powered by DeepSeek Harness." };
const SKILLS_SECTION = { name: "deepseek-harness:skills-policy", order: 150, text: "[SKILLS POLICY]" };
const SCALE_SECTION = { name: "deepseek-harness:scale-policy", order: 599, text: "[SCALE POLICY]" };

const makeAssembly = (teamPolicyText) => ({
  sections: [
    OTHER_SECTION,
    SKILLS_SECTION,
    SCALE_SECTION,
    { name: "team:policy", order: 600, text: teamPolicyText },
    { name: "tool:subagent", order: 2800, text: "Start independent subagent delegations together." },
  ],
  contexts: [{ name: "sandbox-policy", text: "file policy: danger-full-access" }],
  tools: [{ name: "spawn_teammate" }],
  variables: { cwd: "C:\\ws", model: "deepseek-flash" },
});

const run = async (assembly) => listener(assembly, { agent: undefined }, async () => assembly);

// --- the real case -----------------------------------------------------------------
check("the listener was registered", () => {
  assert.equal(typeof listener, "function", "no system-prompt/assemble listener found");
});

const assembly = makeAssembly(TEAM_POLICY);
const out = await run(assembly);
const teamSection = out.sections.find((section) => section.name === "team:policy");

check("the Agent Teams prohibition sentence is gone", () => {
  assert.ok(!teamSection.text.includes(GATE), "the no-auto sentence survived the rewrite");
});
check("the replacement text from the prompt file is injected", () => {
  assert.ok(
    teamSection.text.startsWith(OVERRIDE),
    `team:policy does not start with the override file contents\n--- got ---\n${teamSection.text.slice(0, 400)}`,
  );
});
check("the rest of the Agent Teams policy is byte-identical", () => {
  const remainder = TEAM_POLICY.slice(GATE.length);
  assert.equal(teamSection.text.slice(OVERRIDE.length), remainder);
});
check("only the first line changed", () => {
  const before = TEAM_POLICY.split("\n");
  const after = teamSection.text.split("\n");
  assert.equal(after.length, before.length + OVERRIDE.split("\n").length - 1);
  assert.deepEqual(after.slice(OVERRIDE.split("\n").length), before.slice(1));
});
check("every other section is the identical object, untouched", () => {
  for (const original of assembly.sections) {
    if (original.name === "team:policy") continue;
    const found = out.sections.find((section) => section.name === original.name);
    assert.equal(found, original, `${original.name} was replaced instead of passed through`);
  }
});
check("section count and order are unchanged", () => {
  assert.equal(out.sections.length, assembly.sections.length);
  assert.deepEqual(
    out.sections.map((section) => section.name),
    assembly.sections.map((section) => section.name),
  );
});
check("contexts, tools and variables are passed through by reference", () => {
  assert.equal(out.contexts, assembly.contexts);
  assert.equal(out.tools, assembly.tools);
  assert.equal(out.variables, assembly.variables);
});
check("the original assembly object is not mutated", () => {
  assert.ok(assembly.sections[3].text.includes(GATE), "the input assembly was mutated in place");
});

// --- fail-safe behaviour -----------------------------------------------------------
const changed = makeAssembly("Agent Teams are configured differently now.");
const changedOut = await run(changed);
check("FAIL-SAFE: unknown team:policy wording is left completely alone", () => {
  assert.equal(changedOut, changed, "the assembly was replaced although nothing matched");
  assert.equal(changedOut.sections[3].text, "Agent Teams are configured differently now.");
});
check("FAIL-SAFE: a section that merely contains the sentence is not touched", () => {
  const decoy = {
    sections: [{ name: "someone:else", order: 10, text: `prefix ${GATE} suffix` }],
    contexts: [],
    tools: [],
    variables: {},
  };
  return run(decoy).then((result) => {
    assert.equal(result, decoy);
    assert.equal(result.sections[0].text, `prefix ${GATE} suffix`);
  });
});
check("FAIL-SAFE: an assembly without team:policy is returned unchanged", () => {
  const empty = { sections: [OTHER_SECTION], contexts: [], tools: [], variables: {} };
  return run(empty).then((result) => assert.equal(result, empty));
});
check("NEGATIVE CONTROL: the gate really is the text being matched", () => {
  assert.ok(TEAM_POLICY.startsWith(GATE), "the fixture no longer starts with the gate sentence");
  assert.ok(OVERRIDE.length > 0, "the override file is empty, so no rewrite would happen");
});

console.log(results.join("\n"));
console.log(
  process.exitCode === 1
    ? `\nFAILED: ${results.filter((line) => line.startsWith("FAIL")).length} check(s)`
    : `\nPASSED: ${results.length} checks`,
);
