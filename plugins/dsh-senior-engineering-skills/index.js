import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// DeepSeek Harness senior-level engineering skills.
//
// The plugin contributes two things and nothing else:
//   * on-demand skill bodies registered in the catalog, which the model loads itself;
//   * one compact always-on policy section that says when each skill applies and which
//     always-on rules outrank it.
//
// Section names are prefixed `dsh-senior-engineering:` so they cannot collide with a
// first-party `harness:` / `team:` / `tool:` section or with the sibling skills plugin's
// `deepseek-harness:` sections. A duplicate section name in one layer throws during prompt
// assembly, so the prefix is a correctness requirement, not a style choice.

/** Strip the trailing separator `fileURLToPath` keeps for directory URLs on Windows. */
const asDir = (url) => fileURLToPath(url).replace(/[\\/]+$/, "");

// Skill bodies and references resolve against the INSTALLED copy of this package
// (profiles/<name>/node_modules/...), never the source folder.
const PLUGIN_ROOT = asDir(new URL("./", import.meta.url));

// Escape non-builtin {{...}} placeholders so the harness template parser does not choke.
// The skill bodies and the policy section are plain prose today; this keeps a future edit
// that quotes template syntax from breaking every prompt assembly.
const escape = (text) => text.replace(/\{\{(?!(?:cwd|model|provider)\}\})/g, "{ {");

const read = (relative) => escape(readFileSync(new URL(relative, import.meta.url), "utf8"));

// The harness renders a section whose `text` is a function on every assembly, the same form
// @deepseek-ai/dsh-tool-subagent registers. Reading per assembly lets a wording edit to
// prompts/senior-policy.md reach the next model step without restarting the app, and a read
// failure degrades to the text captured at import instead of throwing into someone else's
// prompt assembly. ONLY the policy section is live this way: each skill body below is read
// once in apply(), so editing a body needs a plugin reload.
const liveText = (relative, fallback) => () => {
  try {
    return read(relative);
  } catch {
    return fallback;
  }
};

const POLICY_URL_TEXT = read("./prompts/senior-policy.md");

const SKILLS = [
  {
    file: "./skills/senior-work-audit.md",
    name: "senior-work-audit",
    description:
      "Run a senior-level audit of a change set, a subsystem or a whole repository: correctness, security, performance, operability and maintainability, with every finding carrying evidence and a severity.",
    whenToUse:
      "Use when asked to audit, review, assess, sweep or assess risk over code or work that already exists - a branch, a diff, a service, a package or an entire repository - and for any 'find what is wrong with this' request that covers more than one file.",
  },
  {
    file: "./skills/senior-system-hardening.md",
    name: "senior-system-hardening",
    description:
      "Harden a running system or a build pipeline: least privilege, secrets, network exposure, container and host baselines, logging, backups and recovery, each change tied to a verified control.",
    whenToUse:
      "Use for hardening, securing, locking down, baselining, CIS-style review, secret and credential hygiene, CI/CD trust, container or host configuration, firewall and exposure review, and any request to reduce attack surface on a real deployment.",
  },
  {
    file: "./skills/senior-code-review.md",
    name: "senior-code-review",
    description:
      "Apply the senior code-review bar to a diff: correctness under failure, boundary and error paths, concurrency, data and schema safety, test quality and reviewer-side verification.",
    whenToUse:
      "Use when reviewing or approving a pull request, merge request, patch or local diff, when writing review comments, and when a change must be judged before it lands rather than audited afterwards.",
  },
  {
    file: "./skills/senior-supply-chain-audit.md",
    name: "senior-supply-chain-audit",
    description:
      "Audit the software supply chain: dependency risk and provenance, lockfile and version pinning, SBOM, build reproducibility, artifact signing and CI/CD pipeline trust.",
    whenToUse:
      "Use for dependency, package, vendor or third-party risk questions, lockfile and version-pinning review, SBOM generation or reading, build and release pipeline trust, artifact signing and provenance, and any 'is this dependency safe' request.",
  },
  {
    file: "./skills/senior-threat-model.md",
    name: "senior-threat-model",
    description:
      "Produce a threat model: assets, trust boundaries, entry points, STRIDE-style threat enumeration, abuse cases, mitigations and the residual risk that remains.",
    whenToUse:
      "Use when designing or changing a system boundary, adding authentication, authorization, payment, file upload or multi-tenancy, when asked to threat model or map attack surface, and before implementation of anything security-relevant.",
  },
  {
    file: "./skills/senior-release-gate.md",
    name: "senior-release-gate",
    description:
      "Run a release-readiness gate: what must be proven before a deploy, rollback and migration safety, observability, capacity, runbooks and the explicit go/no-go with its evidence.",
    whenToUse:
      "Use before a deploy, launch, migration, major version or production change, when asked whether something is ready to ship, and when assembling a go/no-go, rollback plan or launch checklist.",
  },
  {
    file: "./skills/senior-test-adequacy.md",
    name: "senior-test-adequacy",
    description:
      "Judge whether the tests actually prove the change: coverage that matters, assertion quality, negative and boundary cases, determinism, and the gap between a green suite and verified behaviour.",
    whenToUse:
      "Use when asking whether tests are sufficient, reviewing a new or existing test suite, when a suite is green but the change is still risky, for flaky or slow tests, and before trusting any coverage number.",
  },
  {
    file: "./skills/senior-data-migration-safety.md",
    name: "senior-data-migration-safety",
    description:
      "Make a schema or data migration safe: expand/contract ordering, reversibility, backfill batching, lock impact, compatibility with old and new code, and the restore drill that proves the backup.",
    whenToUse:
      "Use for any schema migration, data backfill, index build, table rewrite, column drop or type change, and for questions about running a migration without downtime or rolling it back.",
  },
  {
    file: "./skills/senior-architecture-review.md",
    name: "senior-architecture-review",
    description:
      "Review a design against a senior bar: boundaries and coupling, failure isolation, data ownership, evolvability, decision records, and the operational consequences of the shape that was chosen.",
    whenToUse:
      "Use when reviewing a design, RFC, ADR or proposed structure, when a change crosses a service or module boundary, and when the question is choosing between designs rather than reading code.",
  },
  {
    file: "./skills/senior-reliability-review.md",
    name: "senior-reliability-review",
    description:
      "Review reliability the way an on-call engineer experiences it: SLOs and error budgets, observability, alert quality and fatigue, failure and retry semantics, capacity, dependency behaviour and incident readiness.",
    whenToUse:
      "Use for SLO, alerting, observability and on-call readiness questions, when a service is flaky or pages too often, when designing retries, timeouts, circuit breakers or degraded modes, and before or after an incident review.",
  },
  {
    file: "./skills/senior-performance-audit.md",
    name: "senior-performance-audit",
    description:
      "Audit performance by measurement: a baseline before any change, the real bottleneck rather than the suspected one, query and allocation analysis, load shape, and the regression guard that keeps the gain.",
    whenToUse:
      "Use when something is slow or expensive, before and after an optimisation, for query and endpoint profiling, for capacity and load-shape questions, and whenever a performance claim needs a number attached to it.",
  },
];

export const name = "dsh-senior-engineering-skills";
export const inject = ["systemPrompt", "skills"];

export function apply(ctx) {
  // One compact always-on section. Order 160 sits between the sibling skills plugin's
  // `deepseek-harness:skills-policy` (150) and the harness plan policy (500), so this
  // plugin neither shadows nor is shadowed by anything.
  ctx.effect(() =>
    ctx.systemPrompt.section({
      name: "dsh-senior-engineering:policy",
      order: 160,
      text: liveText("./prompts/senior-policy.md", POLICY_URL_TEXT),
    }),
  );

  for (const skill of SKILLS) {
    const content = read(skill.file);
    ctx.effect(() =>
      ctx.skills.register({
        name: skill.name,
        description: skill.description,
        whenToUse: skill.whenToUse,
        source: "dsh-senior-engineering-skills",
        resourceBase: { kind: "directory", path: PLUGIN_ROOT },
        content,
      }),
    );
  }
}
