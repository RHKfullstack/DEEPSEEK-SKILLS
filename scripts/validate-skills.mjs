#!/usr/bin/env node
/**
 * Pack validator for the DSH repository.
 *
 * The Claude repository has carried a validator since the beginning; this one
 * did not, which is how its README came to call nineteen folder skills "eight"
 * and its INSTALL came to call them "six". Everything checked here is a fact
 * the documentation asserts, so a drift fails CI instead of shipping.
 *
 * Run: node scripts/validate-skills.mjs   (exit 0 = pass, 1 = errors)
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const errors = [];
const warnings = [];

const read = (p) => readFileSync(p, "utf8").replace(/^\uFEFF/, "");

function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

// ---- 1. folder skills -------------------------------------------------------
const skillsDir = join(ROOT, "skills");
const folderSkills = readdirSync(skillsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

for (const name of folderSkills) {
  const file = join(skillsDir, name, "SKILL.md");
  if (!existsSync(file)) {
    errors.push(`E1 ${name}: no SKILL.md`);
    continue;
  }
  const raw = read(file);
  if (!raw.startsWith("---")) errors.push(`E1 ${name}: SKILL.md does not start with --- (BOM or missing frontmatter)`);
  const fm = frontmatter(raw);
  if (!fm) {
    errors.push(`E2 ${name}: unparseable frontmatter`);
    continue;
  }
  if (!fm.name) errors.push(`E2 ${name}: no name`);
  if (!fm.description) errors.push(`E2 ${name}: no description`);
  // A colon followed by a space ends an unquoted YAML scalar early and the loader
  // drops the skill entirely - this is how game-design vanished from the catalog.
  if (fm.description && /:\s/.test(fm.description)) errors.push(`E2b ${name}: description contains a colon-space and breaks the YAML scalar`);
  if (fm.name && fm.name !== name) errors.push(`E2 ${name}: declares name "${fm.name}"`);
  if (fm.description && (fm.description.length < 60 || fm.description.length > 900)) {
    warnings.push(`W1 ${name}: description length ${fm.description.length}`);
  }
}

// ---- 2. plugin payloads -----------------------------------------------------
const seniorDir = join(ROOT, "plugins", "dsh-senior-engineering-skills", "skills");
const seniorSkills = existsSync(seniorDir) ? readdirSync(seniorDir).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, "")) : [];
if (seniorSkills.length !== 11) errors.push(`E3 senior plugin: expected 11 skill files, found ${seniorSkills.length}`);

const coreFiles = ["sandbox-mode", "plannable", "organizer"];
const coreDir = join(ROOT, "plugins", "dsh-deepseek-harness-skills");
for (const f of coreFiles) {
  const p = join(coreDir, "prompts", `${f}.md`);
  if (!existsSync(p)) errors.push(`E4 core: missing prompts/${f}.md`);
}

// ---- 3. the root bundle -----------------------------------------------------
const pkgPath = join(ROOT, "package.json");
if (!existsSync(pkgPath)) {
  errors.push("E5 no root package.json - the repository is not installable");
} else {
  const pkg = JSON.parse(read(pkgPath));
  if (!pkg.dsh?.bundle?.patch) errors.push("E5 package.json has no dsh.bundle.patch");
  if (!existsSync(join(ROOT, "cordis.patch.yml"))) errors.push("E5 no cordis.patch.yml");
  if (!existsSync(join(ROOT, "index.js"))) errors.push("E5 no index.js");
}

// ---- 4. counts asserted by the documentation --------------------------------
const known = new Set([...folderSkills, ...seniorSkills, ...coreFiles]);
const counts = {
  folder: folderSkills.length,
  senior: seniorSkills.length,
  core: coreFiles.length,
};
const total = counts.folder + counts.senior + counts.core;

const readmes = ["README.md", "INSTALL.md"].filter((f) => existsSync(join(ROOT, f)));
for (const f of readmes) {
  const text = read(join(ROOT, f));
  // The document may state the total directly ("33 skills in one install") or as a
  // breakdown ("19 user + 11 plugin + 3 core = 33"). Either way the total must appear.
  if (!new RegExp(`\\b${total}\\b`).test(text)) {
    errors.push(`E8 ${f}: never states the pack total (${total})`);
  }
}

// ---- 5. citations resolve ---------------------------------------------------
const cited = new Set();
for (const name of folderSkills) {
  const text = read(join(skillsDir, name, "SKILL.md"));
  for (const m of text.matchAll(/`([a-z][a-z0-9-]{2,40})`/g)) {
    const id = m[1];
    if (/^(senior|game|stack)-/.test(id) || ["ui-design", "creative-designer", "project-quality-chain", "sandbox-mode", "plannable", "organizer"].includes(id)) {
      cited.add(id);
    }
  }
}
for (const id of [...cited].sort()) {
  if (!known.has(id)) errors.push(`E9 cited skill does not exist: \`${id}\``);
}

// ---- report -----------------------------------------------------------------
const summary = `checked ${counts.folder} folder + ${counts.senior} senior + ${counts.core} core = ${total} skills; ${cited.size} distinct citations`;
if (errors.length) {
  console.error(`FAIL - ${errors.length} error(s)\n${errors.map((e) => `  ${e}`).join("\n")}\n${summary}`);
  process.exit(1);
}
for (const w of warnings) console.log(`  warn ${w}`);
console.log(`PASS - 0 errors\n${summary}`);
