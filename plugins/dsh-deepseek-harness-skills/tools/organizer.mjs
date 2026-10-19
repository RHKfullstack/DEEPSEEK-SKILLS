#!/usr/bin/env node
// organizer.mjs - the deterministic organizer engine.
//
// WHAT IT IS
//   The enforcing half of the `organizer` skill. It finds agent-created repository
//   litter, classifies it from EVIDENCE (git state, on-disk metadata, content probes,
//   whether the current session recorded creating it), and then either reports it or
//   quarantines it behind an explicit, per-class approval gate. Nothing here is
//   advisory: `apply` re-verifies every target immediately before it touches it and
//   refuses anything the plan did not already say.
//
// SURFACE (every command accepts --json and prints {schemaVersion, kind, data})
//   inventory   --root <dir> [--json]
//   plan        --root <dir> --level <minimal|light|standard|deep|immaculate>
//               [--scope session|repo] [--out <plan.json>] [--json]
//   apply       --plan <plan.json> [--approve-s2] [--confirm <id,id>] [--only <id,id>] [--json]
//   undo        --journal <journal.json> [--json]
//   disposition --root <dir> --level <level> [--set <id>=<kept|removed|landed|deferred|accepted>:<reason>]... [--json]
//   doctor      [--json]
//
// EXIT CODES
//   0 ok   2 usage   3 not found   5 drift (an item changed since planning)   6 findings / failures / unaccounted
//   Precedence when several apply: 2 or 3 (nothing was attempted) > 5 (drift) > 6 (refusals) > 0.
//
// SAFETY INVARIANTS - a violation is a defect, not a style choice
//   I1 NO SHELL DELETION. Every mutation goes through the `node:fs` APIs. No path is ever
//      interpolated into a shell string, and nothing is executed through a shell: the only
//      child process in this file is `spawnSync("git", [args], { shell: false })`. The
//      `shell` field in a plan item is DOCUMENTATION of the equivalent command - it is
//      never executed (each item carries `shellExecuted: false`). The recorded incident
//      class this exists to prevent is `rm -rf $VAR` with an unresolved variable.
//   I2 CONTAINMENT. Every target is resolved (realpath) and proven to sit strictly inside
//      the containment root before it is touched. A target that is, or that is reached
//      through, a symlink or NTFS junction is refused outright - never followed.
//   I3 PROTECTED SET. `.git/**`, `.env*`, key material, git-tracked files, `docs/**`,
//      `vendor/**`, `node_modules/**`, `storage/app/**`, the engine's own state and the
//      root itself are never planned at any level, and each exclusion is reported by path
//      with its reason.
//   I4 RE-VERIFY AT APPLY. `apply` re-checks size + mtime + sha256 (or the tree digest for
//      a directory) before each action. Drift means: skip THAT item, keep going, exit 5.
//   I5 GATES. S2 needs --approve-s2. S3 needs --confirm <id> naming that exact item.
//      A refusal is reported, never routed around, and never silently downgraded.
//   I6 JOURNAL. Every action is journalled with its inverse, so `undo` can restore S1 and
//      S2 quarantines and can honestly report what it could NOT restore.
//   I7 WINDOWS-SAFE. Both separators, long paths, read-only files, non-regular filesystem
//      objects (reserved device names) and unreadable files are handled without crashing.
//
// Evidence-first: a classification is only ever *raised* by evidence, never lowered. Each
// artifact records the rule that matched, the signals behind it, and any class raises, so a
// reviewer can audit the decision instead of trusting the engine.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------

const SCHEMA_VERSION = 1;
const IS_WINDOWS = process.platform === "win32";

const EXIT = { OK: 0, USAGE: 2, NOT_FOUND: 3, DRIFT: 5, FINDINGS: 6 };

const LEVELS = ["minimal", "light", "standard", "deep", "immaculate"];
const LEVEL_RANK = new Map(LEVELS.map((name, index) => [name, index]));

const SCOPES = ["session", "repo"];

// The seven artifact kinds the skill documents. `protected` is not an artifact kind - it is
// the reason an entry never becomes one.
const KIND = {
  TEST_ARTIFACT: "test-artifact",
  TEST_CONTENT: "test-content",
  EMPTY_DIR: "empty-dir",
  SCRAPE_RAW: "scrape-raw",
  JUNK_NAMED: "junk-named",
  BUILD_OUTPUT: "build-output",
  BACKUP: "backup",
  UNTRACKED_WORK: "untracked-work",
  IGNORED_OTHER: "ignored-other",
  PROTECTED: "protected",
};

const SAFETY = ["S0", "S1", "S2", "S3"];

// Item dispositions. `pending` is the only one that counts as unaccounted for.
const DISPOSITIONS = ["kept", "removed", "landed", "deferred", "accepted", "pending"];

const ACTIONS = {
  NONE: "none",
  REPORT: "report",
  MOVE: "move",
  PURGE: "purge",
  // Settle an empty directory: remove it, with a journalled mkdir inverse so `undo` recreates it.
  SETTLE: "settle",
  // Move a detected test file into the project's own test tree. Never a sink move, never a purge.
  ROUTE: "route-to-test-tree",
};

// Every action `apply` is allowed to perform. A plan is a hand-editable artifact, so an action
// the engine does not recognise is refused by name rather than treated as one it does know.
const KNOWN_ACTIONS = new Set(Object.values(ACTIONS));

const DEFAULT_LIMITS = {
  // Above this, hashing is partial (first MiB + last 64 KiB + size + mtime) and the item
  // says so. 891 MB backups must not be read twice per run.
  maxHashBytes: 32 * 1024 * 1024,
  // Above this, an item cannot be quarantined cheaply, so its class is raised to S3.
  maxSinkBytes: 256 * 1024 * 1024,
  // A scan that would exceed this is truncated and the run reports failure rather than
  // pretending it saw everything.
  maxWalkEntries: 200000,
  // A directory whose planned members reach this count collapses into one dir item.
  aggregateMin: 25,
  // Content probes only ever read this much of a file's head.
  headBytes: 4096,
  // Upper bound on the basenames sent to one `git grep` reference check. Above it the check is
  // reported as not-run and the candidates are raised a class rather than silently assumed clean.
  maxReferenceChecks: 2000,
  // V5-1: directories the "is this root above another repository" search may visit. This is a WORK
  // bound, deliberately not a depth bound: a depth bound made the guard's miss silent one level
  // past its cap, which is the defect. When this budget runs out without an answer the plan is
  // refused rather than applied unproven - see `findNestedRepository`.
  nestedRepoScanDirs: 20000,
};

const envInt = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

const limitsFromEnv = () => ({
  maxHashBytes: envInt("DSH_ORGANIZER_MAX_HASH_BYTES", DEFAULT_LIMITS.maxHashBytes),
  maxSinkBytes: envInt("DSH_ORGANIZER_MAX_SINK_BYTES", DEFAULT_LIMITS.maxSinkBytes),
  maxWalkEntries: envInt("DSH_ORGANIZER_MAX_WALK", DEFAULT_LIMITS.maxWalkEntries),
  aggregateMin: envInt("DSH_ORGANIZER_AGGREGATE_MIN", DEFAULT_LIMITS.aggregateMin),
  headBytes: DEFAULT_LIMITS.headBytes,
  maxReferenceChecks: DEFAULT_LIMITS.maxReferenceChecks,
  nestedRepoScanDirs: envInt("DSH_ORGANIZER_NEST_SCAN_DIRS", DEFAULT_LIMITS.nestedRepoScanDirs),
});

const JUNK_SMALL_BYTES = 1024 * 1024;

// Directory basenames that mark regenerable build/cache output. Anything else that git
// ignores and that no rule recognises stays an owner decision - "ignored" is not evidence
// that a file is disposable.
const BUILD_DIR_NAMES = new Set([
  "dist",
  "dist-app",
  "build",
  "out",
  "output",
  "coverage",
  "playwright-report",
  "test-results",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".parcel-cache",
  ".turbo",
  ".cache",
  "__pycache__",
  "target",
]);

// Output that a RUNNING app serves from disk. Removing it degrades the app until it is
// rebuilt, so it is only proposed at `immaculate` even though it is regenerable.
const LIVE_RUNTIME_PREFIXES = [
  "public/build",
  "bootstrap/cache",
  "storage/framework",
  "storage/logs",
];

// Source-controlled-adjacent directories that mark raw scrape payloads. Corroborating
// evidence only - a payload still has to look like a payload.
const SCRAPE_DIR_MARKERS = new Set(["_raw", "raw", "_scrape", "scrape", "scrapes", "_captures"]);

// The doctrine's own artifact sink. `.work/<date>-<slug>/` holds the deliverables of an agent
// run, and the engine was planning its `raw/` and `_raw/` payloads for removal because `raw` is
// a mandated sink subdirectory AND a scrape marker. The sink and everything under it are never
// items, at any level: the run's own output is not litter.
const WORK_SINK_SEGMENT = ".work";

// Directories a framework REQUIRES to exist even when they are empty. An empty one is not
// stale: removing it breaks the app on the next boot, so they are never settled.
const FRAMEWORK_KEEP_DIRS = [
  "storage/framework/cache",
  "storage/framework/sessions",
  "storage/framework/views",
  "storage/app/public",
  "bootstrap/cache",
];

// Where a project's test tree lives. Used to decide whether a detected test file can be routed
// home; `scope` is the directory the test tree holds directly (`tests/Feature` -> `tests`).
const TEST_TREE_ROOTS = [
  { rel: "tests", scope: "tests" },
  { rel: "test", scope: "test" },
  { rel: "spec", scope: "spec" },
  { rel: "specs", scope: "specs" },
  { rel: "__tests__", scope: "__tests__" },
];

// Extensions a detected test file may be routed into the test tree with. A test in a language
// this list does not cover is reported instead of moved.
const ROUTABLE_TEST_EXTENSIONS = new Set([
  "php",
  "js",
  "mjs",
  "cjs",
  "jsx",
  "ts",
  "tsx",
  "vue",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "cs",
  "ps1",
  "sh",
  "bash",
]);

// Content signals for a file that was never NAMED as a test but whose content is for testing.
// STRONG signals name a test framework or runner: they are confident on their own. WEAK signals
// are ordinary words that also appear in production code, so they only ever corroborate - a hit
// with no strong signal is deliberately left on its existing rule. That is the "ambiguous hit
// must not become disposably removable" rule, enforced by never reclassifying on a weak hit.
const TEST_CONTENT_STRONG = [
  ["phpunit-use", /use\s+PHPUnit\\/],
  ["extends-testcase", /extends\s+TestCase\b/],
  ["public-function-test", /public\s+function\s+test/i],
  ["jest", /\bjest\s*\./],
  ["vitest", /\bvitest\b/i],
  ["testing-library", /@testing-library/],
  ["cypress", /\bcypress\b/i],
  ["playwright", /\bplaywright\b/i],
  ["describe-block", /\bdescribe\s*\(/],
  ["before-each", /\bbeforeEach\s*\(/],
  ["python-pytest", /\bimport\s+pytest\b/],
  ["python-def-test", /\bdef\s+test_[A-Za-z0-9_]*\s*\(/],
  ["python-unittest", /\bunittest\b/],
  // Pester is PowerShell's actual test framework, and V2-3 proved the literal token `Pester`
  // alone misses a real test file: an idiomatic Pester test writes `Describe 'x' { It 'y' { ... } }`
  // and never says "Pester". The framework's own block cmdlets with a QUOTED name are the
  // reliable marker - Pester writes `Describe 'name' {`, capitalised and without a parenthesis,
  // which the lowercase `describe(` JS pattern above deliberately does not match. The `Should`
  // assertion is corroboration (it is also how Pester is written), so it stays WEAK and never
  // decides on its own.
  ["powershell-pester", /\bPester\b/],
  ["powershell-describe-block", /\b(?:Describe|Context)\s+['"][^'"]+['"]\s*\{/],
  ["powershell-it-block", /\bIt\s+['"][^'"]+['"]\s*\{/],
];

const TEST_CONTENT_WEAK = [
  ["pest-it", /(^|[^\w$])it\s*\(/],
  ["test-call", /(^|[^\w$])test\s*\(/],
  ["expect-call", /(^|[^\w$])expect\s*\(/],
  ["phpunit-assert", /->assert[A-Za-z]/],
  ["python-assert", /^\s*assert\s+\S/m],
  // Ordinary production cmdlets. A deploy script, an API client or a health check is written
  // with exactly these, so they corroborate and never decide: a file whose only signal is one
  // of them keeps its existing rule instead of being relocated into the test tree.
  ["powershell-diagnostic", /\bInvoke-(?:RestMethod|WebRequest|Expression|Command)\b/],
  // V2-3: Pester's real assertion syntax is `Should -Be` / `| Should -Not -BeNullOrEmpty`, not
  // the leading-hyphen `-Should` the old pattern required - that pattern matched nothing Pester
  // ever writes. Still a weak signal: `Should` is a plausible function name in production
  // PowerShell, so it corroborates a Describe/It block rather than deciding on its own.
  ["powershell-should", /\bShould\s+-[A-Za-z]/],
];

// A probe script: shell or PowerShell that reads like a throwaway check. A shebang alone is
// ordinary scripting, so it only counts when the body also carries a probe/assert signal - and
// even then it is a weak signal, because probe scripts are routinely kept.
const SHEBANG_RE = /^#!.*\b(?:sh|bash|zsh|pwsh|powershell|python3?)\b/i;
const PROBE_BODY_RE = /^\s*(?:echo|Write-(?:Host|Output|Error)|exit\s|Assert-|if\s*\(|throw\b)/im;

/**
 * Run the content probe and record what it found. Returns a classified artifact for a STRONG
 * signal; returns null for a weak-only or no-signal result, leaving the file on whatever rule the
 * table reaches. A weak hit is stashed on the node so that ANY fall-through path can attach it to
 * its evidence via `inheritTestProbe` - recording what the engine looked at is house style, and a
 * fall-through path that drops it would make the report look clean by omission.
 */
const applyTestContentProbe = (node, context, evidence, rel) => {
  if (node.type !== "file") return null;
  if (testTreeOf(rel) !== null) return null;
  const ext = extensionOf(rel);
  if (!ROUTABLE_TEST_EXTENSIONS.has(ext)) return null;
  const probe = probeTestContent(node.abs, ext);
  const { strong, weak } = probe;
  if (strong === null) {
    if (weak.length > 0) node.testProbe = { signal: "weak-only", strong: null, weak };
    return null;
  }
  const destination = context.testTree && context.routeTarget
    ? context.routeTarget(rel, context.testTree.rel)
    : null;
  const free = destination !== null && safeLstat(path.join(context.rootReal, destination)) === null;
  evidence.testProbe = { signal: strong, strong, weak };
  evidence.signals.push(`content-probe:${strong}`);
  if (destination !== null && free) {
    return {
      kind: KIND.TEST_CONTENT,
      rule: "test-content",
      reason: `content is a test (\`${strong}\`) but the file sits outside the test tree; route it to \`${destination}\``,
      action: ACTIONS.ROUTE,
      minLevelOverride: "standard",
      routeTarget: destination,
      evidence,
    };
  }
  const whyNot = destination === null
    ? "no test tree was found in this project"
    : `the destination \`${destination}\` already exists`;
  return {
    kind: KIND.TEST_CONTENT,
    rule: "test-content",
    reason: `content is a test (\`${strong}\`) outside the test tree: ${whyNot}; reported, never removed`,
    action: ACTIONS.REPORT,
    minLevelOverride: "standard",
    evidence,
  };
};

/** Attach whatever the content probe found, so a fall-through path never loses it. */
const inheritTestProbe = (node, evidence) => {
  if (!node.testProbe || evidence.testProbe) return;
  evidence.testProbe = node.testProbe;
  evidence.signals.push(`content-probe:weak-only:${node.testProbe.weak[0]}`);
};

const PAYLOAD_EXTENSIONS = new Set([
  "json",
  "jsonl",
  "ndjson",
  "html",
  "htm",
  "txt",
  "csv",
  "tsv",
  "bin",
  "log",
  "xml",
  "har",
  "body",
  "resp",
]);

const SOURCE_EXTENSIONS = new Set([
  "php",
  "js",
  "mjs",
  "cjs",
  "jsx",
  "ts",
  "tsx",
  "vue",
  "svelte",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "cs",
  "ps1",
  "sh",
  "bash",
  "bat",
  "cmd",
  "sql",
  "blade",
  "css",
  "scss",
  "less",
  "md",
  "mdx",
  "yml",
  "yaml",
  "toml",
  "ini",
  "env",
  "vbs",
  "graphql",
  "proto",
]);

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif", "ico"]);

// Kinds for which "a tracked file names this" means the file is USED, and therefore must not be
// removed. Generated output is excluded on purpose - see the reference pass in `analyze`.
const REFERENCE_SENSITIVE_KINDS = new Set([
  "junk-named",
  "ignored-other",
  "scrape-raw",
  "backup",
  "untracked-work",
]);

const CONFIG_EXTENSIONS = new Set(["json", "yml", "yaml", "ini", "conf", "cfg", "toml", "env"]);

// Files that name other paths in order to EXCLUDE them. They are never treated as evidence
// that a candidate is used.
const IGNORE_RULE_FILES = new Set([
  ".gitignore",
  ".gitattributes",
  ".gitmodules",
  ".ignore",
  ".npmignore",
  ".dockerignore",
  ".eslintignore",
  ".prettierignore",
]);

// Windows reserved device names. A real file can carry one of these names, and the plain
// path can also resolve to the device, so these are always at least S2 and never S1.
const RESERVED_DEVICE_RE = /^(nul|con|prn|aux|com[1-9]|lpt[1-9])(\..*)?$/i;

// Name patterns that make an untracked/ignored item a junk candidate. Every match is
// recorded as evidence.junkPattern so the decision can be audited rather than trusted. The
// third element marks a pattern that only applies at the repository ROOT - `dsh-parity-audit`
// inside tests/ is a test suite, while `dsh-scan-asar.cjs` at the root is agent scratch.
const JUNK_NAME_PATTERNS = [
  [RESERVED_DEVICE_RE, "windows-reserved-device-name"],
  [/^\.dsh[-.]/i, "agent-scratch-prefix"],
  [/^dsh[-.](scan|asar|skill|extract|probe|scratch|junk|litter)/i, "agent-scratch-prefix"],
  [/^dsh[-.](scan|asar|skill)/i, "agent-scratch-prefix", true],
  [/^\.?(agent|ai|tmp|temp|scratch|throwaway)[-_.]/i, "scratch-prefix", true],
  [/^_\d/, "part-scratch-prefix"],
  [/^_(p|part|ws|ph|phase)\d*/i, "part-scratch-prefix"],
  [/^_shots?([-_.]|$)/i, "shots-scratch-prefix"],
  [/^(untitled|new[-_ ]?(text|file|document))/i, "untitled"],
  [/^\$/, "editor-lock"],
  [/^~\$/, "office-lock"],
  [/~$/, "editor-backup-suffix"],
  [/^copy of /i, "finder-copy"],
  [/[-_ ]copy(\.[^.]+)?$/i, "finder-copy"],
  [/\(\d+\)(\.[^.]+)?$/, "duplicate-suffix"],
  [/\.(tmp|temp|bak|backup|orig|old|rej|swp|swo|part|crdownload|download)$/i, "temp-extension"],
  [/\.(err|out)$/i, "run-output-extension"],
  [/\.out\.txt$/i, "run-output-extension"],
  [/\.(rdb|dump)$/i, "runtime-dump-extension"],
  [/-check\.(png|jpe?g|webp|gif|html?)$/i, "check-artifact"],
  [/^(screenshot|screen-shot|shot|capture|snap)[-_.].*\.(png|jpe?g|webp)$/i, "capture-artifact"],
  [/^(dump|core)\.[a-z0-9]+$/i, "runtime-dump"],
  [/\.log$/i, "log-file"],
];

const BACKUP_NAME_PATTERNS = [
  [/\.(bak|backup|old|orig|prev|save)$/i, "backup-extension"],
  [/~$/, "editor-backup-suffix"],
  [/[-_.]backup([-_.]|$)/i, "backup-infix"],
  [/^(db|database|dump|site|codebase|www)[-_.].*\.(sql|gz|zip|tar|tgz|7z|rar|dump)$/i, "backup-archive"],
  [/^.*\d{4}[-_]\d{2}[-_]\d{2}.*\.(zip|tar|tgz|gz|7z|rar|sql|dump|exe|msi|dmg)$/i, "dated-backup-archive"],
  [/\.sql\.gz$/i, "backup-archive"],
];

const BACKUP_DIR_NAMES = new Set(["backup", "backups", "_backup", "_backups", "db-backups"]);

// Directory names that mark a project's own test tree. Used to decide whether a file that LOOKS
// like a test already sits where it belongs.
const TEST_DIR_NAMES = new Set(["test", "tests", "__tests__", "spec", "specs", "__mocks__", "cypress", "e2e"]);

// Root-level dot-directories are tool configuration, not litter. They are reported,
// dispositioned `kept` by policy and never proposed for removal.
const ROOT_CONFIG_DOTDIR_RE = /^\.[a-z0-9][a-z0-9._-]*$/i;
const ROOT_CONFIG_DOTDIR_ALLOW = new Set([".git", ".github"]); // .git protected; .github usually tracked

// ---------------------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------------------

const toPosix = (value) => value.split(path.sep).join("/");

const nowIso = () => new Date().toISOString();

const sha256Hex = (value) => createHash("sha256").update(value).digest("hex");

const truncate = (value, length) =>
  typeof value === "string" && value.length > length ? `${value.slice(0, length - 1)}â€¦` : value;

const bytesHuman = (value) => {
  if (!Number.isFinite(value)) return "?";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let n = value;
  let unit = 0;
  while (n >= 1024 && unit < units.length - 1) {
    n /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? n : n.toFixed(1)} ${units[unit]}`;
};

const ageDaysOf = (mtimeMs) =>
  Math.max(0, Math.round(((Date.now() - mtimeMs) / 86400000) * 10) / 10);

const isoOrNull = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);

/** Case-insensitive "is `target` inside `root`" using already-resolved absolute paths. */
const isInsidePath = (root, target) => {
  const normalRoot = IS_WINDOWS ? root.toLowerCase() : root;
  const normalTarget = IS_WINDOWS ? target.toLowerCase() : target;
  if (normalTarget === normalRoot) return true;
  const withSep = normalRoot.endsWith(path.sep) ? normalRoot : normalRoot + path.sep;
  return normalTarget.startsWith(withSep);
};

/** True when the resolved path differs from the lexical path by more than letter case. */
const pathDiffersBeyondCase = (a, b) => {
  if (a === b) return false;
  return IS_WINDOWS ? a.toLowerCase() !== b.toLowerCase() : true;
};

const compareRel = (a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0);

/**
 * Key for every git-state lookup. Windows paths are case-insensitive while git records the
 * index case, so a tracked file whose on-disk case differs must still read as tracked - if it
 * did not, a tracked file that also matched a junk pattern could be planned for removal.
 */
const trackKey = (rel) => (IS_WINDOWS ? toPosix(rel).toLowerCase() : toPosix(rel));

const isUnderPrefixCI = (rel, prefix) => {
  const value = trackKey(rel);
  const base = trackKey(prefix).replace(/\/+$/, "");
  return value === base || value.startsWith(`${base}/`);
};

const safeLstat = (abs) => {
  try {
    return lstatSync(abs);
  } catch {
    return null;
  }
};

/**
 * V3-1 for `undo`. A journal is a hand-editable JSON file, so an entry's inverse path is a
 * claim. Every restore must be checked against the entry's own `rel` - the same derivation
 * `apply` uses - and refused when the two disagree. Returns the refusal reason, or null.
 */
const restoreMismatch = (rootReal, entryRel, inverseAbs) => {
  if (typeof entryRel !== "string" || entryRel === "") {
    return "journal entry carries no rel; its restore target cannot be derived, so it is refused";
  }
  if (typeof inverseAbs !== "string" || inverseAbs === "") {
    return "journal entry carries no restore path";
  }
  const derived = path.resolve(rootReal, toPosix(entryRel));
  if (pathDiffersBeyondCase(path.resolve(inverseAbs), derived)) {
    return `journal inverse does not match the path derived from its rel (rel resolves to ${derived}, inverse says ${path.resolve(inverseAbs)}); refusing to restore`;
  }
  return null;
};

/**
 * The canonical relative path of an absolute target, with each segment folded to the case the
 * filesystem actually stores (V3-1). `path.relative` alone is not enough on a case-insensitive
 * volume: a plan may write `Docs/guide.md` for `docs/guide.md`, and `protectionReason` matches
 * `segments[0] === "docs"` case-sensitively, so the protection decision would inspect a path the
 * action does not use. Walking the ancestors and taking each one's `realpath` gives the on-disk
 * form, which is what the predicate and the git-tracked key both expect. A segment that cannot be
 * resolved keeps its given spelling; the walk stops rather than guessing.
 */
const canonicalRelFor = (rootReal, abs) => {
  const relative = path.relative(rootReal, abs);
  if (relative === "") return "";
  const segments = relative.split(/[\\/]+/).filter((segment) => segment !== "");
  // Fold every ANCESTOR to its on-disk spelling. The leaf is folded too when it resolves - it has
  // to be, because the spelling a plan used is exactly what a caller compares against this result,
  // and V4-5 was a comment that claimed the opposite. So a leaf whose case differs from what the
  // filesystem stores (`Docs/GUIDE.MD` for `docs/guide.md`) comes back folded, the caller's
  // canonical-form check sees a mismatch and refuses it; a leaf that cannot be resolved keeps the
  // spelling it was given. The fold is what makes the answer independent of how the path was typed.
  let current = rootReal;
  for (const segment of segments.slice(0, -1)) {
    const next = path.join(current, segment);
    const resolved = realpathSyncSafe(next);
    if (resolved === null) break;
    current = resolved;
  }
  const leaf = segments[segments.length - 1];
  const leafResolved = realpathSyncSafe(path.join(current, leaf));
  const leafParentReal = leafResolved === null ? null : realpathSyncSafe(path.dirname(leafResolved));
  const foldedLeaf = leafParentReal === null ? leaf : path.basename(leafResolved);
  return toPosix(path.relative(rootReal, path.join(current, foldedLeaf)));
};

/**
 * THE ONE GATE EVERY SOURCE AND DESTINATION GOES THROUGH (round 5).
 *
 * Three rounds of audit findings had the same shape: a fix landed on one arm and the next arm did
 * not inherit it. F2 hardened `apply` and left `undo`; V2-1 fixed apply's operand and left the
 * canonical form; V3-2 fixed undo's `move` arm and left its `route` arm (V4-1). Each fix was
 * correct and each was narrower than the invariant, because the invariant lived in a call site
 * instead of in one place. This function is that place.
 *
 * Every absolute path this engine is about to act on - apply's target, apply's route destination,
 * undo's restore source, undo's restore destination, a settle's directory and a purge's target -
 * must be passed through here first, and a non-null return is a refusal. A new arm that calls this
 * inherits containment, canonical form, link refusal, the protected set and the git-tracked
 * re-check by construction; a new arm that forgets to call it is the only way to be unguarded, and
 * the harness asserts each arm's call site individually.
 *
 * Options, all defaulting to the strict reading:
 *   role            "target" | "destination" | "source" - only used in the refusal wording.
 *   claimedRel      the relative path the caller was handed (a plan item's or journal entry's
 *                   `rel`). Supplying it turns on the canonical-form refusal: when the claimed
 *                   string is not already the canonical form of the path being acted on, the
 *                   operand is refused. Omit it only where there is no claimed rel to compare
 *                   against (a derived route destination, a purge target read from a plan row
 *                   that was already canonicalised).
 *   allowMissing    (default false) the path is EXPECTED not to exist yet (a route destination,
 *                   a directory about to be created), so absence is not drift.
 *   followLinks     (default false) resolve the path through a link and judge the real location.
 *                   Only `apply`'s item target sets this, so a plan rooted at a container
 *                   directory is judged by where the file really is (V4-3); the helper returns
 *                   `realAbs` so the caller can act on the path it just checked.
 *   git             the live git state, or null to skip the tracked re-check.
 *   requireGit      (default false) refuse when git state is unavailable instead of skipping the
 *                   re-check. `apply` sets this: "I cannot prove what is tracked here" must not
 *                   read as "nothing is tracked here" (V4-3).
 *
 * Returns `{ reason: null, relDecided, realAbs }` when the path may be acted on, else
 * `{ reason: "<what refused it>", relDecided, realAbs }`.
 */
const validateOperand = (rootReal, absInput, protectionContext, options = {}) => {
  const {
    role = "target",
    claimedRel = null,
    requireCanonical = claimedRel !== null,
    allowMissing = false,
    followLinks = false,
    git = null,
    requireGit = false,
    // V5-3: an operand that legitimately lives outside the repository - a `move` entry's restore
    // source sits in the engine's sink - is expressed as a DIFFERENT containment root rather than
    // as rules the caller skips. Expressing it as "skip the rules" is what let V4-2 and then V5-2
    // exist: a hand-rolled location rule without the type rule beside it is exactly that defect.
    // With `containerRoot` the type, missing and canonical rules all run unchanged, and only the
    // protected set is out of scope (it is defined relative to the repository, not the sink).
    containerRoot = rootReal,
    containerLabel = null,
    skipProtection = false,
  } = options;
  const label = role === "source" ? "restore source" : role === "destination" ? "destination" : "target";
  const container = path.resolve(containerRoot ?? rootReal);
  const containerName = containerLabel ?? "the containment root";
  const refuse = (reason, relDecided = null, realAbs = null) => ({ reason, relDecided, realAbs });

  if (typeof absInput !== "string" || absInput === "") {
    return refuse(`${label} is missing; refusing to derive a path from nothing`);
  }
  const abs = path.resolve(absInput);

  // 1. Containment, decided on the resolved path so `..` cannot escape.
  if (!isInsidePath(container, abs)) {
    return refuse(`${label} is outside ${containerName}`);
  }
  if (abs === container) {
    return refuse(`${containerName} itself is never an item`);
  }

  // 2. Type. A link is never followed, whatever the caller intends to do with it. This is the
  //    check V4-2 was missing on the undo SOURCE side: a junction planted inside the sink passed
  //    the location test and was renamed into the repository.
  const stats = safeLstat(abs);
  if (stats !== null && stats.isSymbolicLink() && !followLinks) {
    return refuse(`${label} is a symlink or junction (never followed)`);
  }
  if (stats === null && !allowMissing) {
    return refuse(`${label} disappeared when it was about to be acted on`);
  }

  // 3. Resolve through links, then re-check containment on the real location.
  let realAbs = abs;
  if (followLinks) {
    const resolved = realpathSyncSafe(abs);
    if (resolved !== null && pathDiffersBeyondCase(resolved, abs)) {
      if (!isInsidePath(container, resolved)) {
        return refuse(`${label} resolves outside ${containerName} (${resolved})`);
      }
      realAbs = resolved;
    }
  }

  // 4. Canonical form: the decision must be made on the same path the action will use. Folding to
  //    the on-disk spelling makes `Docs/x` decide as `docs/x`; a caller that holds the claimed
  //    `rel` additionally gets a refusal when the two differ, which is what rejects a
  //    non-canonical rel (`./x`, `a/../x`, a case variant) on every arm that supplies one.
  const relDecided = canonicalRelFor(container, realAbs);
  if (requireCanonical) {
    const claimed = toPosix(claimedRel);
    if (claimed !== relDecided) {
      return refuse(`${label}'s rel is not in canonical relative form (rel is "${claimed}", which resolves to "${relDecided}")`, relDecided, realAbs);
    }
  }

  // 5. The protected set, plus the git-tracked re-check on the canonical form. Both are defined
  //    relative to the REPOSITORY, so an operand judged against another container (the sink)
  //    skips them explicitly - named here rather than implied by the caller not calling the gate.
  if (skipProtection) return refuse(null, relDecided, realAbs);
  const protectedBy = protectionReason(relDecided, protectionContext);
  if (protectedBy !== null) {
    return refuse(`${label} is protected now: ${protectedBy}`, relDecided, realAbs);
  }
  if (git !== null) {
    if (!git.available && requireGit) {
      return refuse("git state is unavailable for this root, so tracked-file protection cannot be established", relDecided, realAbs);
    }
    if (git.available && git.tracked.has(trackKey(relDecided))) {
      return refuse(`${label} is tracked by git now (protected since planning)`, relDecided, realAbs);
    }
  }

  return refuse(null, relDecided, realAbs);
};

const safeReaddir = (abs) => {
  try {
    return readdirSync(abs, { withFileTypes: true });
  } catch (error) {
    return { error: error.code ?? "EUNKNOWN" };
  }
};

/**
 * V4-2: is this path a symlink or NTFS junction? Small on purpose.
 *
 * `validateOperand` decides this for every operand that lives inside the root, but a `move`
 * entry's restore source lives in the sink, which is outside the root by design, so the gate
 * stops it at containment before it can report on the type. That exemption is about LOCATION
 * only - the sink rule answers for where the source may be - and it must not quietly exempt the
 * type rule as well, which is exactly how a junction planted inside the validated sink came to be
 * renamed into the repository.
 */
const isLinkOperand = (abs) => {
  const stats = safeLstat(abs);
  return stats !== null && stats.isSymbolicLink();
};

/**
 * V4-3 / V5-1: is `rootReal` a strict ancestor of a directory carrying its own `.git`?
 *
 * The walk already protects a nested repository wholesale during planning ("a nested git
 * repository or worktree (a directory carrying its own `.git`) is protected in full"), because its
 * tracked set belongs to that repository and is not visible from here. At apply time the same fact
 * means something sharper: a plan whose root sits ABOVE such a repository was not cut against the
 * tree it is about to change, and re-rooting the plan is exactly how the round-4 audit moved
 * `docs/**`, a tracked file and a nested `.git/config` at exit 0.
 *
 * **Round 5 bounded this at six levels of depth, and the bound made the guard's miss silent one
 * level past its cap** (V5-1): a repository at level 7 was not found, `requireGit` cannot help
 * because the plan's root IS a repository with readable git state, and three target classes moved
 * at exit 0. A depth cap was the wrong control: the risk it was guarding against is unbounded
 * WORK, not depth, and depth is already bounded by the filesystem - links are never descended
 * (`dirent.isDirectory()` is false for a junction) so there is no cycle to run away from.
 *
 * So the budget counts directories VISITED, not levels, and the walk reports exhaustion instead of
 * returning a bare "not found". The caller must refuse the plan when the search is exhausted,
 * because "I ran out of budget" is not "there is nothing there" - the same fail-closed rule the
 * git re-check follows.
 *
 * Returns `{ repo, exhausted, visited, unreadable }`: `repo` is the offending directory or null;
 * `exhausted` is true when the search stopped before it could prove absence, either because it ran
 * out of budget or because it met a directory it could not read; `unreadable` names that directory
 * when that is what happened, so the refusal can say which of the two it was.
 */
const findNestedRepository = (rootReal, budget = limitsFromEnv().nestedRepoScanDirs) => {
  const queue = [rootReal];
  let cursor = 0;
  let visited = 0;
  while (cursor < queue.length) {
    const dir = queue[cursor];
    cursor += 1;
    const listing = safeReaddir(dir);
    // V6-2: a directory this engine could not read is an UNPROVEN absence, not an empty one. This
    // was a bare `continue`, which made "I could not list this directory" read as "there is
    // nothing nested here" - so a repository hidden behind one ACL'd directory was missed and the
    // plan applied over it at exit 0, moving a file out of a repository the plan was never cut
    // against. That is the same reasoning the budget below already follows, left uncovered for
    // this case. It is also the rule `plan` applies: an unreadable subtree is reported as a scan
    // error and fails the run, so skipping it silently at apply time contradicted the planner.
    // It is reported separately from the budget so the refusal can say which one happened.
    if (!Array.isArray(listing)) return { repo: null, exhausted: true, visited, unreadable: dir };
    for (const dirent of listing) {
      if (!dirent.isDirectory()) continue;
      // A `.git` entry is the marker we look for, never a directory to descend into.
      if (dirent.name === ".git") continue;
      visited += 1;
      if (visited > budget) return { repo: null, exhausted: true, visited, unreadable: null };
      const child = path.join(dir, dirent.name);
      // A `.git` may be a directory (ordinary repository) or a file (worktree or submodule); both
      // mean the directory's tracked set is not ours to reason about.
      if (existsSync(path.join(child, ".git"))) return { repo: child, exhausted: false, visited, unreadable: null };
      queue.push(child);
    }
  }
  return { repo: null, exhausted: false, visited, unreadable: null };
};

const ensureDir = (abs) => {
  mkdirSync(abs, { recursive: true });
  return abs;
};

const readHead = (abs, byteCount) => {
  let fd = null;
  try {
    fd = openSync(abs, "r");
    const buffer = Buffer.alloc(byteCount);
    const read = readSync(fd, buffer, 0, byteCount, 0);
    return buffer.subarray(0, read);
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* the probe is best-effort; a failed close must not fail the scan */
      }
    }
  }
};

/** Single-quote a path for the DOCUMENTED shell field. Never executed - see I1. */
const quoteForShell = (abs) =>
  IS_WINDOWS ? `'${abs.replace(/'/g, "''")}'` : `'${abs.replace(/'/g, "'\\''")}'`;

/**
 * The equivalent command an operator would run by hand. Documentation only: the engine
 * performs the action through fs APIs, and each plan item records `shellExecuted: false`.
 */
const equivalentShell = (action, from, to) => {
  if (action === ACTIONS.MOVE || action === ACTIONS.ROUTE) {
    return IS_WINDOWS
      ? `Move-Item -LiteralPath ${quoteForShell(from)} -Destination ${quoteForShell(to)}`
      : `mv -- ${quoteForShell(from)} ${quoteForShell(to)}`;
  }
  if (action === ACTIONS.PURGE) {
    return IS_WINDOWS
      ? `Remove-Item -LiteralPath ${quoteForShell(from)} -Recurse -Force`
      : `rm --recursive --force -- ${quoteForShell(from)}`;
  }
  if (action === ACTIONS.SETTLE) {
    // Settle removes an EMPTY directory only, so this documents the non-recursive form.
    return IS_WINDOWS
      ? `Remove-Item -LiteralPath ${quoteForShell(from)}`
      : `rmdir -- ${quoteForShell(from)}`;
  }
  return null;
};

const itemIdFor = (rel) => `it-${sha256Hex(toPosix(rel).toLowerCase()).slice(0, 10)}`;

const levelRank = (level) => {
  const rank = LEVEL_RANK.get(level);
  return rank === undefined ? null : rank;
};

// ---------------------------------------------------------------------------------------
// Hashing / fingerprints
// ---------------------------------------------------------------------------------------

const sha256FileRange = (abs, start, length) => {
  let fd = null;
  try {
    fd = openSync(abs, "r");
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(1024 * 1024);
    let position = start;
    let remaining = length;
    while (remaining > 0) {
      const want = Math.min(buffer.length, remaining);
      const read = readSync(fd, buffer, 0, want, position);
      if (read <= 0) break;
      hash.update(buffer.subarray(0, read));
      position += read;
      remaining -= read;
    }
    return hash.digest("hex");
  } catch (error) {
    return { error: error.code ?? "EUNKNOWN" };
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* nothing to do: an unreadable file is reported as meta-only */
      }
    }
  }
};

/**
 * Cheap-but-honest content digest. Files above the hash cap get a partial digest that still
 * covers head, tail, size and mtime, and the fingerprint says `mode: "partial"` so nobody
 * mistakes it for a whole-file hash.
 */
const hashForFile = (abs, size, mtimeMs, limits) => {
  if (size <= limits.maxHashBytes) {
    const digest = sha256FileRange(abs, 0, size);
    if (typeof digest === "string") return { mode: "full", sha256: digest };
    return { mode: "meta", sha256: null, unreadable: digest.error };
  }
  const headLength = Math.min(1024 * 1024, size);
  const tailLength = Math.min(64 * 1024, Math.max(0, size - headLength));
  const head = sha256FileRange(abs, 0, headLength);
  if (typeof head !== "string") return { mode: "meta", sha256: null, unreadable: head.error };
  const tail = tailLength > 0 ? sha256FileRange(abs, size - tailLength, tailLength) : "";
  if (tailLength > 0 && typeof tail !== "string") {
    return { mode: "meta", sha256: null, unreadable: tail.error };
  }
  const marker = `\u0000${size}\u0000${mtimeMs}`;
  return {
    mode: "partial",
    sha256: sha256Hex(`${head}:${tailLength > 0 ? tail : ""}:${marker}`),
  };
};

/** Directory digest over (rel, size, mtimeMs) of every descendant - stat-only, no reads. */
const fingerprintDirectory = (abs, limits) => {
  const lines = [];
  let entries = 0;
  let bytes = 0;
  const stack = [{ dir: abs, rel: "" }];
  while (stack.length > 0) {
    const current = stack.pop();
    const listing = safeReaddir(current.dir);
    if (Array.isArray(listing)) {
      for (const dirent of listing) {
        const childAbs = path.join(current.dir, dirent.name);
        const rel = current.rel === "" ? dirent.name : `${current.rel}/${dirent.name}`;
        const stats = safeLstat(childAbs);
        if (stats === null) {
          lines.push(`${rel}|missing`);
          continue;
        }
        if (stats.isSymbolicLink()) {
          lines.push(`${rel}|link|${stats.size}`);
          continue;
        }
        if (stats.isDirectory()) {
          stack.push({ dir: childAbs, rel });
          continue;
        }
        entries += 1;
        bytes += stats.size;
        lines.push(`${rel}|${stats.size}|${Math.trunc(stats.mtimeMs)}`);
        if (entries > limits.maxWalkEntries) break;
      }
    }
    if (entries > limits.maxWalkEntries) break;
  }
  lines.sort();
  return {
    mode: "tree",
    sha256: sha256Hex(lines.join("\n")),
    entries,
    bytes,
  };
};

const fingerprintFor = (abs, type, limits) => {
  if (type === "dir") return fingerprintDirectory(abs, limits);
  const stats = safeLstat(abs);
  if (stats === null) return { mode: "missing" };
  const size = stats.size;
  const mtimeMs = Math.trunc(stats.mtimeMs);
  const hashed = hashForFile(abs, size, mtimeMs, limits);
  return { mode: hashed.mode, size, mtimeMs, sha256: hashed.sha256, unreadable: hashed.unreadable };
};

const fingerprintsEqual = (a, b) => {
  if (!a || !b) return false;
  if (a.mode !== b.mode) return false;
  if (a.mode === "tree") {
    return a.sha256 === b.sha256 && a.entries === b.entries;
  }
  return a.size === b.size && a.mtimeMs === b.mtimeMs && a.sha256 === b.sha256;
};

/** Every action that may be performed on a target. Used for fingerprints and reference checks. */
const isActingAction = (action) =>
  action === ACTIONS.MOVE || action === ACTIONS.PURGE || action === ACTIONS.SETTLE || action === ACTIONS.ROUTE;

const fingerprintSummary = (fingerprint) => {
  if (!fingerprint) return "none";
  if (fingerprint.mode === "tree") {
    return `tree ${String(fingerprint.sha256).slice(0, 12)} (${fingerprint.entries} entries)`;
  }
  if (fingerprint.mode === "missing") return "missing";
  const hash = fingerprint.sha256 ? String(fingerprint.sha256).slice(0, 12) : "(unreadable)";
  return `${fingerprint.mode} ${hash} ${fingerprint.size}B mtime=${fingerprint.mtimeMs}`;
};

// ---------------------------------------------------------------------------------------
// State: sink, journals, session record, owner decisions
// ---------------------------------------------------------------------------------------

const stateRootDir = () =>
  process.env.DSH_ORGANIZER_STATE && process.env.DSH_ORGANIZER_STATE.trim() !== ""
    ? path.resolve(process.env.DSH_ORGANIZER_STATE.trim())
    : path.join(os.homedir(), ".dsh", "organizer");

const rootStateDir = (rootReal) =>
  path.join(stateRootDir(), "roots", sha256Hex(rootReal.toLowerCase()).slice(0, 10));

const statePaths = (rootReal) => {
  const base = rootStateDir(rootReal);
  return {
    base,
    sink: path.join(base, "sink"),
    journals: path.join(base, "journals"),
    plans: path.join(base, "plans"),
    tmp: path.join(base, "tmp"),
    session: path.join(base, "session.json"),
    decisions: path.join(base, "dispositions.json"),
  };
};

/**
 * The session record is how "the current run's own record created it" becomes evidence.
 * Format (written by the agent or the owner, read-only for this engine):
 *   { "schemaVersion": 1, "root": "<abs>", "created": ["rel/path", "other/rel"] }
 * Env override: DSH_ORGANIZER_SESSION_RECORD=<file>.
 */
const readSessionRecord = (rootReal) => {
  const override = process.env.DSH_ORGANIZER_SESSION_RECORD;
  const file =
    override && override.trim() !== "" ? path.resolve(override.trim()) : statePaths(rootReal).session;
  if (!existsSync(file)) {
    return { path: file, found: false, created: [], note: "no session record; S1 requires one" };
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    const created = Array.isArray(parsed?.created)
      ? parsed.created.map((value) => toPosix(String(value)).replace(/^\.\//, "")).filter(Boolean)
      : [];
    return {
      path: file,
      found: true,
      root: typeof parsed?.root === "string" ? parsed.root : null,
      created,
      note: parsed?.note ?? null,
    };
  } catch (error) {
    return {
      path: file,
      found: false,
      created: [],
      unreadable: error.message,
      note: "session record exists but could not be parsed",
    };
  }
};

/**
 * Restore-drill evidence. A backup is "verified" ONLY when a human (or an agent) recorded a
 * drill for it - the engine never restores a backup to test it, so it must not infer that a
 * copy works. Format, at `<state>/roots/<hash>/restore-evidence.json`:
 *   { "schemaVersion": 1, "root": "<abs>",
 *     "verified": { "<rel-or-family>": { "drilledAt": "<iso>", "target": "<where>", "note": "<why>" } } }
 * With no file, every copy is unverified and the retention policy keeps rather than removes.
 */
const readRestoreEvidence = (rootReal) => {
  const file = path.join(rootStateDir(rootReal), "restore-evidence.json");
  if (!existsSync(file)) {
    return { path: file, found: false, verified: {}, note: "no restore-drill evidence recorded" };
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    const verified = parsed && typeof parsed.verified === "object" && parsed.verified !== null
      ? parsed.verified
      : {};
    return { path: file, found: true, verified, root: typeof parsed.root === "string" ? parsed.root : null };
  } catch (error) {
    return {
      path: file,
      found: false,
      verified: {},
      unreadable: error.message,
      note: "restore evidence exists but could not be parsed; nothing is treated as verified",
    };
  }
};

/** A copy counts as drill-verified when its own rel OR its family carries a `drilledAt`. */
const isRestoreVerified = (rel, family, restoreEvidence) => {
  const own = restoreEvidence.verified?.[rel];
  if (own && typeof own.drilledAt === "string" && own.drilledAt !== "") return true;
  const familyRecord = restoreEvidence.verified?.[family];
  return Boolean(familyRecord && typeof familyRecord.drilledAt === "string" && familyRecord.drilledAt !== "");
};

const readDecisions = (rootReal) => {
  const file = statePaths(rootReal).decisions;
  if (!existsSync(file)) return { path: file, decisions: {} };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    const decisions = parsed && typeof parsed.decisions === "object" && parsed.decisions !== null
      ? parsed.decisions
      : {};
    return { path: file, decisions };
  } catch {
    return { path: file, decisions: {}, unreadable: true };
  }
};

const writeDecisions = (rootReal, decisions, root) => {
  const file = statePaths(rootReal).decisions;
  ensureDir(path.dirname(file));
  writeFileSync(
    file,
    `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, root, updatedAt: nowIso(), decisions }, null, 2)}\n`,
    "utf8",
  );
  return file;
};

const readJournals = (rootReal) => {
  const dir = statePaths(rootReal).journals;
  if (!existsSync(dir)) return [];
  const names = readdirSync(dir).filter((name) => name.endsWith(".json")).sort();
  const journals = [];
  for (const name of names) {
    const file = path.join(dir, name);
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      if (parsed && parsed.kind === "journal" && parsed.data) {
        journals.push({ file, journal: parsed.data });
      }
    } catch {
      journals.push({ file, journal: null, unreadable: true });
    }
  }
  return journals;
};

/** Applied actions resolved per item by TIMESTAMP, so journals cannot depend on file order. */
const appliedActionsById = (rootReal) => {
  const latest = new Map();
  for (const entry of readJournals(rootReal)) {
    if (!entry.journal || !Array.isArray(entry.journal.entries)) continue;
    for (const record of entry.journal.entries) {
      if (typeof record.id !== "string") continue;
      const prior = latest.get(record.id);
      const at = typeof record.at === "string" ? record.at : "";
      if (prior && prior.at >= at) continue;
      latest.set(record.id, {
        at,
        action: record.action,
        rel: record.rel,
        journal: entry.file,
        restorable: record.restorable === true,
        // The entry the owner undid is no longer in effect, so the item is back in scope.
        restored: record.undoStatus === "restored",
        status: record.status,
      });
    }
  }
  const applied = new Map();
  for (const [id, record] of latest) {
    if (record.restored || record.status !== "applied") continue;
    applied.set(id, record);
  }
  return applied;
};

// ---------------------------------------------------------------------------------------
// Git layer. One spawn per question; never a shell (I1).
// ---------------------------------------------------------------------------------------

const gitVersion = () => {
  const result = spawnSync("git", ["--version"], { encoding: "utf8", windowsHide: true, shell: false });
  if (result.error || result.status !== 0) {
    return { found: false, version: null, error: result.error?.code ?? "not-on-path" };
  }
  return { found: true, version: String(result.stdout).trim() };
};

const runGit = (cwd, args) =>
  spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
    shell: false,
  });

/**
 * Tracked / ignored state for the whole containment root in two git calls.
 * Tracked files are protected; ignored paths are candidates; everything else is untracked.
 */
const readGitState = (rootReal) => {
  const version = gitVersion();
  if (!version.found) {
    return {
      available: false,
      reason: "git not found on PATH",
      tracked: new Set(),
      ignoredFiles: new Set(),
      ignoredDirs: [],
      trackedCount: 0,
      ignoredCount: 0,
    };
  }
  const top = runGit(rootReal, ["rev-parse", "--show-toplevel"]);
  if (top.status !== 0) {
    return {
      available: false,
      reason: "not a git work tree",
      gitVersion: version.version,
      tracked: new Set(),
      ignoredFiles: new Set(),
      ignoredDirs: [],
      trackedCount: 0,
      ignoredCount: 0,
    };
  }
  const topLevel = realpathSyncSafe(String(top.stdout).trim());

  const tracked = new Set();
  const trackedOut = runGit(rootReal, ["ls-files", "-z", "--full-name"]);
  if (trackedOut.status === 0 && typeof trackedOut.stdout === "string") {
    for (const raw of trackedOut.stdout.split("\u0000")) {
      if (raw === "") continue;
      const abs = path.resolve(topLevel, raw);
      if (isInsidePath(rootReal, abs)) tracked.add(trackKey(path.relative(rootReal, abs)));
    }
  }

  const ignoredFiles = new Set();
  const ignoredDirs = [];
  const statusOut = runGit(rootReal, [
    "status",
    "--porcelain=v1",
    "-z",
    "--ignored",
    "--untracked-files=normal",
  ]);
  if (statusOut.status === 0 && typeof statusOut.stdout === "string") {
    const records = statusOut.stdout.split("\u0000");
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      if (record.length < 4) continue;
      const code = record.slice(0, 2);
      const relRaw = record.slice(3);
      if (code[0] === "R" || code[0] === "C") index += 1; // rename/copy carries a second field
      if (code !== "!!") continue;
      const rel = toPosix(relRaw);
      if (rel.endsWith("/")) ignoredDirs.push(rel.replace(/\/+$/, ""));
      else ignoredFiles.add(trackKey(rel));
    }
  }

  let head = null;
  let branch = null;
  const headOut = runGit(rootReal, ["rev-parse", "--short", "HEAD"]);
  if (headOut.status === 0) head = String(headOut.stdout).trim();
  const branchOut = runGit(rootReal, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branchOut.status === 0) branch = String(branchOut.stdout).trim();

  return {
    available: true,
    gitVersion: version.version,
    topLevel,
    rootIsTopLevel: !pathDiffersBeyondCase(topLevel, rootReal),
    tracked,
    ignoredFiles,
    ignoredDirs: ignoredDirs.sort(),
    trackedCount: tracked.size,
    ignoredCount: ignoredFiles.size + ignoredDirs.length,
    head,
    branch,
  };
};

const realpathSyncSafe = (abs) => {
  try {
    return realpathSync.native(abs);
  } catch {
    return path.resolve(abs);
  }
};

/**
 * Which candidate basenames appear in git-tracked files. One `git grep` for all of them
 * (patterns from a file, so the command line stays short), then attribute each hit by
 * reading the matched tracked file. A referenced item is never planned for removal.
 */
const findReferences = (rootReal, basenames, limits, tmpDir) => {
  const result = { checked: 0, referenced: new Map(), mode: "none", note: null };
  if (basenames.length === 0) return result;
  const candidates = [...new Set(basenames)].filter((name) => name.length > 0);
  if (candidates.length === 0) return result;
  if (candidates.length > limits.maxReferenceChecks) {
    result.mode = "skipped";
    result.note = `reference check skipped: ${candidates.length} candidates exceeds ${limits.maxReferenceChecks}`;
    return result;
  }
  const patternFile = path.join(ensureDir(tmpDir), `refs-${sha256Hex(candidates.join("|")).slice(0, 8)}.txt`);
  writeFileSync(patternFile, `${candidates.join("\n")}\n`, "utf8");
  const grep = runGit(rootReal, ["grep", "-l", "-F", "-f", patternFile]);
  if (grep.status !== 0 && grep.status !== 1) {
    result.mode = "unavailable";
    result.note = `git grep failed: ${truncate(String(grep.stderr ?? "").trim(), 200)}`;
    return result;
  }
  result.mode = "git-grep";
  result.checked = candidates.length;
  const hits = String(grep.stdout ?? "")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");
  for (const hit of hits) {
    const abs = path.resolve(rootReal, hit);
    if (!isInsidePath(rootReal, abs)) continue;
    // An ignore-rule file names paths in order to EXCLUDE them. Counting `.gitignore` as a
    // reference would make every ignored item permanently unremovable - the exact opposite of
    // what the file means - so those files are not evidence of use.
    if (IGNORE_RULE_FILES.has(basenameOf(toPosix(hit)))) continue;
    let text;
    try {
      const stats = statSync(abs);
      if (stats.size > 8 * 1024 * 1024) continue;
      text = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    for (const name of candidates) {
      if (!text.includes(name)) continue;
      const list = result.referenced.get(name) ?? [];
      if (list.length < 5) list.push(toPosix(hit));
      result.referenced.set(name, list);
    }
  }
  return result;
};

// ---------------------------------------------------------------------------------------
// Tool probe (doctor)
// ---------------------------------------------------------------------------------------

const TRASH_CANDIDATES = ["trash", "trash-put", "gio", "recycle"];

const probeTool = (name) => {
  const result = spawnSync(name, ["--version"], {
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    timeout: 5000,
  });
  if (result.error) return { name, found: false, reason: result.error.code ?? "unavailable" };
  if (result.status !== 0) return { name, found: false, reason: `exit ${result.status}` };
  return { name, found: true, version: truncate(String(result.stdout).trim().split(/\r?\n/)[0], 80) };
};

const probeTools = () => {
  const git = gitVersion();
  const trashProbes = TRASH_CANDIDATES.map(probeTool);
  const found = trashProbes.filter((probe) => probe.found);
  return {
    git,
    trashProbes,
    trashTool: found.length > 0 ? found[0].name : null,
    // I5 support: with no trash tool a removal has no native recovery path, so S2 removal
    // candidates are raised to S3 (per-item --confirm). S1 is unaffected: its recovery is
    // the sink plus the undo journal, which the engine owns.
    raiseS2WhenNoTrash: found.length === 0,
  };
};

const doctorReport = () => {
  const tools = probeTools();
  const stateDir = stateRootDir();
  const findings = [];
  if (!tools.git.found) {
    findings.push({
      severity: "high",
      message:
        "git is not available: tracked files cannot be protected and no removal is planned; classes are raised one step",
    });
  }
  if (tools.trashTool === null) {
    findings.push({
      severity: "info",
      message:
        "no trash CLI on PATH (trash/trash-put/gio): S2 removal candidates are raised to S3 and need --confirm <id>; S1 items keep the sink+journal recovery path",
    });
  }
  findings.push({
    severity: "info",
    message: `quarantine sink: ${path.join(stateDir, "roots", "<rootHash>", "sink")} (outside the repository; recovery is \`undo\`)`,
  });
  return {
    platform: process.platform,
    release: os.release(),
    node: process.version,
    stateDir,
    stateDirExists: existsSync(stateDir),
    tools,
    limits: limitsFromEnv(),
    findings,
  };
};

// ---------------------------------------------------------------------------------------
// Protection (I3)
// ---------------------------------------------------------------------------------------

/**
 * Why an entry is protected, or null when it is in scope. Protection is decided by path and
 * by git state only - never by size, age or guesswork.
 */
const protectionReason = (rel, context) => {
  const posix = toPosix(rel);
  if (posix === "" || posix === ".") return "the containment root itself is never an item";
  const segments = posix.split("/");
  const base = segments[segments.length - 1];
  const lower = base.toLowerCase();

  if (segments[0] === ".git") return "git internals (.git/**)";
  // The doctrine's own artifact sink (Rule O1: `<root>/.work/<date>-<slug>/`). Its mandated
  // subdirectories include `raw/` and `_raw/`, which are ALSO scrape markers, so without this
  // rule the engine plans the current run's own deliverables for removal. Matched on a captured
  // `.work` segment rather than only the root one, so a nested sink is protected too.
  if (segments.some((segment) => segment.toLowerCase() === WORK_SINK_SEGMENT)) {
    return "agent artifact sink (.work/**) is never planned and never walked";
  }
  if (segments.includes("node_modules")) return "dependency tree (node_modules/**)";
  if (segments.includes("vendor")) return "vendored dependencies (vendor/**)";
  if (segments[0] === "docs") return "owner-protected documentation root (docs/**)";
  if (segments[0] === "storage" && segments[1] === "app") {
    return "runtime application state (storage/app/**)";
  }
  if (lower === ".env" || lower.startsWith(".env.") || lower.startsWith(".env")) {
    return "environment/secrets file (.env*)";
  }
  if (
    /\.(pem|key|pfx|p12|jks|keystore|ppk|asc|gpg|der|crt|cer)$/i.test(base) ||
    /^id_(rsa|dsa|ecdsa|ed25519)/i.test(base) ||
    /vault-keys/i.test(base) ||
    /^(authorized_keys|known_hosts|\.netrc|\.npmrc|\.pypirc)$/i.test(base)
  ) {
    return "key or credential material";
  }
  if (context.tracked.has(trackKey(posix))) return "tracked by git (the repository owns this file)";
  if (context.engineProtectedPrefixes.some((prefix) => isInsidePath(prefix, path.join(context.rootReal, rel)))) {
    return "engine state / scratchpad inside the root (never an item)";
  }
  // The CURRENT run's quarantine sink: a plan must never select its own destination. The state
  // dir is normally outside the root, in which case this adds nothing; when an operator points
  // DSH_ORGANIZER_STATE inside the root, the sink stays out of the plan anyway.
  if ((context.protectedSinkPrefixes ?? []).some((prefix) => isInsidePath(prefix, path.join(context.rootReal, rel)))) {
    return "this run's quarantine sink inside the root (never an item)";
  }
  if (context.tempDirs.some((prefix) => isInsidePath(prefix, path.join(context.rootReal, rel)))) {
    return "system temp directory inside the root (never an item)";
  }
  return null;
};

// ---------------------------------------------------------------------------------------
// Content probes
// ---------------------------------------------------------------------------------------

const looksLikeJson = (text) => {
  const trimmed = text.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
};

const looksLikeJsonLines = (text) => {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length < 2) return false;
  let parsed = 0;
  for (const line of lines.slice(0, 5)) {
    try {
      const value = JSON.parse(line);
      if (value && typeof value === "object") parsed += 1;
    } catch {
      return false;
    }
  }
  return parsed >= 2;
};

const SCRAPE_SHAPE_KEYS = [
  "url",
  "status",
  "statuscode",
  "headers",
  "body",
  "html",
  "response",
  "request",
  "cookies",
  "useragent",
  "payload",
  "raw",
];

/** A payload probe: JSON with request/response shape, a challenge page, or an opaque blob. */
const probePayload = (abs, ext) => {
  const head = readHead(abs, DEFAULT_LIMITS.headBytes);
  if (head === null) return { payloadLike: true, signal: "unreadable-head (treated as opaque payload)" };
  const text = head.toString("utf8");
  const replacementChars = (text.match(/\uFFFD/g) ?? []).length;
  const binaryish = head.includes(0) || replacementChars > head.length / 20;
  if (binaryish) return { payloadLike: true, signal: "binary-blob" };
  const lower = text.toLowerCase();
  if (ext === "html" || ext === "htm") {
    if (lower.includes("<!doctype html") || lower.includes("<html")) {
      const challenge = /captcha|challenge|cf-|cloudflare|just a moment|enable javascript/i.test(text);
      return {
        payloadLike: true,
        signal: challenge ? "html-challenge-page" : "html-document",
      };
    }
  }
  if (ext === "json" || ext === "jsonl" || ext === "ndjson") {
    if (looksLikeJson(text) || looksLikeJsonLines(text)) {
      const keys = SCRAPE_SHAPE_KEYS.filter((key) => lower.includes(`"${key}"`));
      return {
        payloadLike: true,
        signal: keys.length > 0 ? `json-with-${keys.slice(0, 3).join("+")}-keys` : "json-document",
      };
    }
  }
  if (ext === "bin" || ext === "har" || ext === "body" || ext === "resp") {
    return { payloadLike: true, signal: `${ext}-payload-extension` };
  }
  if (ext === "log" || ext === "txt" || ext === "csv" || ext === "tsv" || ext === "xml") {
    return { payloadLike: true, signal: `${ext}-payload-extension` };
  }
  return { payloadLike: false, signal: "no-payload-signal" };
};

// ---------------------------------------------------------------------------------------
// Test-content probe and empty-directory helpers
// ---------------------------------------------------------------------------------------

/**
 * Is this file's CONTENT for testing, even though nothing named it a test? Reads the head only
 * (`DEFAULT_LIMITS.headBytes`), and answers with the signal that matched - never with a bare
 * boolean - so the plan can quote the evidence.
 *
 * A STRONG signal (a framework or runner is named) is confident. A WEAK signal alone is not:
 * `it(`, `test(`, `expect(` and a shebang are ordinary code too, and reclassifying on those
 * would turn production files into route candidates. Weak-only therefore returns
 * `{ confident: false }` and the file keeps its existing rule.
 */
const probeTestContent = (abs, ext) => {
  const head = readHead(abs, DEFAULT_LIMITS.headBytes);
  if (head === null) return { confident: false, strong: null, weak: [], signal: "unreadable-head" };
  const text = head.toString("utf8");
  const replacementChars = (text.match(/\uFFFD/g) ?? []).length;
  if (head.includes(0) || replacementChars > head.length / 20) {
    return { confident: false, strong: null, weak: [], signal: "binary-blob" };
  }
  const strongMatches = TEST_CONTENT_STRONG.filter(([, pattern]) => pattern.test(text));
  const weakMatches = TEST_CONTENT_WEAK.filter(([, pattern]) => pattern.test(text));
  const strong = strongMatches.length > 0 ? strongMatches[0][0] : null;
  const weak = weakMatches.map(([label]) => label);
  const shebang = SHEBANG_RE.test(text);
  if (shebang && PROBE_BODY_RE.test(text)) weak.push("probe-script-body");
  return {
    confident: strong !== null,
    strong,
    weak,
    shebang,
    extension: ext,
    signals: strong !== null ? [`test-framework:${strong}`, ...weak] : weak,
    signal: strong ?? (weak.length > 0 ? `weak-only:${weak[0]}` : "no-test-signal"),
  };
};

/** Where `rel` sits, if anywhere, inside the project's test tree. */
const testTreeOf = (rel) => {
  const segments = rel.split("/");
  const index = segments.findIndex((segment) => TEST_DIR_NAMES.has(segment.toLowerCase()));
  if (index === -1) return null;
  return { root: segments.slice(0, index + 1).join("/"), scope: segments[index].toLowerCase() };
};

/**
 * The destination for a detected test file: `tests/<area>/<module>.test.<ext>`. The area is the
 * file's own parent directory when its basename is too generic to carry meaning (`index`,
 * `test`, `main`), otherwise the basename itself. A `.test` stem is not doubled.
 */
const routeTargetFor = (relInput, testRoot) => {
  // `rel` is POSIX by contract, but normalise anyway: the join below is string-based, and a
  // Windows-separated input would produce a malformed destination.
  const rel = toPosix(relInput);
  const base = basenameOf(rel);
  const ext = extensionOf(rel);
  const stem = ext === "" ? base : base.slice(0, base.length - ext.length - 1);
  const parentDir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
  const parentName = parentDir === "" ? "" : basenameOf(parentDir);
  const generic = new Set(["index", "main", "test", "tests", "spec"]);
  const area = parentName !== "" && !generic.has(parentName.toLowerCase()) ? parentName : stem;
  const moduleName = /\.test$|\.spec$/i.test(stem) ? stem : `${stem}.test`;
  return `${testRoot}/${area}/${moduleName}.${ext}`;
};

/** The test tree this root actually has, if any. */
const detectTestTree = (context) => {
  for (const candidate of TEST_TREE_ROOTS) {
    const abs = path.join(context.rootReal, candidate.rel);
    const stats = safeLstat(abs);
    if (stats !== null && stats.isDirectory()) return candidate;
  }
  return null;
};

const isFrameworkKeepDir = (rel) =>
  FRAMEWORK_KEEP_DIRS.some((prefix) => isUnderPrefix(rel, prefix));

/** A directory with no entries at all. `.gitkeep` counts as an entry: the placeholder is deliberate. */
const isEmptyDirectoryNode = (node) => node.type === "dir" && node.childCount === 0 && !node.subtreeHasTracked;

/**
 * A directory may be settled only when nothing depends on it: not protected, no tracked file
 * anywhere beneath (or removing it would break the repository), not a link/junction, not a sink
 * directory, not one of the framework's own required directories, and not a parent of anything
 * the plan keeps or reports. The root itself is never settled.
 */
const isSettleCandidate = (node, context) => {
  if (node.type !== "dir" || node.rel === "") return false;
  if (node.protectedReason !== null || node.subtreeHasProtected || node.subtreeHasTracked || node.subtreeHasRefused) {
    return false;
  }
  // A protected directory is still a walked node (its CONTENTS are never walked), so it reaches
  // this predicate. Removing the sink itself after its payloads were quarantined would be exactly
  // backwards, so protection is checked against the set as well as the node's own flag.
  if (context.protectedRels?.has(node.rel)) return false;
  if (node.linkLike || node.refusedReason) return false;
  const segments = node.rel.split("/");
  if (segments.some((segment) => segment.toLowerCase() === WORK_SINK_SEGMENT)) return false;
  if (segments.some((segment) => ["sink", "quarantine"].includes(segment.toLowerCase()))) return false;
  if (isFrameworkKeepDir(node.rel)) return false;
  // A directory that holds something the plan KEEPS or merely REPORTS is still in use.
  const descendants = context.descendantKinds?.get(node.rel) ?? null;
  if (descendants !== null && descendants.has("protected")) return false;
  return true;
};

// ---------------------------------------------------------------------------------------
// Walk (never follows a link; never descends into a protected directory)
// ---------------------------------------------------------------------------------------

const kindOfStats = (stats) => {
  if (stats === null) return "missing";
  if (stats.isSymbolicLink()) return "link";
  if (stats.isDirectory()) return "dir";
  if (stats.isFile()) return "file";
  return "other";
};

const enumerateRoot = (rootReal, context, limits) => {
  const entries = [];
  const protectedEntries = [];
  const refused = [];
  const scanErrors = [];
  let truncated = false;
  let visited = 0;

  const rootNode = {
    rel: "",
    abs: rootReal,
    type: "dir",
    size: 0,
    mtimeMs: 0,
    depth: 0,
    parent: null,
    protectedReason: null,
    childCount: 0,
    subtreeBytes: 0,
    subtreeHasProtected: false,
    subtreeHasTracked: false,
    subtreeHasRefused: false,
  };
  entries.push(rootNode);

  const stack = [rootNode];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node.rel !== "" && node.protectedReason !== null) continue;
    const listing = safeReaddir(node.abs);
    if (!Array.isArray(listing)) {
      scanErrors.push({ rel: node.rel, error: listing.error });
      continue;
    }
    // A directory carrying its own `.git` marker is a nested repository or worktree. Its tracked
    // set belongs to THAT repository, which this engine cannot see, so nothing inside it is ever
    // an item: acting there would mean touching files another repository owns.
    if (node.rel !== "" && listing.some((dirent) => dirent.name === ".git")) {
      node.protectedReason = "nested git repository or worktree (its own tracked set is not visible here)";
      node.subtreeHasProtected = true;
      protectedEntries.push(node);
      continue;
    }
    node.childCount = listing.length;
    for (const dirent of listing) {
      if (visited >= limits.maxWalkEntries) {
        truncated = true;
        break;
      }
      visited += 1;
      const rel = node.rel === "" ? dirent.name : `${node.rel}/${dirent.name}`;
      const abs = path.join(node.abs, dirent.name);
      const stats = safeLstat(abs);
      const type = kindOfStats(stats);
      if (stats === null) {
        scanErrors.push({ rel, error: "lstat-failed" });
        continue;
      }
      const child = {
        rel,
        abs,
        type,
        size: type === "file" ? stats.size : 0,
        mtimeMs: Math.trunc(stats.mtimeMs),
        depth: node.depth + 1,
        parent: node.rel,
        protectedReason: null,
        realpath: null,
        linkLike: type === "link",
        escapesRoot: false,
        childCount: 0,
        subtreeBytes: type === "file" ? stats.size : 0,
        subtreeHasProtected: false,
        subtreeHasTracked: false,
        subtreeHasRefused: false,
      };

      const resolved = realpathSyncSafe(abs);
      child.realpath = resolved;
      const outside = !isInsidePath(rootReal, resolved);
      const differs = pathDiffersBeyondCase(resolved, path.resolve(abs));
      child.escapesRoot = outside;

      if (type === "link" || differs) {
        // I2: a path that is, or that traverses, a link is refused outright. Nothing about a
        // link is ever followed, and a link is never an item.
        child.refusedReason = type === "link"
          ? "symlink or NTFS junction (never followed, never removed)"
          : "path resolves through a link or junction to a different location (never followed)";
        child.subtreeHasRefused = true;
        node.subtreeHasRefused = true;
        refused.push(child);
        continue;
      }
      if (outside) {
        child.refusedReason = "resolves outside the containment root";
        child.subtreeHasRefused = true;
        node.subtreeHasRefused = true;
        refused.push(child);
        continue;
      }
      if (type === "other") {
        child.refusedReason =
          "non-regular filesystem object (character device, pipe, socket); not a removable artifact";
        child.subtreeHasRefused = true;
        node.subtreeHasRefused = true;
        refused.push(child);
        continue;
      }

      const reason = protectionReason(rel, context);
      if (reason !== null) {
        child.protectedReason = reason;
        child.subtreeHasProtected = true;
        node.subtreeHasProtected = true;
        protectedEntries.push(child);
        entries.push(child);
        continue;
      }

      entries.push(child);
      if (type === "dir") stack.push(child);
    }
    if (truncated) break;
  }

  // Post-order accumulation: children always appear after their parent in discovery order,
  // so a single reverse pass bubbles subtree facts up one level at a time. The map keeps it
  // linear - the previous `find`-per-ancestor form was quadratic and would stall a large tree.
  const byRel = new Map(entries.map((node) => [node.rel, node]));
  for (let index = entries.length - 1; index > 0; index -= 1) {
    const node = entries[index];
    const parentNode = byRel.get(node.parent);
    if (!parentNode) continue;
    parentNode.subtreeBytes += node.subtreeBytes;
    if (context.tracked.has(trackKey(node.rel))) node.subtreeHasTracked = true;
    if (
      node.subtreeHasProtected ||
      node.protectedReason !== null ||
      node.subtreeHasRefused ||
      node.subtreeHasTracked
    ) {
      if (node.subtreeHasProtected || node.protectedReason !== null) parentNode.subtreeHasProtected = true;
      if (node.subtreeHasRefused) parentNode.subtreeHasRefused = true;
      if (node.subtreeHasTracked) parentNode.subtreeHasTracked = true;
    }
  }

  return { rootNode, entries, byRel, protectedEntries, refused, scanErrors, truncated, visited };
};

// ---------------------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------------------

const extensionOf = (rel) => {
  const base = rel.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot + 1).toLowerCase();
};

const basenameOf = (rel) => {
  const parts = String(rel).split(/[/\\]/);
  return parts[parts.length - 1];
};

const hasDirSegment = (rel, names) => rel.split("/").some((segment) => names.has(segment));

const isUnderPrefix = (rel, prefix) =>
  rel === prefix || rel.startsWith(`${prefix}/`);

const matchesAny = (value, patterns, options = {}) => {
  for (const [pattern, label, rootOnly] of patterns) {
    if (rootOnly === true && options.atRoot !== true) continue;
    if (pattern.test(value)) return label;
  }
  return null;
};

const ignoredStateOf = (rel, git) => {
  if (!git.available) return "unknown";
  if (git.tracked.has(trackKey(rel))) return "tracked";
  if (git.ignoredFiles.has(trackKey(rel))) return "ignored";
  if (git.ignoredDirs.some((dir) => isUnderPrefixCI(rel, dir))) return "ignored";
  return "untracked";
};

const isLiveRuntime = (rel) => LIVE_RUNTIME_PREFIXES.some((prefix) => isUnderPrefix(rel, prefix));

const isRootConfigDotDir = (rel) =>
  !rel.includes("/") && ROOT_CONFIG_DOTDIR_RE.test(rel) && !ROOT_CONFIG_DOTDIR_ALLOW.has(rel.toLowerCase());

const retentionClassOf = (ageDays) => {
  if (ageDays <= 7) return "hot";
  if (ageDays <= 30) return "warm";
  if (ageDays <= 180) return "cold";
  return "stale";
};

const backupFamilyOf = (rel) => {
  const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
  const base = basenameOf(rel);
  const stem = base.replace(/\.[^.]+$/, "");
  const normalized = stem
    .replace(/\d+/g, "#")
    .replace(/#+/g, "#")
    .replace(/[-_.]+/g, "-")
    .toLowerCase();
  return dir === "" ? normalized : `${dir}/${normalized}`;
};

/**
 * The ordered rule table. First match wins, and the match records the rule id plus the
 * signals behind it. Nothing here may lower a class; raises happen in computeSafety.
 */
const classifyEntry = (node, context) => {
  const rel = node.rel;
  const base = basenameOf(rel);
  const ext = extensionOf(rel);
  const ignoredState = ignoredStateOf(rel, context.git);
  const sessionCreated = context.sessionCreated(rel);
  const evidence = {
    tracked: ignoredState === "tracked",
    ignoredState,
    sessionCreated,
    extension: ext === "" ? null : ext,
    signals: [],
  };

  // --- refused / non-regular -----------------------------------------------------------
  if (node.refusedReason) {
    return {
      kind: KIND.PROTECTED,
      rule: "refused-path",
      reason: node.refusedReason,
      action: ACTIONS.REPORT,
      evidence: { ...evidence, signals: [node.refusedReason] },
    };
  }

  // --- backup ------------------------------------------------------------------------
  // Only a FILE is a backup. A directory named `backups` is a container: it is either covered
  // by its children or dropped as a container, never counted as a 15 GiB "backup".
  const inBackupDir = node.type === "file" && hasDirSegment(rel, BACKUP_DIR_NAMES) && node.parent !== "";
  const backupName = node.type === "file" ? matchesAny(base, BACKUP_NAME_PATTERNS) : null;
  if (inBackupDir || backupName !== null) {
    const ageDays = ageDaysOf(node.mtimeMs);
    const retentionClass = retentionClassOf(ageDays);
    if (backupName !== null) evidence.backupPattern = backupName;
    if (inBackupDir) evidence.signals.push("inside-backup-directory");
    if (backupName !== null) evidence.signals.push(`name-pattern:${backupName}`);
    return {
      kind: KIND.BACKUP,
      rule: "backup",
      reason: inBackupDir
        ? "archive under a backups directory"
        : `name matches the backup pattern \`${backupName}\``,
      action: ACTIONS.REPORT,
      retentionClass,
      ageDays,
      evidence,
      minLevelOverride: "deep",
    };
  }

  // --- scrape-raw --------------------------------------------------------------------
  const dirMarker = rel.split("/").find((segment) => SCRAPE_DIR_MARKERS.has(segment.toLowerCase()));
  if (dirMarker !== undefined && PAYLOAD_EXTENSIONS.has(ext)) {
    const probe = probePayload(node.abs, ext);
    evidence.dirMarker = dirMarker;
    evidence.signals.push(`parent-directory-marker:${dirMarker}`);
    evidence.signals.push(probe.signal);
    if (probe.payloadLike) {
      evidence.payloadLike = true;
      return {
        kind: KIND.SCRAPE_RAW,
        rule: "scrape-raw",
        reason: `raw payload (\`${probe.signal}\`) captured under a \`${dirMarker}\` directory`,
        action: ACTIONS.MOVE,
        minLevelOverride: "standard",
        evidence,
      };
    }
    evidence.payloadLike = false;
  }

  // --- reserved device name (raise, never lower) ---------------------------------------
  if (RESERVED_DEVICE_RE.test(base)) {
    evidence.reservedDeviceName = true;
    evidence.signals.push("windows-reserved-device-name");
  }

  // --- test content (content, not name) -----------------------------------------------
  //
  // Evaluated ONCE, here, before the build-output and junk-named rules. Two orderings matter:
  //   * before build-output, so a test file that happens to sit under `dist/` or `coverage/` is
  //     recognised as a test and never planned as regenerable output;
  //   * before junk-named, so a weak-only hit cannot be silently evicted by a name pattern on its
  //     way to the move action. A file that looks like an uncertain test AND carries a junk name
  //     is exactly the case the "ambiguous hits are never disposably removable" rule exists for.
  const testContent = applyTestContentProbe(node, context, evidence, rel);
  if (testContent !== null) return testContent;

  // --- build output ------------------------------------------------------------------
  const buildSegment = rel.split("/").find((segment) => BUILD_DIR_NAMES.has(segment.toLowerCase()));
  const buildByExtension =
    ext === "map" || ext === "tsbuildinfo" || ext === "pyc" || base.endsWith(".min.js") || base.endsWith(".min.css");
  const live = isLiveRuntime(rel);
  if (buildSegment !== undefined || buildByExtension || live) {
    if (buildSegment !== undefined) {
      evidence.buildDirMarker = buildSegment;
      evidence.signals.push(`build-directory:${buildSegment}`);
    }
    if (buildByExtension) evidence.signals.push(`generated-extension:${ext}`);
    if (live) {
      const prefix = LIVE_RUNTIME_PREFIXES.find((candidate) => isUnderPrefix(rel, candidate));
      evidence.liveRuntimePrefix = prefix;
      evidence.signals.push(`live-runtime-output:${prefix}`);
    }
    return {
      kind: KIND.BUILD_OUTPUT,
      rule: live && buildSegment === undefined && !buildByExtension ? "runtime-cache" : "build-output",
      reason: live
        ? `regenerable cache or output under \`${evidence.liveRuntimePrefix}\` that the framework or a build step rewrites`
        : buildSegment !== undefined
          ? `regenerable output under the \`${buildSegment}\` build directory`
          : `generated file (\`${ext}\`) that a build step recreates`,
      action: ACTIONS.MOVE,
      minLevelOverride: live ? "immaculate" : "standard",
      evidence,
    };
  }

  // --- test artifact -----------------------------------------------------------------
  const testDirMarker = rel
    .split("/")
    .find((segment) => ["test-results", "coverage", "playwright-report", "artifacts"].includes(segment.toLowerCase()));
  const checkName = matchesAny(
    base,
    JUNK_NAME_PATTERNS.filter(([, label]) => label === "check-artifact" || label === "capture-artifact"),
    { atRoot: node.parent === "" },
  );
  if (testDirMarker !== undefined || checkName !== null) {
    if (testDirMarker !== undefined) evidence.signals.push(`test-output-directory:${testDirMarker}`);
    if (checkName !== null) {
      evidence.junkPattern = checkName;
      evidence.signals.push(`name-pattern:${checkName}`);
    }
    return {
      kind: KIND.TEST_ARTIFACT,
      rule: "test-artifact",
      reason:
        testDirMarker !== undefined
          ? `test run output under \`${testDirMarker}\``
          : `unreferenced check/capture artifact (\`${checkName}\`)`,
      action: ACTIONS.MOVE,
      minLevelOverride: "standard",
      evidence,
    };
  }

  // --- junk-named --------------------------------------------------------------------
  const junkName = matchesAny(base, JUNK_NAME_PATTERNS, { atRoot: node.parent === "" });
  if (junkName !== null) {
    evidence.junkPattern = junkName;
    evidence.signals.push(`name-pattern:${junkName}`);
    // The name is why this file is a removal candidate, so a weak content-probe hit does NOT veto
    // it - but it is recorded, because a file that also looks like an uncertain test is exactly
    // what the owner must see before confirming the item by name.
    inheritTestProbe(node, evidence);
    if (node.type === "file" && node.size <= JUNK_SMALL_BYTES) evidence.smallFile = true;
    return {
      kind: KIND.JUNK_NAMED,
      rule: "junk-named",
      reason: `name matches the junk pattern \`${junkName}\` and git does not track it${node.testProbe ? ` (content probe also found only weak test signals: ${node.testProbe.weak.join(", ")}; the name is the reason it is proposed, and it is confirmed per item)` : ""}`,
      action: ACTIONS.MOVE,
      minLevelOverride:
        node.type === "file" && node.size <= JUNK_SMALL_BYTES ? "light" : "standard",
      evidence,
    };
  }

  // --- root tool-configuration dot-directories: kept by policy ------------------------
  if (node.type === "dir" && isRootConfigDotDir(rel) && ignoredState !== "untracked") {
    evidence.signals.push("root-dot-directory", `ignored-state:${ignoredState}`);
    return {
      kind: KIND.IGNORED_OTHER,
      rule: "root-config-dotdir",
      reason: "root-level dot-directory holding tool configuration, not agent litter",
      action: ACTIONS.NONE,
      dispositionOverride: { disposition: "kept", decidedBy: "policy", reason: "tool configuration directory" },
      minLevelOverride: "minimal",
      evidence,
    };
  }

  // --- ignored, unrecognised: an owner decision, never an automatic removal -----------
  if (ignoredState === "ignored") {
    const configLike =
      node.type === "file" && CONFIG_EXTENSIONS.has(ext) && node.depth > 1 && (node.parent !== "");
    if (configLike) {
      evidence.signals.push("ignored-configuration-file");
      return {
        kind: KIND.IGNORED_OTHER,
        rule: "ignored-config",
        reason: "ignored configuration file inside a source tree (local settings, not litter)",
        action: ACTIONS.NONE,
        dispositionOverride: {
          disposition: "kept",
          decidedBy: "policy",
          reason: "ignored local configuration file",
        },
        minLevelOverride: "minimal",
        evidence,
      };
    }
    const knownCacheName = /^(thumbs\.db|desktop\.ini|\.ds_store|\.directory)$/i.test(base);
    if (knownCacheName) {
      evidence.signals.push("os-metadata-file");
      return {
        kind: KIND.IGNORED_OTHER,
        rule: "os-metadata",
        reason: `operating-system metadata file (\`${base}\`)`,
        action: ACTIONS.MOVE,
        minLevelOverride: "standard",
        evidence,
      };
    }
    evidence.signals.push(`ignored-state:${ignoredState}`);
    return {
      kind: KIND.IGNORED_OTHER,
      rule: "ignored-other",
      reason: "ignored by git but not recognised as regenerable output; owner decision required",
      action: ACTIONS.REPORT,
      dispositionOverride: {
        disposition: "pending",
        decidedBy: "engine",
        reason: "ignored content with no recognised regenerable marker",
      },
      minLevelOverride: "standard",
      evidence,
    };
  }

  // --- untracked source/work: never removed, proposed for landing --------------------
  if (ignoredState === "untracked" || ignoredState === "unknown") {
    evidence.signals.push(`ignored-state:${ignoredState}`);
    // A weak-only content probe is corroboration: it never reclassifies, but it IS recorded, so
    // the report says the file looked test-like instead of looking clean by omission.
    inheritTestProbe(node, evidence);
    const sourceLike = SOURCE_EXTENSIONS.has(ext) || IMAGE_EXTENSIONS.has(ext);
    if (sourceLike) evidence.signals.push(`source-extension:${ext}`);
    return {
      kind: KIND.UNTRACKED_WORK,
      rule: "untracked-work",
      reason: ignoredState === "unknown"
        ? "untracked and git state is unavailable; treated as work that must not be removed"
        : "untracked content that no junk/build/test pattern explains",
      action: ACTIONS.REPORT,
      minLevelOverride: "deep",
      evidence,
    };
  }

  return {
    kind: KIND.UNTRACKED_WORK,
    rule: "fallback",
    reason: "no rule matched; treated as work, never removed",
    action: ACTIONS.REPORT,
    minLevelOverride: "deep",
    evidence,
  };
};

// ---------------------------------------------------------------------------------------
// Safety class (I5). Evidence raises a class; nothing lowers it.
// ---------------------------------------------------------------------------------------

const raiseClass = (safety, reason, raisedBy) => {
  const index = SAFETY.indexOf(safety);
  const next = SAFETY[Math.min(index + 1, SAFETY.length - 1)];
  if (next !== safety) raisedBy.push(reason);
  return next;
};

const computeSafety = (artifact, node, context, limits) => {
  const raisedBy = [];
  const signals = artifact.evidence.signals;
  let action = artifact.action;

  let safety;
  if (artifact.action === ACTIONS.SETTLE) {
    // Settling an empty directory is S1 by the owner's authorisation, not by provenance: there
    // is no content to lose, the removal is journalled with a mkdir inverse, and a raise would
    // only add a per-item confirmation for an empty folder.
    return { safety: "S1", raisedBy: [], action: ACTIONS.SETTLE };
  }
  if (artifact.action === ACTIONS.NONE || artifact.action === ACTIONS.REPORT) {
    safety = "S0";
  } else if (artifact.evidence.sessionCreated) {
    safety = "S1";
  } else {
    safety = "S2";
  }

  // V2-2: ROUTE belongs in this guard. It moves a file to a new path inside the repository, so
  // the same raises apply - and the no-trash raise below was previously dead code for routes
  // because its `ROUTE` arm sat inside a branch only MOVE and PURGE could reach.
  if (action === ACTIONS.MOVE || action === ACTIONS.PURGE || action === ACTIONS.ROUTE) {
    const itemBytes = node.type === "dir" ? node.bytes ?? node.subtreeBytes : node.size;
    if (itemBytes > limits.maxSinkBytes) {
      safety = raiseClass(safety, "oversize", raisedBy);
      signals.push("oversize");
      // Above the quarantine cap the engine will not hold a copy. For everything except a
      // backup (which is the owner's only copy of something) the action becomes a real,
      // irreversible purge - S3, therefore named one by one with --confirm. Backups over
      // the cap are downgraded to `archive` instead, in the backup pass below.
      if (action === ACTIONS.MOVE && artifact.kind !== KIND.BACKUP) {
        action = ACTIONS.PURGE;
        raisedBy.push("oversize-purge");
      }
    }
    if (artifact.evidence.reservedDeviceName && SAFETY.indexOf(safety) < SAFETY.indexOf("S2")) {
      safety = "S2";
      raisedBy.push("reserved-device-name");
    }
    if (artifact.kind === KIND.UNTRACKED_WORK) {
      safety = raiseClass(safety, "untracked-work", raisedBy);
    }
    if (!context.git.available) {
      safety = raiseClass(safety, "git-unavailable", raisedBy);
    }
    // No trash CLI means no native recovery path for a removal. S1 is exempt because its
    // recovery is the engine's own sink+journal; S2 removal candidates are raised to S3 so
    // each one needs --confirm <id>. A test-content route is included: it moves a file to a new
    // path inside the repository, which is a real change to where the file lives.
    if (
      context.tools.raiseS2WhenNoTrash &&
      (action === ACTIONS.MOVE || action === ACTIONS.ROUTE) &&
      safety === "S2"
    ) {
      safety = raiseClass(safety, "no-trash-tool", raisedBy);
      signals.push("no-trash-tool");
    }
    // V2-2: a route is S3 unconditionally. Relocating a file the agent did not write into a
    // place the runner may execute changes where the file lives, so it gets the per-item
    // `--confirm` gate rather than one batch `--approve-s2` that could relocate any number of
    // files at once. This is a floor, not a raise: nothing lowers a class.
    if (action === ACTIONS.ROUTE && SAFETY.indexOf(safety) < SAFETY.indexOf("S3")) {
      safety = "S3";
      raisedBy.push("route-changes-where-the-file-lives");
      signals.push("route-changes-where-the-file-lives");
    }
    // A purge is irreversible by definition, so it is always S3 and always named individually -
    // whether it came from the oversize rule or from an owner asking for the bytes back with
    // `plan --purge`. A reversible quarantine is S2 at most; an irreversible delete never is.
    if (action === ACTIONS.PURGE && SAFETY.indexOf(safety) < SAFETY.indexOf("S3")) {
      safety = "S3";
      raisedBy.push("purge-irreversible");
      signals.push("purge-irreversible");
    }
  }

  if (artifact.evidence.referencedBy && artifact.evidence.referencedBy.length > 0) {
    safety = "S3";
    raisedBy.push("referenced-by-tracked-file");
  }

  return { safety, raisedBy, action };
};

// ---------------------------------------------------------------------------------------
// Analysis core
// ---------------------------------------------------------------------------------------

const ANALYZE_INTERNALS = Symbol("analyzeInternals");

const analyze = (rootInput, level, scope, options = {}) => {
  const limits = limitsFromEnv();
  const rootGiven = path.resolve(rootInput);
  if (!existsSync(rootGiven)) {
    const error = new Error(`root not found: ${rootGiven}`);
    error.code = EXIT.NOT_FOUND;
    throw error;
  }
  const stats = safeLstat(rootGiven);
  if (stats === null || !stats.isDirectory()) {
    const error = new Error(`root is not a directory: ${rootGiven}`);
    error.code = EXIT.NOT_FOUND;
    throw error;
  }
  const rootReal = realpathSyncSafe(rootGiven);
  const git = readGitState(rootReal);
  const tools = probeTools();
  const session = readSessionRecord(rootReal);
  const decisions = readDecisions(rootReal);
  const paths = statePaths(rootReal);

  const sessionCreated = (rel) => {
    if (!session.found) return false;
    const posix = toPosix(rel);
    return session.created.some((recorded) => posix === recorded || posix.startsWith(`${recorded}/`));
  };

  const context = {
    rootReal,
    git,
    tools,
    session,
    limits,
    tracked: git.tracked,
    // The engine's own state directory and the system temp directory are the "current
    // scratchpad". They are only protected when they actually live INSIDE the root - which is
    // why each is filtered on containment here. Without the filter, a fixture inside the OS
    // temp directory would be protected in its entirety.
    engineProtectedPrefixes: [paths.base].filter((dir) => isInsidePath(rootReal, dir)),
    // The current run's sink, so a plan can never select its own destination.
    protectedSinkPrefixes: [paths.sink].filter((dir) => isInsidePath(rootReal, dir)),
    tempDirs: [path.resolve(os.tmpdir())].filter((dir) => isInsidePath(rootReal, dir)),
    sessionCreated,
    // Filled in after the walk: the kinds present below each directory, and the project's test
    // tree, if it has one. Both are read-only lookups for the classifier.
    descendantKinds: null,
    testTree: null,
  };

  const enumerated = enumerateRoot(rootReal, context, limits);
  context.testTree = detectTestTree(context);
  context.routeTarget = routeTargetFor;
  // The protected entries keyed by rel: `.work/` and the engine's own state dir are walked nodes
  // whose contents are skipped, so `isSettleCandidate` needs the set, not just the node flag.
  context.protectedRels = new Set(enumerated.protectedEntries.map((node) => node.rel));

  // Whole-directory actions are only allowed when the subtree is free of protected,
  // tracked or refused descendants. Protection is inherited upward for that decision.
  const dirActionAllowed = (node) =>
    !node.subtreeHasProtected && !node.subtreeHasTracked && !node.subtreeHasRefused;

  // --- pass 1: classify every in-scope entry -------------------------------------------
  const classifiedEntries = [];
  for (const node of enumerated.entries) {
    if (node.rel === "") continue;
    if (node.protectedReason !== null) continue;
    classifiedEntries.push({ node, artifact: classifyEntry(node, context) });
  }

  // --- empty-directory settle ----------------------------------------------------------
  //
  // Runs as a sweep over the classified entries, DEEPEST FIRST, so a directory emptied by this
  // plan is recognised only after its own children have been settled or moved - which is also
  // the order `apply` performs them in. A directory that an ordinary rule already explains
  // (a junk name, a build directory, a test-output directory) keeps that rule: the name is
  // better evidence than emptiness, and nothing here may override it.
  //
  // The sweep itself runs LAST, on the final item list (see `settlePass` below), because whether
  // a directory still holds a planned decision depends on aggregation, which happens after
  // classification.
  const settleArtifactFor = (node, base) => ({
    kind: KIND.EMPTY_DIR,
    rule: "empty-dir",
    reason: "empty directory, no entries, reversible via journal; the owner authorised settling empty folders",
    action: ACTIONS.SETTLE,
    // `light` on purpose: an empty folder is the cheapest thing to ask for, so the everyday
    // sweep reaches it. `minLevel` is carried too, because this artifact replaces one that
    // already went through the level computation in pass 3.
    minLevel: "light",
    minLevelOverride: "light",
    safety: "S1",
    raisedBy: [],
    evidence: {
      ...base.evidence,
      signals: [
        ...base.evidence.signals,
        `empty-directory:${isEmptyDirectoryNode(node) ? "no-entries" : "emptied-by-this-plan"}`,
      ],
      childCount: node.childCount,
      subtreeBytes: node.subtreeBytes,
      emptiedByThisPlan: isEmptyDirectoryNode(node) ? false : true,
    },
  });

  // Kinds present anywhere below each directory, so a directory item can tell whether its
  // subtree agrees with it or whether it is merely a container for other kinds.
  const descendantKinds = new Map();
  for (const entry of classifiedEntries) {
    let ancestor = entry.node.parent;
    while (ancestor !== null && ancestor !== "") {
      const set = descendantKinds.get(ancestor) ?? new Set();
      set.add(entry.artifact.kind);
      descendantKinds.set(ancestor, set);
      ancestor = enumerated.byRel.get(ancestor)?.parent ?? null;
    }
  }
  context.descendantKinds = descendantKinds;

  // --- which directories this plan will empty ------------------------------------------
  //
  // Pass 3 drops an untracked directory as "repository structure, not a finding" so one item per
  // directory does not bury the report. An empty directory IS a finding, so those directories are
  // registered here and kept. The check is iterative, deepest-first: a directory whose children
  // are all being moved is itself about to be empty, and its parent may become empty as a result.
  const willBeEmptyDirs = new Set();
  for (let round = 0; round < 8; round += 1) {
    let changed = 0;
    for (const entry of classifiedEntries) {
      const { node, artifact } = entry;
      if (node.type !== "dir" || willBeEmptyDirs.has(node.rel)) continue;
      if (!isSettleCandidate(node, context)) continue;
      if (isEmptyDirectoryNode(node)) {
        willBeEmptyDirs.add(node.rel);
        changed += 1;
        continue;
      }
      const descendants = classifiedEntries.filter((candidate) => candidate.node.rel.startsWith(`${node.rel}/`));
      if (descendants.length === 0) continue;
      const allRemovable = descendants.every((candidate) => {
        const action = candidate.artifact.action;
        if (action === ACTIONS.MOVE || action === ACTIONS.PURGE) return true;
        return candidate.node.type === "dir" && willBeEmptyDirs.has(candidate.node.rel);
      });
      if (!allRemovable) continue;
      willBeEmptyDirs.add(node.rel);
      changed += 1;
    }
    if (changed === 0) break;
  }

  // --- pass 2: which directories speak for their whole subtree -------------------------
  //
  // The engine reports at the level of the decision it proposes, so:
  //   * an actionable directory covers its subtree (one reviewable item, one action);
  //   * a report-only directory whose subtree is all the same kind covers it too (one owner
  //     decision instead of one per file);
  //   * a report-only directory holding OTHER kinds is a container, not a decision: it is
  //     dropped and its children carry the information (e.g. a backups/ directory full of
  //     individually classified backup files);
  //   * an actionable directory that is blocked by protected/tracked content is neither: it
  //     stays visible as S0 and its unprotected children stay visible per item.
  const coveringDirs = new Set();
  const containerDirs = new Set();
  for (const entry of classifiedEntries) {
    const { node, artifact } = entry;
    if (node.type !== "dir") continue;
    if (artifact.kind === KIND.UNTRACKED_WORK) continue; // repository structure, not a finding
    const actionable = artifact.action === ACTIONS.MOVE || artifact.action === ACTIONS.PURGE;
    if (actionable && dirActionAllowed(node)) {
      coveringDirs.add(node.rel);
      continue;
    }
    if (actionable) continue; // blocked: reported, children stay visible
    // An actionable-but-not-covering item (a settle, or a route) speaks for itself: it must not
    // be dropped as a container, and it must not swallow the children it does not cover.
    if (isActingAction(artifact.action)) continue;
    const kinds = descendantKinds.get(node.rel) ?? new Set();
    const agrees = [...kinds].every((kind) => kind === artifact.kind);
    if (agrees) coveringDirs.add(node.rel);
    else containerDirs.add(node.rel);
  }

  const isCovered = (rel) => {
    let ancestor = enumerated.byRel.get(rel)?.parent ?? null;
    while (ancestor !== null && ancestor !== "") {
      if (coveringDirs.has(ancestor)) return true;
      ancestor = enumerated.byRel.get(ancestor)?.parent ?? null;
    }
    return false;
  };

  // A directory that an ordinary rule already made actionable (a build directory, a junk-named
  // one) speaks for itself and is NOT a settle candidate: turning it into an `empty-dir` would
  // also defeat aggregation, which drops the aggregate whenever the parent directory is itself an
  // item. Only structure-like directories become settle candidates.
  const settleCandidates = new Set();
  for (const rel of willBeEmptyDirs) {
    const entry = classifiedEntries.find((candidate) => candidate.node.rel === rel);
    if (!entry) continue;
    if (entry.artifact.kind !== KIND.UNTRACKED_WORK) continue;
    // A covering directory already accounts for its subtree with one action of its own.
    if (coveringDirs.has(rel)) continue;
    settleCandidates.add(rel);
  }

  // --- pass 3: the artifact list -------------------------------------------------------
  const artifacts = [];
  for (const entry of classifiedEntries) {
    const node = entry.node;
    if (isCovered(node.rel)) continue;
    if (containerDirs.has(node.rel)) continue;
    // A directory that matched no rule carries no information of its own: its children do.
    // Emitting one item per directory would bury the report in repository structure.
    //
    // The exception is a directory this plan will empty, which IS a finding, not structure. It
    // becomes an `empty-dir` item right here, so that later passes (aggregation, the reference
    // check) see it as what it is rather than re-deriving the same fact.
    if (node.type === "dir" && entry.artifact.kind === KIND.UNTRACKED_WORK) {
      // A directory this plan empties is a finding, not repository structure: either it is empty
      // now, or its own children are all moving out. Both are settled by the same predicate, so
      // the decision is made once, here, and every later pass reads it off the artifact.
      if (!willBeEmptyDirs.has(node.rel)) continue;
      entry.artifact = settleArtifactFor(node, entry.artifact);
    }
    const classified = entry.artifact;

    const blockedDirAction =
      node.type === "dir" &&
      (classified.action === ACTIONS.MOVE || classified.action === ACTIONS.PURGE) &&
      !dirActionAllowed(node);

    let finalArtifact = classified;
    if (blockedDirAction) {
      const blockers = [];
      if (node.subtreeHasProtected) blockers.push("protected");
      if (node.subtreeHasTracked) blockers.push("git-tracked");
      if (node.subtreeHasRefused) blockers.push("link-or-device");
      finalArtifact = {
        ...classified,
        action: ACTIONS.REPORT,
        reason: `${classified.reason} - whole-directory action refused: subtree contains ${blockers.join(", ")} content`,
        evidence: {
          ...classified.evidence,
          signals: [...classified.evidence.signals, `whole-dir-action-blocked:${blockers.join("+")}`],
          blockedBy: blockers,
        },
        dispositionOverride: {
          disposition: "pending",
          decidedBy: "engine",
          reason: "whole-directory action is blocked by protected descendants; handle per item",
        },
      };
    }

    const nodeForSafety = node.type === "dir"
      ? { ...node, bytes: node.subtreeBytes }
      : node;
    const computed = computeSafety(finalArtifact, nodeForSafety, context, limits);
    finalArtifact = { ...finalArtifact, action: computed.action };
    finalArtifact.evidence.raisedBy = computed.raisedBy;
    if (node.type === "dir") {
      finalArtifact.evidence.childCount = node.childCount;
      finalArtifact.evidence.subtreeBytes = node.subtreeBytes;
      if (coveringDirs.has(node.rel)) finalArtifact.evidence.coversSubtree = true;
    }

    // `minimal` means exactly one thing: the litter this session recorded creating. An item
    // with that provenance is therefore plannable at the lowest level, which is what makes
    // "clean up after yourself" the cheapest thing to ask for.
    //
    // A settle carries its own level (`light`: an empty folder is the cheapest thing to ask
    // for), so it does not fall through to the "standard" default the other kinds use.
    const minLevel =
      finalArtifact.action === ACTIONS.SETTLE
        ? "light"
        : finalArtifact.action !== ACTIONS.NONE &&
            finalArtifact.action !== ACTIONS.REPORT &&
            finalArtifact.evidence.sessionCreated === true
          ? "minimal"
          : finalArtifact.minLevelOverride ?? "standard";

    artifacts.push({
      node,
      kind: finalArtifact.kind,
      rule: finalArtifact.rule,
      reason: finalArtifact.reason,
      action: finalArtifact.action,
      safety: computed.safety,
      raisedBy: computed.raisedBy,
      minLevel,
      evidence: finalArtifact.evidence,
      retentionClass: finalArtifact.retentionClass ?? null,
      ageDays: finalArtifact.ageDays ?? ageDaysOf(node.mtimeMs),
      dispositionOverride: finalArtifact.dispositionOverride ?? null,
      routeTarget: finalArtifact.routeTarget ?? null,
    });
  }

  // --- backup family analysis: keep-latest retention ------------------------------------
  //
  // Per family: exactly one `keep` (the newest VERIFIED copy), at most one `previous` kept as
  // the fallback until a restore drill verifies the newer one, and every older copy `supersede`
  // -> quarantined, S3, confirmed by name. Two rules make this safe rather than aggressive:
  //   * never remove the only copy of a family;
  //   * never remove a copy when the newer one has NO restore evidence - if nothing is verified,
  //     nothing in that family is proposed for removal at all. "I cannot prove the new backup
  //     restores" must never be answered by deleting the old one.
  const restoreEvidence = options.restoreEvidence ?? readRestoreEvidence(rootReal);
  const purgeRequested = options.purgeBackups === true;
  const backupArtifacts = artifacts.filter((artifact) => artifact.kind === KIND.BACKUP);
  const families = new Map();
  for (const artifact of backupArtifacts) {
    const family = backupFamilyOf(artifact.node.rel);
    const list = families.get(family) ?? [];
    list.push(artifact);
    families.set(family, list);
  }
  const retentionFamilies = [];
  for (const [family, members] of families) {
    // Newest first. The rel path breaks ties: files written in the same millisecond (a script
    // that dumps several backups at once) would otherwise make "the newest copy" depend on
    // readdir order, and a retention policy that removes files must not be arbitrary.
    members.sort((a, b) => b.node.mtimeMs - a.node.mtimeMs || (a.node.rel < b.node.rel ? 1 : a.node.rel > b.node.rel ? -1 : 0));
    const [newest, ...older] = members;
    const newestVerified = isRestoreVerified(toPosix(newest.node.rel), family, restoreEvidence);
    // The fallback is the copy immediately before the kept one, kept as the safety net until a
    // drill verifies the newer copy. When the newest copy has NO restore evidence, nothing in
    // the family is proposed for removal at all: the incumbent and that same previous copy are
    // both kept, and every older copy is marked `keep` by the unverified-family rule rather than
    // superseded. "I cannot prove the new backup restores" must never be answered by deleting
    // the old one.
    const fallback = older[0] ?? null;
    const keptByUnverifiedRule = newestVerified ? [] : older.slice(1);
    const removable = members.filter(
      (member) => member !== newest && member !== fallback && !keptByUnverifiedRule.includes(member),
    );

    for (const member of members) {
      const keptBecauseUnverified = keptByUnverifiedRule.includes(member);
      const soleCopy = members.length === 1 && member === newest;
      // V2-4: at most ONE copy of a family carries `previous` - the copy immediately before the
      // keep, which is the fallback the doctrine names. A copy retained only because the family
      // has no restore evidence is kept, but it is not a fallback and must not claim to be one:
      // `previous` on several rows contradicted the family-level `previous` field and would make
      // a reader filtering on `retentionRole === "previous"` see two fallbacks where there is one.
      const retentionRole = member === newest ? "keep" : member === fallback ? "previous" : null;
      const oversize = member.node.size > limits.maxSinkBytes;
      let disposition;
      let reason;
      if (soleCopy) {
        // Never remove the only copy of a family. A sole copy is not superseded by anything, so
        // `supersede` would be false evidence - it is kept, whatever its age or size.
        disposition = "keep";
        reason = `only copy in family \`${family}\`, ${member.ageDays} days old: nothing supersedes it, so it is retained`;
      } else if (member === newest) {
        disposition = "keep";
        reason = newestVerified
          ? `newest copy in family \`${family}\` and restore-drill verified`
          : `newest copy in family \`${family}\`; no restore evidence is recorded, so it is retained and nothing in this family is proposed for removal`;
      } else if (keptBecauseUnverified) {
        disposition = "keep";
        reason = `retained because the newest copy \`${newest.node.rel}\` has no restore evidence: nothing in family \`${family}\` is proposed for removal`;
      } else if (member === fallback) {
        disposition = "keep";
        reason = `fallback for family \`${family}\`: kept until the newer verified copy \`${newest.node.rel}\` is proven by a restore drill`;
      } else {
        disposition = "supersede";
        reason = `superseded by the newer verified copy \`${newest.node.rel}\``;
      }
      if (oversize && disposition === "supersede") {
        // A backup is the owner's only copy of something, so it is NEVER purged: it is proposed
        // for archive instead, and says why.
        disposition = "archive";
        reason = `${member.ageDays} days old but ${bytesHuman(member.node.size)} exceeds the quarantine cap of ${bytesHuman(limits.maxSinkBytes)}: archive off-line, then delete`;
        member.evidence.oversizeArchive = true;
      }
      member.backupDisposition = disposition;
      member.backupReason = reason;
      member.retentionRole = retentionRole;
      member.restoreVerified = member === newest ? newestVerified : false;
      member.evidence.backupFamily = family;
      member.evidence.retentionClass = member.retentionClass;
      member.evidence.ageDays = member.ageDays;
      member.evidence.retentionRole = retentionRole;
      member.evidence.restoreVerified = member.restoreVerified;
      member.evidence.supersededBy = disposition === "supersede" ? newest.node.rel : null;
      member.evidence.removableBytes =
        disposition === "supersede"
          ? purgeRequested
            ? member.node.size
            : 0
          : 0;
      if (disposition === "keep" || disposition === "archive") {
        member.action = ACTIONS.REPORT;
      } else {
        // `supersede` is the only retention outcome that acts, and it acts reversibly: a move
        // to the sink, S3, named per item with --confirm. `plan --purge` upgrades it to a real
        // purge for an owner who wants the bytes back.
        member.action = purgeRequested ? ACTIONS.PURGE : ACTIONS.MOVE;
        member.minLevel = "deep";
      }
      const recomputed = computeSafety(
        { ...member, action: member.action },
        member.node.type === "dir" ? { ...member.node, bytes: member.node.subtreeBytes } : member.node,
        context,
        limits,
      );
      member.safety = recomputed.safety;
      member.action = recomputed.action;
      member.raisedBy = recomputed.raisedBy;
      member.evidence.raisedBy = recomputed.raisedBy;
      // A retention default accounts for a healthy backup; a removal PROPOSAL must not: it stays
      // pending until the owner applies it or sets a disposition, otherwise the gate would close
      // itself without anything having happened.
      member.dispositionOverride =
        disposition === "keep"
          ? { disposition: "kept", decidedBy: "policy", reason }
          : disposition === "archive"
            ? { disposition: "deferred", decidedBy: "policy", reason }
            : { disposition: "pending", decidedBy: "engine", reason: `proposed disposition ${disposition}: ${reason}` };
    }

    const fallbackBytes = fallback ? fallback.node.size : 0;
    retentionFamilies.push({
      family,
      copies: members.length,
      keep: newest.node.rel,
      keepVerified: newestVerified,
      previous: fallback ? fallback.node.rel : null,
      previousBytes: fallbackBytes,
      removable: removable.length,
      removableBytes: removable.reduce((sum, member) => sum + member.node.size, 0),
      reclaimableBytes: removable.reduce((sum, member) => {
        const oversize = member.node.size > limits.maxSinkBytes;
        return sum + (oversize ? 0 : member.node.size);
      }, 0),
      reason:
        removable.length > 0
          ? `${removable.length} older cop${removable.length === 1 ? "y" : "ies"} superseded by \`${newest.node.rel}\``
          : newestVerified
            ? "one verified copy plus at most one fallback: nothing to remove"
            : `no copy in this family has restore evidence: all ${members.length} cop${members.length === 1 ? "y" : "ies"} retained, nothing proposed for removal`,
    });
  }
  retentionFamilies.sort((a, b) => (a.family < b.family ? -1 : a.family > b.family ? 1 : 0));

  const retentionPolicy = {
    policy:
      "one keep (newest restore-verified copy) + at most one previous (the fallback) per family; older copies are supersede proposals only when a newer copy is verified",
    purgeRequested,
    // Honest accounting: a quarantine move relocates bytes, it does not free them. Only a purge
    // reclaims disk, and the engine will not purge a backup unless the owner asks with --purge
    // and confirms the item by name.
    freesDiskSpace: purgeRequested,
    families: retentionFamilies,
    totals: {
      families: retentionFamilies.length,
      keep: retentionFamilies.filter((row) => row.keep).length,
      previous: retentionFamilies.filter((row) => row.previous !== null).length,
      supersede: retentionFamilies.reduce((sum, row) => sum + row.removable, 0),
      removableBytes: retentionFamilies.reduce((sum, row) => sum + row.removableBytes, 0),
      reclaimableBytes: retentionFamilies.reduce((sum, row) => sum + row.reclaimableBytes, 0),
    },
    note: purgeRequested
      ? "`plan --purge` was requested: supersede items are purges (irreversible, still confirmed per item by name) and the bytes are actually reclaimed"
      : "a quarantine move does NOT free disk space: the bytes stay in the sink until the owner deletes them. Use `plan --purge` to reclaim them for regenerable backups, or delete the sink copy by name.",
  };

  // --- owner decisions override the engine, never the gates ---------------------------
  for (const artifact of artifacts) {
    const decision = decisions.decisions[artifact.node.rel];
    if (!decision) continue;
    artifact.decidedBy = "owner";
    artifact.decisionReason = decision.reason ?? "";
    artifact.decisionAt = decision.at ?? null;
    artifact.dispositionOverride = {
      disposition: decision.disposition,
      decidedBy: "owner",
      reason: decision.reason ?? "",
    };
    if (decision.disposition !== "removed") {
      artifact.action = ACTIONS.NONE;
      artifact.safety = "S0";
    } else {
      artifact.minLevel = "minimal";
    }
  }

  // --- reference check for removal candidates ----------------------------------------
  //
  // A run that could NOT perform the check must never read as "no references found": the
  // candidates keep their action but are raised one class and carry referenceCheck: "not-run",
  // so the plan says out loud which check did not happen.
  const removalCandidates = artifacts.filter((artifact) => isActingAction(artifact.action));
  const basenames = removalCandidates.map((artifact) => basenameOf(artifact.node.rel));
  const references = options.skipReferenceCheck
    ? { checked: 0, referenced: new Map(), mode: "skipped", note: "reference check disabled" }
    : findReferences(rootReal, basenames, limits, paths.tmp);

  if (references.mode !== "git-grep") {
    for (const artifact of removalCandidates) {
      artifact.evidence.referenceCheck = "not-run";
      artifact.evidence.referenceCheckNote = references.note ?? references.mode;
      artifact.evidence.signals.push(`reference-check:${references.mode}`);
      artifact.raisedBy = [...artifact.raisedBy, "reference-check-not-run"];
      artifact.safety = raiseClass(artifact.safety, "reference-check-not-run", []);
      artifact.evidence.raisedBy = artifact.raisedBy;
    }
  }

  // --- a directory that holds something kept or reported is still in use ---------------
  //
  // This is the "not a parent of any item the plan keeps or reports" rule. It is applied after
  // every action is final, because the reference check above can turn a removal candidate into
  // a report - and a directory holding a reported item must not be settled underneath it.
  const parentsOfKeptOrReported = new Set();
  for (const artifact of artifacts) {
    if (artifact.action === ACTIONS.MOVE || artifact.action === ACTIONS.PURGE || artifact.action === ACTIONS.SETTLE) {
      continue;
    }
    let ancestor = artifact.node.parent;
    while (ancestor !== null && ancestor !== "") {
      parentsOfKeptOrReported.add(ancestor);
      ancestor = enumerated.byRel.get(ancestor)?.parent ?? null;
    }
  }
  // A directory that still holds content the plan keeps or reports is in use, and so is one
  // that a route in this same plan is about to fill: removing it would undo that route.
  const routeDestinations = artifacts
    .filter((artifact) => artifact.action === ACTIONS.ROUTE && typeof artifact.routeTarget === "string")
    .map((artifact) => path.resolve(rootReal, artifact.routeTarget));
  for (const artifact of artifacts) {
    if (artifact.action !== ACTIONS.SETTLE) continue;
    const holdsKeptContent = parentsOfKeptOrReported.has(artifact.node.rel);
    const receivesRoute = routeDestinations.some(
      (destination) => destination === artifact.node.abs || isInsidePath(artifact.node.abs, destination),
    );
    if (!holdsKeptContent && !receivesRoute) continue;
    artifact.action = ACTIONS.REPORT;
    artifact.safety = "S0";
    artifact.reason = holdsKeptContent
      ? `${artifact.reason} - not settled: the plan keeps or reports content under it`
      : `${artifact.reason} - not settled: a routed test file is written into it by this same plan`;
    artifact.evidence.signals = [
      ...artifact.evidence.signals,
      holdsKeptContent ? "settle-blocked:plan-keeps-content-below" : "settle-blocked:receives-a-routed-file",
    ];
    if (artifact.evidence.childCount === 0) artifact.evidence.childCount = null;
  }

  // --- two items must never be routed to the same destination --------------------------
  //
  // A rename onto an occupied path is a data-loss shape, so a contested destination degrades
  // BOTH items to `report` rather than letting file order decide which one survives.
  const routeCounts = new Map();
  for (const artifact of artifacts) {
    if (artifact.action !== ACTIONS.ROUTE) continue;
    const target = artifact.routeTarget;
    routeCounts.set(target, (routeCounts.get(target) ?? 0) + 1);
  }
  for (const artifact of artifacts) {
    if (artifact.action !== ACTIONS.ROUTE) continue;
    if ((routeCounts.get(artifact.routeTarget) ?? 0) < 2) continue;
    artifact.action = ACTIONS.REPORT;
    artifact.safety = "S0";
    artifact.reason = `${artifact.reason} - not routed: ${routeCounts.get(artifact.routeTarget)} items resolve to the same destination`;
    artifact.evidence.signals = [...artifact.evidence.signals, "route-blocked:destination-contested"];
  }

  for (const artifact of artifacts) {
    const base = basenameOf(artifact.node.rel);
    const referencedBy = references.referenced.get(base) ?? [];
    artifact.evidence.referencedBy = referencedBy;
    if (referencedBy.length === 0) continue;
    artifact.evidence.signals.push("referenced-by-tracked-file");
    if (REFERENCE_SENSITIVE_KINDS.has(artifact.kind)) {
      // A junk-named or ignored file that tracked code loads is not litter. Stop, and say who
      // names it.
      artifact.action = ACTIONS.REPORT;
      artifact.reason = `${artifact.reason} - referenced by tracked file(s): ${referencedBy.join(", ")}`;
      artifact.safety = "S3";
      artifact.raisedBy = [...artifact.raisedBy, "referenced-by-tracked-file"];
      artifact.evidence.raisedBy = artifact.raisedBy;
      artifact.dispositionOverride = {
        disposition: "pending",
        decidedBy: "engine",
        reason: "referenced by tracked files; owner must decide",
      };
    } else {
      // A build or test script MUST name the output directory it produces, so a mention there is
      // the expected shape of the evidence rather than a signal of value. The reference is still
      // recorded, and the owner sees it, but it does not by itself veto regenerable output.
      artifact.evidence.referenceNote =
        "named by build/test configuration; expected for generated output and not treated as a use";
      artifact.evidence.signals.push("referenced-by-configuration");
    }
  }

  // --- session scope ------------------------------------------------------------------
  const scopedArtifacts =
    scope === "session"
      ? artifacts.filter((artifact) => artifact.evidence.sessionCreated === true)
      : artifacts;

  // --- aggregation: keep the plan reviewable -----------------------------------------
  const requestedRank = level === null ? null : levelRank(level);
  const planned = scopedArtifacts.filter((artifact) => {
    if (artifact.action !== ACTIONS.MOVE && artifact.action !== ACTIONS.PURGE) return false;
    if (requestedRank === null) return false;
    return requestedRank >= (levelRank(artifact.minLevel) ?? 0);
  });

  const aggregates = new Map();
  if (requestedRank !== null) {
    const groups = new Map();
    const plannedByParent = new Map();
    for (const artifact of planned) {
      const parent = artifact.node.parent;
      const plannedHere = plannedByParent.get(parent) ?? 0;
      plannedByParent.set(parent, plannedHere + 1);
      if (artifact.node.type !== "file") continue;
      const list = groups.get(parent) ?? [];
      list.push(artifact);
      groups.set(parent, list);
    }
    for (const [parent, members] of groups) {
      if (parent === "" || members.length < limits.aggregateMin) continue;
      const signature = new Set(
        members.map((member) => `${member.kind}|${member.safety}|${member.action}|${member.minLevel}`),
      );
      if (signature.size !== 1) continue;
      // Every planned item in the directory must belong to the group, so aggregation can
      // never quietly swallow a differently-classed sibling.
      if (plannedByParent.get(parent) !== members.length) continue;
      const parentNode = enumerated.byRel.get(parent);
      if (!parentNode || !dirActionAllowed(parentNode)) continue;
      // A directory the settle pass will remove must not have its contents folded into one
      // directory item that sits on a directory about to disappear.
      if (willBeEmptyDirs.has(parent)) continue;
      aggregates.set(parent, { members, parentNode });
    }
  }

  const aggregatedRels = new Set();
  for (const [, group] of aggregates) {
    for (const member of group.members) aggregatedRels.add(member.node.rel);
  }

  // --- items --------------------------------------------------------------------------
  const items = [];
  for (const artifact of scopedArtifacts) {
    if (aggregatedRels.has(artifact.node.rel)) continue;
    items.push(artifact);
  }
  for (const [parent, group] of aggregates) {
    const { members, parentNode } = group;
    const bytes = members.reduce((sum, member) => sum + member.node.size, 0);
    const first = members[0];
    items.push({
      node: {
        ...parentNode,
        abs: parentNode.abs,
        size: bytes,
        mtimeMs: Math.max(...members.map((member) => member.node.mtimeMs)),
        type: "dir",
        subtreeBytes: bytes,
      },
      kind: first.kind,
      rule: `aggregate:${first.rule}`,
      reason: `${members.length} \`${first.kind}\` items in one directory, ${bytesHuman(bytes)} total (${first.reason})`,
      action: first.action,
      safety: first.safety,
      raisedBy: [...new Set(members.flatMap((member) => member.raisedBy))],
      minLevel: first.minLevel,
      evidence: {
        signals: [`aggregate-of-${members.length}`],
        aggregate: {
          count: members.length,
          bytes,
          members: members.slice(0, 5).map((member) => member.node.rel),
          omitted: Math.max(0, members.length - 5),
        },
      },
      retentionClass: null,
      ageDays: ageDaysOf(parentNode.mtimeMs),
      dispositionOverride: null,
    });
  }

  items.sort(compareRel);

  // --- empty-directory settle, decided on the FINAL item list ---------------------------
  //
  // Last, because whether a directory still holds a planned decision depends on aggregation:
  // 30 junk files that collapsed into ONE directory item must not have their directory settled
  // out from under that item. Deepest-first, iterated to a fixpoint so settling a child is what
  // makes its parent settleable.
  /** Does anything still planned sit at or below `rel`? A settle must never race a move. */
  const hasUnsettledPlannedBelow = (rel, currentId) => {
    for (const item of items) {
      const id = itemIdFor(item.node.rel);
      if (id === currentId) continue;
      if (item.planned !== true) continue;
      if (item.action === ACTIONS.SETTLE) continue;
      const other = item.node.rel;
      if (other === rel || other.startsWith(`${rel}/`)) return true;
    }
    return false;
  };

  const settleSweep = () => {
    const byDepth = [...items].sort((a, b) => (b.node.rel.split("/").length - a.node.rel.split("/").length));
    let changed = 0;
    for (const item of byDepth) {
      const node = item.node;
      if (node.type !== "dir") continue;
      const settleable =
        willBeEmptyDirs.has(node.rel) &&
        (item.kind === KIND.UNTRACKED_WORK || item.action === ACTIONS.SETTLE) &&
        isSettleCandidate(node, context) &&
        !hasUnsettledPlannedBelow(node.rel, itemIdFor(node.rel));
      if (!settleable) continue;
      const settled = settleArtifactFor(node, item);
      settled.node = node;
      settled.ageDays = item.ageDays;
      items[items.indexOf(item)] = settled;
      changed += 1;
    }
    return changed;
  };

  for (let round = 0; round < 8 && settleSweep() > 0; round += 1) {
    /* the sweep reports how many directories it settled in this round */
  }
  items.sort(compareRel);

  const fingerprintCache = new Map();
  for (const item of items) {
    // Only items that could actually be acted on are hashed: a report-only item has no action
    // to verify, and hashing an entire repository to print a report would be pure cost.
    const hasAction = isActingAction(item.action);
    const shouldFingerprint =
      hasAction && (requestedRank === null || requestedRank >= (levelRank(item.minLevel) ?? 0));
    if (!shouldFingerprint) {
      item.fingerprint = null;
      continue;
    }
    const nodeForFingerprint = item.node.type === "dir" && item.evidence.aggregate
      ? item.node
      : item.node;
    const key = item.node.rel;
    if (!fingerprintCache.has(key)) {
      fingerprintCache.set(
        key,
        fingerprintFor(nodeForFingerprint.abs, nodeForFingerprint.type, limits),
      );
    }
    item.fingerprint = fingerprintCache.get(key);
  }

  // --- the single public item view every command consumes -----------------------------
  //
  // One shape, so `inventory`, `plan`, `apply` and `disposition` can never disagree about what
  // an item is: id, absolute target, class, action, level, evidence, fingerprint and the
  // documented equivalent command. `planned` is the level gate, and `apply` refuses anything
  // the plan did not mark as planned.
  const publicItems = items.map((artifact) => {
    const plannedAtLevel =
      requestedRank !== null &&
      artifact.action !== ACTIONS.NONE &&
      artifact.action !== ACTIONS.REPORT &&
      requestedRank >= (levelRank(artifact.minLevel) ?? 0);
    const disposition =
      artifact.dispositionOverride ??
      (artifact.action === ACTIONS.NONE
        ? { disposition: "pending", decidedBy: "engine", reason: artifact.reason }
        : { disposition: "pending", decidedBy: "engine", reason: "proposed action awaits apply" });
    const target = artifact.node.abs;
    const sinkTarget =
      artifact.action === ACTIONS.MOVE ? path.join(paths.sink, "<runStamp>", artifact.node.rel) : null;
    const routeTarget =
      artifact.action === ACTIONS.ROUTE && artifact.routeTarget
        ? path.join(rootReal, artifact.routeTarget)
        : null;
    const sized =
      artifact.node.type === "file"
        ? artifact.node.size
        : artifact.evidence.aggregate?.bytes ?? artifact.node.subtreeBytes;
    return {
      id: itemIdFor(artifact.node.rel),
      rel: artifact.node.rel,
      path: target,
      type: artifact.node.type,
      kind: artifact.kind,
      rule: artifact.rule,
      reason: artifact.reason,
      safety: artifact.safety,
      class: artifact.safety,
      raisedBy: artifact.raisedBy,
      action: artifact.action,
      minLevel: artifact.minLevel,
      levelState:
        requestedRank === null
          ? "reported"
          : artifact.action === ACTIONS.REPORT || artifact.action === ACTIONS.NONE
            ? "no-action"
            : plannedAtLevel
              ? "planned"
              : "deferred-by-level",
      planned: plannedAtLevel,
      disposition: disposition.disposition,
      dispositionSource: disposition.decidedBy,
      dispositionReason: disposition.reason,
      size: sized,
      mtime: isoOrNull(artifact.node.mtimeMs),
      ageDays: artifact.ageDays,
      retentionClass: artifact.retentionClass,
      evidence: artifact.evidence,
      fingerprint: artifact.fingerprint ?? null,
      fingerprintSummary: fingerprintSummary(artifact.fingerprint ?? null),
      shell:
        artifact.action === ACTIONS.MOVE || artifact.action === ACTIONS.PURGE
          ? equivalentShell(artifact.action, target, sinkTarget)
          : artifact.action === ACTIONS.ROUTE
            ? equivalentShell(ACTIONS.ROUTE, target, routeTarget)
            : artifact.action === ACTIONS.SETTLE
              ? equivalentShell(ACTIONS.SETTLE, target, null)
              : null,
      shellExecuted: false,
      routeTarget: routeTarget,
      retentionRole: artifact.retentionRole ?? null,
      restoreVerified: artifact.restoreVerified === true,
    // `unsure` is the doctrine's third class: the engine looked, found only a weak signal, and
    // deliberately did not decide. The flag is EVIDENCE-based, never class-based: a strong-signal
    // `test-content` item carries no `unsure`, and a weak hit on a reported class carries it too.
    //
    // `unsure` records that the probe could not decide; it does NOT mean "left in place". The
    // reason therefore says what the plan actually proposes, so a `--json` reader is never told
    // "kept on disk" about an item that is a per-item-confirmed removal candidate.
    unsure:
      artifact.evidence.testProbe?.strong === null && (artifact.evidence.testProbe?.weak?.length ?? 0) > 0,
    unsureReason: artifact.evidence.testProbe?.strong === null && (artifact.evidence.testProbe?.weak?.length ?? 0) > 0
      ? `content probe found only weak test signals (${artifact.evidence.testProbe.weak.join(", ")}); ${
          isActingAction(artifact.action)
            ? `this is still a per-item-confirmed ${artifact.action}, and the item's own reason names what proposes it`
            : "not planned, so it stays on disk for the owner to decide"
        }`
      : null,
      landHint:
        artifact.kind === KIND.UNTRACKED_WORK
          ? `review and, if it belongs in the repository, land it yourself (git add -- '${artifact.node.rel}')`
          : null,
      note: artifact.evidence.oversizeArchive
        ? "exceeds the quarantine cap: archive off-line before deleting"
        : artifact.evidence.reservedDeviceName
          ? "Windows reserved device name; the class is never below S2 and the path may resolve to a device"
          : artifact.evidence.blockedBy
            ? `whole-directory action blocked by ${artifact.evidence.blockedBy.join(", ")}; handle per item`
            : artifact.evidence.referencedBy?.length > 0
              ? "referenced by tracked files; owner decision required"
              : artifact.action === ACTIONS.ROUTE
                ? "the file moves within the repository: relative imports may need fixing, and the test runner must collect it afterwards"
                : artifact.action === ACTIONS.SETTLE
                  ? "empty directory; `undo` recreates it, and the removal is journalled with a mkdir inverse"
                  : artifact.action === ACTIONS.PURGE
                    ? "an owner-requested purge is irreversible: the journal records it as not restorable"
                    : artifact.retentionRole === "previous"
                      ? "kept as the fallback until a restore drill verifies the newer copy"
                      : artifact.kind === KIND.BACKUP && artifact.restoreVerified !== true && artifact.action === "report"
                        ? "no restore-drill evidence recorded for this family: retained, and nothing in it is proposed for removal"
                        : null,
    };
  });

  // --- counts -------------------------------------------------------------------------
  const byKind = {};
  const bySafety = {};
  const byMinLevel = {};
  for (const item of publicItems) {
    byKind[item.kind] = (byKind[item.kind] ?? 0) + 1;
    bySafety[item.safety] = (bySafety[item.safety] ?? 0) + 1;
    byMinLevel[item.minLevel] = (byMinLevel[item.minLevel] ?? 0) + 1;
  }

  const litterKinds = new Set([
    KIND.JUNK_NAMED,
    KIND.TEST_ARTIFACT,
    KIND.BUILD_OUTPUT,
    KIND.SCRAPE_RAW,
    KIND.IGNORED_OTHER,
  ]);
  const litterItems = publicItems.filter(
    (item) => litterKinds.has(item.kind) && item.action !== ACTIONS.NONE,
  );
  const backupItems = publicItems.filter((item) => item.kind === KIND.BACKUP);
  const actionable = publicItems.filter((item) => isActingAction(item.action));

  const counts = {
    discovered: enumerated.visited,
    artifacts: publicItems.length,
    actionable: actionable.length,
    planned: publicItems.filter((item) => item.planned).length,
    litter: litterItems.length,
    backups: backupItems.length,
    untrackedWork: publicItems.filter((item) => item.kind === KIND.UNTRACKED_WORK).length,
    protected: enumerated.protectedEntries.length,
    // Protection is a rule, not a finding: this groups the excluded paths by the rule that
    // excluded them, so "561 tracked files" reads as one reason with a count.
    protectedByReason: enumerated.protectedEntries.reduce((acc, node) => {
      acc[node.protectedReason] = (acc[node.protectedReason] ?? 0) + 1;
      return acc;
    }, {}),
    refused: enumerated.refused.length,
    byKind,
    bySafety,
    byMinLevel,
  };

  const bytes = {
    artifactBytes: publicItems
      .filter((item) => item.type === "file")
      .reduce((sum, item) => sum + item.size, 0),
    litterBytes: litterItems
      .filter((item) => item.type === "file")
      .reduce((sum, item) => sum + item.size, 0),
    actionableBytes: actionable.reduce((sum, item) => sum + item.size, 0),
    backupBytes: backupItems.reduce((sum, item) => sum + item.size, 0),
  };

  return {
    [ANALYZE_INTERNALS]: { enumerated, references, paths, decisions, aggregates },
    root: rootReal,
    rootGiven,
    rootReal,
    level,
    scope,
    limits,
    tools,
    git: {
      available: git.available,
      reason: git.reason ?? null,
      version: git.gitVersion ?? null,
      topLevel: git.topLevel ?? null,
      rootIsTopLevel: git.rootIsTopLevel ?? null,
      trackedCount: git.trackedCount ?? 0,
      ignoredCount: git.ignoredCount ?? 0,
      head: git.head ?? null,
      branch: git.branch ?? null,
    },
    session,
    references: {
      mode: references.mode,
      checked: references.checked,
      referenced: references.referenced.size,
      note: references.note ?? null,
    },
    items: publicItems,
    protected: enumerated.protectedEntries
      .map((node) => ({
        rel: node.rel,
        path: node.abs,
        type: node.type,
        reason: node.protectedReason,
        walked: node.type === "dir" ? false : true,
      }))
      .sort(compareRel),
    refused: enumerated.refused
      .map((node) => ({
        rel: node.rel,
        path: node.abs,
        type: node.type,
        reason: node.refusedReason,
        realpath: node.realpath,
        escapesRoot: node.escapesRoot,
      }))
      .sort(compareRel),
    backups: items
      .filter((item) => item.kind === KIND.BACKUP && !item.evidence.aggregate)
      .map((item) => ({
        rel: item.node.rel,
        path: item.node.abs,
        size: item.node.type === "file" ? item.node.size : item.node.subtreeBytes,
        mtime: isoOrNull(item.node.mtimeMs),
        ageDays: item.ageDays,
        retentionClass: item.retentionClass,
        family: item.evidence.backupFamily ?? backupFamilyOf(item.node.rel),
        disposition: item.backupDisposition ?? "keep",
        retentionRole: item.retentionRole ?? null,
        restoreVerified: item.restoreVerified === true,
        supersededBy: item.evidence.supersededBy ?? null,
        reason: item.backupReason ?? "",
        safety: item.safety,
      }))
      .sort(compareRel),
    restoreEvidence: {
      path: restoreEvidence.path,
      found: restoreEvidence.found,
      verifiedCount: Object.keys(restoreEvidence.verified ?? {}).length,
      note: restoreEvidence.note ?? null,
    },
    retentionPolicy,
    counts,
    bytes,
    scanErrors: enumerated.scanErrors,
    truncated: enumerated.truncated,
    notes: [
      retentionPolicy.note,
      retentionPolicy.totals.supersede > 0 && !purgeRequested
        ? `${retentionPolicy.totals.supersede} superseded backup cop(ies), ${bytesHuman(retentionPolicy.totals.removableBytes)}: quarantining them frees no disk space - add --purge to reclaim the bytes`
        : null,
      context.testTree
        ? `test tree detected at \`${context.testTree.rel}/\`: a detected test file outside it is routed there, never removed`
        : "no test tree detected: a detected test file is reported, never removed",
    ].filter((note) => note !== null),
  };
};

// ---------------------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------------------

const buildPlanData = (analysis, options = {}) => {
  const internals = analysis[ANALYZE_INTERNALS];
  // `analyze` already produced the public item view for exactly this level: `planned` is the
  // level gate and `shell` documents the equivalent command. A plan never re-classifies.
  const items = analysis.items;

  const actionable = items.filter((item) => item.planned);
  const confirmIds = actionable.filter((item) => item.safety === "S3").map((item) => item.id);
  const s2Ids = actionable.filter((item) => item.safety === "S2").map((item) => item.id);

  const planHash = sha256Hex(
    JSON.stringify({
      root: analysis.rootReal,
      level: analysis.level,
      scope: analysis.scope,
      items: items.map((item) => [item.rel, item.kind, item.safety, item.action, item.planned]),
    }),
  ).slice(0, 10);

  const planId = `p-${planHash}`;
  const planFile = options.out
    ? path.resolve(options.out)
    : path.join(internals.paths.plans, `${planId}-${analysis.level}-${analysis.scope}.json`);

  const counts = {
    items: items.length,
    planned: actionable.length,
    deferredByLevel: items.filter((item) => item.levelState === "deferred-by-level").length,
    noAction: items.filter((item) => item.levelState === "no-action").length,
    litter: analysis.counts.litter,
    backups: analysis.counts.backups,
    untrackedWork: analysis.counts.untrackedWork,
    actionable: analysis.counts.actionable,
    plannedByClass: {
      S0: actionable.filter((item) => item.safety === "S0").length,
      S1: actionable.filter((item) => item.safety === "S1").length,
      S2: actionable.filter((item) => item.safety === "S2").length,
      S3: actionable.filter((item) => item.safety === "S3").length,
    },
    protected: analysis.protected.length,
    refused: analysis.refused.length,
  };

  const data = {
    planId,
    createdAt: nowIso(),
    root: analysis.rootReal,
    rootGiven: analysis.rootGiven,
    level: analysis.level,
    scope: analysis.scope,
    tools: {
      git: analysis.git.available,
      trashTool: analysis.tools.trashTool,
      raiseS2WhenNoTrash: analysis.tools.raiseS2WhenNoTrash,
    },
    limits: analysis.limits,
    git: analysis.git,
    session: analysis.session,
    references: analysis.references,
    items,
    actionable: actionable.map((item) => item.id),
    protected: analysis.protected,
    refused: analysis.refused,
    // The doctrine requires a named "unsure, deferred" section in every plan, even when empty:
    // an item the engine looked at and could not classify is reported by name rather than
    // silently omitted. These are always unplanned and stay on disk.
    unsure: items
      .filter((item) => item.unsure === true)
      .map((item) => ({
        id: item.id,
        rel: item.rel,
        path: item.path,
        kind: item.kind,
        action: item.action,
        minLevel: item.minLevel,
        reason: item.unsureReason,
        signals: item.evidence?.signals ?? [],
      })),
    backups: analysis.backups,
    retentionPolicy: analysis.retentionPolicy,
    restoreEvidence: analysis.restoreEvidence,
    counts,
    bytes: analysis.bytes,
    nextCommands: {
      apply:
        actionable.length > 0
          ? runnerFor(
              `apply --plan "${planFile}"${s2Ids.length > 0 ? " --approve-s2" : ""}${confirmIds.length > 0 ? ` --confirm ${confirmIds.join(",")}` : ""}`,
            )
          : null,
      s2Ids,
      confirmIds,
      note:
        confirmIds.length > 0
          ? `${confirmIds.length} item(s) are S3 and need --confirm with exactly those ids; the command above already names them`
          : "no S3 items in this plan",
    },
    notes: [
      analysis.tools.trashTool === null
        ? "no trash CLI found: S2 removal candidates were raised to S3 (per-item --confirm); S1 items keep the reversible sink+journal path"
        : `trash tool available: ${analysis.tools.trashTool}`,
      "`shell` on each item is documentation of the equivalent command; this engine executes no shell command for it (shellExecuted: false)",
      analysis.retentionPolicy?.note ?? null,
      actionable.some((item) => item.action === ACTIONS.SETTLE)
        ? `${actionable.filter((item) => item.action === ACTIONS.SETTLE).length} empty director(ies) will be settled after the moves in this plan run, deepest first; \`undo\` recreates each one`
        : null,
      actionable.some((item) => item.action === ACTIONS.ROUTE)
        ? `${actionable.filter((item) => item.action === ACTIONS.ROUTE).length} test file(s) will be routed into the test tree; the runner must collect them afterwards`
        : null,
      actionable.some((item) => item.action === ACTIONS.PURGE && item.kind === KIND.BACKUP)
        ? "purge was requested for superseded backups: those actions are irreversible and are still confirmed per item by name"
        : null,
      analysis.truncated ? "the scan hit the walk limit and was truncated: the report is incomplete" : null,
      analysis.scanErrors.length > 0 ? `${analysis.scanErrors.length} path(s) could not be read and were skipped` : null,
    ].filter((note) => note !== null),
  };
  data.planFile = planFile;
  return data;
};

// ---------------------------------------------------------------------------------------
// Apply (I4, I5, I6)
// ---------------------------------------------------------------------------------------

const sinkStamp = () => {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(
    now.getUTCHours(),
  )}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
};

/** Move with rename first (same volume is free and atomic), copy+delete only on EXDEV. */
const movePath = (from, to) => {
  ensureDir(path.dirname(to));
  try {
    renameSync(from, to);
    return { method: "rename", modeChanged: null };
  } catch (error) {
    if (error.code === "EXDEV" || error.code === "EPERM" || error.code === "EACCES" || error.code === "EBUSY") {
      // A read-only file can refuse a rename on Windows. Clear the bit, retry, and record it
      // so `undo` can put the mode back.
      let modeChanged = null;
      try {
        const stats = statSync(from);
        const current = stats.mode & 0o777;
        if (current !== 0 && (current & 0o200) === 0) {
          chmodSync(from, current | 0o200);
          modeChanged = { from: current, to: current | 0o200 };
          renameSync(from, to);
          return { method: "rename-after-chmod", modeChanged };
        }
      } catch {
        /* fall through to the copy path */
      }
      const stats = safeLstat(from);
      if (stats !== null && stats.isDirectory()) {
        cpSync(from, to, { recursive: true, force: true, preserveTimestamps: true, errorOnExist: false });
        rmSync(from, { recursive: true, force: true, maxRetries: 3 });
      } else {
        copyFileSync(from, to);
        rmSync(from, { force: true, maxRetries: 3 });
      }
      return { method: "copy+delete", modeChanged };
    }
    throw error;
  }
};

/**
 * The context `protectionReason()` needs, rebuilt at apply time from LIVE state. This is the
 * F2 fix: `apply` used to re-check only containment and git-tracked status, so a hand-edited
 * plan could move `.env`, `id_rsa` or the sink manifest out of the repository through the
 * documented `--confirm` flow. The plan is a hand-editable artifact, so every protection rule
 * is now re-decided per item immediately before it is touched - the same predicate that
 * decided at plan time, on the state that exists at apply time.
 */
const protectionContextFor = (rootReal, gitState) => {
  const paths = statePaths(rootReal);
  return {
    rootReal,
    tracked: gitState.tracked,
    engineProtectedPrefixes: [paths.base].filter((dir) => isInsidePath(rootReal, dir)),
    protectedSinkPrefixes: [paths.sink].filter((dir) => isInsidePath(rootReal, dir)),
    tempDirs: [path.resolve(os.tmpdir())].filter((dir) => isInsidePath(rootReal, dir)),
  };
};

const applyPlan = (planFile, flags) => {
  if (!existsSync(planFile)) {
    const error = new Error(`plan not found: ${planFile}`);
    error.code = EXIT.NOT_FOUND;
    throw error;
  }
  let plan;
  try {
    plan = JSON.parse(readFileSync(planFile, "utf8"));
  } catch (error) {
    const wrapped = new Error(`plan is not valid JSON: ${error.message}`);
    wrapped.code = EXIT.USAGE;
    throw wrapped;
  }
  if (plan?.kind !== "plan" || !plan.data || !Array.isArray(plan.data.items)) {
    const error = new Error(`not an organizer plan: ${planFile}`);
    error.code = EXIT.USAGE;
    throw error;
  }
  const data = plan.data;
  const rootReal = data.root;
  if (!existsSync(rootReal)) {
    const error = new Error(`plan root no longer exists: ${rootReal}`);
    error.code = EXIT.NOT_FOUND;
    throw error;
  }
  const currentRootReal = realpathSyncSafe(rootReal);
  if (pathDiffersBeyondCase(currentRootReal, rootReal)) {
    const error = new Error(`plan root resolved elsewhere: ${rootReal} -> ${currentRootReal}`);
    error.code = EXIT.NOT_FOUND;
    throw error;
  }
  // --- V4-3: the plan's root is a claim like every other field -------------------------------
  // Protection is anchored to the root, so a plan re-rooted at the project's PARENT re-anchors the
  // whole model: `docs/**`, `storage/app/**` and `.git/**` stop matching at segment 0, and the
  // parent is not a git work tree, so the tracked re-check was skipped rather than failing closed.
  // The walk detects a nested repository during planning; at apply time the same fact is a refusal,
  // because it means this plan was not cut against the tree it is about to change.
  const gitAtRoot = readGitState(rootReal);
  if (!gitAtRoot.available && existsSync(path.join(rootReal, ".git"))) {
    const error = new Error(
      `plan root has a .git that git state cannot read: ${rootReal}; refusing to apply without tracked-file protection`,
    );
    error.code = EXIT.FINDINGS;
    throw error;
  }
  const nesting = findNestedRepository(rootReal);
  if (nesting.repo !== null) {
    const error = new Error(
      `plan root is a strict ancestor of a nested git repository (${nesting.repo}); its tracked set is not visible here, so this plan was not cut against the tree it would change`,
    );
    error.code = EXIT.FINDINGS;
    throw error;
  }
  // V5-1: the search is a work-bounded walk, and running out of budget is NOT the same answer as
  // "there is nothing nested here". Refusing is the only honest reading of an unproven absence -
  // the same rule the git re-check follows when it cannot read the tracked set.
  if (nesting.exhausted) {
    // Two ways to run out of proof, and the operator needs to know which: an unreadable directory
    // is a permissions problem to fix, a spent budget is a knob to raise.
    const error = new Error(
      nesting.unreadable !== null
        ? `the nested-repository search could not list ${nesting.unreadable}, so it cannot prove this root is not above another repository; grant read access to that directory or re-run with the plan root below it`
        : `the nested-repository search reached its budget of ${limitsFromEnv().nestedRepoScanDirs} directories after visiting ${nesting.visited} without proving this root is not above another repository; raise DSH_ORGANIZER_NEST_SCAN_DIRS to search further`,
    );
    error.code = EXIT.FINDINGS;
    throw error;
  }

  const limits = data.limits ?? limitsFromEnv();
  const paths = statePaths(rootReal);
  const itemsById = new Map(data.items.map((item) => [item.id, item]));

  // Validate every selector BEFORE touching anything, so a typo cannot half-apply a plan.
  const unknownOnly = flags.only.filter((id) => !itemsById.has(id));
  const unknownConfirm = flags.confirm.filter((id) => !itemsById.has(id));
  if (unknownOnly.length > 0 || unknownConfirm.length > 0) {
    const error = new Error(
      `unknown item id(s): ${[...unknownOnly, ...unknownConfirm].join(", ")} (ids come from the plan; nothing was attempted)`,
    );
    error.code = EXIT.USAGE;
    throw error;
  }

  const onlySet = flags.only.length > 0 ? new Set(flags.only) : null;
  const confirmSet = new Set(flags.confirm);

  const gitNow = readGitState(rootReal);
  // I3 re-decided at apply time, on live state (F2). One context, used for every item.
  const protectionNow = protectionContextFor(rootReal, gitNow);
  const selected = data.items.filter(
    (item) => item.planned === true && item.action !== ACTIONS.NONE && (onlySet === null || onlySet.has(item.id)),
  );

  const runStamp = sinkStamp();
  const sinkDir = path.join(paths.sink, runStamp);
  const journalEntries = [];
  const results = [];

  // Emptying happens AFTER the moves: settling a directory first would fight the move that is
  // supposed to leave it empty. Deepest-first, so a parent is considered once its child is gone.
  const relDepth = (rel) => rel.split("/").filter(Boolean).length;
  // Every absolute route destination in this plan, so a settle cannot delete a directory that a
  // route in the same plan is about to fill.
  const routeDestinations = data.items
    .filter((item) => item.action === ACTIONS.ROUTE && typeof item.routeTarget === "string")
    .map((item) => path.resolve(rootReal, item.routeTarget));
  const ordered = [
    ...selected.filter((item) => item.action !== ACTIONS.SETTLE),
    ...selected.filter((item) => item.action === ACTIONS.SETTLE).sort((a, b) => relDepth(b.rel) - relDepth(a.rel)),
  ];

  for (const item of ordered) {
    const safety = item.safety;
    const record = (status, reason, extra = {}) => {
      results.push({
        id: item.id,
        rel: item.rel,
        kind: item.kind,
        action: item.action,
        safety,
        status,
        reason,
        ...extra,
      });
    };

    // --- the plan may only ask for an action this engine knows how to perform ----------
    // Checked FIRST: an unrecognised action cannot be performed safely whatever the target is,
    // and deciding it before the target checks means the refusal names the real problem rather
    // than whichever guard happened to run first.
    if (!KNOWN_ACTIONS.has(item.action)) {
      record("refused", `unknown action "${item.action}" in the plan; refusing rather than guessing`);
      continue;
    }

    // --- every operand goes through ONE gate: validateOperand() ------------------------
    // This block used to be eight inline checks, and three rounds of findings came from an arm
    // that had grown a slightly different set of them. The checks now live in the helper, so the
    // route destination below, the settle directory, the purge target and both `undo` operands
    // are the same code path rather than four copies of it. See `validateOperand` for the order
    // and for why `followLinks` and `requireGit` exist.
    if (typeof item.rel !== "string" || item.rel === "") {
      record("refused", "plan item carries no rel; the action path is derived from it, so it is required");
      continue;
    }
    const relNow = toPosix(item.rel);
    let target = path.resolve(rootReal, relNow);
    // Containment is decided on the DERIVED path, so `..` traversal cannot escape whatever the
    // plan claims about `path` (V2-1).
    if (path.isAbsolute(item.rel) || !isInsidePath(rootReal, target)) {
      record("refused", "target is outside the containment root");
      continue;
    }
    if (target === rootReal) {
      record("refused", "the containment root itself is never an item");
      continue;
    }
    // The plan's own `path` may only AGREE with the derivation (letter case excepted on Windows).
    if (typeof item.path === "string" && item.path !== "") {
      if (!isInsidePath(rootReal, path.resolve(item.path))) {
        record("refused", "target is outside the containment root");
        continue;
      }
      if (pathDiffersBeyondCase(path.resolve(item.path), target)) {
        record(
          "refused",
          `plan item's rel and path disagree (rel resolves to ${target}, path is ${path.resolve(item.path)}); re-plan before applying`,
        );
        continue;
      }
    }

    const lstatNow = safeLstat(target);
    if (lstatNow === null) {
      record("drift", "target disappeared since planning");
      continue;
    }
    // Kept ahead of the helper so this refusal reads as a link rather than as a non-canonical rel:
    // `canonicalRelFor` walks the leaf, and a leaf swapped for a junction would otherwise resolve
    // elsewhere and be reported under a different rule than the one that actually stopped it.
    if (lstatNow.isSymbolicLink()) {
      record("refused", "target is now a symlink or junction (never followed)");
      continue;
    }
    // V4-3: `followLinks` judges the location the file is REALLY at, so a plan rooted at a
    // container directory is decided on the same path the action is rebased onto below.
    const operand = validateOperand(rootReal, target, protectionNow, {
      role: "target",
      claimedRel: relNow,
      followLinks: true,
      git: gitNow,
      requireGit: true,
    });
    if (operand.reason !== null) {
      record("refused", operand.reason, { checkedRel: operand.relDecided, checkedPath: operand.realAbs });
      continue;
    }
    // Act on the path that was just decided, never on the spelling the plan used.
    const targetDecided = operand.realAbs;
    const relDecided = operand.relDecided;
    if (pathDiffersBeyondCase(targetDecided, target)) target = targetDecided;

    // --- gates (I5): refusal is reported, never routed around ------------------------
    // A purge is the only irreversible action in this engine, so it is gated explicitly and
    // FIRST: the canonical target must have cleared the protected set (above), the plan's class
    // for the item must be S3, and that exact item id must have been named with `--confirm`.
    // Stating it here means a future change to the S2/S3 chain cannot silently reopen the path
    // a forged `safety` field used to reach `fs.rm`.
    if (item.action === ACTIONS.PURGE) {
      if (safety !== "S3") {
        record("refused", `purge requires class S3, and this item's class is ${safety}; an irreversible delete is never confirmed by batch`);
        continue;
      }
      if (!confirmSet.has(item.id)) {
        record("refused", `purge requires --confirm ${item.id} naming this exact item`);
        continue;
      }
    }
    if (safety === "S2" && flags.approveS2 !== true) {
      record("refused", "S2 needs --approve-s2");
      continue;
    }
    if (safety === "S3" && !confirmSet.has(item.id)) {
      record("refused", `S3 needs --confirm ${item.id}`);
      continue;
    }
    if (safety === "S0") {
      record("skipped-policy", "S0 is report-only");
      continue;
    }

    // --- drift (I4) ------------------------------------------------------------------
    const typeNow = lstatNow.isDirectory() ? "dir" : lstatNow.isFile() ? "file" : "other";
    if (typeNow === "other") {
      record("refused", "target is no longer a regular file or directory");
      continue;
    }
    const fingerprintNow = fingerprintFor(target, typeNow, limits);
    const expected = item.fingerprint;
    if (expected === null || expected === undefined) {
      record("drift", "the plan carries no fingerprint for this item; re-plan before applying");
      continue;
    }
    // A directory that this same plan empties is planned with the fingerprint of its pre-move
    // contents. Its CONTENT is therefore expected to differ by the time the settle runs, so the
    // drift check for a settle is "is it empty right now?", which the act below decides; asking
    // whether the tree digest still matches would fail a plan doing exactly what it promised.
    const isSettle = item.action === ACTIONS.SETTLE;
    if (!isSettle && (expected.mode !== fingerprintNow.mode || !fingerprintsEqual(expected, fingerprintNow))) {
      record(
        "drift",
        `target changed since planning (planned ${fingerprintSummary(expected)}; now ${fingerprintSummary(fingerprintNow)})`,
        { plannedFingerprint: fingerprintSummary(expected), currentFingerprint: fingerprintSummary(fingerprintNow) },
      );
      continue;
    }

    // --- act -------------------------------------------------------------------------
    const destination = path.join(sinkDir, item.rel);
    try {
      if (item.action === ACTIONS.MOVE) {
        const moved = movePath(target, destination);
        journalEntries.push({
          id: item.id,
          rel: item.rel,
          action: "move",
          at: nowIso(),
          from: target,
          to: destination,
          size: item.size,
          kind: item.kind,
          safety,
          verifiedFingerprint: fingerprintNow,
          restorable: true,
          status: "applied",
          undoStatus: null,
          inverse: { op: "move", from: destination, to: target, modeChanged: moved.modeChanged },
          method: moved.method,
        });
        record("applied", `quarantined to the sink (${moved.method})`, { sink: destination, bytes: item.size });
      } else if (item.action === ACTIONS.ROUTE) {
        // A move WITHIN the repository: a detected test file going to its test tree. Still a
        // move (so `undo` restores it), never a removal, and never into the sink.
        const relTarget = typeof item.routeTarget === "string" ? item.routeTarget : null;
        if (relTarget === null) {
          record("refused", "route-to-test-tree item carries no destination; re-plan before applying");
          continue;
        }
        const destinationAbs = path.resolve(rootReal, relTarget);
        if (!isInsidePath(rootReal, destinationAbs) || destinationAbs === rootReal) {
          record("refused", `route destination is outside the containment root: ${relTarget}`);
          continue;
        }
        // V2-1 for routes: the destination is derived from the source item, never taken on the
        // plan's word. A forged `routeTarget` could otherwise drop the file into a protected
        // directory (`docs/`, `.work/`, a runtime tree) while the item still looked honest.
        const testTree = detectTestTree({ rootReal });
        const expectedRouteTarget = testTree === null ? null : routeTargetFor(relNow, testTree.rel);
        if (expectedRouteTarget === null) {
          record("refused", "no test tree is present in this root now; refusing to route");
          continue;
        }
        if (pathDiffersBeyondCase(path.resolve(rootReal, toPosix(relTarget)), path.resolve(rootReal, toPosix(expectedRouteTarget)))) {
          record(
            "refused",
            `route destination does not match the one derived from the source file (expected ${expectedRouteTarget}, plan says ${toPosix(relTarget)}); re-plan before applying`,
          );
          continue;
        }
        // The destination goes through the same gate as every other operand (V2-1 for routes).
        // `allowMissing` because a route destination is *expected* not to exist - the occupancy
        // check below is the drift rule for it, and refusing on absence here would make every
        // honest route fail. `claimedRel` is the derived target, not the plan's string: the plan's
        // `routeTarget` has already been proven equal to the derivation above.
        const destinationOperand = validateOperand(rootReal, destinationAbs, protectionNow, {
          role: "destination",
          claimedRel: toPosix(path.relative(rootReal, destinationAbs)),
          allowMissing: true,
        });
        if (destinationOperand.reason !== null) {
          record("refused", destinationOperand.reason, { protectedBy: destinationOperand.relDecided, checkedPath: destinationAbs });
          continue;
        }
        if (safeLstat(destinationAbs) !== null) {
          record("drift", `route destination is now occupied: ${relTarget}; refusing to overwrite`);
          continue;
        }
        ensureDir(path.dirname(destinationAbs));
        const routed = movePath(target, destinationAbs);
        journalEntries.push({
          id: item.id,
          rel: item.rel,
          action: "route-to-test-tree",
          at: nowIso(),
          from: target,
          to: destinationAbs,
          size: item.size,
          kind: item.kind,
          safety,
          verifiedFingerprint: fingerprintNow,
          restorable: true,
          status: "applied",
          undoStatus: null,
          inverse: { op: "move", from: destinationAbs, to: target, modeChanged: routed.modeChanged },
          method: routed.method,
        });
        record("applied", `routed into the test tree at ${relTarget} (${routed.method})`, {
          routeTarget: destinationAbs,
          bytes: item.size,
        });
      } else if (item.action === ACTIONS.SETTLE) {
        // Settle an EMPTY directory. The inverse is a mkdir, which `undo` performs, so the
        // directory comes back exactly as it was. Two refusals keep this safe:
        //   * the directory must still be empty (a route in this same plan may have just put a
        //     file back into its test tree - the plan planned `tests/` as empty and then routed
        //     into `tests/`, so LIVE state wins over the plan's claim);
        //   * it must not be an ancestor of a route destination, for the same reason.
        const listingNow = safeReaddir(target);
        if (!Array.isArray(listingNow) || listingNow.length > 0) {
          record("drift", "directory is no longer empty; refusing to settle it");
          continue;
        }
        const asRouteAncestor = routeDestinations.some(
          (destination) => destination === target || isInsidePath(target, destination),
        );
        if (asRouteAncestor) {
          record("refused", "directory receives a routed test file in this plan; settling it would undo that route");
          continue;
        }
        // Non-recursive on purpose: rmdir fails loudly if anything appeared after the check,
        // where rm -r would silently delete it.
        rmdirSync(target);
        journalEntries.push({
          id: item.id,
          rel: item.rel,
          action: "settle",
          at: nowIso(),
          from: target,
          to: null,
          size: 0,
          kind: item.kind,
          safety,
          // The planned digest is what `undo` compares the recreated directory against: at action
          // time the directory is empty, and for a directory this plan just emptied the planned
          // digest describes the contents the plan already accounted for.
          verifiedFingerprint: isSettle ? expected : fingerprintNow,
          restorable: true,
          status: "applied",
          undoStatus: null,
          inverse: { op: "mkdir", path: target },
          method: "fs.rmdir",
        });
        record("applied", "empty directory settled (undo recreates it)", { bytes: 0 });
      } else {
        rmSync(target, { recursive: typeNow === "dir", force: true, maxRetries: 3 });
        journalEntries.push({
          id: item.id,
          rel: item.rel,
          action: "purge",
          at: nowIso(),
          from: target,
          to: null,
          size: item.size,
          kind: item.kind,
          safety,
          verifiedFingerprint: fingerprintNow,
          restorable: false,
          status: "applied",
          undoStatus: null,
          inverse: { op: "none", reason: "purge is irreversible" },
          method: "fs.rm",
        });
        record("applied", "purged permanently (S3, named with --confirm)", { bytes: item.size });
      }
    } catch (error) {
      record("error", `action failed: ${error.code ?? ""} ${error.message}`.trim());
    }
  }

  // Refusals for items the plan deferred or the level excluded, so the report is complete.
  for (const item of data.items) {
    if (item.planned === true) continue;
    if (onlySet !== null && !onlySet.has(item.id)) continue;
    if (item.action === ACTIONS.NONE || item.action === ACTIONS.REPORT) continue;
    results.push({
      id: item.id,
      rel: item.rel,
      kind: item.kind,
      action: item.action,
      safety: item.safety,
      status: "not-planned-at-level",
      reason: `deferred by level: planned from \`${item.minLevel}\` upward`,
    });
  }

  const journalFile = journalEntries.length > 0 ? writeJournal(paths, data.planId, {
    planId: data.planId,
    planFile: path.resolve(planFile),
    root: rootReal,
    rootGiven: data.rootGiven,
    sinkDir,
    createdAt: nowIso(),
    entries: journalEntries,
  }) : null;

  const counts = {
    selected: selected.length,
    applied: results.filter((result) => result.status === "applied").length,
    drift: results.filter((result) => result.status === "drift").length,
    refused: results.filter((result) => result.status === "refused").length,
    skipped: results.filter((result) => result.status === "skipped-policy").length,
    deferredByLevel: results.filter((result) => result.status === "not-planned-at-level").length,
    errors: results.filter((result) => result.status === "error").length,
  };

  const dataOut = {
    planId: data.planId,
    planFile: path.resolve(planFile),
    root: rootReal,
    approved: { s2: flags.approveS2 === true, confirm: flags.confirm, only: flags.only },
    journalFile,
    sinkDir,
    results,
    counts,
    nextCommands: {
      undo: journalFile ? runnerFor(`undo --journal "${journalFile}"`) : null,
      disposition: runnerFor(`disposition --root "${rootReal}" --level ${data.level}`),
    },
    notes: [
      counts.drift > 0 ? `${counts.drift} item(s) changed since planning and were skipped (exit 5)` : null,
      counts.refused > 0 ? `${counts.refused} item(s) refused by a gate or containment check (exit 6)` : null,
      "every applied action carries its inverse in the journal; `undo` restores S1/S2 quarantines and reports purges as not restorable",
    ].filter((note) => note !== null),
  };

  let exitCode = EXIT.OK;
  if (counts.drift > 0) exitCode = EXIT.DRIFT;
  else if (counts.refused > 0 || counts.errors > 0) exitCode = EXIT.FINDINGS;

  return { data: dataOut, exitCode };
};

const writeJournal = (paths, planId, journalData) => {
  ensureDir(paths.journals);
  let sequence = 1;
  let file = path.join(paths.journals, `journal-${planId}.json`);
  while (existsSync(file)) {
    sequence += 1;
    file = path.join(paths.journals, `journal-${planId}-${sequence}.json`);
  }
  const payload = { schemaVersion: SCHEMA_VERSION, kind: "journal", data: journalData };
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return file;
};

/** Absolute path to this file, for the ready-to-paste commands in a plan's `nextCommands`. */
const runnerFor = (extra) => {
  const here = new URL(import.meta.url);
  const file = IS_WINDOWS
    ? decodeURIComponent(here.pathname).replace(/^\//, "").replace(/\//g, "\\")
    : here.pathname;
  return `node "${file}" ${extra}`;
};

// ---------------------------------------------------------------------------------------
// Undo (I6)
// ---------------------------------------------------------------------------------------

const undoJournal = (journalFile) => {
  if (!existsSync(journalFile)) {
    const error = new Error(`journal not found: ${journalFile}`);
    error.code = EXIT.NOT_FOUND;
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(journalFile, "utf8"));
  } catch (error) {
    const wrapped = new Error(`journal is not valid JSON: ${error.message}`);
    wrapped.code = EXIT.USAGE;
    throw wrapped;
  }
  if (parsed?.kind !== "journal" || !parsed.data || !Array.isArray(parsed.data.entries)) {
    const error = new Error(`not an organizer journal: ${journalFile}`);
    error.code = EXIT.USAGE;
    throw error;
  }
  const journal = parsed.data;
  const rootReal = journal.root;
  // One protection context for the whole run, on live state: the same predicate `apply` uses.
  const protectionNow = protectionContextFor(rootReal, readGitState(rootReal));
  // V3-5: the journal's own `sinkDir` is a claim like every other field. It is trusted for two
  // things - validating a restore source, and pruning empty directories afterwards - so it is
  // validated ONCE here. `apply` records `<state>/roots/<hash>/sink/<runStamp>`, so the claim
  // must be STRICTLY inside the sink this engine derives for the journal's root: a forged sink
  // that named the whole sink tree, another root's sink, or any unrelated directory gets neither
  // of those privileges.
  const expectedSinkDir = path.resolve(statePaths(rootReal).sink);
  const journalSinkDir = typeof journal.sinkDir === "string" && journal.sinkDir !== "" ? path.resolve(journal.sinkDir) : null;
  // `isInsidePath` is already case-insensitive on Windows and returns true for an exact match, so
  // the strict-containment test is the equality guard plus that call. (An earlier version also
  // required `!pathDiffersBeyondCase(...)`, which asks "do these differ by MORE than case" and is
  // therefore true for any two genuinely different paths - it rejected every honest journal.)
  const sinkDirValidated = journalSinkDir !== null && journalSinkDir !== expectedSinkDir && isInsidePath(expectedSinkDir, journalSinkDir);
  const results = [];

  for (const entry of journal.entries) {
    if (entry.undoStatus === "restored") {
      results.push({ id: entry.id, rel: entry.rel, status: "already-undone", reason: "restored by an earlier undo" });
      continue;
    }
    if (entry.status !== "applied") {
      results.push({ id: entry.id, rel: entry.rel, status: "skipped", reason: `entry status is ${entry.status}` });
      continue;
    }
    if (entry.restorable !== true || (entry.inverse?.op !== "move" && entry.inverse?.op !== "mkdir")) {
      results.push({
        id: entry.id,
        rel: entry.rel,
        status: "not-restorable",
        reason: `purged permanently (${entry.action}); there is no copy to restore`,
      });
      continue;
    }

    // A settled empty directory is restored by recreating it: the inverse of the settle is a
    // mkdir, and `undo` performs it rather than reporting the directory as unrestorable.
    if (entry.inverse.op === "mkdir") {
      const dirPath = entry.inverse.path;
      // The inverse's own path must AGREE with the entry's `rel` before the operand gate runs:
      // the gate compares the claimed rel against the canonical form of the path given to it, so
      // a journal whose rel and inverse disagree is caught by this rather than reported as a
      // canonical-form problem. Same order as the move arm below.
      const mismatch = restoreMismatch(rootReal, entry.rel, dirPath);
      if (mismatch !== null) {
        results.push({ id: entry.id, rel: entry.rel, status: "skipped", reason: mismatch, level: "drift" });
        continue;
      }
      const mkdirOperand = validateOperand(rootReal, dirPath, protectionNow, {
        role: "destination",
        claimedRel: entry.rel,
        allowMissing: true,
      });
      if (mkdirOperand.reason !== null) {
        results.push({
          id: entry.id,
          rel: entry.rel,
          status: "refused",
          reason: mkdirOperand.reason,
          protectedBy: mkdirOperand.relDecided,
        });
        continue;
      }
      const occupied = safeLstat(dirPath);
      if (occupied !== null && !occupied.isDirectory()) {
        results.push({
          id: entry.id,
          rel: entry.rel,
          status: "skipped",
          reason: "restore target is occupied by a non-directory; refusing to touch it (exit 5)",
          level: "drift",
        });
        continue;
      }
      try {
        ensureDir(dirPath);
        entry.undoStatus = "restored";
        entry.restoredAt = nowIso();
        results.push({ id: entry.id, rel: entry.rel, status: "restored", reason: `directory recreated at ${dirPath}` });
      } catch (error) {
        results.push({
          id: entry.id,
          rel: entry.rel,
          status: "error",
          reason: `recreate failed: ${error.code ?? ""} ${error.message}`.trim(),
        });
      }
      continue;
    }
    const from = entry.inverse.from;
    const to = entry.inverse.to;
    if (!existsSync(from)) {
      results.push({
        id: entry.id,
        rel: entry.rel,
        status: "not-restorable",
        reason: `the quarantined copy is gone from the sink (${from})`,
      });
      continue;
    }
    // --- the SOURCE, through the same gate as every other operand (V4-1, V4-2, V5-3) -------
    // Round 4's `restoreSourceReason` returned early for a route entry, so a forged journal with
    // `action: "route-to-test-tree"` had its source checked by nothing at all: an out-of-root file
    // was imported and a protected `.env` was displaced, both at exit 0. That exemption is gone.
    // Where the source is allowed to be depends on the action - a `move` quarantines into the
    // sink, a route never does - and V5-3 expresses that as a different CONTAINER rather than as
    // skipped rules, so the type, missing and canonical rules run for both arms. The hand-rolled
    // `isLinkOperand` that used to stand here is gone with it: a location rule without the type
    // rule beside it is exactly the shape of V4-2, and this is what stops it being copied.
    if (entry.action === "route-to-test-tree") {
      const routeSource = validateOperand(rootReal, from, protectionNow, { role: "source" });
      if (routeSource.reason !== null) {
        results.push({ id: entry.id, rel: entry.rel, status: "refused", reason: `routed file's ${routeSource.reason}` });
        continue;
      }
    } else {
      const sinkSource = validateOperand(rootReal, from, protectionNow, {
        role: "source",
        containerRoot: sinkDirValidated ? journalSinkDir : null,
        containerLabel: "this journal's sink",
        skipProtection: true,
        allowMissing: true,
      });
      if (sinkSource.reason !== null) {
        results.push({ id: entry.id, rel: entry.rel, status: "refused", reason: sinkSource.reason });
        continue;
      }
    }
    // V3-2/V3-1: the inverse's destination must AGREE with the entry's `rel`, then goes through
    // the operand gate like every other destination.
    const restoreMismatchReason = restoreMismatch(rootReal, entry.rel, to);
    if (restoreMismatchReason !== null) {
      results.push({ id: entry.id, rel: entry.rel, status: "refused", reason: restoreMismatchReason });
      continue;
    }
    const destinationOperand = validateOperand(rootReal, to, protectionNow, {
      role: "destination",
      claimedRel: entry.rel,
      allowMissing: true,
    });
    if (destinationOperand.reason !== null) {
      results.push({
        id: entry.id,
        rel: entry.rel,
        status: "refused",
        reason: destinationOperand.reason,
        protectedBy: destinationOperand.relDecided,
      });
      continue;
    }
    const lstatNow = safeLstat(to);
    if (lstatNow !== null) {
      results.push({
        id: entry.id,
        rel: entry.rel,
        status: "skipped",
        reason: "restore target is occupied; refusing to overwrite (exit 5)",
        level: "drift",
      });
      continue;
    }
    // The destination's PARENT is the one link check that is not a gate call, and it is named
    // here rather than implied: the gate judges the destination itself (whose leaf link is refused
    // by its own type rule), and this asks the narrower question "would the restore be written
    // through a link". It cannot go through the gate unchanged because a restore directly into the
    // root has the root as its parent, which the gate rightly refuses as a containment root. It
    // reuses the same predicate, so the file has exactly one definition of "this is a link".
    const parent = path.dirname(to);
    if (parent !== rootReal && isLinkOperand(parent)) {
      results.push({ id: entry.id, rel: entry.rel, status: "skipped", reason: "restore parent is a link (never followed)" });
      continue;
    }
    const sinkFingerprint = fingerprintFor(from, lstatSync(from).isDirectory() ? "dir" : "file", limitsFromEnv());
    if (entry.verifiedFingerprint && !fingerprintsEqual(entry.verifiedFingerprint, sinkFingerprint)) {
      results.push({
        id: entry.id,
        rel: entry.rel,
        status: "skipped",
        reason: `the quarantined copy changed since it was journalled (${fingerprintSummary(sinkFingerprint)}) (exit 5)`,
        level: "drift",
      });
      continue;
    }
    try {
      movePath(from, to);
      if (entry.inverse.modeChanged) {
        try {
          chmodSync(to, entry.inverse.modeChanged.from);
        } catch {
          /* a mode we cannot restore is reported by the entry, not fatal to the restore */
        }
      }
      entry.undoStatus = "restored";
      entry.restoredAt = nowIso();
      results.push({ id: entry.id, rel: entry.rel, status: "restored", reason: `moved back to ${to}` });
    } catch (error) {
      results.push({ id: entry.id, rel: entry.rel, status: "error", reason: `restore failed: ${error.code ?? ""} ${error.message}`.trim() });
    }
  }

  // Housekeeping: prune empty quarantine directories, but ONLY inside this journal's own sink.
  // A forged `sinkDir` must not turn housekeeping into a deletion primitive (V3-5), so only a
  // sink that matched the derived one above is pruned.
  //
  // V5-2: the walk root goes through the operand gate like every other operand. It used to be
  // validated for LOCATION only (a lexical `isInsidePath`), and a junction planted at that exact
  // position was therefore walked THROUGH - `rmdirSync` on a directory reached through a junction
  // removes the real directory behind it, so an `undo` deleted empty directories outside every
  // containment root, unrecoverably. Child links were always skipped correctly; the asymmetry was
  // only at the root, which is exactly the kind of gap a hand-rolled location rule leaves. The
  // gate's type rule closes it, and the prune is skipped rather than refused - housekeeping that
  // cannot run is not an error the operator needs to act on.
  // V6-1: `followLinks` resolves the WHOLE path and re-checks containment on the real location.
  // The type rule alone checks the leaf, so a junction one component ABOVE the journal's `sinkDir`
  // was still invisible: `<sinkRoot>\linkanc` -> an outside tree, with the journal naming
  // `<sinkRoot>\linkanc\j1`, passes a leaf test and a lexical containment test, and the walk then
  // deletes empty directories behind the junction. Resolving the path is what closes it, and it
  // cannot weaken anything: for an honest sink the path resolves to itself, and if the host's state
  // directory is itself reached through a link the prune is simply skipped - housekeeping that
  // cannot run is not an error the operator needs to act on.
  if (sinkDirValidated) {
    const pruneOperand = validateOperand(rootReal, journalSinkDir, protectionNow, {
      role: "destination",
      containerRoot: expectedSinkDir,
      containerLabel: "the quarantine sink",
      skipProtection: true,
      followLinks: true,
    });
    if (pruneOperand.reason === null) pruneEmptyDirs(journalSinkDir);
  }

  writeFileSync(journalFile, `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, kind: "journal", data: journal }, null, 2)}\n`, "utf8");

  const counts = {
    entries: journal.entries.length,
    restored: results.filter((result) => result.status === "restored").length,
    alreadyUndone: results.filter((result) => result.status === "already-undone").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    refused: results.filter((result) => result.status === "refused").length,
    notRestorable: results.filter((result) => result.status === "not-restorable").length,
    errors: results.filter((result) => result.status === "error").length,
  };

  // V3-3: a refused restore is a finding, not a success. `apply` maps a refusal to exit 6, and
  // the documented contract says 6 means findings/failures/unaccounted; `undo` used to report
  // `status: "refused"` per entry and still exit 0, so a script could not tell a blocked restore
  // from a successful one.
  let exitCode = EXIT.OK;
  if (results.some((result) => result.level === "drift")) exitCode = EXIT.DRIFT;
  else if (counts.refused > 0 || counts.notRestorable > 0 || counts.errors > 0) exitCode = EXIT.FINDINGS;

  return {
    data: {
      journalFile: path.resolve(journalFile),
      planId: journal.planId ?? null,
      root: rootReal,
      results,
      counts,
      notes: [
        counts.notRestorable > 0
          ? `${counts.notRestorable} item(s) cannot be restored: a purge is irreversible by design (S3, named with --confirm)`
          : null,
        counts.refused > 0 ? `${counts.refused} item(s) refused: the restore target is protected or the journal disagrees with itself (exit 6)` : null,
        counts.skipped > 0 ? `${counts.skipped} item(s) skipped; see the per-item reason` : null,
      ].filter((note) => note !== null),
    },
    exitCode,
  };
};

/**
 * Remove the empty directories a restore left behind inside the quarantine sink (V3-5).
 *
 * `rmSync(child, { recursive: false, force: false })` throws `ERR_FS_EISDIR` for a directory on
 * every platform, and the empty `catch` swallowed it, so this function had never deleted anything
 * - while the comment claimed it pruned. `rmdirSync` is the call that removes one empty
 * directory, and it fails loudly on a non-empty one, which is the behaviour wanted here.
 * Only the directory's own emptiness is trusted: `ENOENT` (another process removed it) and
 * `ENOTEMPTY`/`EEXIST` (something appeared after the listing) are both benign, anything else is
 * left alone rather than escalated.
 *
 * The walk prunes the empty CHILDREN of `dir` and then `dir` itself, so the run directory a
 * restore emptied is removed rather than being left as a husk under the sink.
 *
 * The caller validates `dir` against the sink this engine derives for the journal's root, so a
 * forged `journal.sinkDir` cannot point this at an arbitrary tree.
 */
const pruneEmptyDirs = (dir) => {
  if (typeof dir !== "string" || !existsSync(dir)) return;
  const walk = (current) => {
    const listing = safeReaddir(current);
    if (!Array.isArray(listing)) return;
    for (const dirent of listing) {
      if (!dirent.isDirectory()) continue;
      walk(path.join(current, dirent.name));
    }
    const after = safeReaddir(current);
    if (!Array.isArray(after) || after.length > 0) return;
    try {
      rmdirSync(current);
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "ENOTEMPTY" || error.code === "EEXIST" || error.code === "EPERM" || error.code === "EBUSY") return;
      throw error;
    }
  };
  walk(dir);
};

// ---------------------------------------------------------------------------------------
// Disposition
// ---------------------------------------------------------------------------------------

const dispositionReport = (rootInput, level, setValues) => {
  const analysis = analyze(rootInput, level, "repo");
  const internals = analysis[ANALYZE_INTERNALS];
  const applied = appliedActionsById(analysis.rootReal);
  const decisions = internals.decisions.decisions ?? {};

  const parsed = [];
  const unknownSetIds = [];
  for (const raw of setValues) {
    const match = /^([^=]+)=([a-z]+)(?::([\s\S]*))?$/.exec(raw);
    if (!match) {
      const error = new Error(`--set must look like <id>=<disposition>:<reason>; got "${raw}"`);
      error.code = EXIT.USAGE;
      throw error;
    }
    const [, id, disposition, rawReason] = match;
    if (!DISPOSITIONS.includes(disposition) || disposition === "pending") {
      const error = new Error(
        `--set disposition must be one of kept|removed|landed|deferred|accepted; got "${disposition}"`,
      );
      error.code = EXIT.USAGE;
      throw error;
    }
    const item = analysis.items.find((candidate) => candidate.id === id);
    if (!item) {
      unknownSetIds.push(id);
      continue;
    }
    const reason = (rawReason ?? "").replace(/^"|"$/g, "");
    parsed.push({ id, rel: item.rel, disposition, reason });
  }

  if (unknownSetIds.length > 0) {
    const error = new Error(
      `--set names unknown item id(s): ${unknownSetIds.join(", ")} (ids come from inventory/plan/disposition output)`,
    );
    error.code = EXIT.USAGE;
    error.unknownSetIds = unknownSetIds;
    throw error;
  }

  for (const decision of parsed) {
    const prior = decisions[decision.rel] ?? {};
    decisions[decision.rel] = {
      disposition: decision.disposition,
      reason: decision.reason,
      at: nowIso(),
      id: decision.id,
      prior: prior.disposition ?? null,
      root: analysis.rootReal,
    };
  }
  let decisionsFile = internals.decisions.path;
  if (parsed.length > 0) {
    decisionsFile = writeDecisions(analysis.rootReal, decisions, analysis.rootReal);
  }

  const rows = [];
  for (const item of analysis.items) {
    const id = item.id;
    const decision = decisions[item.rel];
    const appliedEntry = applied.get(id);
    // A policy default (kept tool config, a backup within its retention window) is a decision.
    // Everything else that the requested level does not reach is an explicit deferral, and
    // only what the level DOES reach and nobody has handled stays pending.
    const hasPolicyDefault = item.dispositionSource === "policy";
    // A level defers an item when the requested level does not REACH it. It is not a deferral
    // when the item has no action at all: a report-only item that the level does reach is the
    // owner's decision to make, and stays pending until they make it.
    const levelReaches = (levelRank(level) ?? 0) >= (levelRank(item.minLevel) ?? 0);
    let disposition;
    let decidedBy;
    let reason;

    if (decision) {
      disposition = decision.disposition;
      decidedBy = "owner";
      reason = decision.reason ?? "";
    } else if (appliedEntry) {
      disposition = "removed";
      decidedBy = "journal";
      reason = `action ${appliedEntry.action} applied ${appliedEntry.at}`;
    } else if (hasPolicyDefault) {
      disposition = item.disposition;
      decidedBy = "policy";
      reason = item.dispositionReason;
    } else if (!levelReaches) {
      disposition = "deferred";
      decidedBy = "level";
      reason =
        item.action === ACTIONS.REPORT || item.action === ACTIONS.NONE
          ? `report-only from \`${item.minLevel}\` upward: ${item.reason}`
          : `beyond \`${level}\`: planned from \`${item.minLevel}\` upward`;
    } else {
      disposition = "pending";
      decidedBy = "none";
      reason = item.dispositionReason ?? item.reason;
    }

    // An item that was removed and is present again is a finding, not an accounting artefact.
    if (appliedEntry && decidedBy === "journal") {
      reason = `${reason}; present on disk again (regenerated since removal)`;
    }

    rows.push({
      id,
      rel: item.rel,
      path: item.path,
      kind: item.kind,
      safety: item.safety,
      action: item.action,
      minLevel: item.minLevel,
      disposition,
      decidedBy,
      reason,
      appliedAt: appliedEntry?.at ?? null,
      journal: appliedEntry?.journal ?? null,
    });
  }

  rows.sort(compareRel);

  const counts = {
    items: rows.length,
    kept: rows.filter((row) => row.disposition === "kept").length,
    removed: rows.filter((row) => row.disposition === "removed").length,
    landed: rows.filter((row) => row.disposition === "landed").length,
    deferred: rows.filter((row) => row.disposition === "deferred").length,
    accepted: rows.filter((row) => row.disposition === "accepted").length,
    pending: rows.filter((row) => row.disposition === "pending").length,
    protected: analysis.protected.length,
    refused: analysis.refused.length,
  };

  const unaccounted = rows.filter((row) => row.disposition === "pending");
  const settled = [...applied.entries()]
    .filter(([id]) => !rows.some((row) => row.id === id))
    .map(([id, entry]) => ({ id, rel: entry.rel, action: entry.action, at: entry.at, journal: entry.journal }))
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  return {
    data: {
      root: analysis.rootReal,
      rootGiven: analysis.rootGiven,
      level,
      decisionsFile,
      setApplied: parsed,
      rows,
      unaccounted: unaccounted.map((row) => ({ id: row.id, rel: row.rel, kind: row.kind, reason: row.reason })),
      settled,
      counts,
      protected: analysis.protected,
      refused: analysis.refused,
      notes: [
        unaccounted.length > 0
          ? `${unaccounted.length} in-scope item(s) are unaccounted for: decide with --set <id>=<kept|removed|landed|deferred|accepted>:"<reason>" or plan/apply them`
          : "every in-scope item carries a disposition",
        counts.deferred > 0
          ? `${counts.deferred} item(s) are deferred by the requested level \`${level}\`; a higher level makes them actionable`
          : null,
      ].filter((note) => note !== null),
    },
    exitCode: unaccounted.length > 0 ? EXIT.FINDINGS : EXIT.OK,
  };
};

// ---------------------------------------------------------------------------------------
// Human-readable rendering (the --json envelope stays machine-only)
// ---------------------------------------------------------------------------------------

const printHuman = (kind, data, error) => {
  // The human view stays readable on a large tree; `--json` always carries every item.
  const LIST_CAP = 200;
  const listing = (rows, render) => {
    const shown = rows.slice(0, LIST_CAP);
    const lines = shown.map(render);
    if (rows.length > shown.length) {
      lines.push(`    â€¦ and ${rows.length - shown.length} more (use --json for the complete list)`);
    }
    return lines;
  };
  const out = [];
  if (error) out.push(`ERROR (${error.code}): ${error.message}`);
  if (kind === "inventory") {
    out.push(`organizer inventory  root=${data.root}`);
    out.push(
      `  git=${data.git.available ? `${data.git.branch ?? "?"}@${data.git.head ?? "?"} (${data.git.trackedCount} tracked, ${data.git.ignoredCount} ignored)` : `unavailable (${data.git.reason})`}  trash=${data.tools.trashTool ?? "none"}`,
    );
    out.push(
      `  discovered=${data.counts.discovered} artifacts=${data.counts.artifacts} litter=${data.counts.litter} backups=${data.counts.backups} untracked-work=${data.counts.untrackedWork}`,
    );
    out.push(`  protected=${data.counts.protected} refused=${data.counts.refused} truncated=${data.truncated}`);
    out.push(`  bytes: litter=${bytesHuman(data.bytes.litterBytes)} backups=${bytesHuman(data.bytes.backupBytes)}`);
    out.push(`  by kind: ${Object.entries(data.counts.byKind).map(([key, value]) => `${key}=${value}`).join(" ") || "(none)"}`);
    out.push(`  by class: ${Object.entries(data.counts.bySafety).map(([key, value]) => `${key}=${value}`).join(" ") || "(none)"}`);
    out.push(`  by min level: ${Object.entries(data.counts.byMinLevel).map(([key, value]) => `${key}=${value}`).join(" ") || "(none)"}`);
    out.push("");
    out.push("  artifacts:");
    out.push(
      ...listing(data.items, (item) =>
        `    ${item.safety} ${item.kind.padEnd(14)} ${item.minLevel.padEnd(10)} ${String(item.size).padStart(10)}  ${item.rel}`,
      ),
    );
    out.push("");
    out.push("  protected (never planned):");
    out.push(
      ...listing(data.protected, (item) =>
        `    ${item.type === "dir" ? "dir " : "file"} ${item.rel || "."}  <- ${item.reason}`,
      ),
    );
    if (data.refused.length > 0) {
      out.push("");
      out.push("  refused (link / device / outside root):");
      out.push(...listing(data.refused, (item) => `    ${item.rel}  <- ${item.reason}`));
    }
  } else if (kind === "plan") {
    out.push(`organizer plan ${data.planId}  level=${data.level} scope=${data.scope}  root=${data.root}`);
    out.push(
      `  items=${data.counts.items} planned=${data.counts.planned} deferred=${data.counts.deferredByLevel}  S1=${data.counts.plannedByClass.S1} S2=${data.counts.plannedByClass.S2} S3=${data.counts.plannedByClass.S3}`,
    );
    out.push(`  plan file: ${data.planFile}`);
    out.push("");
    out.push(
      ...listing(data.items, (item) => {
        const name = item.rel.length > 70 ? `â€¦${item.rel.slice(-69)}` : item.rel;
        const lines = [
          `  ${item.planned ? "PLAN" : "defer"} ${item.safety} ${item.action.padEnd(6)} ${item.kind.padEnd(14)} ${String(item.size).padStart(10)}  ${name}`,
          `        ${item.reason}`,
        ];
        if (item.raisedBy.length > 0) lines.push(`        raised by: ${item.raisedBy.join(", ")}`);
        if (item.shell) lines.push(`        equivalent: ${item.shell}`);
        return lines.join("\n");
      }),
    );
    out.push("");
    out.push("  next:");
    out.push(`    ${data.nextCommands.apply ?? "(nothing to apply)"}`);
    if (data.unsure.length > 0) {
      out.push("");
      out.push(`  unsure, deferred (${data.unsure.length} — looked at, not classified, left on disk):`);
      out.push(...listing(data.unsure, (row) => `    ${row.kind} ${row.rel}\n        ${row.reason}`));
    }
    for (const note of data.notes) out.push(`    note: ${note}`);
  } else if (kind === "apply") {
    out.push(`organizer apply  plan=${data.planId}  root=${data.root}`);
    out.push(
      `  applied=${data.counts.applied} drift=${data.counts.drift} refused=${data.counts.refused} skipped=${data.counts.skipped} deferred=${data.counts.deferredByLevel} errors=${data.counts.errors}`,
    );
    if (data.journalFile) out.push(`  journal: ${data.journalFile}`);
    if (data.sinkDir) out.push(`  sink: ${data.sinkDir}`);
    out.push("");
    for (const result of data.results) {
      out.push(`  ${result.status.padEnd(20)} ${result.safety} ${result.rel}`);
      out.push(`        ${result.reason}`);
    }
    out.push("");
    out.push("  next:");
    out.push(`    ${data.nextCommands.undo ?? "(no journal to undo)"}`);
  } else if (kind === "undo") {
    out.push(`organizer undo  journal=${data.journalFile}`);
    out.push(
      `  restored=${data.counts.restored} notRestorable=${data.counts.notRestorable} skipped=${data.counts.skipped} errors=${data.counts.errors}`,
    );
    for (const result of data.results) out.push(`  ${result.status.padEnd(16)} ${result.rel}  <- ${result.reason}`);
  } else if (kind === "disposition") {
    out.push(`organizer disposition  root=${data.root} level=${data.level}`);
    out.push(
      `  items=${data.counts.items} kept=${data.counts.kept} removed=${data.counts.removed} landed=${data.counts.landed} deferred=${data.counts.deferred} accepted=${data.counts.accepted} pending=${data.counts.pending}`,
    );
    out.push(`  decisions file: ${data.decisionsFile}`);
    out.push("");
    out.push(
      ...listing(data.rows, (row) => {
        const lines = [`  ${row.disposition.padEnd(9)} ${row.decidedBy.padEnd(7)} ${row.id}  ${row.rel}`];
        if (row.reason) lines.push(`        ${row.reason}`);
        return lines.join("\n");
      }),
    );
    for (const note of data.notes) out.push(`  note: ${note}`);
  } else if (kind === "doctor") {
    out.push(`organizer doctor  platform=${data.platform}  node=${data.node}`);
    out.push(`  state dir: ${data.stateDir} (${data.stateDirExists ? "present" : "not created yet"})`);
    out.push(`  git: ${data.tools.git.found ? data.tools.git.version : "MISSING"}`);
    out.push(`  trash: ${data.tools.trashTool ?? "none found"}`);
    for (const probe of data.tools.trashProbes) {
      out.push(`    ${probe.name}: ${probe.found ? probe.version : `missing (${probe.reason})`}`);
    }
    for (const finding of data.findings) out.push(`  [${finding.severity}] ${finding.message}`);
  } else {
    out.push(JSON.stringify(data, null, 2));
  }
  process.stdout.write(`${out.join("\n")}\n`);
};

// ---------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------

const USAGE = `organizer - deterministic cleanup engine for agent-created repository litter

  node organizer.mjs inventory   --root <dir> [--json]
  node organizer.mjs plan        --root <dir> --level <${LEVELS.join("|")}> [--scope <${SCOPES.join("|")}>] [--out <plan.json>] [--json]
  node organizer.mjs apply       --plan <plan.json> [--approve-s2] [--confirm <id,id>] [--only <id,id>] [--json]
  node organizer.mjs undo        --journal <journal.json> [--json]
  node organizer.mjs disposition --root <dir> --level <level> [--set <id>=<kept|removed|landed|deferred|accepted>:<reason>]... [--json]
  node organizer.mjs doctor      [--json]

Exit codes: 0 ok, 2 usage, 3 not found, 5 drift, 6 findings/failures/unaccounted.
Env: DSH_ORGANIZER_STATE (state/sink/journal dir), DSH_ORGANIZER_SESSION_RECORD (session record file),
     DSH_ORGANIZER_MAX_HASH_BYTES, DSH_ORGANIZER_MAX_SINK_BYTES, DSH_ORGANIZER_MAX_WALK,
     DSH_ORGANIZER_AGGREGATE_MIN.
`;

const VALUE_FLAGS = new Set(["--root", "--level", "--scope", "--out", "--plan", "--journal", "--only", "--confirm", "--set"]);
const BOOLEAN_FLAGS = new Set(["--json", "--approve-s2", "--purge", "--help", "-h"]);

const parseArgv = (argv) => {
  const command = argv[0] && !argv[0].startsWith("-") ? argv[0] : null;
  const flags = {
    json: false,
    help: false,
    approveS2: false,
    purge: false,
    root: null,
    level: null,
    scope: null,
    out: null,
    plan: null,
    journal: null,
    only: [],
    confirm: [],
    set: [],
  };
  for (let index = command === null ? 0 : 1; index < argv.length; index += 1) {
    const token = argv[index];
    let name = token;
    let inlineValue = null;
    const equals = token.indexOf("=");
    if (token.startsWith("--") && equals > 0) {
      name = token.slice(0, equals);
      inlineValue = token.slice(equals + 1);
    }
    if (BOOLEAN_FLAGS.has(name)) {
      if (name === "--json") flags.json = true;
      if (name === "--help" || name === "-h") flags.help = true;
      if (name === "--approve-s2") flags.approveS2 = true;
      if (name === "--purge") flags.purge = true;
      continue;
    }
    if (!VALUE_FLAGS.has(name)) {
      const error = new Error(`unknown option: ${token}`);
      error.code = EXIT.USAGE;
      throw error;
    }
    const value = inlineValue !== null ? inlineValue : argv[++index];
    if (value === undefined) {
      const error = new Error(`option ${name} needs a value`);
      error.code = EXIT.USAGE;
      throw error;
    }
    if (name === "--only") flags.only.push(...value.split(",").map((part) => part.trim()).filter(Boolean));
    else if (name === "--confirm") flags.confirm.push(...value.split(",").map((part) => part.trim()).filter(Boolean));
    else if (name === "--set") flags.set.push(value);
    else flags[name.slice(2)] = value;
  }
  return { command, flags };
};

const requireFlag = (flags, name) => {
  if (flags[name] === null || flags[name] === undefined || flags[name] === "") {
    const error = new Error(`--${name} is required for this command`);
    error.code = EXIT.USAGE;
    throw error;
  }
  return flags[name];
};

const requireLevel = (flags) => {
  const level = requireFlag(flags, "level");
  if (!LEVELS.includes(level)) {
    const error = new Error(`--level must be one of ${LEVELS.join("|")}; got "${level}"`);
    error.code = EXIT.USAGE;
    throw error;
  }
  return level;
};

const emit = (kind, data, json, exitCode, error) => {
  if (json) {
    const envelope = { schemaVersion: SCHEMA_VERSION, kind, data };
    if (error) envelope.error = { code: error.code ?? null, message: error.message };
    process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
  } else {
    printHuman(kind, data, error);
  }
  process.exitCode = exitCode;
};

const main = () => {
  let parsed;
  try {
    parsed = parseArgv(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${USAGE}`);
    process.exitCode = error.code ?? EXIT.USAGE;
    return;
  }
  const { command, flags } = parsed;

  if (flags.help || command === null) {
    if (flags.json) {
      emit("help", { usage: USAGE }, true, command === null && !flags.help ? EXIT.USAGE : EXIT.OK, null);
    } else {
      process.stdout.write(USAGE);
      process.exitCode = flags.help ? EXIT.OK : EXIT.USAGE;
    }
    return;
  }

  try {
    if (command === "inventory") {
      const root = requireFlag(flags, "root");
      const analysis = analyze(root, null, "repo");
      analysis.notes = [
        "inventory is read-only: it classifies and reports, and never touches an item",
        "each item carries `minLevel`: the lowest plan level that will act on it",
      ];
      emit("inventory", analysis, flags.json, EXIT.OK, null);
      return;
    }

    if (command === "plan") {
      const root = requireFlag(flags, "root");
      const level = requireLevel(flags);
      const scope = flags.scope ?? "repo";
      if (!SCOPES.includes(scope)) {
        const error = new Error(`--scope must be one of ${SCOPES.join("|")}; got "${scope}"`);
        error.code = EXIT.USAGE;
        throw error;
      }
      const analysis = analyze(root, level, scope, { purgeBackups: flags.purge === true });
      const data = buildPlanData(analysis, { out: flags.out });
      ensureDir(path.dirname(data.planFile));
      const payload = { schemaVersion: SCHEMA_VERSION, kind: "plan", data };
      writeFileSync(data.planFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
      let exitCode = EXIT.OK;
      if (analysis.truncated || analysis.scanErrors.length > 0) exitCode = EXIT.FINDINGS;
      emit("plan", data, flags.json, exitCode, null);
      return;
    }

    if (command === "apply") {
      const planFile = requireFlag(flags, "plan");
      const result = applyPlan(planFile, flags);
      emit("apply", result.data, flags.json, result.exitCode, null);
      return;
    }

    if (command === "undo") {
      const journalFile = requireFlag(flags, "journal");
      const result = undoJournal(journalFile);
      emit("undo", result.data, flags.json, result.exitCode, null);
      return;
    }

    if (command === "disposition") {
      const root = requireFlag(flags, "root");
      const level = requireLevel(flags);
      const result = dispositionReport(root, level, flags.set);
      emit("disposition", result.data, flags.json, result.exitCode, null);
      return;
    }

    if (command === "doctor") {
      const data = doctorReport();
      const exitCode = data.tools.git.found ? EXIT.OK : EXIT.FINDINGS;
      emit("doctor", data, flags.json, exitCode, null);
      return;
    }

    const error = new Error(`unknown command: ${command}`);
    error.code = EXIT.USAGE;
    throw error;
  } catch (error) {
    const code = typeof error.code === "number" ? error.code : EXIT.FINDINGS;
    const kind = ["inventory", "plan", "apply", "undo", "disposition", "doctor"].includes(command) ? command : "error";
    if (flags.json) {
      emit(kind, error.unknownSetIds ? { unknownSetIds: error.unknownSetIds } : {}, true, code, error);
    } else {
      process.stderr.write(`${error.message}\n`);
      if (code === EXIT.USAGE) process.stderr.write(`\n${USAGE}`);
      process.exitCode = code;
    }
    return;
  }
};

main();

export { analyze, buildPlanData, classifyEntry, protectionReason, computeSafety, isInsidePath };
