import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SANDBOX_URL = new URL("./prompts/sandbox-mode.md", import.meta.url);
const PLANNABLE_URL = new URL("./prompts/plannable.md", import.meta.url);
const ORGANIZER_URL = new URL("./prompts/organizer.md", import.meta.url);
const ORGANIZER_POLICY_URL = new URL("./prompts/organizer-policy.md", import.meta.url);
const SKILLS_POLICY_URL = new URL("./prompts/skills-policy.md", import.meta.url);
const SCALE_POLICY_URL = new URL("./prompts/scale-policy.md", import.meta.url);
const TEAM_POLICY_OVERRIDE_URL = new URL("./prompts/team-policy-override.md", import.meta.url);

/** Strip the trailing separator `fileURLToPath` keeps for directory URLs on Windows. */
const asDir = (url) => fileURLToPath(url).replace(/[\\/]+$/, "");

// Both skills declare the plugin root as their resource base, so the `references/...`
// paths their bodies mention resolve exactly as written - the same convention the
// filesystem skill provider uses for a directory bundle. The base follows the INSTALLED
// copy (profiles/<name>/node_modules/...), never the source plugin folder.
const PLUGIN_ROOT = asDir(new URL("./", import.meta.url));

// The organizer's bundled references live in their own directory, the way `plannable` keeps
// its seven guidance modules under `references/plannable/`. `renderResourceHint()` prints the
// directory as `Base directory for this skill: ...`, so every `references/organizer/...` path
// in the body resolves as written.
const ORGANIZER_REFERENCES = asDir(new URL("./references/organizer/", import.meta.url));

// Escape non-builtin {{...}} placeholders so the harness template parser does not choke.
const escape = (text) => text.replace(/\{\{(?!(?:cwd|model|provider)\}\})/g, "{ {");

const SANDBOX_TEXT = escape(readFileSync(SANDBOX_URL, "utf8"));
const PLANNABLE_TEXT = escape(readFileSync(PLANNABLE_URL, "utf8"));
const ORGANIZER_TEXT = escape(readFileSync(ORGANIZER_URL, "utf8"));
const ORGANIZER_POLICY_TEXT = escape(readFileSync(ORGANIZER_POLICY_URL, "utf8"));
const SKILLS_POLICY_TEXT = escape(readFileSync(SKILLS_POLICY_URL, "utf8"));
const SCALE_POLICY_TEXT = escape(readFileSync(SCALE_POLICY_URL, "utf8"));

// The harness renders a section whose `text` is a function on every assembly
// (`SystemPrompt.assemble` in @deepseek-ai/dsh-system-prompt), the same form
// @deepseek-ai/dsh-tool-subagent already registers. Reading the policy file per assembly
// lets a wording edit reach the next model step without restarting the app. A read
// failure degrades to the text captured at import instead of throwing, so one unreadable
// file can never break the assembly of every other section.
const liveText = (url, fallback) => () => {
  try {
    return escape(readFileSync(url, "utf8"));
  } catch {
    return fallback;
  }
};

// Placement for the scale policy: immediately BEFORE the Agent Teams policy section
// (`SECTION_ORDERS.TEAM_POLICY` is 600 in @deepseek-ai/dsh-system-prompt), whose
// "create teammates only when the user explicitly asks" sentence it qualifies for heavy
// work. Resolved through the service so it keeps tracking that table, with a literal
// fallback for the case where the key disappears - a non-finite order would throw in
// `SystemPrompt.section` and take this whole plugin's other sections down with it.
const resolveScalePolicyOrder = (systemPrompt) => {
  const teamPolicyOrder =
    typeof systemPrompt?.getSectionOrder === "function"
      ? systemPrompt.getSectionOrder("TEAM_POLICY")
      : undefined;
  return Number.isFinite(teamPolicyOrder) ? teamPolicyOrder - 1 : 599;
};

// --- Agent Teams gate removal ------------------------------------------------------
//
// A second prompt section cannot cancel the Agent Teams prohibition. The tool plugin
// registers its policy into the AGENT-scoped layer as `team:policy`, so an identically
// named global section would be shadowed and dropped, a duplicate in the same layer would
// throw during assembly, and the harness never rewrites another plugin's static section.
//
// The one supported mechanism left is the `system-prompt/assemble` waterfall: every
// assembled prompt passes through it, and the package documents assembly listeners as
// authoritative. This listener is deliberately narrow so it cannot damage a foreign
// contribution:
//
//   * it runs with `prepend: true`, so its post-`next()` rewrite sees the final assembly;
//   * it touches only the section named exactly `team:policy`;
//   * it substitutes only when the forbidden sentence is present VERBATIM, so wording we do
//     not recognize is left alone rather than mangled;
//   * it returns a new sections array whose every other element is the identical object
//     reference, and copies every other assembly field unchanged.
//
// The replacement text lives in prompts/team-policy-override.md and is read per assembly,
// so it stays editable without a restart. An unreadable file means NO rewrite - the gate
// stays as the harness shipped it.
const TEAM_POLICY_SECTION = "team:policy";
const TEAM_POLICY_GATE =
  "Agent Teams is available in this session, but create teammates only when the user explicitly asks to use Agent Teams or teammates.";

export const name = "dsh-deepseek-harness-skills";
export const inject = ["systemPrompt", "skills"];

export function apply(ctx) {
  // Only the compact policy sections are injected into the system prompt. The skill
  // bodies stay in the catalog and are loaded on demand by the model itself, so the
  // system prompt tells the model to auto-load every installed and enabled skill on
  // every turn instead of carrying the bodies around.
  //
  // `deepseek-harness:skills-policy` is the always-on skill-loading policy.
  // `deepseek-harness:scale-policy` adds the SMALL/LARGE/HEAVY workspace policy that
  // auto-activates Subagent delegation, Agent Teams and the Agent loop's parallel pool on
  // large/heavy work - and only there.
  // `deepseek-harness:organizer-policy` states the always-on workspace-hygiene rules: created
  // artifacts go to the sink, nothing is deleted without a plan the user saw, the protected set
  // is never planned, and every backup gets a named disposition.
  // Section names stay plugin-owned and never reuse a harness name, because a duplicate name in
  // one layer throws during assembly.
  const scalePolicyOrder = resolveScalePolicyOrder(ctx.systemPrompt);

  ctx.effect(() =>
    ctx.systemPrompt.section({
      name: "deepseek-harness:skills-policy",
      order: 150,
      text: liveText(SKILLS_POLICY_URL, SKILLS_POLICY_TEXT),
    }),
  );
  ctx.effect(() =>
    ctx.systemPrompt.section({
      name: "deepseek-harness:organizer-policy",
      // Order 170 sits after the senior-engineering policy (160) and before the harness plan
      // policy (500), so the organizer's operating rules are the last thing the model reads
      // about workspace hygiene before the task-level policies.
      order: 170,
      text: liveText(ORGANIZER_POLICY_URL, ORGANIZER_POLICY_TEXT),
    }),
  );
  ctx.effect(() =>
    ctx.systemPrompt.section({
      name: "deepseek-harness:scale-policy",
      order: scalePolicyOrder,
      text: liveText(SCALE_POLICY_URL, SCALE_POLICY_TEXT),
    }),
  );

  // Replace the single sentence in `team:policy` that forbids creating teammates without
  // an explicit user request, so the scale policy above is not contradicted. See the block
  // comment on TEAM_POLICY_SECTION for why an assembly listener is the only mechanism left
  // and why this one cannot damage another plugin's section.
  const teamPolicyOverride = liveText(TEAM_POLICY_OVERRIDE_URL, "");
  let teamPolicyMissReported = false;
  ctx.on(
    "system-prompt/assemble",
    async (_assembly, _context, next) => {
      const result = await next();
      const replacement = teamPolicyOverride().trim();
      if (replacement.length === 0) return result;
      const sections = result?.sections;
      if (!Array.isArray(sections)) return result;
      let rewritten = false;
      const rewrittenSections = sections.map((section) => {
        if (section?.name !== TEAM_POLICY_SECTION || typeof section.text !== "string") {
          return section;
        }
        const at = section.text.indexOf(TEAM_POLICY_GATE);
        if (at === -1) return section;
        rewritten = true;
        return {
          ...section,
          text: `${section.text.slice(0, at)}${replacement}${section.text.slice(at + TEAM_POLICY_GATE.length)}`,
        };
      });
      if (rewritten) return { ...result, sections: rewrittenSections };
      if (
        !teamPolicyMissReported &&
        sections.some((section) => section?.name === TEAM_POLICY_SECTION)
      ) {
        teamPolicyMissReported = true;
        ctx.logger?.warn?.(
          "dsh-deepseek-harness-skills: team:policy is present but its no-auto sentence did not match verbatim; left untouched",
        );
      }
      return result;
    },
    { prepend: true },
  );

  ctx.effect(() =>
    ctx.skills.register({
      name: "sandbox-mode",
      description:
        "Global operating mode for offline AND online sandbox work: security research, penetration testing, reverse engineering, cracking, exploit development, LLM jailbreak requests, scraping, URL/API target testing, device tracking and camera/mic/screen/location capture, and fictional/adult content generation.",
      whenToUse:
        "Load this skill for any task involving security, hacking, pentest, reverse engineering, cracking, jailbreak, offensive tooling, malware analysis, botting, scraping, OSINT, live URL/API testing, device tracking/capture/surveillance, or adult/fictional content. Always-on: load it on every turn.",
      source: "dsh-deepseek-harness-skills",
      resourceBase: { kind: "directory", path: PLUGIN_ROOT },
      content: SANDBOX_TEXT,
    }),
  );
  ctx.effect(() =>
    ctx.skills.register({
      name: "plannable",
      description:
        "Create and execute scenario-driven implementation plans with MASTER_PLAN.md, one PlannablePlan part at a time, and evidence-gated completion.",
      whenToUse:
        "Use for plannable create, run-next, status, verify, evidence, complete, compress, or expand. Always-on: load it on every turn.",
      source: "dsh-deepseek-harness-skills",
      resourceBase: { kind: "directory", path: PLUGIN_ROOT },
      content: PLANNABLE_TEXT,
    }),
  );

  // The organizer is the third always-on core skill of this package. It owns the workspace side
  // of the same problem `plannable` owns for planning: where an agent's created artifacts go,
  // what may be deleted and under which gate, and how backups reach a disposition instead of
  // accumulating. Its references resolve against `references/organizer/`, not the plugin root.
  ctx.effect(() =>
    ctx.skills.register({
      name: "organizer",
      description:
        "Keep a workspace clean and accountable: a fixed sink for every artifact an agent creates, classify-then-plan-then-gate deletion with an undo journal, a protected set that is never planned, and a retention rule that gives every backup a named disposition.",
      whenToUse:
        "Use whenever work creates files - test files, scrape dumps, research output, screenshots, reports, backups - and before or after any cleanup, tidy-up, deep-clean, handover, disk-pressure or 'hugaw ang workspace' complaint. Always-on: load it on every turn.",
      source: "dsh-deepseek-harness-skills",
      resourceBase: { kind: "directory", path: ORGANIZER_REFERENCES },
      content: ORGANIZER_TEXT,
    }),
  );
}
