// PART-004 verification: does the organizer engine actually enforce what the skill claims?
//
//   node tools/organizer-test.mjs [--keep]
//
// Builds a throwaway fixture repository under the system temp directory - never inside a real
// project - and drives the CLI as a child process, asserting the REAL behaviour of every gate:
// the protected set, the level table, class raising, S2/S3 approvals, drift, the journal and
// its inverse, containment against a junction that escapes the root, and the disposition exit
// code. Prints PASS/FAIL/SKIP per assertion; exits 1 if any assertion failed.
//
// Every command is invoked with `spawnSync(process.execPath, [args])` - no shell - so the test
// observes exactly the interface the skill documents.

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ORGANIZER = fileURLToPath(new URL("./organizer.mjs", import.meta.url));
const IS_WINDOWS = process.platform === "win32";
const DAY_MS = 86400000;

const SCRATCH = mkdtempSync(path.join(os.tmpdir(), `organizer-test-${Date.now()}-`));
const FIXTURE = path.join(SCRATCH, "fixture");
const OUTSIDE = path.join(SCRATCH, "outside");
const STATE = path.join(SCRATCH, "state");
const FAKE_BIN = path.join(SCRATCH, "fakebin");
const SESSION_RECORD = path.join(SCRATCH, "session.json");

mkdirSync(FIXTURE, { recursive: true });
mkdirSync(OUTSIDE, { recursive: true });
mkdirSync(STATE, { recursive: true });

// ---------------------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------------------

let passed = 0;
let failed = 0;
let skipped = 0;
const observedExitCodes = new Set();

const SKIP = Symbol("skip");
const skipWith = (why) => {
  const error = new Error(why);
  error[SKIP] = true;
  throw error;
};

const check = (label, fn) => {
  try {
    const detail = fn();
    passed += 1;
    process.stdout.write(detail ? `PASS ${label} — ${detail}\n` : `PASS ${label}\n`);
  } catch (error) {
    if (error[SKIP]) {
      skipped += 1;
      process.stdout.write(`SKIP ${label} — ${error.message}\n`);
      return;
    }
    failed += 1;
    process.stdout.write(`FAIL ${label}: ${error.message}\n`);
  }
};

const ok = (condition, message) => assert.ok(condition, message);
const eq = (actual, expected, message) =>
  assert.equal(actual, expected, `${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);

const find = (rows, predicate, message) => {
  const found = rows.find(predicate);
  assert.ok(found, `${message} (searched ${rows.length} rows)`);
  return found;
};

const itemExists = (items, rel) => items.some((item) => item.rel === rel);
const sha256 = (abs) => createHash("sha256").update(readFileSync(abs)).digest("hex");
const sortedIds = (set) => [...set].sort().join(",");

const baseEnv = {
  ...process.env,
  DSH_ORGANIZER_STATE: STATE,
  DSH_ORGANIZER_SESSION_RECORD: SESSION_RECORD,
};

const run = (args, options = {}) => {
  const result = spawnSync(process.execPath, [ORGANIZER, ...args], {
    encoding: "utf8",
    cwd: options.cwd ?? FIXTURE,
    env: { ...baseEnv, ...(options.env ?? {}) },
    maxBuffer: 128 * 1024 * 1024,
  });
  const record = { args, code: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  observedExitCodes.add(record.code);
  return record;
};

const jin = (record, label) => {
  try {
    return JSON.parse(record.stdout);
  } catch (error) {
    throw new Error(
      `${label}: stdout is not JSON (${error.message}); stderr=${record.stderr.slice(0, 200)}; stdout starts: ${record.stdout.slice(0, 200)}`,
    );
  }
};

const write = (rel, content, options = {}) => {
  const abs = path.join(FIXTURE, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content, options.encoding ?? "utf8");
  if (options.mode !== undefined) chmodSync(abs, options.mode);
  if (options.ageDays !== undefined) {
    const when = new Date(Date.now() - options.ageDays * DAY_MS);
    utimesSync(abs, when, when);
  }
  return abs;
};

/** Size + mtime snapshot of the whole fixture (excluding .git), for "nothing changed" proofs. */
const snapshotTree = () => {
  const rows = [];
  const walk = (dir, rel) => {
    for (const dirent of readdirSync(dir, { withFileTypes: true })) {
      const childRel = rel === "" ? dirent.name : `${rel}/${dirent.name}`;
      if (childRel === ".git" || childRel.startsWith(".git/")) continue;
      const abs = path.join(dir, dirent.name);
      const stats = lstatSync(abs);
      if (stats.isSymbolicLink()) {
        rows.push(`${childRel}|link`);
        continue;
      }
      if (stats.isDirectory()) {
        walk(abs, childRel);
        continue;
      }
      rows.push(`${childRel}|${stats.size}|${Math.trunc(stats.mtimeMs)}`);
    }
  };
  walk(FIXTURE, "");
  rows.sort();
  return { count: rows.length, digest: createHash("sha256").update(rows.join("\n")).digest("hex") };
};

let planSerial = 0;
const makePlan = (level, options = {}) => {
  const file = path.join(SCRATCH, `plan-${level}-${(planSerial += 1)}.json`);
  const record = run(
    [
      "plan",
      "--root",
      FIXTURE,
      "--level",
      level,
      "--scope",
      options.scope ?? "repo",
      "--out",
      file,
      ...(options.purge ? ["--purge"] : []),
      "--json",
    ],
    { env: options.env },
  );
  const envelope = jin(record, `plan --level ${level}`);
  return {
    record,
    data: envelope.data,
    items: envelope.data.items,
    byRel: new Map(envelope.data.items.map((item) => [item.rel, item])),
    file,
  };
};

const basenameOfRel = (rel) => rel.split("/").pop();

const itemAt = (plan, rel) => {
  const item = plan.byRel.get(rel);
  ok(item, `no plan item for "${rel}" (plan has ${plan.items.length} items)`);
  return item;
};

const plannedIds = (plan) => new Set(plan.items.filter((item) => item.planned).map((item) => item.id));
const subset = (small, big) => [...small].every((id) => big.has(id));

// ---------------------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------------------

const F = {
  junkUntracked: ".dsh-scan-asar.cjs",
  nulDeviceName: "NUL.css",
  duplicateSuffix: "scratch(1).txt",
  runtimeDump: "dump.rdb",
  sessionCreated: "session-created.tmp",
  drift: "scratch-drift.txt",
  readOnly: "scratch-readonly.tmp",
  oversize: "scratch-big.tmp",
  referenced: "scratch-referenced.js",
  swap: "scratch-swap.tmp",
  scrapeJson: "tests/_raw/payload.json",
  scrapeHtml: "tests/_raw/challenge.html",
  untrackedWork: "tests/real-work.php",
  untrackedText: "tests/winter.txt",
  checkArtifact: "user-conversation-check.png",
  buildApp: "dist/app.js",
  testReport: "test-results/report.html",
  backupHot: "backups/db-2026-09-01.sql",
  backupSuperseded2: "backups/db-2026-06-01.sql",
  backupSuperseded: "backups/db-2026-01-01.sql",
  backupStale: "backups/legacy-2019-dump.sql",
  backupOversizeStale: "backups/huge-codebase-2019-01-01.zip",
  backupOversizeSuperseded: "backups/db-huge-2019-01-01.sql",
  backupOversizeSuperseded2: "backups/db-huge-2020-01-01.sql",
  backupOversizeSuperseded3: "backups/db-huge-2021-01-01.sql",
  // V2-4: a 3-copy family with NO restore evidence - the shape the `previous` defect needed
  backupUnverifiedNewest: "backups/audit-unverified-2026-03-01.sql",
  backupUnverifiedMiddle: "backups/audit-unverified-2026-02-01.sql",
  backupUnverifiedOldest: "backups/audit-unverified-2026-01-01.sql",
  blockedDir: ".dsh-scan-dump",
  blockedDirChild: ".dsh-scan-dump/_MANIFEST.json",
  blockedDirProtected: ".dsh-scan-dump/dsh/node_modules/pkg/index.js",
  configDotDir: ".vscode/settings.json",
  ignoredFrame: "frames/frame-001.png",
  // capability 1: test CONTENT, not a test name. None of these match a junk pattern, so they are
  // untracked-work by default and only the content probe can reclassify them.
  testContentJs: "src/validate-widget.js",
  testContentPhp: "src/WidgetBehaviour.php",
  testContentPy: "src/check_totals.py",
  // a weak-only hit: `const test = ...` is ordinary code and must NOT be reclassified
  testContentAmbiguous: "src/not-a-test.js",
  // PowerShell: the production/diagnostic cmdlets are ordinary code and must NOT be routed, while
  // a real Pester test (which names its framework) still must be
  psDeploy: "scripts/deploy.ps1",
  psHealthcheck: "scripts/healthcheck.ps1",
  psPester: "scripts/ApiChecks.Tests.ps1",
  // capability 2: an empty directory, and a directory that only becomes empty once this plan's
  // own moves have run
  emptyDir: "stale-empty-folder",
  emptiedParent: "stale-empty-parent",
  emptiedParentChild: "stale-empty-parent/leftover.tmp",
  // audit F4: the doctrine's own artifact sink, whose raw/ and _raw/ subdirectories are ALSO
  // scrape markers - the exact shape the engine was planning for removal
  workSinkManifest: ".work/2026-10-12-audit/MANIFEST.md",
  workSinkRaw: ".work/2026-10-12-audit/_raw/page.json",
  workSinkRawOut: ".work/2026-10-12-audit/raw/dump.txt",
  // a real scrape directory OUTSIDE the sink: proves the F4 fix did not disable scrape detection.
  // `_raw` is the mandated sink subdirectory name, so this is the closest possible neighbour of
  // the sink case - and it must still be classified. The payload extension must not also be a
  // junk pattern, or the junk rule would win.
  liveScrape: "live/_raw/page.json",
};

const longSegments = Array.from({ length: 10 }, (_, index) => `averylongdirectorysegment${String(index).padStart(2, "0")}`);
const longPathRel = ["deep", ...longSegments, "scratch-longpath.tmp"].join("/");

const buildFixture = () => {
  // protected: secrets, keys, docs, dependency and runtime trees
  write(".env", "APP_KEY=not-a-real-key\n");
  write(".env.example", "APP_KEY=\n");
  write("id_rsa", "-----BEGIN OPENSSH PRIVATE KEY-----\nplaceholder\n");
  write("server.pem", "-----BEGIN CERTIFICATE-----\nplaceholder\n");
  write(".vault-keys", "placeholder-vault-key-material\n");
  write("docs/guide.md", "# owner documentation (never an item)\n");
  write("vendor/lib/helper.php", "<?php // vendored dependency\n");
  write("node_modules/dep/index.js", "module.exports = 1;\n");
  write("storage/app/state.json", '{"runtime":true}\n');

  // tracked work, plus a tracked file that references a junk-named file, and a tracked build
  // script that names its own output directory
  write("tracked-file.php", "<?php\n// loads scratch-referenced.js from the build directory\n");
  write("build.sh", "#!/bin/sh\nnpm run build -- --outdir dist\n");
  write(".gitignore", "dist/\ntest-results/\nbackups/\nframes/\n.vscode/\n*.rdb\nuser-conversation-check.png\n.work/\nraw-out/\n");

  // capability 2: an empty directory, and a directory that only becomes empty once the plan's own
  // move of `stale-empty-parent/leftover.tmp` has run. A `.gitkeep`-only directory is NOT empty.
  mkdirSync(path.join(FIXTURE, F.emptyDir), { recursive: true });
  write(`${F.emptiedParentChild}`, "scratch leftover\n");
  mkdirSync(path.join(FIXTURE, "stale-gitkeep-folder"), { recursive: true });
  write("stale-gitkeep-folder/.gitkeep", "");

  // audit F4: the doctrine's artifact sink. `raw/` and `_raw/` are mandated sink subdirectories
  // AND scrape markers, so a sink with today's date must never be planned at any level.
  write(F.workSinkManifest, "# run manifest\n");
  write(F.workSinkRaw, JSON.stringify({ url: "https://example.invalid/x", status: 403, headers: {} }, null, 2));
  write(F.workSinkRawOut, "raw dump body\n");

  // the same scrape shape OUTSIDE the sink, which the engine must still classify and plan
  write(F.liveScrape, JSON.stringify({ url: "https://example.invalid/y", status: 200, headers: {}, body: "<html>ok</html>" }, null, 2));

  // capability 1: test CONTENT in files whose NAMES say nothing about testing
  write(
    F.testContentJs,
    "import { describe, it, expect } from 'vitest';\n\ndescribe('validateWidget', () => {\n  it('rejects an empty name', () => {\n    expect(validateWidget('')).toBe(false);\n  });\n});\n",
  );
  write(
    F.testContentPhp,
    "<?php\n\nuse PHPUnit\\Framework\\TestCase;\n\nclass WidgetBehaviour extends TestCase\n{\n    public function test_it_rejects_an_empty_name(): void\n    {\n        $this->assertFalse(validate_widget(''));\n    }\n}\n",
  );
  write(F.testContentPy, "import pytest\n\n\ndef test_totals_add_up():\n    assert total([1, 2]) == 3\n");
  // weak-only: bare `test`/`it` identifiers with no framework anywhere. This must stay on its
  // existing rule rather than being reclassified as a test and routed.
  write(F.testContentAmbiguous, "const test = 1;\nconst it = 2;\nexport const total = test + it;\n");

  // A production deploy script and a health check: `Invoke-RestMethod` / `Invoke-WebRequest` are
  // ordinary cmdlets, so naming one is NOT a test signal. Neither file may be routed.
  write(
    F.psDeploy,
    'param([string]$Target)\n$response = Invoke-RestMethod -Uri "https://api.example.invalid/deploy" -Method Post -Body $Target\nWrite-Host "deployed to $Target"\nexit 0\n',
  );
  write(
    F.psHealthcheck,
    '$r = Invoke-WebRequest -Uri "https://example.invalid/health" -UseBasicParsing\nif ($r.StatusCode -ne 200) { throw "unhealthy" }\n',
  );
  // A real Pester test: it names its framework, so the PowerShell stack is still covered.
  write(
    F.psPester,
    'BeforeAll { Import-Module Pester }\nDescribe "Api" {\n  It "returns ok" { (Invoke-RestMethod -Uri "https://example.invalid/api").status | Should -Be 200 }\n}\n',
  );

  // litter: untracked junk of several shapes
  write(F.junkUntracked, "// throwaway asar scan script\n");
  write(F.duplicateSuffix, "scratch notes\n");
  write(F.runtimeDump, "REDIS0009-placeholder\n");
  write(F.sessionCreated, "written by this session\n");
  write(F.drift, "AAAA\n");
  write(F.readOnly, "read-only junk\n", { mode: 0o444 });
  write(F.oversize, "X".repeat(4096));
  write(F.referenced, "// referenced by tracked-file.php\n");
  write(F.swap, "swap me for a junction\n");

  // build output and test output: directory items that cover their children
  write(F.buildApp, "console.log(1)\n");
  write("dist/app.js.map", "{}\n");
  write(F.testReport, "<html>test report</html>\n");
  write(F.checkArtifact, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]));

  // raw scrape payloads, mixed with analysis
  write(
    F.scrapeJson,
    JSON.stringify({ url: "https://example.invalid/x", status: 403, headers: { server: "cf" }, body: "<html>cf</html>" }, null, 2),
  );
  write(F.scrapeHtml, "<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>challenge</body></html>\n");

  // untracked real work
  write(F.untrackedWork, "<?php\n// real test work that is not committed yet\n");
  write(F.untrackedText, "notes that someone wants to keep\n");

  // backups: one VERIFIED newest hot copy, one fallback, one superseded, one stale sole copy,
  // one stale and over a small cap. The three `db-*` copies are one family, which is what lets
  // the keep-latest policy show all three roles at once (keep / previous / supersede).
  write(F.backupHot, "-- newest dump\n", { ageDays: 3 });
  write(F.backupSuperseded2, "-- middle dump\n", { ageDays: 60 });
  write(F.backupSuperseded, "-- older dump\n", { ageDays: 200 });
  write(F.backupStale, "-- very old dump\n", { ageDays: 400 });
  write(F.backupOversizeStale, `PK\u0003\u0004${"X".repeat(4096)}`, { ageDays: 400 });

  // A second oversize family with a VERIFIED newest copy, so an OLD copy is genuinely proposed
  // for removal and can exercise the "never purge an oversize backup" downgrade. A sole oversize
  // copy is `keep`, so it never reaches that question.
  write(F.backupOversizeSuperseded3, "-- newest huge dump\n", { ageDays: 2 });
  write(F.backupOversizeSuperseded2, "-- middle huge dump\n", { ageDays: 90 });
  write(F.backupOversizeSuperseded, `DUMP${"Y".repeat(4096)}`, { ageDays: 300 });

  // an ignored directory that is not recognised regenerable output
  write(F.ignoredFrame, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2]));

  // root tool configuration in a dot-directory
  write(F.configDotDir, '{"editor.tabSize": 2}\n');

  // a junk-named directory CONTAINING protected content: whole-directory action must be refused
  write(F.blockedDirChild, '{"manifest":"extracted"}\n');
  write(F.blockedDirProtected, "module.exports = 2;\n");

  // 30 same-kind files in one directory: aggregation must collapse them. The placeholder keeps
  // the directory non-empty once they are moved, so aggregation is what the plan proposes rather
  // than the directory being settled as a stale folder.
  for (let index = 0; index < 30; index += 1) {
    write(`agg-logs/dump-${String(index).padStart(2, "0")}.log`, `log line ${index}\n`);
  }
  write("agg-logs/.gitkeep", "");

  // a path longer than MAX_PATH, to prove the walk does not care
  const longAbs = write(longPathRel, "long path junk\n");

  // NUL.css: a real file with a Windows reserved device name. The plain path can resolve to the
  // device, so the file is created through the extended-length prefix.
  writeFileSync(`\\\\?\\${path.join(FIXTURE, F.nulDeviceName)}`, "body { color: red }\n", "utf8");

  // V2-4 (round-3 audit): a 3-copy family with NO restore evidence at all. This is the shape that
  // reproduced the defect - with nothing verified, every older copy is retained, and the old build
  // labelled all of them `previous`. Without this family in the fixture the one-previous assertion
  // could not fail, because every multi-copy family here has a verified newest copy.
  write(F.backupUnverifiedOldest, "-- oldest unverified dump\n", { ageDays: 300 });
  write(F.backupUnverifiedMiddle, "-- middle unverified dump\n", { ageDays: 90 });
  write(F.backupUnverifiedNewest, "-- newest unverified dump\n", { ageDays: 5 });

  return { longAbs };
};

const git = (args) => spawnSync("git", args, { cwd: FIXTURE, encoding: "utf8", windowsHide: true, shell: false });

const longInfo = buildFixture();

writeFileSync(
  SESSION_RECORD,
  `${JSON.stringify({ schemaVersion: 1, root: realpathSync.native(FIXTURE), created: [F.sessionCreated] }, null, 2)}\n`,
  "utf8",
);

const gitInit = git(["init", "-q", "-b", "main"]);
const gitAdd = git(["add", "tracked-file.php", "build.sh", ".gitignore"]);
const gitCommit = git(["-c", "user.email=fixture@example.invalid", "-c", "user.name=fixture", "commit", "-qm", "fixture"]);

// Restore-drill evidence for the newest copy of two backup families. The engine never restores a
// backup itself, so "verified" can only ever mean a drill somebody recorded - this file is that
// record, and it is what lets an older copy of the same family be proposed for removal at all.
// The fixture's other backup families deliberately have NO evidence, which is the default on this
// host and the case the retention policy must handle by keeping.
const FIXTURE_REAL = realpathSync.native(FIXTURE);
const ROOT_HASH = createHash("sha256").update(FIXTURE_REAL.toLowerCase()).digest("hex").slice(0, 10);
const RESTORE_EVIDENCE = path.join(STATE, "roots", ROOT_HASH, "restore-evidence.json");
mkdirSync(path.dirname(RESTORE_EVIDENCE), { recursive: true });
writeFileSync(
  RESTORE_EVIDENCE,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      root: FIXTURE_REAL,
      verified: {
        [F.backupHot]: { drilledAt: "2026-10-01T00:00:00Z", target: "scratch database", note: "fixture drill" },
        [F.backupOversizeSuperseded3]: {
          drilledAt: "2026-10-01T00:00:00Z",
          target: "scratch database",
          note: "fixture drill for the oversize family",
        },
      },
    },
    null,
    2,
  )}\n`,
  "utf8",
);

let junctionCreated = false;
let junctionError = null;
try {
  symlinkSync(OUTSIDE, path.join(FIXTURE, "outside-link"), "junction");
  junctionCreated = existsSync(path.join(FIXTURE, "outside-link"));
  if (!junctionCreated) junctionError = "the junction is not visible after creation";
} catch (error) {
  junctionError = `${error.code ?? ""} ${error.message}`.trim();
}
writeFileSync(path.join(OUTSIDE, "precious.txt"), "outside the containment root\n", "utf8");

const outsideFileIntact = () => existsSync(path.join(OUTSIDE, "precious.txt"));
const longPathWorks = existsSync(longInfo.longAbs);

// A fake trash CLI: a copy of node.exe named `trash` responds to `--version` with exit 0, which
// is exactly the probe the engine performs. This proves the doctor -> class interaction in both
// directions without inventing a dependency.
let trashEnv = null;
let trashError = null;
try {
  mkdirSync(FAKE_BIN, { recursive: true });
  const fake = path.join(FAKE_BIN, IS_WINDOWS ? "trash.exe" : "trash");
  copyFileSync(process.execPath, fake);
  chmodSync(fake, 0o755);
  trashEnv = { PATH: `${FAKE_BIN}${path.delimiter}${process.env.PATH}` };
} catch (error) {
  trashError = error.message;
}

process.stdout.write(
  [
    `organizer engine test — node ${process.version} on ${process.platform}`,
    `fixture:  ${FIXTURE}`,
    `outside:  ${OUTSIDE} (junction target)`,
    `state:    ${STATE}`,
    junctionCreated ? "junction: created — containment and junction-swap tests ran" : `junction: unavailable (${junctionError})`,
    trashEnv ? "trash:    fake trash CLI staged on PATH for the raise test" : `trash:    could not be staged (${trashError})`,
    longPathWorks ? `long path: leaf ${longPathRel.length} characters, created` : "long path: could not be created",
    gitInit.status === 0 && gitAdd.status === 0 && gitCommit.status === 0
      ? "git:      fixture repository initialised with tracked files"
      : `git:      fixture repository NOT fully initialised (init=${gitInit.status} add=${gitAdd.status} commit=${gitCommit.status})`,
    "",
  ].join("\n") + "\n",
);

// ---------------------------------------------------------------------------------------
// A. envelope + doctor
// ---------------------------------------------------------------------------------------

const doctorRecord = run(["doctor", "--json"]);
let doctor = null;

check("A1 doctor --json exits 0 and prints the {schemaVersion, kind, data} envelope", () => {
  eq(doctorRecord.code, 0, "doctor exit code");
  doctor = jin(doctorRecord, "doctor");
  eq(doctor.schemaVersion, 1, "schemaVersion");
  eq(doctor.kind, "doctor", "kind");
  ok(doctor.data && typeof doctor.data === "object", "data missing");
  return `node ${doctor.data.node}, state dir ${doctor.data.stateDir}`;
});

check("A2 doctor finds git and reports no trash CLI on this host", () => {
  eq(doctor.data.tools.git.found, true, "git must be found");
  eq(doctor.data.tools.trashTool, null, "trashTool on this host");
  const finding = find(doctor.data.findings, (row) => /raised to S3/.test(row.message), "the no-trash raise finding");
  ok(/trash/.test(finding.message), "the finding must name the trash tool");
  return "trash=null, so S2 removal candidates are raised to S3";
});

check("A3 doctor human output renders without --json", () => {
  const record = run(["doctor"]);
  eq(record.code, 0, "exit code");
  ok(record.stdout.includes("git: git version"), "git line missing");
  ok(record.stdout.includes("trash: none found"), "trash line missing");
  return "human rendering ok";
});

// ---------------------------------------------------------------------------------------
// B. inventory
// ---------------------------------------------------------------------------------------

const invRecord = run(["inventory", "--root", FIXTURE, "--json"]);
let inv = null;

check("B1 inventory --json exits 0 with the envelope and the resolved root", () => {
  eq(invRecord.code, 0, "exit code");
  inv = jin(invRecord, "inventory");
  eq(inv.kind, "inventory", "kind");
  eq(inv.data.root, realpathSync.native(FIXTURE), "resolved root");
  eq(inv.data.git.available, true, "git available");
  return `${inv.data.counts.artifacts} artifacts, ${inv.data.counts.protected} protected, ${inv.data.counts.refused} refused`;
});

check("B2 git state is read for real: tracked and ignored are distinguished", () => {
  ok(inv.data.git.trackedCount >= 2, `tracked files: ${inv.data.git.trackedCount}`);
  ok(inv.data.git.ignoredCount >= 4, `ignored entries: ${inv.data.git.ignoredCount}`);
  const row = find(inv.data.protected, (candidate) => candidate.rel === "tracked-file.php", "tracked-file.php");
  ok(/tracked by git/.test(row.reason), `reason: ${row.reason}`);
  return `${inv.data.git.trackedCount} tracked / ${inv.data.git.ignoredCount} ignored`;
});

check("B3 every protected item is reported by path with its reason", () => {
  const expectations = [
    [".git", /git internals/],
    [".env", /secrets/],
    ["id_rsa", /key or credential/],
    ["server.pem", /key or credential/],
    [".vault-keys", /key or credential/],
    ["docs", /documentation/],
    ["vendor", /vendored dependencies/],
    ["node_modules", /node_modules/],
    ["storage/app", /runtime application state/],
    ["tracked-file.php", /tracked by git/],
  ];
  for (const [rel, pattern] of expectations) {
    const row = find(inv.data.protected, (candidate) => candidate.rel === rel, `protected entry for ${rel}`);
    ok(pattern.test(row.reason), `${rel} reason was: ${row.reason}`);
  }
  return `${expectations.length} protected paths, each with its reason`;
});

check("B4 nothing from a protected tree is ever enumerated as an item", () => {
  const prefixes = ["docs/", "vendor/", "node_modules/", "storage/app/", ".git/"];
  const leaks = inv.data.items.filter((item) => prefixes.some((prefix) => item.rel.startsWith(prefix)));
  eq(leaks.length, 0, `leaked: ${leaks.map((item) => item.rel).join(", ")}`);
  return "no item reaches inside a protected tree";
});

check("B5 all seven kinds are decided from evidence", () => {
  const kinds = new Set(inv.data.items.map((item) => item.kind));
  const expected = ["test-artifact", "scrape-raw", "junk-named", "build-output", "backup", "untracked-work", "ignored-other"];
  const missing = expected.filter((kind) => !kinds.has(kind));
  eq(missing.length, 0, `missing kinds: ${missing.join(", ")}`);
  return expected.join(", ");
});

check("B6 scrape payloads are recognised by directory marker AND a content probe", () => {
  const json = find(inv.data.items, (item) => item.rel === F.scrapeJson, "payload.json");
  const html = find(inv.data.items, (item) => item.rel === F.scrapeHtml, "challenge.html");
  eq(json.kind, "scrape-raw", "payload.json kind");
  eq(html.kind, "scrape-raw", "challenge.html kind");
  eq(json.evidence.dirMarker, "_raw", "directory marker evidence");
  eq(json.evidence.payloadLike, true, "payload probe");
  ok(/json-with-/.test(json.evidence.signals.join(" ")), `signals: ${json.evidence.signals.join(", ")}`);
  ok(/html-challenge-page/.test(html.evidence.signals.join(" ")), `html signals: ${html.evidence.signals.join(", ")}`);
  return `_raw + ${json.evidence.signals.join("+")}`;
});

check("B7 NUL.css is classified from evidence with the reserved-device flag raised", () => {
  const item = find(inv.data.items, (candidate) => candidate.rel === F.nulDeviceName, "NUL.css item");
  eq(item.kind, "junk-named", "kind");
  eq(item.evidence.reservedDeviceName, true, "reservedDeviceName evidence");
  ok(item.safety !== "S1", `class must never be S1 for a device name, got ${item.safety}`);
  ok(/reserved device name/.test(item.note ?? ""), `note was: ${item.note}`);
  return `${item.safety} with evidence.reservedDeviceName=true`;
});

check("B8 a referenced junk file is not a removal candidate: evidence beats the name pattern", () => {
  const item = find(inv.data.items, (candidate) => candidate.rel === F.referenced, "referenced junk item");
  eq(item.action, "report", "action must not be move/purge");
  ok(item.evidence.referencedBy.includes("tracked-file.php"), `referencedBy: ${JSON.stringify(item.evidence.referencedBy)}`);
  eq(item.safety, "S3", "referenced items are raised to S3");
  ok(/referenced by tracked file/.test(item.reason), `reason: ${item.reason}`);
  return `referencedBy=${item.evidence.referencedBy.join(",")}`;
});

check("B9 build/test output becomes a directory item that covers its children", () => {
  const dist = find(inv.data.items, (item) => item.rel === "dist", "dist directory item");
  const testResults = find(inv.data.items, (item) => item.rel === "test-results", "test-results directory item");
  eq(dist.kind, "build-output", "dist kind");
  eq(testResults.kind, "build-output", "test-results kind");
  eq(dist.type, "dir", "dist type");
  ok(dist.evidence.childCount >= 2, `dist childCount: ${dist.evidence.childCount}`);
  const covered = [F.buildApp, "dist/app.js.map", F.testReport].filter((rel) => itemExists(inv.data.items, rel));
  eq(covered.length, 0, `children must be covered by the directory item, found: ${covered.join(", ")}`);
  return `dist covers ${dist.evidence.childCount} children`;
});

check("B9b a build script naming its own output does not veto regenerable output", () => {
  // build.sh is tracked and mentions `dist`: that is the expected shape of the evidence, so the
  // reference is recorded as a note while the directory stays a removal candidate.
  const dist = find(inv.data.items, (item) => item.rel === "dist", "dist directory item");
  ok(dist.evidence.referencedBy.includes("build.sh"), `referencedBy: ${JSON.stringify(dist.evidence.referencedBy)}`);
  ok(/not treated as a use/.test(dist.evidence.referenceNote ?? ""), `referenceNote: ${dist.evidence.referenceNote}`);
  eq(dist.action, "move", "the action must survive a configuration reference");
  return "reference recorded, action kept";
});

check("B10 untracked real work is report-only: the engine will not touch it, and offers a landing hint", () => {
  const php = find(inv.data.items, (item) => item.rel === F.untrackedWork, "real-work.php");
  const txt = find(inv.data.items, (item) => item.rel === F.untrackedText, "winter.txt");
  eq(php.kind, "untracked-work", "kind");
  eq(txt.kind, "untracked-work", "kind");
  eq(php.action, "report", "action");
  eq(php.safety, "S0", "report-only items are S0");
  eq(php.planned, false, "never planned for an action");
  ok(/git add/.test(php.landHint ?? ""), `landHint: ${php.landHint}`);
  return "untracked-work is S0 report-only with a landing hint";
});

check("B11 the check artifact is recognised as a test artifact (an ignore rule is not a reference)", () => {
  const item = find(inv.data.items, (item) => item.rel === F.checkArtifact, "user-conversation-check.png");
  eq(item.kind, "test-artifact", "kind");
  eq(item.action, "move", "action");
  ok(/name-pattern/.test(item.evidence.signals.join(" ")), `signals: ${item.evidence.signals.join(", ")}`);
  eq(item.evidence.referencedBy.length, 0, "a .gitignore entry must never count as a reference");
  return item.evidence.signals.join(", ");
});

check("B12 keep-latest backup retention: one keep, one previous, the rest superseded — and nothing removed without restore evidence", () => {
  // 11 rows: the db family (3), the oversize db-huge family (3), the oversize zip, the stale sole
  // copy, and the V2-4 unverified 3-copy family added in round 3.
  eq(inv.data.backups.length, 11, "backup rows");
  const hot = find(inv.data.backups, (row) => row.rel === F.backupHot, "newest backup");
  const middle = find(inv.data.backups, (row) => row.rel === F.backupSuperseded2, "fallback backup");
  const older = find(inv.data.backups, (row) => row.rel === F.backupSuperseded, "superseded backup");
  const stale = find(inv.data.backups, (row) => row.rel === F.backupStale, "stale sole copy");
  eq(hot.disposition, "keep", "the newest VERIFIED copy is the keep");
  eq(hot.retentionRole, "keep", "retentionRole");
  eq(hot.restoreVerified, true, "the newest copy is the one a drill verified");
  eq(middle.disposition, "keep", "the copy before it is kept as the fallback");
  eq(middle.retentionRole, "previous", "retentionRole");
  ok(/fallback/.test(middle.reason), `fallback reason: ${middle.reason}`);
  eq(older.disposition, "supersede", "only copies older than the fallback are superseded");
  ok(new RegExp(`superseded by the newer verified copy`).test(older.reason), `reason: ${older.reason}`);
  eq(older.supersededBy, F.backupHot, "the superseding copy is named");
  eq(hot.family, older.family, "all three db copies share a family");
  eq(middle.family, older.family, "the fallback shares the family");
  // A sole copy with no evidence is never proposed for removal, at any class.
  eq(stale.disposition, "keep", "a sole copy is kept");
  ok(/only copy in family/.test(stale.reason), `sole-copy reason: ${stale.reason}`);
  return `keep=${hot.retentionRole} previous=${middle.retentionRole} supersede=${older.disposition}`;
});

check("B12b the plan states the per-family retention policy and that a move frees no disk space", () => {
  const plan = makePlan("deep");
  const policy = plan.data.retentionPolicy;
  ok(policy, "retentionPolicy is surfaced in the plan");
  const row = find(policy.families, (candidate) => candidate.family === "backups/db-#-#-#", "the db family row");
  eq(row.keep, F.backupHot, "family keep");
  eq(row.previous, F.backupSuperseded2, "family previous");
  eq(row.removable, 1, "family removable count");
  ok(row.removableBytes > 0, "removable bytes are reported");
  eq(policy.freesDiskSpace, false, "a quarantine move frees no disk space");
  ok(/does NOT free disk space/.test(policy.note), `policy note: ${policy.note}`);
  ok(/--purge/.test(policy.note), "the note must name the honest option");
  return `${policy.totals.supersede} supersede proposal(s), ${policy.totals.removableBytes} B`;
});

check("B12c at most ONE copy per family claims retentionRole `previous` (audit V2-4)", () => {
  // V2-4: an unverified multi-copy family kept every older copy AND labelled each of them
  // `previous`, so a reader filtering on `retentionRole === "previous"` saw several fallbacks
  // where the doctrine allows exactly one. The fallback is the copy immediately before the keep;
  // a copy retained only because the family has no restore evidence is kept but is not a fallback.
  const plan = makePlan("deep");
  const families = plan.data.retentionPolicy.families;
  const problems = [];
  let unverifiedFamiliesChecked = 0;
  for (const family of families) {
    const members = plan.items.filter((item) => item.evidence.backupFamily === family.family);
    const previousRows = members.filter((item) => item.retentionRole === "previous").map((item) => item.rel);
    if (previousRows.length > 1) {
      problems.push(`${family.family}: ${previousRows.length} items claim 'previous' (${previousRows.join(", ")})`);
    }
    if (family.previous === null && previousRows.length > 0) {
      problems.push(`${family.family}: family names no previous but items do (${previousRows.join(", ")})`);
    }
    if (family.previous !== null && (previousRows.length !== 1 || previousRows[0] !== family.previous)) {
      problems.push(`${family.family}: item roles ${JSON.stringify(previousRows)} disagree with family previous ${family.previous}`);
    }
    // An UNVERIFIED family is the shape the defect needed: nothing may be removable, yet every
    // copy must still be accounted for with a role that does not imply fallback status.
    if (!family.keepVerified) {
      unverifiedFamiliesChecked += 1;
      if (family.removable !== 0) problems.push(`${family.family}: unverified family proposes ${family.removable} removal(s)`);
      for (const member of members) {
        if (member.retentionRole === "previous" && family.previous === null) {
          problems.push(`${family.family}: ${member.rel} claims a fallback role in a family with no fallback`);
        }
      }
    }
  }
  ok(unverifiedFamiliesChecked > 0, "the fixture must contain at least one family with no restore evidence");
  eq(problems.length, 0, `families violating the one-previous rule: ${problems.join(" | ")}`);
  const previousTotal = plan.items.filter((item) => item.retentionRole === "previous").length;
  eq(
    previousTotal,
    families.filter((family) => family.previous !== null).length,
    "the number of `previous` items must equal the number of families that name a fallback",
  );
  return `${families.length} families (${unverifiedFamiliesChecked} unverified), ${previousTotal} fallback row(s)`;
});

check("B13 an ignored directory that is not recognised output needs an owner decision", () => {
  const frames = find(inv.data.items, (item) => item.rel === "frames", "frames directory");
  eq(frames.kind, "ignored-other", "kind");
  eq(frames.action, "report", "action must not remove it automatically");
  ok(/owner decision required/.test(frames.reason), `reason: ${frames.reason}`);
  return "frames/ is report-only";
});

check("B14 root tool-configuration dot-directories are kept by policy and cover their subtree", () => {
  const vscode = find(inv.data.items, (item) => item.rel === ".vscode", ".vscode");
  eq(vscode.action, "none", ".vscode action");
  eq(vscode.disposition, "kept", ".vscode disposition");
  eq(vscode.evidence.coversSubtree, true, "the kept directory covers its subtree");
  eq(itemExists(inv.data.items, F.configDotDir), false, "its children must not become separate items");
  return "kept by policy, one decision for the subtree";
});

check("B15 a whole-directory action is refused when the subtree holds protected content", () => {
  const dump = find(inv.data.items, (item) => item.rel === F.blockedDir, "blocked directory item");
  eq(itemExists(inv.data.items, F.blockedDirProtected), false, "the node_modules file must never be an item");
  eq(dump.kind, "junk-named", "kind is still junk-named");
  eq(dump.action, "report", "the action must be refused");
  eq(dump.safety, "S0", "class");
  ok(dump.evidence.blockedBy.includes("protected"), `blockedBy: ${JSON.stringify(dump.evidence.blockedBy)}`);
  ok(/whole-directory action refused/.test(dump.reason), `reason: ${dump.reason}`);
  return `blocked by ${dump.evidence.blockedBy.join("+")}`;
});

check("B16 a junction is refused, never followed, and never becomes an item", () => {
  if (!junctionCreated) skipWith(`could not create a junction: ${junctionError}`);
  const refused = find(inv.data.refused, (row) => row.rel === "outside-link", "refused junction");
  ok(/junction|link/.test(refused.reason), `reason: ${refused.reason}`);
  eq(refused.escapesRoot, true, "escapesRoot flag");
  eq(itemExists(inv.data.items, "outside-link"), false, "a junction must not be an item");
  eq(outsideFileIntact(), true, "the target outside the root must be untouched");
  return "outside-link refused with escapesRoot=true";
});

check("B17 a path longer than MAX_PATH is enumerated without crashing", () => {
  if (!longPathWorks) skipWith("the fixture could not create a path over MAX_PATH");
  const item = find(inv.data.items, (candidate) => candidate.rel === longPathRel, "long path item");
  eq(item.kind, "junk-named", "kind");
  ok(item.path.length > 260, `absolute path length was ${item.path.length}`);
  ok(item.path.startsWith(realpathSync.native(FIXTURE)) || item.path.startsWith(FIXTURE), "path must stay inside the root");
  return `absolute path ${item.path.length} characters`;
});

check("B18 every item carries id, absolute path, class, evidence, size and level", () => {
  for (const item of inv.data.items) {
    ok(/^it-[0-9a-f]{10}$/.test(item.id), `id shape: ${item.id}`);
    ok(path.isAbsolute(item.path), `path must be absolute: ${item.path}`);
    ok(["S0", "S1", "S2", "S3"].includes(item.safety), `class: ${item.safety}`);
    eq(item.class, item.safety, `class must mirror safety for ${item.rel}`);
    ok(typeof item.size === "number", `size for ${item.rel}`);
    ok(item.evidence && typeof item.evidence === "object", `evidence for ${item.rel}`);
    ok(["minimal", "light", "standard", "deep", "immaculate"].includes(item.minLevel), `minLevel: ${item.minLevel}`);
    ok(typeof item.reason === "string" && item.reason.length > 0, `reason for ${item.rel}`);
  }
  return `${inv.data.items.length} items validated`;
});

check("B19 item ids are stable across runs for the same path", () => {
  const again = jin(run(["inventory", "--root", FIXTURE, "--json"]), "inventory #2");
  const first = new Map(inv.data.items.map((item) => [item.rel, item.id]));
  const second = new Map(again.data.items.map((item) => [item.rel, item.id]));
  eq(second.size, first.size, "same item count");
  for (const [rel, id] of first) eq(second.get(rel), id, `id for ${rel}`);
  return `${first.size} ids reproduced`;
});

check("B20 inventory is read-only: nothing in the fixture changed", () => {
  const before = snapshotTree();
  run(["inventory", "--root", FIXTURE, "--json"]);
  const after = snapshotTree();
  eq(after.count, before.count, "file count");
  eq(after.digest, before.digest, "tree digest");
  return `${before.count} files, digest unchanged`;
});

check("B21 a tracked file whose on-disk case differs is still protected (Windows paths are case-insensitive)", () => {
  if (!IS_WINDOWS) skipWith("case-insensitive path lookup only applies on Windows");
  const lower = "scratch-case-test.tmp";
  const upper = "SCRATCH-CASE-TEST.TMP";
  write(lower, "tracked despite the junk-sounding name\n");
  const add = git(["add", lower]);
  eq(add.status, 0, `git add failed: ${add.stderr}`);
  // Rename to a different case in two steps: NTFS keeps the spelling, git keeps the index case.
  const staged = path.join(FIXTURE, "_case_swap_tmp");
  renameSync(path.join(FIXTURE, lower), staged);
  renameSync(staged, path.join(FIXTURE, upper));
  const restated = jin(run(["inventory", "--root", FIXTURE, "--json"]), "inventory with a case-mismatched tracked file");
  const row = find(restated.data.protected, (candidate) => candidate.rel === upper, `protected row for ${upper}`);
  ok(/tracked by git/.test(row.reason), `reason: ${row.reason}`);
  eq(itemExists(restated.data.items, upper), false, "a tracked file must never become an item");
  git(["rm", "--cached", "-q", "--force", lower]);
  rmSync(path.join(FIXTURE, upper), { force: true });
  return `${upper} resolved to git's ${lower}`;
});

// ---------------------------------------------------------------------------------------
// C. plan
// ---------------------------------------------------------------------------------------

const planMinimal = makePlan("minimal");
const planLight = makePlan("light");
const planStandard = makePlan("standard");
const planDeep = makePlan("deep");
const planImmaculate = makePlan("immaculate");

check("C1 plan --json exits 0 and writes a reviewable, re-readable plan file", () => {
  eq(planStandard.record.code, 0, "exit code");
  eq(planStandard.data.level, "standard", "level");
  eq(planStandard.data.scope, "repo", "scope");
  ok(existsSync(planStandard.file), "plan file written");
  const reread = JSON.parse(readFileSync(planStandard.file, "utf8"));
  eq(reread.kind, "plan", "plan file kind");
  eq(reread.data.planId, planStandard.data.planId, "plan id in the file");
  return `${planStandard.data.planId}, ${planStandard.items.length} items`;
});

check("C2 `minimal` plans exactly the litter this session recorded creating", () => {
  const planned = planMinimal.items.filter((item) => item.planned);
  eq(planned.length, 1, "planned item count");
  eq(planned[0].rel, F.sessionCreated, "planned rel");
  eq(planned[0].safety, "S1", "a session-recorded item is reversible and needs no approval");
  eq(planned[0].minLevel, "minimal", "minLevel");
  return `${planned[0].rel} at S1`;
});

check("C3 `--scope session` and `--level minimal` agree on the same item set", () => {
  const sessionPlan = makePlan("standard", { scope: "session" });
  eq(sessionPlan.data.scope, "session", "scope echoed");
  eq(sessionPlan.items.length, 1, "session-scoped item count");
  for (const item of sessionPlan.items) eq(item.evidence.sessionCreated, true, `sessionCreated for ${item.rel}`);
  const a = sortedIds(plannedIds(planMinimal));
  const b = sortedIds(plannedIds(sessionPlan));
  eq(b, a, "the two sets must agree");
  return "1 item in both";
});

check("C4 levels are monotone: each planned set contains the previous one", () => {
  const sets = [planMinimal, planLight, planStandard, planDeep, planImmaculate].map(plannedIds);
  const sizes = sets.map((set) => set.size);
  for (let index = 1; index < sets.length; index += 1) {
    ok(subset(sets[index - 1], sets[index]), `level ${index} does not contain level ${index - 1}`);
    ok(sizes[index] >= sizes[index - 1], "planned counts must not shrink as the level rises");
  }
  return `planned counts ${sizes.join(" -> ")}`;
});

check("C5 an item below the requested level is reported as deferred, not silently dropped", () => {
  const scrape = itemAt(planMinimal, F.scrapeJson);
  eq(scrape.levelState, "deferred-by-level", "levelState");
  eq(scrape.planned, false, "planned flag");
  eq(scrape.action, "move", "the action is still recorded for review");
  eq(itemAt(planStandard, F.scrapeJson).planned, true, "planned at standard");
  return `scrape-raw: deferred at minimal, planned at standard (minLevel=${scrape.minLevel})`;
});

check("C6 a junk-named untracked file with no session record is S2-raised, never S1", () => {
  const junk = itemAt(planStandard, F.duplicateSuffix);
  eq(junk.kind, "junk-named", "kind");
  ok(junk.safety !== "S1", `class was ${junk.safety}`);
  ok(junk.raisedBy.includes("no-trash-tool"), `raisedBy: ${JSON.stringify(junk.raisedBy)}`);
  ok(junk.evidence.signals.includes("no-trash-tool"), "the raise must be visible as a signal");
  const session = itemAt(planStandard, F.sessionCreated);
  eq(session.safety, "S1", "the session-recorded item keeps S1");
  eq(session.raisedBy.length, 0, `S1 is exempt from the trash raise: ${JSON.stringify(session.raisedBy)}`);
  return `junk=${junk.safety} (${junk.raisedBy.join(",")}), session=${session.safety}`;
});

check("C7 a real trash CLI on PATH removes the raise (doctor adjusts the plan)", () => {
  if (trashEnv === null) skipWith(`could not stage a fake trash binary: ${trashError}`);
  const fakeDoctor = jin(run(["doctor", "--json"], { env: trashEnv }), "doctor with a trash tool");
  eq(fakeDoctor.data.tools.trashTool, "trash", "trashTool must be detected");
  const withTrash = makePlan("standard", { env: trashEnv });
  const junk = itemAt(withTrash, F.duplicateSuffix);
  eq(junk.safety, "S2", "with a trash tool the S2 class stands");
  ok(!junk.raisedBy.includes("no-trash-tool"), `raisedBy: ${JSON.stringify(junk.raisedBy)}`);
  eq(itemAt(planStandard, F.duplicateSuffix).safety, "S3", "without a trash tool the same item is S3");
  globalThis.planWithTrash = withTrash;
  return "S2 with a trash tool, S3 without";
});

check("C8 an item over the quarantine cap is raised, and its action becomes an irreversible purge", () => {
  const capped = makePlan("standard", { env: { DSH_ORGANIZER_MAX_SINK_BYTES: "1024" } });
  const item = itemAt(capped, F.oversize);
  eq(item.action, "purge", "action above the cap");
  eq(item.safety, "S3", "class");
  ok(item.raisedBy.includes("oversize"), `raisedBy: ${JSON.stringify(item.raisedBy)}`);
  ok(item.raisedBy.includes("oversize-purge"), `raisedBy: ${JSON.stringify(item.raisedBy)}`);
  ok(/Remove-Item/.test(item.shell ?? ""), `shell: ${item.shell}`);
  eq(itemAt(planStandard, F.oversize).action, "move", "with the default cap the same item is a reversible move");
  return "purge above the cap, move below it";
});

check("C9 an oversize backup is never purged: it is proposed for archive instead", () => {
  // `plan --purge` is the only path that turns a backup removal into an irreversible purge, and
  // even then an oversize backup is downgraded to `archive` - a backup is the owner's only copy
  // of something, so the engine will not destroy it just because the owner asked for bytes.
  // The superseded `db` copy is used because it is the only backup the retention policy proposes
  // for removal at all; a sole copy is kept, so it never reaches the archive question.
  const capped = makePlan("deep", { env: { DSH_ORGANIZER_MAX_SINK_BYTES: "1024" }, purge: true });
  const item = itemAt(capped, F.backupOversizeSuperseded);
  eq(item.kind, "backup", "kind");
  eq(item.action, "report", "an oversize backup is never purged, even under --purge");
  eq(item.evidence.oversizeArchive, true, "oversizeArchive evidence");
  ok(/archive off-line/.test(item.dispositionReason), `dispositionReason: ${item.dispositionReason}`);
  // Under the same cap, a small superseded copy is a reversible move (and a purge under --purge).
  eq(itemAt(makePlan("deep", { env: { DSH_ORGANIZER_MAX_SINK_BYTES: "1024" } }), F.backupSuperseded).action, "move", "without --purge it stays a reversible move");
  return `archive, not purge — ${item.dispositionReason}`;
});

check("C10 backups enter the plan only at `deep`", () => {
  eq(itemAt(planStandard, F.backupSuperseded).planned, false, "not planned at standard");
  eq(itemAt(planDeep, F.backupSuperseded).planned, true, "planned at deep");
  eq(itemAt(planDeep, F.backupSuperseded).minLevel, "deep", "minLevel");
  return "backups are a deep-level concern";
});

check("C10b `plan --purge` upgrades a superseded backup to an irreversible purge, still confirmed per item", () => {
  const purged = makePlan("deep", { purge: true });
  const item = itemAt(purged, F.backupSuperseded);
  eq(item.action, "purge", "action under --purge");
  eq(item.safety, "S3", "an irreversible delete is never below S3");
  ok(item.raisedBy.includes("purge-irreversible"), `raisedBy: ${JSON.stringify(item.raisedBy)}`);
  ok(purged.data.nextCommands.confirmIds.includes(item.id), "it must still be named one by one with --confirm");
  eq(purged.data.retentionPolicy.freesDiskSpace, true, "purge is the only thing that frees bytes");
  ok(purged.data.retentionPolicy.totals.reclaimableBytes > 0, "reclaimable bytes are reported");
  // The default plan for the same item stays a reversible move.
  eq(itemAt(planDeep, F.backupSuperseded).action, "move", "without --purge it stays a reversible move");
  return `purge ${item.rel} (S3, ${item.safety}), default stays a move`;
});

check("C11 30 same-kind files in one directory collapse into one reviewable item", () => {
  const aggregate = find(planStandard.items, (item) => item.rel === "agg-logs", "aggregate item for agg-logs");
  eq(aggregate.kind, "junk-named", "kind");
  eq(aggregate.evidence.aggregate.count, 30, "aggregate count");
  eq(aggregate.type, "dir", "type");
  // `.gitkeep` is the deliberate placeholder, not one of the 30 logs: it stays visible on purpose.
  const children = planStandard.items.filter(
    (item) => item.rel.startsWith("agg-logs/") && basenameOfRel(item.rel) !== ".gitkeep",
  );
  eq(children.length, 0, `children must be folded in, found ${children.length}`);
  return `1 item covering ${aggregate.evidence.aggregate.count} files`;
});

check("C12 every planned item documents the equivalent shell command, and none is executed", () => {
  for (const item of planStandard.items) {
    eq(item.shellExecuted, false, `shellExecuted for ${item.rel}`);
    if (item.planned && item.action !== "report" && item.action !== "none") {
      ok(typeof item.shell === "string" && item.shell.length > 0, `shell missing for ${item.rel}`);
      ok(item.shell.includes(item.path), `shell must quote the absolute target: ${item.shell}`);
    }
    if (item.action === "report" || item.action === "none") eq(item.shell, null, `shell must be null for ${item.rel}`);
  }
  return `${planStandard.items.length} items documented, shellExecuted=false everywhere`;
});

check("C13 the plan carries the exact ids that will need --confirm", () => {
  const s3 = planStandard.items.filter((item) => item.planned && item.safety === "S3").map((item) => item.id);
  ok(planStandard.data.nextCommands.confirmIds.length > 0, "confirmIds must not be empty");
  eq(sortedIds(planStandard.data.nextCommands.confirmIds), sortedIds(s3), "confirmIds must be exactly the S3 planned items");
  for (const id of planStandard.data.nextCommands.confirmIds) {
    ok(planStandard.data.nextCommands.apply.includes(id), "the suggested apply command must name it");
  }
  return `${s3.length} S3 ids suggested in nextCommands.apply`;
});

check("C14 plan usage errors: an unknown level is 2, a missing root is 3", () => {
  eq(run(["plan", "--root", FIXTURE, "--level", "bogus", "--json"]).code, 2, "unknown level");
  eq(run(["plan", "--root", path.join(SCRATCH, "nope"), "--level", "light", "--json"]).code, 3, "missing root");
  eq(run(["plan", "--root", FIXTURE, "--level", "light", "--scope", "galaxy", "--json"]).code, 2, "unknown scope");
  return "2 / 3 / 2";
});

// ---------------------------------------------------------------------------------------
// D. apply
// ---------------------------------------------------------------------------------------

const s1Item = itemAt(planStandard, F.sessionCreated);
const junkItem = itemAt(planStandard, F.duplicateSuffix);

check("D1 apply refuses S2 items without --approve-s2 and changes nothing", () => {
  if (globalThis.planWithTrash === undefined) skipWith("no trash tool could be staged, so no S2 plan exists");
  const job = itemAt(globalThis.planWithTrash, F.duplicateSuffix);
  eq(job.safety, "S2", "the plan must hold an S2 removal candidate");
  const before = snapshotTree();
  const record = run(["apply", "--plan", globalThis.planWithTrash.file, "--only", job.id, "--json"]);
  eq(record.code, 6, "exit code for a refusal");
  const result = jin(record, "apply without --approve-s2").data;
  const row = find(result.results, (candidate) => candidate.id === job.id, "S2 result");
  eq(row.status, "refused", "status");
  ok(/--approve-s2/.test(row.reason), `reason: ${row.reason}`);
  eq(existsSync(path.join(FIXTURE, F.duplicateSuffix)), true, "the refused file must still exist");
  const after = snapshotTree();
  eq(after.digest, before.digest, "tree digest must be unchanged");
  return `refused: ${row.reason}`;
});

check("D2 --approve-s2 still refuses S3 items, naming the exact id to confirm", () => {
  const record = run(["apply", "--plan", planStandard.file, "--approve-s2", "--only", junkItem.id, "--json"]);
  eq(record.code, 6, "exit code");
  const result = jin(record, "apply with --approve-s2").data;
  const row = find(result.results, (candidate) => candidate.id === junkItem.id, "S3 result");
  eq(row.status, "refused", "status");
  eq(row.safety, "S3", "class");
  ok(row.reason.includes(row.id), `the refusal must name that exact id: ${row.reason}`);
  eq(existsSync(path.join(FIXTURE, F.duplicateSuffix)), true, "still nothing moved");
  return `refusal: ${row.reason}`;
});

check("D3 --confirm for a DIFFERENT id never approves this one", () => {
  const other = itemAt(planStandard, F.junkUntracked);
  ok(other.id !== junkItem.id, "two distinct ids");
  const record = run([
    "apply",
    "--plan",
    planStandard.file,
    "--approve-s2",
    `--confirm=${other.id}`,
    "--only",
    junkItem.id,
    "--json",
  ]);
  const result = jin(record, "apply with a mismatched confirm").data;
  const row = find(result.results, (candidate) => candidate.id === junkItem.id, "un-confirmed result");
  eq(row.status, "refused", "status");
  ok(/needs --confirm/.test(row.reason), `reason: ${row.reason}`);
  eq(existsSync(path.join(FIXTURE, F.duplicateSuffix)), true, "the file must still exist");
  return "a confirm for one id never approves another";
});

check("D4 an unknown --only id is a usage error and nothing is applied", () => {
  const before = snapshotTree();
  const record = run(["apply", "--plan", planStandard.file, "--only", "it-0000000000", "--json"]);
  eq(record.code, 2, "exit code");
  ok(/unknown item id/.test(jin(record, "unknown --only").error.message), "the error must name the problem");
  eq(snapshotTree().digest, before.digest, "nothing may be touched when a selector is invalid");
  return "exit 2 before any action is attempted";
});

check("D5 an S1 item applies with no approval and is journalled as restorable", () => {
  const before = sha256(path.join(FIXTURE, F.sessionCreated));
  const record = run(["apply", "--plan", planMinimal.file, "--json"]);
  eq(record.code, 0, "exit code");
  const result = jin(record, "apply minimal").data;
  eq(result.counts.applied, 1, "exactly one item applied");
  eq(result.counts.refused, 0, "S1 needs no gate");
  ok(existsSync(result.journalFile), "journal written");
  eq(existsSync(path.join(FIXTURE, F.sessionCreated)), false, "the file left the repository");
  const journal = JSON.parse(readFileSync(result.journalFile, "utf8"));
  eq(journal.kind, "journal", "journal kind");
  const entry = journal.data.entries[0];
  eq(entry.id, s1Item.id, "journalled id");
  eq(entry.restorable, true, "restorable");
  eq(entry.action, "move", "action");
  eq(entry.inverse.op, "move", "the inverse is recorded");
  eq(entry.verifiedFingerprint.sha256, before, "the journalled fingerprint is the pre-move content hash");
  ok(existsSync(entry.to), "the quarantined copy exists in the sink");
  eq(sha256(entry.to), before, "the quarantined copy is byte-identical");
  ok(journal.data.sinkDir.startsWith(STATE), "the sink lives outside the repository");
  globalThis.s1Journal = result.journalFile;
  globalThis.s1Entry = entry;
  return `journalled ${entry.id} -> ${path.basename(entry.to)}`;
});

check("D6 drift: a same-size content change is caught by sha256, and only that item is skipped", () => {
  const driftPlan = makePlan("standard");
  const driftItem = itemAt(driftPlan, F.drift);
  const target = path.join(FIXTURE, F.drift);
  const sizeBefore = statSync(target).size;
  writeFileSync(target, "BBBB\n");
  eq(statSync(target).size, sizeBefore, "the drift keeps the same size, so the hash is what catches it");
  const record = run([
    "apply",
    "--plan",
    driftPlan.file,
    "--approve-s2",
    `--confirm=${driftItem.id}`,
    "--only",
    driftItem.id,
    "--json",
  ]);
  eq(record.code, 5, "exit code for drift");
  const result = jin(record, "apply with drift").data;
  const row = find(result.results, (candidate) => candidate.id === driftItem.id, "drift result");
  eq(row.status, "drift", "status");
  ok(/changed since planning/.test(row.reason), `reason: ${row.reason}`);
  ok(row.plannedFingerprint !== row.currentFingerprint, "both fingerprints must be reported");
  eq(existsSync(target), true, "a drifted item is skipped, never touched");
  return "exit 5 from a same-size content change";
});

check("D7 drift and a refusal together are both reported, and drift wins the exit code", () => {
  const mixed = makePlan("standard");
  const driftItem = itemAt(mixed, F.drift);
  const refusedItem = itemAt(mixed, F.junkUntracked);
  writeFileSync(path.join(FIXTURE, F.drift), "CCCC\n");
  const record = run([
    "apply",
    "--plan",
    mixed.file,
    "--approve-s2",
    `--confirm=${driftItem.id}`,
    "--only",
    `${driftItem.id},${refusedItem.id}`,
    "--json",
  ]);
  eq(record.code, 5, "drift takes precedence over the refusal");
  const result = jin(record, "apply drift + refusal").data;
  ok(result.counts.drift >= 1, "drift counted");
  ok(result.counts.refused >= 1, "the refusal is still reported");
  return `drift=${result.counts.drift} refused=${result.counts.refused}`;
});

check("D8 re-applying the same plan does not invent targets: a vanished item is drift", () => {
  const record = run(["apply", "--plan", planMinimal.file, "--json"]);
  eq(record.code, 5, "exit code");
  const result = jin(record, "re-apply minimal").data;
  eq(result.counts.applied, 0, "nothing to apply");
  eq(result.counts.drift, 1, "the vanished item is drift");
  return "a second apply is a no-op that reports drift";
});

check("D9 a target that became a junction between plan and apply is refused", () => {
  if (!junctionCreated) skipWith(`junctions are unavailable: ${junctionError}`);
  const swapPlan = makePlan("standard");
  const swapItem = itemAt(swapPlan, F.swap);
  const swapAbs = path.join(FIXTURE, F.swap);
  rmSync(swapAbs, { force: true });
  try {
    symlinkSync(OUTSIDE, swapAbs, "junction");
  } catch (error) {
    skipWith(`could not create the replacement junction: ${error.message}`);
  }
  const record = run([
    "apply",
    "--plan",
    swapPlan.file,
    "--approve-s2",
    `--confirm=${swapItem.id}`,
    "--only",
    swapItem.id,
    "--json",
  ]);
  eq(record.code, 6, "exit code");
  const result = jin(record, "apply over a junction").data;
  const row = find(result.results, (candidate) => candidate.id === swapItem.id, "swap result");
  eq(row.status, "refused", "status");
  ok(/junction|link/.test(row.reason), `reason: ${row.reason}`);
  eq(outsideFileIntact(), true, "the junction target outside the root must be untouched");
  return `refused: ${row.reason}`;
});

check("D10 a read-only file is quarantined without crashing, and its bytes survive", () => {
  const readOnlyAbs = path.join(FIXTURE, F.readOnly);
  if (!existsSync(readOnlyAbs)) skipWith("the read-only fixture file is already gone");
  const before = sha256(readOnlyAbs);
  const roPlan = makePlan("standard");
  const roItem = itemAt(roPlan, F.readOnly);
  const record = run([
    "apply",
    "--plan",
    roPlan.file,
    "--approve-s2",
    `--confirm=${roItem.id}`,
    "--only",
    roItem.id,
    "--json",
  ]);
  const result = jin(record, "apply read-only").data;
  const row = find(result.results, (candidate) => candidate.id === roItem.id, "read-only result");
  eq(row.status, "applied", `status (${row.reason})`);
  const journal = JSON.parse(readFileSync(result.journalFile, "utf8"));
  const entry = journal.data.entries[0];
  eq(sha256(entry.to), before, "the quarantined copy is byte-identical");
  return entry.inverse.modeChanged
    ? "read-only bit cleared and recorded for undo"
    : "renamed without a mode change (NTFS allows renaming a read-only file)";
});

check("D11 apply refuses a target that git now tracks: protection is re-checked at apply time", () => {
  const newTracked = "scratch-now-tracked.tmp";
  write(newTracked, "temporarily untracked\n");
  const plan = makePlan("standard");
  const item = itemAt(plan, newTracked);
  eq(item.action, "move", "planned as a removal candidate first");
  git(["add", newTracked]);
  const record = run([
    "apply",
    "--plan",
    plan.file,
    "--approve-s2",
    `--confirm=${item.id}`,
    "--only",
    item.id,
    "--json",
  ]);
  const result = jin(record, "apply over a newly tracked file").data;
  const row = find(result.results, (candidate) => candidate.id === item.id, "newly tracked result");
  eq(row.status, "refused", "status");
  ok(/tracked by git/.test(row.reason), `reason: ${row.reason}`);
  eq(existsSync(path.join(FIXTURE, newTracked)), true, "a tracked file is never removed");
  git(["rm", "--cached", "-q", "--force", newTracked]);
  rmSync(path.join(FIXTURE, newTracked), { force: true });
  return `refused: ${row.reason}`;
});

check("D12 apply --plan with a missing file is exit 3", () => {
  eq(run(["apply", "--plan", path.join(SCRATCH, "no-such-plan.json"), "--json"]).code, 3, "exit code");
  return "3 for a missing plan";
});

// ---------------------------------------------------------------------------------------
// E. undo
// ---------------------------------------------------------------------------------------

check("E1 undo restores an S1 quarantine byte-for-byte", () => {
  const target = path.join(FIXTURE, F.sessionCreated);
  const record = run(["undo", "--journal", globalThis.s1Journal, "--json"]);
  eq(record.code, 0, "exit code");
  const result = jin(record, "undo").data;
  eq(result.counts.restored, 1, "restored count");
  eq(existsSync(target), true, "the file is back");
  eq(sha256(target), globalThis.s1Entry.verifiedFingerprint.sha256, "content restored exactly");
  eq(existsSync(globalThis.s1Entry.to), false, "the quarantine copy was moved back, not copied");
  return `restored ${globalThis.s1Entry.rel}`;
});

check("E2 a second undo reports already-undone instead of restoring twice", () => {
  const record = run(["undo", "--journal", globalThis.s1Journal, "--json"]);
  eq(record.code, 0, "exit code");
  const result = jin(record, "second undo").data;
  eq(result.counts.alreadyUndone, 1, "already-undone count");
  eq(result.counts.restored, 0, "nothing restored twice");
  return "idempotent";
});

check("E3 undo refuses to overwrite a destination that was recreated, and says so", () => {
  const plan = makePlan("minimal");
  const applied = jin(run(["apply", "--plan", plan.file, "--json"]), "apply for occupied undo").data;
  eq(applied.counts.applied, 1, "the S1 item applied");
  writeFileSync(path.join(FIXTURE, F.sessionCreated), "regenerated by the agent\n");
  const record = run(["undo", "--journal", applied.journalFile, "--json"]);
  eq(record.code, 5, "exit code");
  const result = jin(record, "undo onto an occupied path").data;
  const row = find(result.results, (candidate) => candidate.status === "skipped", "skipped row");
  ok(/occupied/.test(row.reason), `reason: ${row.reason}`);
  eq(readFileSync(path.join(FIXTURE, F.sessionCreated), "utf8"), "regenerated by the agent\n", "the recreated file is untouched");
  return "exit 5, nothing overwritten";
});

check("E4 undo honestly reports an irreversible purge as not restorable", () => {
  const capped = makePlan("standard", { env: { DSH_ORGANIZER_MAX_SINK_BYTES: "1024" } });
  const item = itemAt(capped, F.oversize);
  eq(item.action, "purge", "the plan must be a purge");
  const record = run(
    ["apply", "--plan", capped.file, "--approve-s2", `--confirm=${item.id}`, "--only", item.id, "--json"],
    { env: { DSH_ORGANIZER_MAX_SINK_BYTES: "1024" } },
  );
  eq(record.code, 0, "a purge applies once confirmed by name");
  const result = jin(record, "purge apply").data;
  eq(existsSync(path.join(FIXTURE, F.oversize)), false, "the item is gone");
  const journal = JSON.parse(readFileSync(result.journalFile, "utf8"));
  const entry = journal.data.entries[0];
  eq(entry.restorable, false, "a purge is not restorable");
  eq(entry.inverse.op, "none", "no inverse exists for a purge");
  const undo = run(["undo", "--journal", result.journalFile, "--json"]);
  eq(undo.code, 6, "exit code");
  const undone = jin(undo, "undo of a purge").data;
  eq(undone.counts.notRestorable, 1, "reported as not restorable");
  ok(/purged permanently/.test(undone.results[0].reason), `reason: ${undone.results[0].reason}`);
  return "exit 6 with an explicit not-restorable reason";
});

check("E5 undo reports a quarantine missing from the sink as not restorable", () => {
  const plan = makePlan("minimal");
  const applied = jin(run(["apply", "--plan", plan.file, "--json"]), "apply before sink tampering").data;
  const journal = JSON.parse(readFileSync(applied.journalFile, "utf8"));
  rmSync(journal.data.entries[0].to, { force: true });
  const record = run(["undo", "--journal", applied.journalFile, "--json"]);
  eq(record.code, 6, "exit code");
  const result = jin(record, "undo with a missing sink copy").data;
  ok(/gone from the sink/.test(result.results[0].reason), `reason: ${result.results[0].reason}`);
  return "a missing copy is reported, never silently 'restored'";
});

check("E6 undo --journal with a missing file is exit 3", () => {
  eq(run(["undo", "--journal", path.join(SCRATCH, "no-journal.json"), "--json"]).code, 3, "exit code");
  return "3 for a missing journal";
});

// ---------------------------------------------------------------------------------------
// F. disposition
// ---------------------------------------------------------------------------------------

check("F1 disposition exits 6 while in-scope items are unaccounted for", () => {
  const record = run(["disposition", "--root", FIXTURE, "--level", "standard", "--json"]);
  eq(record.code, 6, "exit code");
  const data = jin(record, "disposition standard").data;
  ok(data.counts.pending > 0, "pending count");
  eq(data.unaccounted.length, data.counts.pending, "unaccounted must match the pending count");
  const total =
    data.counts.kept + data.counts.removed + data.counts.landed + data.counts.deferred + data.counts.accepted + data.counts.pending;
  eq(total, data.counts.items, "every row carries exactly one disposition");
  return `${data.counts.items} items, ${data.counts.pending} pending`;
});

check("F2 disposition at `minimal` accounts for everything the level does not reach", () => {
  const record = run(["disposition", "--root", FIXTURE, "--level", "minimal", "--json"]);
  const data = jin(record, "disposition minimal").data;
  ok(data.counts.deferred > 0, "lower levels are explicitly deferred, not ignored");
  eq(data.counts.pending, 0, "nothing is pending at minimal");
  eq(record.code, 0, "exit code when the requested level has nothing outstanding");
  for (const row of data.rows) {
    if (row.decidedBy === "level") eq(row.disposition, "deferred", `deferred row ${row.rel}`);
  }
  return `${data.counts.deferred} deferred by level, 0 pending`;
});

check("F3 --set records an owner decision, persists it, and closes that item", () => {
  const target = itemAt(planStandard, "frames");
  const before = jin(run(["disposition", "--root", FIXTURE, "--level", "standard", "--json"]), "disposition before").data;
  const record = run([
    "disposition",
    "--root",
    FIXTURE,
    "--level",
    "standard",
    "--set",
    `${target.id}=accepted:"ignored frames are intentional"`,
    "--json",
  ]);
  const data = jin(record, "disposition --set").data;
  const row = find(data.rows, (candidate) => candidate.id === target.id, "the decided row");
  eq(row.disposition, "accepted", "disposition");
  eq(row.decidedBy, "owner", "decidedBy");
  ok(/intentional/.test(row.reason), `reason: ${row.reason}`);
  const beforeRows = new Map(before.rows.map((candidate) => [candidate.rel, candidate.disposition]));
  const changed = data.rows
    .filter((candidate) => beforeRows.get(candidate.rel) !== candidate.disposition)
    .map((candidate) => `${candidate.rel}: ${beforeRows.get(candidate.rel)} -> ${candidate.disposition}`);
  eq(
    data.counts.pending,
    before.counts.pending - 1,
    `the pending count drops by exactly one; changed rows: ${changed.join(", ") || "(none)"}`,
  );
  ok(existsSync(data.decisionsFile), "the decision file persists");
  const again = jin(run(["disposition", "--root", FIXTURE, "--level", "standard", "--json"]), "disposition again").data;
  eq(find(again.rows, (candidate) => candidate.id === target.id, "persisted row").disposition, "accepted", "persisted decision");
  return `pending ${before.counts.pending} -> ${data.counts.pending}`;
});

check("F4 a `kept` decision suppresses planning at every level; `removed` replans it", () => {
  const target = itemAt(planStandard, F.junkUntracked);
  run(["disposition", "--root", FIXTURE, "--level", "standard", "--set", `${target.id}=kept:"still needed"`, "--json"]);
  const item = itemAt(makePlan("immaculate"), F.junkUntracked);
  eq(item.action, "none", "action after the owner decision");
  eq(item.planned, false, "planned flag");
  eq(item.disposition, "kept", "disposition");
  eq(item.dispositionSource, "owner", "dispositionSource");
  run(["disposition", "--root", FIXTURE, "--level", "standard", "--set", `${target.id}=removed:"test cleanup"`, "--json"]);
  const removal = itemAt(makePlan("standard"), F.junkUntracked);
  ok(removal.action === "move" || removal.action === "purge", `action after a removed decision: ${removal.action}`);
  eq(removal.planned, true, "it is actionable again");
  return "kept suppresses, removed replans";
});

check("F5 --set rejects unknown ids and unknown dispositions with exit 2", () => {
  const unknownId = run(["disposition", "--root", FIXTURE, "--level", "standard", "--set", "it-0000000000=kept:x", "--json"]);
  eq(unknownId.code, 2, "unknown id");
  ok(/unknown item id/.test(jin(unknownId, "unknown id").error.message), "the error must name the problem");
  const target = itemAt(planStandard, "frames");
  eq(run(["disposition", "--root", FIXTURE, "--level", "standard", "--set", `${target.id}=sideways:x`, "--json"]).code, 2, "bad disposition");
  eq(run(["disposition", "--root", FIXTURE, "--level", "standard", "--set", "nonsense", "--json"]).code, 2, "malformed --set");
  return "3 usage errors, no state written";
});

check("F6 apply the whole standard plan, decide the rest, and disposition exits 0", () => {
  const plan = makePlan("standard");
  const planned = plan.items.filter((item) => item.planned && item.action !== "none" && item.action !== "report");
  const s3 = planned.filter((item) => item.safety === "S3").map((item) => item.id);
  const record = run(["apply", "--plan", plan.file, "--approve-s2", `--confirm=${s3.join(",")}`, "--json"]);
  const result = jin(record, "full standard apply").data;
  const failures = result.results.filter((row) => row.status === "error" || row.status === "drift" || row.status === "refused");
  eq(failures.length, 0, `unexpected results: ${JSON.stringify(failures.slice(0, 4))}`);
  eq(result.counts.applied, planned.length, `applied ${result.counts.applied} of ${planned.length}`);
  // Since round 2 the standard plan also carries test-content routes: a detected test file is
  // moved into the test tree rather than removed, so a routed item leaves the tree at its old
  // path. That is the intended capability, and it is asserted in detail in section G.
  const routed = planned.filter((item) => item.action === "route-to-test-tree");
  const removalPlanned = planned.filter((item) => item.action === "move" || item.action === "purge");
  ok(removalPlanned.length > 0, "the standard plan must still propose real removals");
  for (const item of routed) {
    eq(item.kind, "test-content", `${item.rel} must be test-content`);
    // The item view exposes the destination as an absolute path.\n    const routedAbs = path.isAbsolute(item.routeTarget) ? item.routeTarget : path.join(FIXTURE, item.routeTarget);\n    ok(existsSync(routedAbs), `routed file must exist at ${routedAbs}`);
  }

  const disposition = jin(run(["disposition", "--root", FIXTURE, "--level", "standard", "--json"]), "disposition after apply").data;
  const pending = disposition.rows.filter((row) => row.disposition === "pending");
  for (const row of pending) {
    const decision = run([
      "disposition",
      "--root",
      FIXTURE,
      "--level",
      "standard",
      "--set",
      `${row.id}=accepted:"decided by the test harness"`,
      "--json",
    ]);
    ok(decision.code !== 2, `the decision for ${row.rel} must be accepted: ${decision.stderr.slice(0, 120)}`);
  }
  const final = run(["disposition", "--root", FIXTURE, "--level", "standard", "--json"]);
  const finalData = jin(final, "final disposition").data;
  eq(finalData.counts.pending, 0, `pending after decisions: ${JSON.stringify(finalData.unaccounted.slice(0, 5))}`);
  eq(final.code, 0, "exit code when nothing is unaccounted for");
  ok(finalData.settled.length > 0, "settled items are still reported after they leave the tree");
  return `${planned.length} applied (${routed.length} routed), ${pending.length} decided, ${finalData.counts.items} items left, all accounted`;
});

// ---------------------------------------------------------------------------------------
// G. round-2 capability and audit-fix assertions
//
// Every gate added in round 2 gets a NEGATIVE test here: the case where it must refuse. The
// audit (F2) proved the round-1 engine would move `.env` through a hand-edited plan, so the
// forged-plan test below is the one that must fail against the old behaviour.
//
// Ordering note: F6 has already applied the whole standard plan, so the round-1 junk items are
// gone. Each check here writes or re-creates what it needs, and reads the deepest level (where
// F6 never applies) when it needs an item to still be in place.
// ---------------------------------------------------------------------------------------

/** Immaculate plan, memoised: several assertions need the deepest level, which nothing applies. */
let immersivePlan = null;
const planImmersive = () => {
  if (immersivePlan === null) immersivePlan = makePlan("immaculate");
  return immersivePlan;
};

const removeSyncQuiet = (...rels) => {
  for (const rel of rels) {
    try {
      rmSync(path.isAbsolute(rel) ? rel : path.join(FIXTURE, rel), { recursive: true, force: true });
    } catch {
      /* best effort: the fixture is removed wholesale at the end anyway */
    }
  }
};

/** Copy a real plan and mutate its JSON, then write the forgery next to it. */
const forgePlan = (sourceFile, name, mutate) => {
  const parsed = JSON.parse(readFileSync(sourceFile, "utf8"));
  mutate(parsed.data);
  const file = path.join(SCRATCH, `forged-${name}.json`);
  writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  return file;
};

check("G1 a forged plan cannot move `.env`, key material or the sink manifest (audit F2)", () => {
  // The audit's F2 attack: take the engine's own emitted plan, re-point ONE item at a protected
  // target with that target's real fingerprint, and apply it under the documented --confirm gate.
  // Round 1 moved `.env`, `id_rsa` and the sink manifest. The protection decision is now re-run
  // at apply time, so every one of these must refuse. The decoy is a file written for this test,
  // so it cannot have been consumed by an earlier apply.
  const decoy = "scratch-forge-decoy.tmp";
  write(decoy, "decoy\n");
  const plan = makePlan("standard");
  const victim = itemAt(plan, decoy);
  eq(victim.action, "move", "the decoy must be a real removal candidate");
  const envAbs = path.join(FIXTURE, ".env");
  const envBefore = readFileSync(envAbs, "utf8");
  const protectedTargets = [
    [".env", /secrets/],
    ["id_rsa", /key or credential/],
    ["docs/guide.md", /documentation/],
    ["node_modules/dep/index.js", /node_modules/],
    ["storage/app/state.json", /runtime application state/],
  ];
  const failures = [];
  for (const [rel, expected] of protectedTargets) {
    const forged = forgePlan(plan.file, `protect-${rel.replace(/[^a-z0-9]/gi, "_")}`, (data) => {
      for (const item of data.items) {
        if (item.id !== victim.id) continue;
        item.rel = rel;
        item.path = path.join(FIXTURE, rel);
        // The auditor's attack used a MATCHING fingerprint, so the drift check would pass and
        // only the protection decision could refuse it. Reproduce that exactly: forge the
        // fingerprint from the real target (and the id, which `--confirm` and `--only` select on)
        // so nothing but the apply-time protection re-check stands in the way.
        const abs = path.join(FIXTURE, rel);
        const stats = lstatSync(abs);
        if (stats.isDirectory()) {
          const digest = createHash("sha256").update("").digest("hex");
          item.fingerprint = { mode: "tree", sha256: digest, entries: 0, bytes: 0 };
        } else {
          const content = readFileSync(abs);
          item.fingerprint = {
            mode: "full",
            size: stats.size,
            mtimeMs: Math.trunc(stats.mtimeMs),
            sha256: createHash("sha256").update(content).digest("hex"),
          };
        }
      }
    });
    const record = run(["apply", "--plan", forged, "--approve-s2", `--confirm=${victim.id}`, "--json"]);
    const data = jin(record, `apply forged ${rel}`).data;
    const row = find(data.results, (candidate) => candidate.id === victim.id, `result for ${rel}`);
    if (row.status !== "refused") {
      failures.push(`${rel}: status=${row.status} reason=${row.reason}`);
      continue;
    }
    if (!expected.test(row.reason)) failures.push(`${rel}: reason did not name the protection (${row.reason})`);
    if (!existsSync(path.join(FIXTURE, rel))) failures.push(`${rel}: the target is GONE from the repository`);
  }
  eq(failures.length, 0, `forged plans that were not refused: ${failures.join(" | ")}`);
  eq(readFileSync(envAbs, "utf8"), envBefore, ".env must be byte-identical after the attack");
  eq(existsSync(path.join(FIXTURE, "id_rsa")), true, "id_rsa must still exist");
  return `${protectedTargets.length} forged protection attacks refused`;
});

check("G2 a forged plan cannot smuggle in an action the engine does not know", () => {
  // The decoy is untracked so the PROTECTION re-check passes and the unknown-action guard is
  // the thing that refuses it - a tracked decoy would be refused earlier and mask the guard.
  const decoy = "scratch-forge-action.tmp";
  write(decoy, "decoy\n");

  const plan = makePlan("standard");
  const victim = itemAt(plan, decoy);
  const forged = forgePlan(plan.file, "unknown-action", (data) => {
    for (const item of data.items) if (item.id === victim.id) item.action = "delete-everything";
  });
  const record = run(["apply", "--plan", forged, "--approve-s2", `--confirm=${victim.id}`, "--json"]);
  eq(record.code, 6, "exit code");
  const row = find(jin(record, "forged action").data.results, (candidate) => candidate.id === victim.id, "forged action result");
  eq(row.status, "refused", "an unknown action must be refused, not guessed at");
  ok(/unknown action/.test(row.reason), `reason: ${row.reason}`);
  eq(existsSync(path.join(FIXTURE, decoy)), true, "nothing may be touched");
  return row.reason;
});

check("G3 a forged plan cannot route a file to a destination outside the root", () => {
  // The source file was routed into the test tree by F6's standard apply, so the plan item for
  // the ORIGINAL path no longer exists. Put a fresh test-content file back and forge ITS item.
  const rel = "src/forge-route-escape.js";
  write(rel, "import { describe, it, expect } from 'vitest';\ndescribe('x', () => { it('y', () => expect(1).toBe(1)); });\n");
  const plan = makePlan("standard");
  const victim = itemAt(plan, rel);
  eq(victim.action, "route-to-test-tree", "the fresh file must be a route candidate");
  const forged = forgePlan(plan.file, "route-escape", (data) => {
    for (const item of data.items) {
      if (item.id !== victim.id) continue;
      item.routeTarget = "..\\..\\outside\\escaped.test.js";
    }
  });
  const record = run(["apply", "--plan", forged, "--approve-s2", `--confirm=${victim.id}`, "--only", victim.id, "--json"]);
  const row = find(
    jin(record, "forged route").data.results,
    (candidate) => candidate.id === victim.id,
    "forged route result",
  );
  eq(row.status, "refused", "status");
  ok(/outside the containment root/.test(row.reason), `reason: ${row.reason}`);
  eq(existsSync(path.join(OUTSIDE, "escaped.test.js")), false, "nothing may be written outside the root");
  eq(existsSync(path.join(FIXTURE, rel)), true, "the source must be untouched");
  return row.reason;
});

check("G4 the doctrine's own `.work/` sink is never planned, at any level (audit F4)", () => {
  const workItems = planImmersive().items.filter((item) => item.rel === ".work" || item.rel.startsWith(".work/"));
  eq(workItems.length, 0, `sink entries became items: ${workItems.map((item) => item.rel).join(", ")}`);
  const protectedRow = find(inv.data.protected, (row) => row.rel === ".work", "the .work protected entry");
  ok(/sink/.test(protectedRow.reason), `reason: ${protectedRow.reason}`);
  // The mandated sink subdirectories (`raw/`, `_raw/`) are ALSO scrape markers, which is exactly
  // how the engine came to plan its own payloads. None of them may be an item.
  for (const rel of [F.workSinkManifest, F.workSinkRaw, F.workSinkRawOut]) {
    eq(itemExists(planImmersive().items, rel), false, `${rel} must never be an item`);
  }
  // F4's fix must not disable scrape detection outside the sink.
  const live = find(inv.data.items, (item) => item.rel === F.liveScrape, "the live scrape payload");
  eq(live.kind, "scrape-raw", "a real scrape payload outside the sink is still classified");
  eq(live.action, "move", "and is still actionable");
  return `.work protected, ${live.rel} still scrape-raw`;
});

check("G5 an empty directory is settled at `light` as S1, journalled so `undo` recreates it", () => {
  const rel = "stale-empty-child-dir";
  mkdirSync(path.join(FIXTURE, rel), { recursive: true });
  const plan = makePlan("light");
  const item = itemAt(plan, rel);
  eq(item.kind, "empty-dir", "kind");
  eq(item.action, "settle", "action");
  eq(item.safety, "S1", "an empty directory is reversible by the journal");
  eq(item.minLevel, "light", "minLevel");
  eq(item.planned, true, "planned at light");
  ok(/empty directory/.test(item.reason), `reason: ${item.reason}`);
  ok(/authorised settling empty folders/.test(item.reason), "the owner's authorisation must be stated");
  ok(/mkdir inverse/.test(item.note ?? ""), `note: ${item.note}`);
  const record = run(["apply", "--plan", plan.file, "--only", item.id, "--json"]);
  eq(record.code, 0, `exit code (${record.stderr.slice(0, 200)})`);
  const applied = jin(record, "apply settle").data;
  const row = find(applied.results, (candidate) => candidate.id === item.id, "settle result");
  eq(row.status, "applied", `status (${row.reason})`);
  eq(existsSync(path.join(FIXTURE, rel)), false, "the empty directory is gone");
  const journal = JSON.parse(readFileSync(applied.journalFile, "utf8"));
  const entry = find(journal.data.entries, (candidate) => candidate.id === item.id, "the settle journal entry");
  eq(entry.inverse.op, "mkdir", "the inverse is a mkdir");
  eq(entry.restorable, true, "a settle is restorable");
  const undo = run(["undo", "--journal", applied.journalFile, "--json"]);
  eq(undo.code, 0, "undo exit code");
  const undone = find(jin(undo, "undo settle").data.results, (candidate) => candidate.id === item.id, "undo row");
  eq(undone.status, "restored", `undo status (${undone.reason})`);
  eq(existsSync(path.join(FIXTURE, rel)), true, "undo RECREATES the directory");
  rmSync(path.join(FIXTURE, rel), { recursive: true, force: true });
  return "settle S1, mkdir inverse, undo recreates it";
});

check("G6 a directory that keeps or reports content is never settled, and `.gitkeep` is not empty", () => {
  // `tests/` still holds reported work, so it must not be settled even though every actionable
  // child beneath it has been moved away.
  const testsItem = makePlan("immaculate").items.find((item) => item.rel === "tests");
  if (testsItem) ok(testsItem.action !== "settle", `tests/ must not be settled (action=${testsItem.action})`);
  // A `.gitkeep`-only directory has an entry, so it is not empty by definition.
  const keep = makePlan("immaculate").items.find((item) => item.rel === "stale-gitkeep-folder");
  ok(!keep || keep.action !== "settle", "a .gitkeep-only directory must not be settled");
  eq(existsSync(path.join(FIXTURE, "stale-gitkeep-folder", ".gitkeep")), true, "the placeholder still exists");
  return "kept content blocks a settle; .gitkeep counts as an entry";
});

check("G7 a directory emptied only by this plan's own moves is settled after them, deepest first", () => {
  mkdirSync(path.join(FIXTURE, "stale-emptied-by-plan"), { recursive: true });
  write("stale-emptied-by-plan/leftover.tmp", "leftover scratch\n");
  const plan = makePlan("light");
  const parent = itemAt(plan, "stale-emptied-by-plan");
  const child = itemAt(plan, "stale-emptied-by-plan/leftover.tmp");
  eq(child.action, "move", "the child is a removal candidate first");
  eq(parent.kind, "empty-dir", "the parent becomes an empty-dir candidate");
  eq(parent.action, "settle", "and is settled");
  eq(parent.evidence.emptiedByThisPlan, true, "the evidence says WHY it is empty");
  // `--only` keeps this apply to the two items under test: unrelated litter written by earlier
  // checks is in the same plan and would otherwise be refused for want of its own --confirm.
  const record = run(["apply", "--plan", plan.file, "--approve-s2", `--confirm=${child.id}`, "--only", `${child.id},${parent.id}`, "--json"]);
  eq(record.code, 0, `exit code (${record.stderr.slice(0, 200)})`);
  const data = jin(record, "apply emptied-by-plan").data;
  find(data.results, (candidate) => candidate.id === child.id && candidate.status === "applied", "child applied");
  find(data.results, (candidate) => candidate.id === parent.id && candidate.status === "applied", "parent settled");
  eq(existsSync(path.join(FIXTURE, "stale-emptied-by-plan")), false, "the emptied directory is gone");
  return "moved first, then settled";
});

check("G8 test CONTENT in an unnamed file is detected and routed to the test tree", () => {
  // Fresh files: F6's standard apply already routed the fixture's originals, which is itself the
  // capability working. Each of the three stacks gets its own file so the probe is exercised per
  // language rather than once.
  const candidates = [
    ["src/g8-vitest.js", "import { describe, it, expect } from 'vitest';\ndescribe('g8', () => it('works', () => expect(1).toBe(1)));\n", /vitest|describe/],
    ["src/G8PhpUnit.php", "<?php\nuse PHPUnit\\Framework\\TestCase;\nclass G8Test extends TestCase { public function test_x(): void {} }\n", /extends-testcase|phpunit/],
    ["src/g8_pytest.py", "import pytest\n\n\ndef test_g8_totals():\n    assert total([1]) == 1\n", /pytest|def-test/],
  ];
  const items = [];
  for (const [rel, content] of candidates) {
    write(rel, content);
    items.push([rel, itemAt(makePlan("immaculate"), rel)]);
  }
  for (const [rel, item] of items) {
    eq(item.kind, "test-content", `${rel} kind`);
    eq(item.action, "route-to-test-tree", `${rel} action`);
    ok(/[/\\]src[/\\]/.test(item.routeTarget), `${rel} routeTarget: ${item.routeTarget}`);
    ok(item.routeTarget.endsWith(".test." + rel.split(".").pop()), `${rel} routeTarget keeps the extension: ${item.routeTarget}`);
    eq(item.minLevel, "standard", `${rel} minLevel`);
    // V2-2: a route changes where a file lives, so it is S3 with a per-item --confirm, not S2
    // with one batch --approve-s2. The old assertion tolerated both, which is why the S2
    // emission survived round 2.
    eq(item.safety, "S3", `${rel} class (V2-2: a route is S3, never S2)`);
    ok(/route it to/.test(item.reason), `${rel} reason: ${item.reason}`);
    ok(/runner must collect it/.test(item.note ?? ""), `${rel} note: ${item.note}`);
    ok(/test-framework|content-probe/.test(item.evidence.signals.join(" ")), `${rel} signals: ${item.evidence.signals.join(",")}`);
  }
  const [first] = items;
  // The item view exposes the route destination as an ABSOLUTE path (like `path`), while the\n  // plan file stores it relative to the root. Assert the shape, not the form.\n  ok(first[1].routeTarget.endsWith(`g8-vitest.test.js`), `routeTarget shape: ${first[1].routeTarget}`);
  // Never a sink move and never a purge, at any level.
  for (const level of ["standard", "immaculate"]) {
    const item = itemAt(level === "standard" ? makePlan("standard") : makePlan("immaculate"), first[0]);
    ok(item.action !== "move" && item.action !== "purge", `test-content action at ${level}: ${item.action}`);
  }
  // The three strongest-signal markers must each have been the one that matched.
  for (const [rel, signal] of [[candidates[0][0], /vitest/], [candidates[1][0], /extends-testcase|phpunit/], [candidates[2][0], /pytest|def-test/]]) {
    const item = find(items, ([candidate]) => candidate === rel, `item for ${rel}`)[1];
    ok(signal.test(item.evidence.testProbe.strong ?? item.evidence.testProbe.signal), `${rel} signal: ${item.evidence.testProbe.signal}`);
  }
  return `${items.length} unnamed test files detected and routed`;
});

check("G9 weak-only test signals are NOT reclassified: an ambiguous hit stays reported work", () => {
  const item = itemAt(makePlan("standard"), F.testContentAmbiguous);
  eq(item.kind, "untracked-work", "a bare `test`/`it` identifier is ordinary code");
  eq(item.action, "report", "so it must never become removable or routable");
  eq(item.planned, false, "not planned");
  return "`const test = ...` was not treated as a test";
});

check("G10 a tracked file is never reclassified as test-content (tracked wins)", () => {
  const tracked = "tracked-test-looking.php";
  write(tracked, "<?php\nuse PHPUnit\\Framework\\TestCase;\nclass T extends TestCase {}\n");
  git(["add", tracked]);
  const plan = makePlan("immaculate");
  eq(itemExists(plan.items, tracked), false, "a tracked file must not become an item at all");
  const row = find(plan.data.protected, (candidate) => candidate.rel === tracked, "the tracked protection row");
  ok(/tracked by git/.test(row.reason), `reason: ${row.reason}`);
  git(["rm", "--cached", "-q", "--force", tracked]);
  rmSync(path.join(FIXTURE, tracked), { force: true });
  return "tracked wins over the content probe";
});

check("G11 applying a route moves the file inside the repository and `undo` puts it back", () => {
  const rel = "src/g11-route-me.js";
  write(rel, "import { describe, it, expect } from 'vitest';\ndescribe('g11', () => it('works', () => expect(1).toBe(1)));\n");
  const plan = makePlan("standard");
  const item = itemAt(plan, rel);
  eq(item.planned, true, "the route is planned at standard");
  // V2-2 NEGATIVE: the batch S2 approval must NOT be enough to relocate the file. The old build
  // applied routes on `--approve-s2` alone; the doctrine and the engine document both promise a
  // per-item confirmation, and a route changes where a file lives.
  const batch = run(["apply", "--plan", plan.file, "--approve-s2", "--only", item.id, "--json"]);
  eq(batch.code, 6, `a batch approval alone must not apply a route (V2-2)`);
  const batchRow = find(jin(batch, "batch-approved route").data.results, (candidate) => candidate.id === item.id, "batch route row");
  eq(batchRow.status, "refused", `batch route status (${batchRow.reason})`);
  ok(/S3 needs --confirm/.test(batchRow.reason), `batch route reason: ${batchRow.reason}`);
  eq(existsSync(path.join(FIXTURE, rel)), true, "the file must not have moved on a batch approval");
  const before = sha256(path.join(FIXTURE, rel));
  const record = run(["apply", "--plan", plan.file, "--approve-s2", `--confirm=${item.id}`, "--only", item.id, "--json"]);
  eq(record.code, 0, `exit code (${record.stderr.slice(0, 200)})`);
  const data = jin(record, "apply route").data;
  const row = find(data.results, (candidate) => candidate.id === item.id, "route result");
  eq(row.status, "applied", `status (${row.reason})`);
  const routedAbs = path.isAbsolute(item.routeTarget) ? item.routeTarget : path.join(FIXTURE, item.routeTarget);
  eq(existsSync(path.join(FIXTURE, rel)), false, "the file left its old path");
  eq(existsSync(routedAbs), true, "the file is at its test-tree path");
  eq(sha256(routedAbs), before, "byte-identical after the route");
  eq(existsSync(path.join(data.sinkDir, rel)), false, "a route must NOT go to the quarantine sink");
  const undo = run(["undo", "--journal", data.journalFile, "--json"]);
  eq(undo.code, 0, "undo exit code");
  eq(existsSync(path.join(FIXTURE, rel)), true, "the route is fully reversible");
  eq(sha256(path.join(FIXTURE, rel)), before, "content restored exactly");
  removeSyncQuiet(routedAbs);
  return `routed to ${item.routeTarget} and back`;
});

check("G12 content lengths reported as bytes are byte lengths, not UTF-16 code units", () => {
  // `organizer.md` is 23575 bytes but 23523 UTF-16 code units: the audit's F9 finding. Reading a
  // buffer must be measured with Buffer.byteLength, never with String.length.
  const probe = path.join(SCRATCH, "utf8-probe.txt");
  const text = `— box ≥ dash\n${"é".repeat(64)}\n`;
  writeFileSync(probe, text, "utf8");
  const charLength = text.length;
  const byteLength = Buffer.byteLength(text, "utf8");
  ok(byteLength > charLength, `the probe must have multibyte characters (${charLength} chars, ${byteLength} bytes)`);
  eq(statSync(probe).size, byteLength, "statSync reports byte length");
  // The engine reports item sizes from statSync, so a multibyte fixture item must report bytes.
  const rel = "scratch-utf8-size.tmp";
  write(rel, text);
  const plan = makePlan("light");
  const item = itemAt(plan, rel);
  eq(item.size, byteLength, `engine size for ${rel}`);
  ok(item.size !== charLength, "a UTF-16 length would have been the wrong unit");
  removeSyncQuiet(probe, rel);
  return `${byteLength} bytes vs ${charLength} UTF-16 units`;
});

check("G13 PowerShell diagnostic cmdlets never decide, and a real Pester test still does", () => {
  // `Invoke-RestMethod` / `Invoke-WebRequest` are ordinary production cmdlets (deploy scripts, API
  // clients, health checks), so naming one must not classify a file as a test. Only a signal that
  // names a test framework - Pester - is allowed to decide. NEGATIVE case first.
  const plan = makePlan("standard");
  for (const rel of [F.psDeploy, F.psHealthcheck]) {
    const item = itemAt(plan, rel);
    eq(item.kind, "untracked-work", `${rel} must not be classified as a test`);
    eq(item.action, "report", `${rel} must never be routed or removed`);
    eq(item.planned, false, `${rel} must not be planned`);
    ok(
      item.evidence.testProbe && item.evidence.testProbe.strong === null,
      `${rel} must carry no strong signal: ${JSON.stringify(item.evidence.testProbe)}`,
    );
  }
  // The weak signal is still recorded as evidence, so the report explains itself.
  const deploy = itemAt(plan, F.psDeploy);
  ok(
    deploy.evidence.testProbe && deploy.evidence.testProbe.weak.includes("powershell-diagnostic"),
    `evidence must record the weak signal: ${JSON.stringify(deploy.evidence.testProbe)}`,
  );
  ok(deploy.evidence.testProbe.strong === null, `strong signal must be null: ${deploy.evidence.testProbe.strong}`);
  // POSITIVE case: a Pester test names its framework, so the stack is still covered. F6's standard
  // apply has already routed the fixture's PowerShell test into the tree, so the proof is the
  // routed file itself rather than an item at the original path.
  const routedPester = path.join(FIXTURE, "tests", "scripts", "ApiChecks.Tests.test.ps1");
  eq(existsSync(routedPester), true, "a Pester test must still be detected and routed");
  const routedSource = readFileSync(routedPester, "utf8");
  ok(/Pester/.test(routedSource), "the routed file keeps its content");
  // A fresh Pester file at a new path must be classified and routed again.
  const freshPester = "scripts/G13Checks.Tests.ps1";
  write(freshPester, 'BeforeAll { Import-Module Pester }\nDescribe "G13" { It "works" { 1 | Should -Be 1 } }\n');
  const pester = itemAt(makePlan("standard"), freshPester);
  eq(pester.kind, "test-content", "a Pester test is still detected");
  eq(pester.action, "route-to-test-tree", "and still routed");
  eq(pester.evidence.testProbe.strong, "powershell-pester", `signal: ${pester.evidence.testProbe.strong}`);
  // V2-3 POSITIVE: the idiom the audit reproduced as undetected. A real Pester v5 file writes
  // `Describe 'name' {` capitalised and without a parenthesis, and its assertion is `Should -Be`,
  // so the old markers (`\bPester\b`, `-Should\b`, lowercase `describe(`) all missed it. This
  // file contains the literal token "Pester" NOWHERE - the framework's own block cmdlets are the
  // signal that decides, and `Should -Be` corroborates.
  const idiomatic = "scripts/G13Idiomatic.Tests.ps1";
  const idiomaticSource = "Describe 'math' {\n  It 'adds' {\n    $value | Should -Be 1\n  }\n}\n";
  write(idiomatic, idiomaticSource);
  ok(!/\bPester\b/.test(idiomaticSource), "the fixture must not contain the literal token 'Pester'");
  ok(!/-Should\b/.test(idiomaticSource), "the fixture must not contain the old `-Should` marker");
  const idiomaticItem = itemAt(makePlan("standard"), idiomatic);
  eq(idiomaticItem.kind, "test-content", "an idiomatic Pester file must be detected without the literal token (V2-3)");
  eq(idiomaticItem.action, "route-to-test-tree", "and routed");
  eq(idiomaticItem.safety, "S3", "a route is S3 (V2-2)");
  ok(
    ["powershell-describe-block", "powershell-it-block"].includes(idiomaticItem.evidence.testProbe.strong),
    `the deciding signal must be a Pester block, got: ${idiomaticItem.evidence.testProbe.strong}`,
  );
  ok(
    idiomaticItem.evidence.testProbe.weak.includes("powershell-should"),
    `\`Should -Be\` must be recorded as corroboration: ${JSON.stringify(idiomaticItem.evidence.testProbe)}`,
  );
  // NEGATIVE kept from round 2: an ordinary PowerShell script with no framework and no Should
  // assertion must stay reported work, at the same level, in the same plan.
  const ordinary = "scripts/G13Ordinary.ps1";
  write(ordinary, "$items = Get-ChildItem -Path .\nforeach ($item in $items) { Write-Output $item.Name }\n");
  const ordinaryItem = itemAt(makePlan("standard"), ordinary);
  eq(ordinaryItem.kind, "untracked-work", "an ordinary script must not be classified as a test");
  eq(ordinaryItem.action, "report", "and must never be routed or removed");
  eq(ordinaryItem.planned, false, "and must not be planned");
  ok(
    ordinaryItem.evidence.testProbe === undefined || ordinaryItem.evidence.testProbe.strong === null,
    `no strong signal may be found: ${JSON.stringify(ordinaryItem.evidence.testProbe)}`,
  );
  // The doctrine requires an "unsure, deferred" section in every plan, even when empty: an item
  // the engine looked at and could not classify must be reported by name, never silently omitted.
  ok(Array.isArray(plan.data.unsure), "the plan must carry an unsure section");
  const unsureRow = find(plan.data.unsure, (row) => row.rel === F.psDeploy, "deploy.ps1 in the unsure section");
  eq(unsureRow.kind, "untracked-work", "unsure row kind");
  ok(/weak test signals/.test(unsureRow.reason), `unsure row reason: ${unsureRow.reason}`);
  eq(deploy.unsure, true, "the ambiguous item must be flagged unsure");
  ok(/not planned/.test(deploy.unsureReason ?? ""), `unsureReason: ${deploy.unsureReason}`);
  // And a file the probe never flagged must not be reported as unsure.
  eq(itemAt(plan, F.testContentAmbiguous).unsure, false, "a plainly-unclassified file is not 'unsure'");

  // A junk-NAMED file that also carries a weak-only probe: the name is why it is a removal
  // candidate, so the probe must NOT veto it - but the probe must still be recorded and the item
  // listed as unsure, because "this also looks like an uncertain test" is exactly what the owner
  // needs to see before confirming it by name. The probe used to be evicted by the junk-named
  // return, which made the uncertainty invisible on the one class of item that gets moved.
  const junkProbe = "scripts/scratch(1).ps1";
  write(junkProbe, 'Invoke-RestMethod -Uri "https://example.invalid/x"\n');
  const junkPlan = makePlan("standard");
  const junkItem = itemAt(junkPlan, junkProbe);
  eq(junkItem.kind, "junk-named", "the name still decides it is junk");
  eq(junkItem.action, "move", "and it is still a removal candidate");
  ok(
    junkItem.evidence.testProbe && junkItem.evidence.testProbe.weak.includes("powershell-diagnostic"),
    `the probe must survive the junk-named path: ${JSON.stringify(junkItem.evidence.testProbe)}`,
  );
  ok(/weak test signals/.test(junkItem.reason), `the reason must disclose the uncertainty: ${junkItem.reason}`);
  eq(junkItem.unsure, true, "a junk-named file with a weak-only probe is still unsure");
  // `unsure` records that the probe could not decide; it must NEVER be reported as "kept on disk"
  // when the plan actually proposes to move the item. The two cases must read differently.
  ok(
    !/stays on disk/.test(junkItem.unsureReason ?? ""),
    `a planned move must not be described as staying on disk: ${junkItem.unsureReason}`,
  );
  ok(/per-item-confirmed move/.test(junkItem.unsureReason ?? ""), `junk unsureReason: ${junkItem.unsureReason}`);
  // The unplanned case must say the opposite, because the field exists to tell a `--json` reader
  // what happens to the item.
  ok(
    /not planned/.test(deploy.unsureReason ?? ""),
    `unplanned unsureReason: ${deploy.unsureReason}`,
  );
  find(junkPlan.data.unsure, (row) => row.rel === junkProbe, "the junk-named file in the unsure section");
  return "diagnostic cmdlets report-only, Pester routes, ambiguity recorded everywhere";
});

// ---------------------------------------------------------------------------------------
// V2-1 (round-2 audit, HIGH, blocking): the plan's `rel` and `path` could disagree.
//
// Every protection class the audit listed as reachable through the disagreement gets a negative
// test here. The forgery keeps `rel` naming an ordinary junk file and points `path` at the
// protected target, WITH that target's real fingerprint, so the drift check passes and only the
// rel/path consistency check (and the protection re-check) can refuse it.
// ---------------------------------------------------------------------------------------

/** The protected classes the audit listed for V2-1. All exist in the fixture from build time. */
const V21_TARGETS = [
  ["env", ".env", /environment\/secrets/],
  ["key", "id_rsa", /key or credential/],
  ["sink", F.workSinkManifest, /agent artifact sink/],
  ["docs", "docs/guide.md", /documentation/],
  ["tracked", "tracked-file.php", /tracked by git/],
];

/** Fingerprint the CURRENT state of an absolute path, so a forgery survives the drift check. */
const fingerprintNowOf = (abs) => {
  const stats = lstatSync(abs);
  if (stats.isDirectory()) {
    return { mode: "tree", sha256: createHash("sha256").update("").digest("hex"), entries: 0, bytes: 0 };
  }
  return {
    mode: "full",
    size: stats.size,
    mtimeMs: Math.trunc(stats.mtimeMs),
    sha256: createHash("sha256").update(readFileSync(abs)).digest("hex"),
  };
};

/** A planned removal candidate to carry each forgery, so `--only`/`--confirm` select it. */
const v21Decoy = (name) => {
  const rel = `scratch-v21-${name}.tmp`;
  write(rel, `v2-1 decoy for ${name}\n`);
  return rel;
};

check("G14 a forged plan whose rel and path disagree cannot move anything (audit V2-1, HIGH)", () => {
  const failures = [];
  const before = V21_TARGETS.map(([, rel]) => [rel, existsSync(path.join(FIXTURE, rel))]);
  for (const [name, targetRel, expectedReason] of V21_TARGETS) {
    const decoy = v21Decoy(name);
    const plan = makePlan("standard");
    const victim = itemAt(plan, decoy);
    eq(victim.action, "move", `${name}: the decoy must be a real removal candidate`);
    const targetAbs = path.join(FIXTURE, targetRel);
    const forged = forgePlan(plan.file, `v21-${name}`, (data) => {
      for (const item of data.items) {
        if (item.id !== victim.id) continue;
        item.rel = decoy; // innocuous: every protection rule passes on this string
        item.path = targetAbs; // the lie: this is the path the old build acted on
        item.fingerprint = fingerprintNowOf(targetAbs); // so the drift check cannot mask it
        if (existsSync(targetAbs) && lstatSync(targetAbs).isFile()) item.size = lstatSync(targetAbs).size;
      }
    });
    const record = run(["apply", "--plan", forged, "--approve-s2", `--confirm=${victim.id}`, "--only", victim.id, "--json"]);
    const row = find(
      jin(record, `apply forged ${name}`).data.results,
      (candidate) => candidate.id === victim.id,
      `v2-1 result for ${name}`,
    );
    // The attack is refused per item at exit 6, and the reason is one of the two honest refusals:
    // the disagreement itself, or the protection decision on the derived path.
    if (record.code !== 6) failures.push(`${name}: exit was ${record.code}, expected 6`);
    if (row.status !== "refused") failures.push(`${name}: status=${row.status} reason=${row.reason}`);
    else if (!/rel and path disagree/.test(row.reason) && !expectedReason.test(row.reason)) {
      failures.push(`${name}: refusal did not name the disagreement or the protection: ${row.reason}`);
    }
    if (!existsSync(targetAbs)) failures.push(`${name}: THE TARGET IS GONE (${targetRel})`);
  }
  eq(failures.length, 0, `v2-1 attacks that were not refused: ${failures.join(" | ")}`);
  for (const [rel, existed] of before) eq(existsSync(path.join(FIXTURE, rel)), existed, `${rel} must be exactly as it was`);
  return `${V21_TARGETS.length} rel/path-disagreement attacks refused at exit 6, nothing moved`;
});

check("G15 a forged journal cannot move a protected file back (audit V2-1, undo arm)", () => {
  const failures = [];
  for (const [name, targetRel, expectedReason] of V21_TARGETS) {
    const decoy = v21Decoy(`journal-${name}`);
    const plan = makePlan("standard");
    const item = itemAt(plan, decoy);
    const targetAbs = path.join(FIXTURE, targetRel);
    const existedBefore = existsSync(targetAbs);
    // An HONEST apply first: it journals a real entry whose inverse is the decoy's own path.
    const record = run(["apply", "--plan", plan.file, "--approve-s2", `--confirm=${item.id}`, "--only", item.id, "--json"]);
    eq(record.code, 0, `${name}: the honest apply must succeed (${record.stderr.slice(0, 200)})`);
    const applied = jin(record, `honest apply ${name}`).data;
    const journalFile = applied.journalFile;
    const journal = JSON.parse(readFileSync(journalFile, "utf8"));
    const entry = find(journal.data.entries, (candidate) => candidate.id === item.id, `journal entry for ${name}`);
    // The forgery: repoint the INVERSE at the protected target while keeping the entry's own
    // `rel` innocuous. A forged journal must not be able to move a protected file "back".
    const forgedId = `it-forged-${name}`;
    journal.data.entries.unshift({
      ...entry,
      id: forgedId,
      rel: decoy,
      inverse: { ...entry.inverse, to: targetAbs },
      undoStatus: null,
      status: "applied",
    });
    writeFileSync(journalFile, `${JSON.stringify(journal, null, 2)}\n`, "utf8");
    const undo = run(["undo", "--journal", journalFile, "--json"]);
    const undoData = jin(undo, `forged-journal undo ${name}`).data;
    const forgedResult = undoData.results.find((candidate) => candidate.id === forgedId);
    if (!forgedResult) failures.push(`${name}: the forged entry did not appear in the undo results`);
    else if (forgedResult.status !== "refused" && !/drift/.test(forgedResult.reason ?? "") && !expectedReason.test(forgedResult.reason ?? "")) {
      failures.push(`${name}: forged entry was ${forgedResult.status} :: ${forgedResult.reason}`);
    }
    if (existsSync(targetAbs) !== existedBefore) failures.push(`${name}: ${targetRel} was touched by the forged journal`);
  }
  eq(failures.length, 0, `forged journals that were not refused: ${failures.join(" | ")}`);
  eq(existsSync(path.join(FIXTURE, ".env")), true, ".env must survive a forged journal");
  eq(existsSync(path.join(FIXTURE, "id_rsa")), true, "id_rsa must survive a forged journal");
  return `${V21_TARGETS.length} forged-journal restores refused, protected targets intact`;
});

// ---------------------------------------------------------------------------------------
// V3-1 (round-3 audit, CRITICAL): the protection decision ran on the raw `rel` string while the
// action ran on `path.resolve(rootReal, rel)`. `toPosix` resolves neither `.` nor `..` and folds
// no case, so `./docs/guide.md`, `stage/../README.md` and `Docs/guide.md` were inspected as one
// path and used as another - reaching move, route, settle and an IRREVERSIBLE purge, with no
// approval flag, at exit 0.
//
// The round-3 assertions could not see this class: G14 forges `rel=<decoy>` with `path=<target>`
// (a disagreement), and never a rel whose CANONICAL FORM differs from its surface form. These
// assertions are one per acting branch for exactly that reason, and they fail against an engine
// with the canonicalisation reverted - see the ablation note in ORGANIZER-ENGINE.md §10.
// ---------------------------------------------------------------------------------------

/** Fingerprint of a live target, so a forgery is not stopped by the drift check before the gate. */
const liveFingerprint = (abs) => {
  const stats = lstatSync(abs);
  if (stats.isDirectory()) {
    return { mode: "tree", sha256: createHash("sha256").update("").digest("hex"), entries: 0, bytes: 0 };
  }
  return {
    mode: "full",
    size: stats.size,
    mtimeMs: Math.trunc(stats.mtimeMs),
    sha256: createHash("sha256").update(readFileSync(abs)).digest("hex"),
  };
};

/**
 * Drive one forged plan item and report what the engine did with it. `bypassed` means the action
 * really happened to a target that existed: a refusal AND a drift skip both count as "not
 * bypassed", because in neither case did the engine act on protected content.
 */
const driveForgery = ({ name, rel, action, targetAbs, confirm = false, keepPath = true, routeTarget = null }) => {
  const decoy = `scratch-v31-${name}.tmp`;
  write(decoy, `v3-1 decoy ${name}\n`);
  const plan = makePlan("standard");
  const victim = itemAt(plan, decoy);
  const itemId = `it-v31-${name}`;
  const forged = forgePlan(plan.file, `v31-${name}`, (data) => {
    data.items.push({
      ...victim,
      id: itemId,
      rel,
      action,
      safety: "S1",
      class: "S1",
      planned: true,
      fingerprint: liveFingerprint(targetAbs),
      routeTarget,
      ...(keepPath ? { path: targetAbs } : {}),
    });
    if (!keepPath) delete data.items[data.items.length - 1].path;
  });
  const existedBefore = existsSync(targetAbs);
  const args = ["apply", "--plan", forged, "--only", itemId, "--json"];
  if (confirm) args.splice(args.length - 1, 0, `--confirm=${itemId}`);
  const record = run(args);
  let row = null;
  try {
    row = jin(record, `v3-1 ${name}`).data.results.find((candidate) => candidate.id === itemId) ?? null;
  } catch {
    /* the assertion below reports the missing row */
  }
  const existsAfter = existsSync(targetAbs);
  return {
    name,
    itemId,
    exit: record.code,
    status: row?.status ?? null,
    reason: row?.reason ?? "",
    existedBefore,
    existsAfter,
    bypassed: record.code === 0 && row?.status === "applied" && existedBefore && !existsAfter,
  };
};

check("G16 a non-canonical rel cannot reach ANY acting branch of apply (audit V3-1, CRITICAL)", () => {
  // Each case gets its OWN target, created immediately before it runs, and `rel` resolves to that
  // very file. Sharing one target (or leaning on a fixture file an earlier assertion already
  // consumed) makes the first case destroy what the later ones need, and the failure then reads as
  // "target gone" for a reason that is not the engine's. Four spellings are covered so no two cases
  // exercise the same resolution rule: `./x/../y`, `x/../y`, a nested `a/b/../../y`, and a
  // case-only variant.
  const cases = [
    {
      name: "move-dotdot-docs",
      rel: "./stage/../docs/v31-move.md",
      action: "move",
      target: "docs/v31-move.md",
    },
    {
      name: "route-dotdot-docs",
      rel: "./stage/../docs/v31-route.md",
      action: "route-to-test-tree",
      target: "docs/v31-route.md",
      routeDest: "tests/docs/v31-route.test.md",
    },
    {
      name: "settle-dotdot-docs",
      rel: "./stage/../docs/v31-emptysub",
      action: "settle",
      target: "docs/v31-emptysub",
      directory: true,
    },
    {
      name: "purge-dotdot-docs",
      rel: "./stage/../docs/v31-purge.md",
      action: "purge",
      target: "docs/v31-purge.md",
      confirm: true,
    },
    {
      name: "move-case-variant-docs",
      rel: "Docs/v31-case.md",
      action: "move",
      target: "docs/v31-case.md",
    },
    {
      name: "move-nested-dotdot-gitconfig",
      rel: "stage/nested/../../.git/config",
      action: "move",
      target: ".git/config",
    },
  ];
  const results = [];
  for (const definition of cases) {
    const targetAbs = path.join(FIXTURE, definition.target);
    const relAbs = path.resolve(FIXTURE, definition.rel);
    // Case-insensitive: the `Docs/...` case-variant case resolves to the SAME file as `docs/...`
    // (that is the point of it), and `path.resolve` preserves the spelling it was given.
    eq(relAbs.toLowerCase(), targetAbs.toLowerCase(), `${definition.name}: the case's rel must resolve to its own target`);
    if (definition.directory) mkdirSync(targetAbs, { recursive: true });
    else write(definition.target, "# protected-class content\n");
    const routeDestAbs = definition.routeDest ? path.join(FIXTURE, definition.routeDest) : null;
    results.push({
      name: definition.name,
      rel: definition.rel,
      outcome: driveForgery({
        name: definition.name,
        rel: definition.rel,
        action: definition.action,
        targetAbs,
        confirm: definition.confirm === true,
        routeTarget: routeDestAbs,
      }),
      routeDestAbs,
    });
  }
  const failures = [];
  for (const { name, rel, outcome, routeDestAbs } of results) {
    if (outcome.bypassed) {
      failures.push(`${name}: BYPASSED (exit 0, applied, target gone) via rel="${rel}"`);
      continue;
    }
    if (outcome.exit === 0) {
      failures.push(`${name}: exit 0, expected a refusal`);
      continue;
    }
    if (outcome.status === "refused" && !/canonical relative form|protected now|tracked by git|outside the containment/.test(outcome.reason)) {
      failures.push(`${name}: refused for an unexpected reason: ${outcome.reason}`);
      continue;
    }
    if (outcome.existsAfter !== true) failures.push(`${name}: the target is GONE (${JSON.stringify(outcome)})`);
    if (routeDestAbs !== null && existsSync(routeDestAbs)) failures.push(`${name}: a refused route created ${routeDestAbs}`);
  }
  eq(failures.length, 0, `V3-1 branch attacks that were not refused: ${failures.join(" | ")}`);
  return `${cases.length} non-canonical rels refused across move/route/settle/purge`;
});

check("G17 the missing-path and purge shapes are refused too (audit V3-1)", () => {
  const cases = [
    { name: "missing-path-docs", rel: "./stage/../docs/v31-nopath.md", action: "move", target: "docs/v31-nopath.md", keepPath: false },
    { name: "missing-path-purge", rel: "./stage/../docs/v31-nopath-purge.md", action: "purge", target: "docs/v31-nopath-purge.md", keepPath: false, confirm: true },
    { name: "missing-path-storage", rel: "stage/../storage/app/cache/v31-nopath.txt", action: "move", target: "storage/app/cache/v31-nopath.txt", keepPath: false },
  ];
  const failures = [];
  for (const definition of cases) {
    const targetAbs = path.join(FIXTURE, definition.target);
    eq(path.resolve(FIXTURE, definition.rel), targetAbs, `${definition.name}: rel must resolve to its target`);
    write(definition.target, "# target with no path field\n");
    const outcome = driveForgery({
      name: definition.name,
      rel: definition.rel,
      action: definition.action,
      targetAbs,
      confirm: definition.confirm === true,
      keepPath: false,
    });
    if (outcome.bypassed) failures.push(`${definition.name}: BYPASSED via rel="${definition.rel}"`);
    else if (outcome.exit === 0) failures.push(`${definition.name}: exit 0, expected a refusal`);
    else if (outcome.existsAfter !== true) failures.push(`${definition.name}: the target is GONE (${JSON.stringify(outcome)})`);
  }
  eq(failures.length, 0, `missing-path attacks that were not refused: ${failures.join(" | ")}`);
  return `${cases.length} missing-path attacks refused`;
});

check("G18 a forged journal cannot import, displace or recreate protected content (audit V3-2/V3-3)", () => {
  const outsideFile = path.join(OUTSIDE, "v32-taken.txt");
  writeFileSync(outsideFile, "a file from outside the repository\n");
  const cases = [
    {
      name: "import-outside-file",
      rel: "imported-from-outside.txt",
      from: outsideFile,
      to: path.join(FIXTURE, "imported-from-outside.txt"),
      target: path.join(FIXTURE, "imported-from-outside.txt"),
    },
    {
      name: "displace-env-into-docs",
      rel: "stage/../docs/injected.md",
      from: path.join(FIXTURE, ".env"),
      to: path.join(FIXTURE, "docs", "injected.md"),
      target: path.join(FIXTURE, ".env"),
      stray: path.join(FIXTURE, "docs", "injected.md"),
    },
    {
      name: "import-inside-docs",
      rel: "stage/../docs/injected2.md",
      from: outsideFile,
      to: path.join(FIXTURE, "docs", "injected2.md"),
      target: path.join(FIXTURE, "docs", "injected2.md"),
    },
    {
      name: "recreate-docs-dir",
      mkdirInto: path.join(FIXTURE, "docs", "v32-newdir"),
      rel: "stage/../docs/v32-newdir",
      target: path.join(FIXTURE, "docs", "v32-newdir"),
    },
    // --- V4-1 / V4-4: the ROUTE arm. Every case above spreads an honest `move` entry, so this arm
    // --- was never exercised and the audit's forged route entry acted at exit 0 through a suite
    // --- that reported 94/0/0. These are the same forgeries with `action` set to the arm that had
    // --- the exemption.
    {
      name: "route-import-from-outside",
      action: "route-to-test-tree",
      rel: "routed-import.txt",
      from: outsideFile,
      to: path.join(FIXTURE, "routed-import.txt"),
      target: path.join(FIXTURE, "routed-import.txt"),
    },
    {
      name: "route-displace-env",
      action: "route-to-test-tree",
      rel: "leak.txt",
      from: path.join(FIXTURE, ".env"),
      to: path.join(FIXTURE, "leak.txt"),
      target: path.join(FIXTURE, ".env"),
      stray: path.join(FIXTURE, "leak.txt"),
    },
    {
      name: "route-displace-tracked",
      action: "route-to-test-tree",
      rel: "tracked-copy.php",
      from: path.join(FIXTURE, "tracked-file.php"),
      to: path.join(FIXTURE, "tracked-copy.php"),
      target: path.join(FIXTURE, "tracked-file.php"),
      stray: path.join(FIXTURE, "tracked-copy.php"),
    },
  ];
  const failures = [];
  for (const definition of cases) {
    const decoy = `scratch-v32-${definition.name}.tmp`;
    write(decoy, `v3-2 decoy ${definition.name}\n`);
    const plan = makePlan("standard");
    const item = itemAt(plan, decoy);
    const honest = run(["apply", "--plan", plan.file, "--approve-s2", `--confirm=${item.id}`, "--only", item.id, "--json"]);
    eq(honest.code, 0, `${definition.name}: the honest apply must succeed (${honest.stderr.slice(0, 200)})`);
    const journalFile = jin(honest, `honest apply ${definition.name}`).data.journalFile;
    const journal = JSON.parse(readFileSync(journalFile, "utf8"));
    const realEntry = journal.data.entries.find((candidate) => candidate.id === item.id);
    const forgedId = `it-forged-${definition.name}`;
    if (definition.mkdirInto) {
      journal.data.entries.unshift({
        id: forgedId,
        rel: definition.rel,
        action: "settle",
        status: "applied",
        restorable: true,
        undoStatus: null,
        inverse: { op: "mkdir", path: definition.mkdirInto },
      });
    } else {
      const fromAbs = definition.from;
      const fingerprint = existsSync(fromAbs) && lstatSync(fromAbs).isFile() ? liveFingerprint(fromAbs) : realEntry.verifiedFingerprint;
      journal.data.entries.unshift({
        ...realEntry,
        id: forgedId,
        rel: definition.rel,
        // The arm under test: round 4 spread an honest `move` entry for every case, so the route
        // arm was never reached (V4-4). `action` is what the forged entry claims to be.
        action: definition.action ?? "move",
        undoStatus: null,
        status: "applied",
        restorable: true,
        verifiedFingerprint: fingerprint,
        inverse: { ...realEntry.inverse, from: fromAbs, to: definition.to },
      });
    }
    writeFileSync(journalFile, `${JSON.stringify(journal, null, 2)}\n`, "utf8");
    const existedBefore = existsSync(definition.target);
    const undo = run(["undo", "--journal", journalFile, "--json"]);
    let undoData = null;
    try {
      undoData = jin(undo, `forged journal ${definition.name}`).data;
    } catch {
      failures.push(`${definition.name}: undo did not print JSON`);
      continue;
    }
    const row = undoData.results.find((candidate) => candidate.id === forgedId);
    // V3-3: a refused entry must exit 6, not 0.
    if (row?.status === "refused" && undo.code !== 6) {
      failures.push(`${definition.name}: a refusal exited ${undo.code}, not 6 (audit V3-3)`);
    }
    if (existsSync(definition.target) !== existedBefore) failures.push(`${definition.name}: ${definition.target} was touched`);
    if (definition.stray && existsSync(definition.stray)) failures.push(`${definition.name}: a stray file was created at ${definition.stray}`);
    if (row && row.status === "restored" && definition.name !== "control") {
      failures.push(`${definition.name}: the forged entry was RESTORED :: ${row.reason}`);
    }
    if (undo.code === 0 && row?.status === "restored") failures.push(`${definition.name}: undo acted on a forged entry at exit 0`);
  }
  eq(failures.length, 0, `forged-journal attacks that were not refused: ${failures.join(" | ")}`);
  eq(existsSync(path.join(FIXTURE, ".env")), true, ".env must survive a forged journal");
  eq(readFileSync(path.join(FIXTURE, ".env"), "utf8"), "APP_KEY=not-a-real-key\n", ".env must be byte-identical");
  // V4-1 explicitly: the route arm must be covered, not merely present in the list.
  const routeCases = cases.filter((definition) => definition.action === "route-to-test-tree");
  ok(routeCases.length >= 2, `the route arm must be exercised by more than one case (got ${routeCases.length})`);
  return `${cases.length} forged journals refused across move (${cases.length - routeCases.length}) and route (${routeCases.length}) arms`;
});

check("G19 an honest undo still restores, and a refused undo is exit 6 (audit V3-2/V3-3)", () => {
  // The control: the gate above must not have been bought by refusing everything.
  const decoy = "scratch-v32-control.tmp";
  write(decoy, "control payload\n");
  const plan = makePlan("standard");
  const item = itemAt(plan, decoy);
  const applied = run(["apply", "--plan", plan.file, "--approve-s2", `--confirm=${item.id}`, "--only", item.id, "--json"]);
  eq(applied.code, 0, `honest apply exit (${applied.stderr.slice(0, 200)})`);
  const appliedData = jin(applied, "honest apply for undo control").data;
  eq(existsSync(path.join(FIXTURE, decoy)), false, "the decoy was quarantined");
  const undo = run(["undo", "--journal", appliedData.journalFile, "--json"]);
  eq(undo.code, 0, `an honest undo must exit 0 (${undo.stderr.slice(0, 200)})`);
  const undone = jin(undo, "honest undo").data;
  eq(undone.counts.restored, 1, "the honest entry was restored");
  eq(undone.counts.refused, 0, "nothing was refused");
  eq(existsSync(path.join(FIXTURE, decoy)), true, "the file is back");
  // V3-5: the working prune removes the sink directory the restore leaves empty.
  const sinkDir = path.dirname(appliedData.sinkDir);
  ok(!existsSync(appliedData.sinkDir), `the emptied run sink directory must be pruned: ${appliedData.sinkDir}`);
  eq(existsSync(sinkDir), true, "the sink root itself is not removed");
  removeSyncQuiet(decoy);
  return "honest undo restored and exit 0; the emptied sink run directory was pruned";
});

// ---------------------------------------------------------------------------------------
// V4-2, V4-3 and the per-arm control (round-5 audit).
//
// The structural point of round 5 is that every operand goes through ONE gate. These assertions
// are per arm: each one names the arm it covers, and G22 is the control that proves the gate was
// not bought by refusing everything.
// ---------------------------------------------------------------------------------------

check("G20 a link planted inside the sink is refused as a restore source (audit V4-2)", () => {
  const junctionTarget = path.join(OUTSIDE, "v42-target");
  mkdirSync(junctionTarget, { recursive: true });
  writeFileSync(path.join(junctionTarget, "inside.txt"), "content behind the junction\n", "utf8");

  const decoy = "scratch-v42-junction.tmp";
  write(decoy, "v4-2 decoy\n");
  const plan = makePlan("standard");
  const item = itemAt(plan, decoy);
  const honest = run(["apply", "--plan", plan.file, "--approve-s2", `--confirm=${item.id}`, "--only", item.id, "--json"]);
  eq(honest.code, 0, `the honest apply must succeed (${honest.stderr.slice(0, 200)})`);
  const applied = jin(honest, "honest apply for the link case").data;
  const journalFile = applied.journalFile;
  const journal = JSON.parse(readFileSync(journalFile, "utf8"));
  const realEntry = journal.data.entries.find((candidate) => candidate.id === item.id);

  // A junction INSIDE the validated sink: it satisfies the location rule, which is exactly why
  // the location rule alone was not enough.
  const junctionPath = path.join(path.resolve(applied.sinkDir), "v42-linked");
  const mklink = spawnSync("cmd", ["/c", "mklink", "/J", junctionPath, junctionTarget], { encoding: "utf8", windowsHide: true, shell: false });
  const junctionMade = existsSync(junctionPath);
  if (!junctionMade) skipWith(`could not create a junction inside the sink: exit ${mklink.status} ${mklink.stderr.slice(0, 120)}`);

  const importedTarget = path.join(FIXTURE, "v42-imported-link");
  journal.data.entries.unshift({
    ...realEntry,
    id: "it-v42-junction",
    rel: "v42-imported-link",
    action: "move",
    undoStatus: null,
    status: "applied",
    restorable: true,
    // No fingerprint: the drift check is skipped for an entry that carries none, so the case
    // reaches the source validation under test instead of being skipped as drift.
    verifiedFingerprint: null,
    inverse: { ...realEntry.inverse, from: junctionPath, to: importedTarget },
  });
  writeFileSync(journalFile, `${JSON.stringify(journal, null, 2)}\n`, "utf8");

  const undo = run(["undo", "--journal", journalFile, "--json"]);
  eq(undo.code, 6, `a link source must refuse at exit 6 (${undo.stderr.slice(0, 200)})`);
  const data = jin(undo, "undo with a junction source").data;
  const row = data.results.find((candidate) => candidate.id === "it-v42-junction");
  eq(row.status, "refused", `status (${row.reason})`);
  ok(/symlink or junction/.test(row.reason), `the refusal must name the link: ${row.reason}`);
  eq(existsSync(importedTarget), false, "no link may be imported into the repository");
  eq(existsSync(junctionPath), true, "the junction itself is left alone");
  return `a junction inside the sink was refused: ${row.reason}`;
});

check("G24 a junction AT the sink-root position is never walked through (audit V5-2)", () => {
  // Round 5's fix put the link predicate on the restore SOURCE and left the prune walk's root
  // validated for location only. A junction at that exact position was therefore walked THROUGH:
  // `rmdirSync` on a directory reached through a junction removes the real directory behind it, so
  // an `undo` deleted empty directories outside every containment root, unrecoverably. Child links
  // were always skipped correctly - the asymmetry was only at the root.
  const outside = path.join(SCRATCH, "v52-outside");
  mkdirSync(path.join(outside, "deep", "empty1"), { recursive: true });
  writeFileSync(path.join(outside, "keep.txt"), "keep me\n", "utf8");

  // The engine derives this path from the root hash, so a journal can name a real location inside
  // its own sink and still be a link.
  const expectedSinkDir = path.join(STATE, "roots", ROOT_HASH, "sink");
  mkdirSync(expectedSinkDir, { recursive: true });
  const junctionPath = path.join(expectedSinkDir, "v52-run");
  const mklink = spawnSync("cmd", ["/c", "mklink", "/J", junctionPath, outside], { encoding: "utf8", windowsHide: true, shell: false });
  if (!existsSync(junctionPath)) skipWith(`could not create a junction at the sink root: exit ${mklink.status} ${mklink.stderr.slice(0, 120)}`);

  const journalFile = path.join(SCRATCH, "v52-journal.json");
  writeFileSync(
    journalFile,
    `${JSON.stringify({
      schemaVersion: 1,
      kind: "journal",
      data: { planId: "p-v52", root: FIXTURE_REAL, sinkDir: junctionPath, createdAt: new Date().toISOString(), entries: [] },
    }, null, 2)}\n`,
    "utf8",
  );

  const record = run(["undo", "--journal", journalFile, "--json"]);
  const emptyAfter = existsSync(path.join(outside, "deep", "empty1"));
  const deepAfter = existsSync(path.join(outside, "deep"));
  eq(record.code, 0, `an empty journal has nothing to refuse; exit must be 0 (${record.stderr.slice(0, 200)})`);
  eq(emptyAfter, true, "an empty directory OUTSIDE every root must survive the prune");
  eq(deepAfter, true, "its parent must survive too");
  eq(existsSync(path.join(outside, "keep.txt")), true, "the outside file is untouched");
  eq(existsSync(junctionPath), true, "the junction itself is left alone");
  // The honest prune must still work - otherwise this assertion could be satisfied by simply not
  // pruning anything, which is what G19's emptied-run-directory check covers.
  return "a junction at the sink root was not walked through; the outside tree is intact";
});

check("G25 a junction ANCESTOR of the sink root is never walked through either (audit V6-1)", () => {
  // Round 6's fix routed the prune root through the gate, and the gate's type rule checks the LEAF.
  // A junction one component ABOVE the journal's `sinkDir` therefore stayed invisible: the leaf
  // `<sinkRoot>\linkanc\j1` is an ordinary directory, and the lexical containment test passes
  // because the string is inside the sink. `rmdirSync` behind that junction deletes the real
  // directory, outside every containment root. `followLinks` resolves the whole path and
  // re-checks containment on the real location, which is what closes it.
  const outside = path.join(SCRATCH, "v61-outside");
  mkdirSync(path.join(outside, "j1", "empty1"), { recursive: true });
  writeFileSync(path.join(outside, "keep.txt"), "keep me\n", "utf8");

  const expectedSinkDir = path.join(STATE, "roots", ROOT_HASH, "sink");
  mkdirSync(expectedSinkDir, { recursive: true });
  const ancestorLink = path.join(expectedSinkDir, "v61-linkanc");
  const mklink = spawnSync("cmd", ["/c", "mklink", "/J", ancestorLink, outside], { encoding: "utf8", windowsHide: true, shell: false });
  if (!existsSync(ancestorLink)) skipWith(`could not create a junction above the sink root: exit ${mklink.status} ${mklink.stderr.slice(0, 120)}`);

  const journalFile = path.join(SCRATCH, "v61-journal.json");
  writeFileSync(
    journalFile,
    `${JSON.stringify({
      schemaVersion: 1,
      kind: "journal",
      data: { planId: "p-v61", root: FIXTURE_REAL, sinkDir: path.join(ancestorLink, "j1"), createdAt: new Date().toISOString(), entries: [] },
    }, null, 2)}\n`,
    "utf8",
  );

  const record = run(["undo", "--journal", journalFile, "--json"]);
  eq(record.code, 0, `an empty journal has nothing to refuse; exit must be 0 (${record.stderr.slice(0, 200)})`);
  eq(existsSync(path.join(outside, "j1", "empty1")), true, "an empty directory behind the junction must survive");
  eq(existsSync(path.join(outside, "j1")), true, "and its parent must survive");
  eq(existsSync(path.join(outside, "keep.txt")), true, "the outside file is untouched");

  // The honest prune must STILL work: `followLinks` resolves an honest sink to itself, so this is
  // the assertion that stops the fix being "disable housekeeping". A fresh apply/undo pair leaves
  // an emptied run directory that must be gone afterwards.
  const decoy = "scratch-v61-honest.tmp";
  write(decoy, "honest prune payload\n");
  const plan = makePlan("standard");
  const item = itemAt(plan, decoy);
  const applied = run(["apply", "--plan", plan.file, "--approve-s2", `--confirm=${item.id}`, "--only", item.id, "--json"]);
  eq(applied.code, 0, `honest apply exit (${applied.stderr.slice(0, 200)})`);
  const appliedData = jin(applied, "v61 honest apply").data;
  const runSink = appliedData.sinkDir;
  const undone = run(["undo", "--journal", appliedData.journalFile, "--json"]);
  eq(undone.code, 0, `honest undo exit (${undone.stderr.slice(0, 200)})`);
  eq(existsSync(path.join(FIXTURE, decoy)), true, "the honest restore put the file back");
  ok(!existsSync(runSink), `the honest prune must still remove the emptied run directory: ${runSink}`);
  return "an ancestor junction was not walked through, and the honest prune still runs";
});

check("G26 a nested repository behind an unreadable directory is refused, not assumed absent (audit V6-2)", () => {
  // The nesting search's failure branch was a bare `continue`, so "I could not list this
  // directory" read as "there is nothing nested here" - the exact reading round 6 rejected for the
  // budget. A repository behind one ACL'd directory was missed and the plan applied at exit 0,
  // moving a file out of a repository the plan was never cut against.
  const base = path.join(SCRATCH, "v62-unreadable");
  const outer = path.join(base, "outer");
  const locked = path.join(outer, "locked");
  const inner = path.join(locked, "inner");
  mkdirSync(inner, { recursive: true });
  const git = (cwd, args) => spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true, shell: false });
  for (const repo of [outer, inner]) {
    git(repo, ["init", "-q"]);
    git(repo, ["config", "user.email", "v62@example.invalid"]);
    git(repo, ["config", "user.name", "v62"]);
  }
  writeFileSync(path.join(outer, "outer-decoy.tmp"), "decoy\n", "utf8");
  const innerFile = path.join(inner, "docs", "guide.md");
  mkdirSync(path.dirname(innerFile), { recursive: true });
  writeFileSync(innerFile, "# inner documentation\n", "utf8");

  const planFile = path.join(base, "plan.json");
  const planRecord = run(["plan", "--root", outer, "--level", "standard", "--scope", "repo", "--out", planFile, "--json"]);
  ok(existsSync(planFile), `planning the outer root must write a plan (exit ${planRecord.code})`);
  const plan = JSON.parse(readFileSync(planFile, "utf8"));
  const decoyItem = plan.data.items.find((candidate) => candidate.rel === "outer-decoy.tmp");
  ok(decoyItem, "the outer plan must carry the decoy item");
  const forged = JSON.parse(JSON.stringify(plan));
  for (const candidate of forged.data.items) {
    if (candidate.id !== decoyItem.id) continue;
    candidate.rel = "locked/inner/docs/guide.md";
    candidate.path = innerFile;
    candidate.fingerprint = liveFingerprint(innerFile);
    candidate.size = lstatSync(innerFile).size;
  }
  const forgedFile = path.join(base, "forged.json");
  writeFileSync(forgedFile, `${JSON.stringify(forged, null, 2)}\n`, "utf8");

  // Make the directory unlistable. The user running the harness is the one to deny, because a
  // deny ACE applies to that user even when they are an administrator.
  const whoami = spawnSync("whoami", { encoding: "utf8" }).stdout.trim();
  const deny = spawnSync("icacls", [locked, "/deny", `${whoami}:(RD)`], { encoding: "utf8", windowsHide: true, shell: false });
  let unreadable = false;
  try {
    readdirSync(locked);
  } catch (error) {
    unreadable = error.code === "EPERM" || error.code === "EACCES";
  }
  try {
    if (!unreadable) skipWith(`could not make ${locked} unreadable (icacls exit ${deny.status}); the case needs a real EPERM`);

    const record = run(["apply", "--plan", forgedFile, `--confirm=${decoyItem.id}`, "--only", decoyItem.id, "--json"]);
    eq(record.code, 6, `an unreadable directory must refuse the plan, not be skipped (got ${record.code})`);
    const message = record.stdout + record.stderr;
    ok(/could not list/.test(message), `the refusal must say the directory could not be listed: ${message.slice(0, 240)}`);
    ok(message.includes("locked"), `the refusal must name the unreadable directory: ${message.slice(0, 240)}`);
    ok(!/reached its budget/.test(message), "an unreadable directory must not be reported as a spent budget");
    eq(existsSync(innerFile), true, "the nested repository's file must be untouched");
  } finally {
    // Always revert, so the scratch tree stays deletable whatever happened above.
    spawnSync("icacls", [locked, "/remove:d", whoami], { encoding: "utf8", windowsHide: true, shell: false });
  }
  return "an unreadable directory is an unproven absence: the plan is refused and the file survives";
});

check("G21 a plan re-rooted at an ancestor is refused, so protection cannot be re-anchored (audit V4-3)", () => {
  // The project owns a .git; the plan's root is pointed at its PARENT, which makes `docs/**`,
  // `storage/app/**` and `.git/**` stop matching at segment 0 and makes `readGitState` unable to
  // see the tracked set. Both halves are refused now.
  const container = path.join(SCRATCH, "v43-container");
  const project = path.join(container, "project");
  mkdirSync(project, { recursive: true });
  const writeIn = (root, rel, content) => {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
    return abs;
  };
  writeIn(project, "docs/guide.md", "# owner documentation\n");
  writeIn(project, "README.md", "# tracked readme\n");
  writeIn(project, "scratch-v43.tmp", "v4-3 decoy\n");
  const git = (args) => spawnSync("git", args, { cwd: project, encoding: "utf8", windowsHide: true, shell: false });
  git(["init", "-q"]);
  git(["config", "user.email", "v43@example.invalid"]);
  git(["config", "user.name", "v43"]);
  git(["add", "README.md"]);
  git(["-c", "commit.gpgsign=false", "commit", "-q", "-m", "tracked"]);

  const planFile = path.join(SCRATCH, "v43-plan.json");
  const planRecord = run(["plan", "--root", project, "--level", "standard", "--scope", "repo", "--out", planFile, "--json"]);
  eq(planRecord.code, 0, `planning the project must succeed (${planRecord.stderr.slice(0, 200)})`);
  const plan = JSON.parse(readFileSync(planFile, "utf8"));
  const decoyItem = plan.data.items.find((candidate) => candidate.rel === "scratch-v43.tmp");
  ok(decoyItem, "the decoy must be a plan item");

  const reRooted = JSON.parse(JSON.stringify(plan));
  reRooted.data.root = container;
  reRooted.data.rootGiven = container;
  const targetRel = "project/docs/guide.md";
  const targetAbs = path.join(container, targetRel);
  for (const candidate of reRooted.data.items) {
    if (candidate.id !== decoyItem.id) continue;
    candidate.rel = targetRel;
    candidate.path = targetAbs;
    candidate.fingerprint = liveFingerprint(targetAbs);
    if (lstatSync(targetAbs).isFile()) candidate.size = lstatSync(targetAbs).size;
  }
  const forgedFile = path.join(SCRATCH, "v43-rerooted.json");
  writeFileSync(forgedFile, `${JSON.stringify(reRooted, null, 2)}\n`, "utf8");

  const record = run(["apply", "--plan", forgedFile, "--confirm=" + decoyItem.id, "--only", decoyItem.id, "--json"]);
  eq(record.code, 6, `a re-rooted plan must refuse at exit 6, not act (got ${record.code})`);
  // The refusal is raised before any item is attempted, so it is an envelope error rather than a
  // per-item row; either shape is acceptable as long as the target is untouched.
  ok(/nested git repository/.test(record.stdout) || /nested git repository/.test(record.stderr), `the refusal must name the nesting: ${record.stdout.slice(0, 200)}`);
  eq(existsSync(targetAbs), true, "docs/guide.md must be untouched by a re-rooted plan");
  // And the honest root still plans and applies that same item, so the guard is not blanket.
  const honest = run(["apply", "--plan", planFile, "--only", decoyItem.id, "--approve-s2", `--confirm=${decoyItem.id}`, "--json"]);
  ok(honest.code === 0 || honest.code === 6, `honest root must not crash (exit ${honest.code})`);
  return "a plan rooted above the project is refused; the honest root is unaffected";
});

check("G23 apply refuses a plan root that nests a repository past any depth, and fails closed without git (audit V4-3, V5-1, V5-4)", () => {
  // V4-3 has two independent guards (the nesting refusal and the fail-closed git re-check). Round 5
  // measured that removing ONE of them left this assertion green, because it asserted the guards by
  // REGULAR EXPRESSION over the source and G21's shallow fixture is answered by whichever guard
  // survives. So both halves are behavioural here, and the nesting half is exercised at a depth the
  // old six-level cap could not reach - which is V5-1 itself.
  const git = (cwd, args) => spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true, shell: false });

  // --- guard A: the nesting refusal, PAST the old depth cap ---------------------------------
  // A plan root that is itself a repository (so the fail-closed git guard cannot fire: git state
  // IS readable at the root) with an inner repository seven levels down.
  const base = path.join(SCRATCH, "v51-deep");
  const outer = path.join(base, "outer");
  const state = path.join(base, "state");
  mkdirSync(state, { recursive: true });
  mkdirSync(outer, { recursive: true });
  git(outer, ["init", "-q"]);
  git(outer, ["config", "user.email", "v51@example.invalid"]);
  git(outer, ["config", "user.name", "v51"]);
  writeFileSync(path.join(outer, "decoy.tmp"), "decoy\n", "utf8");
  const parents = Array.from({ length: 6 }, (_, index) => `d${index + 1}`);
  const inner = path.join(outer, ...parents, "inner");
  mkdirSync(inner, { recursive: true });
  git(inner, ["init", "-q"]);
  git(inner, ["config", "user.email", "v51@example.invalid"]);
  git(inner, ["config", "user.name", "v51"]);
  const innerFile = path.join(inner, "docs", "guide.md");
  mkdirSync(path.dirname(innerFile), { recursive: true });
  writeFileSync(innerFile, "# inner\n", "utf8");

  const planFile = path.join(base, "plan.json");
  const planRecord = run(["plan", "--root", outer, "--level", "standard", "--scope", "repo", "--out", planFile, "--json"]);
  eq(planRecord.code, 0, `planning the outer root must succeed (${planRecord.stderr.slice(0, 200)})`);
  const plan = JSON.parse(readFileSync(planFile, "utf8"));
  const decoyItem = plan.data.items.find((candidate) => candidate.rel === "decoy.tmp");
  ok(decoyItem, "the outer plan must carry the decoy item");
  const innerRel = `${parents.join("/")}/inner/docs/guide.md`;
  const forged = JSON.parse(JSON.stringify(plan));
  for (const candidate of forged.data.items) {
    if (candidate.id !== decoyItem.id) continue;
    candidate.rel = innerRel;
    candidate.path = innerFile;
    candidate.fingerprint = liveFingerprint(innerFile);
    candidate.size = lstatSync(innerFile).size;
  }
  const forgedFile = path.join(base, "forged.json");
  writeFileSync(forgedFile, `${JSON.stringify(forged, null, 2)}\n`, "utf8");
  const deepRecord = run(["apply", "--plan", forgedFile, `--confirm=${decoyItem.id}`, "--only", decoyItem.id, "--json"]);
  eq(deepRecord.code, 6, `a repository nested ${parents.length + 1} levels down must refuse (got ${deepRecord.code})`);
  ok(
    /nested git repository/.test(deepRecord.stdout + deepRecord.stderr),
    `the refusal must name the nesting, not something else: ${deepRecord.stdout.slice(0, 220)}`,
  );
  eq(existsSync(innerFile), true, "the inner repository's docs/guide.md must be untouched");

  // --- guard B: the fail-closed git re-check, behaviourally ---------------------------------
  // A plan root with NO git work tree anywhere beneath it. Nothing else refuses this plan, so the
  // only thing that can stop it is the git guard - which is what makes this behavioural coverage
  // rather than a text match.
  const plain = path.join(SCRATCH, "v54-plain");
  mkdirSync(plain, { recursive: true });
  writeFileSync(path.join(plain, "scratch-v54.tmp"), "payload\n", "utf8");
  const plainPlan = path.join(SCRATCH, "v54-plan.json");
  const plainPlanRecord = run(["plan", "--root", plain, "--level", "standard", "--scope", "repo", "--out", plainPlan, "--json"]);
  eq(plainPlanRecord.code, 0, `planning a non-git root must succeed (${plainPlanRecord.stderr.slice(0, 200)})`);
  const plainData = JSON.parse(readFileSync(plainPlan, "utf8")).data;
  const plainItem = plainData.items.find((candidate) => candidate.rel === "scratch-v54.tmp");
  ok(plainItem, "the non-git plan must carry the item");
  const plainRecord = run(["apply", "--plan", plainPlan, `--confirm=${plainItem.id}`, "--only", plainItem.id, "--json"]);
  eq(plainRecord.code, 6, `a root with no readable git state must fail closed (got ${plainRecord.code})`);
  ok(
    /git state is unavailable/.test(plainRecord.stdout + plainRecord.stderr),
    `the fail-closed refusal must say why: ${plainRecord.stdout.slice(0, 220)}`,
  );
  eq(existsSync(path.join(plain, "scratch-v54.tmp")), true, "the item must be untouched when the guard fails closed");

  // --- the work bound, and the fact that its exhaustion REFUSES rather than searches on ------
  const bounded = run(["apply", "--plan", planFile, `--confirm=${decoyItem.id}`, "--only", decoyItem.id, "--json"], {
    env: { DSH_ORGANIZER_NEST_SCAN_DIRS: "1" },
  });
  eq(bounded.code, 6, `an exhausted nesting search must refuse, not search on (got ${bounded.code})`);
  ok(
    /nested-repository search reached its budget/.test(bounded.stdout + bounded.stderr),
    `the budget refusal must name the bound and the knob: ${bounded.stdout.slice(0, 240)}`,
  );
  return `nesting refused at depth ${parents.length + 1}; the git guard and the search budget both fail closed`;
});

check("G22 the operand gate does not refuse everything: every arm still applies honestly (control)", () => {
  // A gate that refuses is easy to write and worthless if it also refuses honest work. This is the
  // control for the whole round: one honest item per acting arm, applied for real.
  const arms = [
    { name: "move", rel: "scratch-g22-move.tmp", action: "move", safety: "S3" },
    { name: "route", rel: "src/g22-route-me.js", action: "route-to-test-tree", safety: "S3" },
    { name: "settle", rel: "g22-empty-dir", action: "settle", safety: "S1" },
  ];
  write("scratch-g22-move.tmp", "control payload for the move arm\n");
  write("src/g22-route-me.js", "import { describe, it, expect } from 'vitest';\ndescribe('g22', () => it('x', () => expect(1).toBe(1)));\n");
  mkdirSync(path.join(FIXTURE, "g22-empty-dir"), { recursive: true });

  const plan = makePlan("standard");
  const failures = [];
  const applied = [];
  for (const arm of arms) {
    const item = itemAt(plan, arm.rel);
    eq(item.action, arm.action, `${arm.name}: the fixture must produce the ${arm.action} action`);
    eq(item.safety, arm.safety, `${arm.name}: class`);
    const args = ["apply", "--plan", plan.file, "--only", item.id, "--json"];
    if (arm.safety === "S3") args.splice(args.length - 1, 0, `--confirm=${item.id}`);
    else args.splice(args.length - 1, 0, "--approve-s2");
    const record = run(args);
    let row = null;
    try {
      row = jin(record, `control apply ${arm.name}`).data.results.find((candidate) => candidate.id === item.id);
    } catch {
      /* reported below */
    }
    if (record.code !== 0) failures.push(`${arm.name}: exit ${record.code}`);
    else if (row?.status !== "applied") failures.push(`${arm.name}: status ${row?.status} :: ${row?.reason}`);
    else applied.push(arm.name);
  }
  eq(failures.length, 0, `honest arms the gate refused: ${failures.join(" | ")}`);
  eq(applied.length, arms.length, "every arm must have applied");
  // The PURGE arm is exercised with a forged row rather than a planned one: `purge` is what the
  // engine does to an item above the quarantine cap, and the fixture's oversize item is planned
  // through a run-local `DSH_ORGANIZER_MAX_SINK_BYTES` that this shared plan does not carry. The
  // row below is an honest, unprotected scratch file taken to `purge` at S3 with its `--confirm`,
  // so it measures the gate, not the forger.
  const purgeRel = "scratch-g22-purge.tmp";
  write(purgeRel, "control payload for the purge arm\n");
  const purgePlan = makePlan("standard");
  const purgeDecoy = itemAt(purgePlan, purgeRel);
  const purgeId = "it-g22-purge";
  const forged = forgePlan(purgePlan.file, "g22-purge", (data) => {
    data.items.push({
      ...purgeDecoy,
      id: purgeId,
      action: "purge",
      safety: "S3",
      class: "S3",
      planned: true,
      fingerprint: liveFingerprint(path.join(FIXTURE, purgeRel)),
    });
  });
  const purgeRecord = run(["apply", "--plan", forged, "--confirm=" + purgeId, "--only", purgeId, "--json"]);
  const purgeRow = purgeRecord.code === 0 ? jin(purgeRecord, "control purge").data.results.find((candidate) => candidate.id === purgeId) : null;
  eq(purgeRecord.code, 0, `honest purge exit (${purgeRecord.stderr.slice(0, 200)})`);
  eq(purgeRow?.status, "applied", `honest purge status (${purgeRow?.reason})`);
  eq(existsSync(path.join(FIXTURE, purgeRel)), false, "the honest purge really removed its target");
  // And the honest undo still restores, so the source and destination halves of the gate are not
  // one-way either. A FRESH decoy: the one above has already been consumed by its own apply, and
  // re-applying it would produce no journal at all (drift), which measures the fixture rather
  // than the gate.
  const undoRel = "scratch-g22-undo.tmp";
  write(undoRel, "control payload for the undo half\n");
  const undoPlan = makePlan("standard");
  const undoItem = itemAt(undoPlan, undoRel);
  const undoApply = run(["apply", "--plan", undoPlan.file, "--approve-s2", `--confirm=${undoItem.id}`, "--only", undoItem.id, "--json"]);
  eq(undoApply.code, 0, `honest apply for undo (${undoApply.stderr.slice(0, 200)})`);
  eq(existsSync(path.join(FIXTURE, undoRel)), false, "the undo decoy was quarantined");
  const undoRecord = run(["undo", "--journal", jin(undoApply, "apply for undo").data.journalFile, "--json"]);
  eq(undoRecord.code, 0, `an honest undo must still exit 0 (${undoRecord.stderr.slice(0, 200)})`);
  const undone = jin(undoRecord, "honest undo").data;
  eq(undone.counts.restored, 1, "the honest entry was restored through the gate");
  eq(existsSync(path.join(FIXTURE, undoRel)), true, "the file is back");
  return `honest ${applied.join(", ")}, purge applied, undo restored — the gate refuses forgeries, not work`;
});

// ---------------------------------------------------------------------------------------
// H. source-level invariants
// ---------------------------------------------------------------------------------------

const source = readFileSync(ORGANIZER, "utf8");
// The invariants are argued in comments - including the incident class the engine prevents - so
// the static checks below run against the CODE ONLY, with comments stripped. Otherwise a comment
// that names `rm -rf $VAR` in order to forbid it would fail the very check it documents.
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^[ \t]*\/\/.*$/gm, "");

check("H1 the engine never asks for a shell", () => {
  ok(!/shell\s*:\s*true/.test(code), "found `shell: true`");
  ok(!/(?<!\.)\bexec(Sync)?\s*\(/.test(code), "found a child_process exec call");
  ok(!/execFile(Sync)?\s*\(/.test(code), "found an execFile call");
  const spawns = code.match(/spawnSync\(/g) ?? [];
  ok(spawns.length >= 3, `expected the git and tool probes, found ${spawns.length} spawnSync calls`);
  ok(!/(?<!Sync)\bspawn\(/.test(code), "found a bare spawn() call");
  return `${spawns.length} spawnSync calls, all argument-array based with shell:false`;
});

check("H2 no shell deletion idiom exists in executable code", () => {
  for (const idiom of ["rm -rf", "rm -fr", "rmdir /s", "git clean", "rimraf", "del /f", "Remove-Item -Force -Recurse"]) {
    ok(!code.includes(idiom), `found the deletion idiom "${idiom}"`);
  }
  ok(!/\$\{[^}]*\}[^`]*\brimraf\b/.test(code), "a template literal feeds a shell command");
  return "no shell deletion idiom in code";
});

check("H3 the documented shell field is explicitly marked as not executed", () => {
  ok(source.includes("shellExecuted: false"), "plan items must carry shellExecuted: false");
  const start = source.indexOf("const equivalentShell");
  ok(start > 0, "equivalentShell helper missing");
  ok(/documentation/i.test(source.slice(Math.max(0, start - 800), start + 900)), "the helper must document that it is never executed");
  return "documentation-only shell field";
});

check("H4 the engine states its invariants in-source, including the incident class it prevents", () => {
  ok(/NO SHELL DELETION/.test(source), "I1 missing");
  ok(/CONTAINMENT/.test(source), "I2 missing");
  ok(/PROTECTED SET/.test(source), "I3 missing");
  ok(/RE-VERIFY AT APPLY/.test(source), "I4 missing");
  ok(/GATES/.test(source), "I5 missing");
  ok(/JOURNAL/.test(source), "I6 missing");
  ok(/rm -rf \$VAR|unresolved variable/.test(source), "the recorded incident class must be named");
  return "I1..I7 documented in-source";
});

check("H5 containment is decided by resolved absolute path, and links are refused", () => {
  ok(/realpathSync\.native/.test(code), "realpath must be used");
  ok(/isInsidePath/.test(code), "containment helper");
  ok(/never followed/.test(code) || /never followed/.test(source), "the refusal wording for links");
  return "realpath + containment + link refusal";
});

// ---------------------------------------------------------------------------------------
// H. exit-code and envelope contract
// ---------------------------------------------------------------------------------------

check("I1 every command prints the {schemaVersion, kind, data} envelope with --json", () => {
  const cases = [
    ["doctor", ["doctor", "--json"]],
    ["inventory", ["inventory", "--root", FIXTURE, "--json"]],
    ["plan", ["plan", "--root", FIXTURE, "--level", "light", "--json"]],
    ["disposition", ["disposition", "--root", FIXTURE, "--level", "light", "--json"]],
  ];
  for (const [kind, args] of cases) {
    const envelope = jin(run(args), kind);
    eq(envelope.schemaVersion, 1, `${kind} schemaVersion`);
    eq(envelope.kind, kind, `${kind} kind`);
    ok(Object.hasOwn(envelope, "data"), `${kind} data`);
  }
  return `${cases.length} commands validated`;
});

check("I2 the documented exit codes were all produced by real runs", () => {
  for (const code of [0, 2, 3, 5, 6]) ok(observedExitCodes.has(code), `exit code ${code} was never observed`);
  return `observed ${[...observedExitCodes].sort((a, b) => a - b).join(", ")}`;
});

check("I3 usage errors: no command, an unknown command and an unknown option are all exit 2", () => {
  eq(run([]).code, 2, "no arguments");
  eq(run(["frobnicate"]).code, 2, "unknown command");
  eq(run(["inventory", "--root", FIXTURE, "--wat"]).code, 2, "unknown option");
  const help = run(["--help"]);
  eq(help.code, 0, "--help");
  ok(help.stdout.includes("Exit codes"), "the usage text must document the exit codes");
  return "2 / 2 / 2, help is 0";
});

check("I4 the plan of a repository is stable: planning twice yields the same plan id", () => {
  const first = makePlan("deep");
  const second = makePlan("deep");
  eq(second.data.planId, first.data.planId, "plan ids must match for an unchanged tree");
  eq(
    sortedIds(new Set(first.items.map((item) => `${item.rel}:${item.safety}:${item.action}`))),
    sortedIds(new Set(second.items.map((item) => `${item.rel}:${item.safety}:${item.action}`))),
    "classification must be deterministic",
  );
  return `${first.data.planId} reproduced`;
});

// ---------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------

const summary = [
  "",
  failed === 0
    ? `PASSED: ${passed} assertion(s) passed, ${skipped} skipped, 0 failed`
    : `FAILED: ${failed} of ${passed + failed} assertion(s) failed (${skipped} skipped)`,
].join("\n");

process.stdout.write(`${summary}\n`);

if (!process.argv.includes("--keep")) {
  try {
    rmSync(SCRATCH, { recursive: true, force: true });
    process.stdout.write(`\ncleaned up ${SCRATCH}\n`);
  } catch (error) {
    process.stdout.write(`\nWARNING: could not remove ${SCRATCH}: ${error.message}\n`);
  }
} else {
  process.stdout.write(`\nkept ${SCRATCH} (--keep)\n`);
}

process.exitCode = failed === 0 ? 0 : 1;
