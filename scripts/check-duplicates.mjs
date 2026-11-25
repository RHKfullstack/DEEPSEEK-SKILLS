#!/usr/bin/env node
/**
 * Duplicate and overlap gate.
 *
 * The pack grows by adding skills, and two failure modes grow with it: a skill that is a copy of
 * another (same description, same body), and a skill whose body quietly becomes a second copy of a
 * neighbour's procedure. Neither is caught by the frontmatter validator, and both make the catalog
 * ambiguous - the model has two rows that claim the same job.
 *
 * Fails on: a declared name that duplicates another, a duplicate description, a byte-identical body,
 * a heading repeated inside one file, a long line repeated inside one file, and two skills whose
 * bodies are more than 30% similar by 8-word shingles (copy-paste overlap).
 *
 * Run: node scripts/check-duplicates.mjs [skills-dir]   (default: ./skills)
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ROOTS = process.argv.length > 2 ? process.argv.slice(2) : [join(ROOT, "skills")];
const OVERLAP_THRESHOLD = 0.3;
const SHINGLE = 8;

function parse(text) {
  const clean = text.replace(/^\uFEFF/, "");
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(clean);
  if (!match) return { frontmatter: {}, body: clean };
  const frontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (kv) frontmatter[kv[1]] = kv[2].trim();
  }
  return { frontmatter, body: clean.slice(match[0].length) };
}

const asciiFold = (text) => text.normalize("NFKD").replace(/[^\x00-\x7F]/g, "");
const tokensOf = (text) =>
  asciiFold(text).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);

function shingles(text) {
  const tokens = tokensOf(text);
  const set = new Set();
  for (let i = 0; i + SHINGLE <= tokens.length; i += 1) set.add(tokens.slice(i, i + SHINGLE).join(" "));
  return set;
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared += 1;
  return shared / (a.size + b.size - shared);
}

const problems = [];

for (const root of ROOTS) {
  const skillsDir = resolve(root);
  if (!existsSync(skillsDir)) {
    problems.push(`MISSING directory ${skillsDir}`);
    continue;
  }

  const skills = [];
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(skillsDir, entry.name, "SKILL.md");
    if (!existsSync(file) || !statSync(file).isFile()) {
      problems.push(`NO SKILL.md in skills/${entry.name}`);
      continue;
    }
    const { frontmatter, body } = parse(readFileSync(file, "utf8"));
    skills.push({
      dir: entry.name,
      name: frontmatter.name ?? "",
      description: frontmatter.description ?? "",
      body,
    });
  }

  console.log(`checked ${skills.length} skills in ${basename(skillsDir)}`);

  const byName = new Map();
  const byDescription = new Map();
  const byBody = new Map();

  for (const skill of skills) {
    if (skill.name !== skill.dir) {
      problems.push(`NAME MISMATCH ${skill.dir}: declares "${skill.name}"`);
    }
    const nameKey = skill.name.toLowerCase();
    if (byName.has(nameKey)) {
      problems.push(`DUPLICATE NAME "${skill.name}" in ${byName.get(nameKey)} and ${skill.dir}`);
    } else {
      byName.set(nameKey, skill.dir);
    }

    const descriptionKey = skill.description.trim().toLowerCase();
    if (descriptionKey.length === 0) {
      problems.push(`EMPTY DESCRIPTION ${skill.dir}`);
    } else if (byDescription.has(descriptionKey)) {
      problems.push(`DUPLICATE DESCRIPTION ${byDescription.get(descriptionKey)} == ${skill.dir}`);
    } else {
      byDescription.set(descriptionKey, skill.dir);
    }

    const bodyKey = asciiFold(skill.body).replace(/\s+/g, " ").trim();
    if (byBody.has(bodyKey)) {
      problems.push(`IDENTICAL BODY ${byBody.get(bodyKey)} == ${skill.dir}`);
    } else {
      byBody.set(bodyKey, skill.dir);
    }
  }

  for (const skill of skills) {
    const headings = new Set();
    const lines = new Set();
    let inFence = false;
    for (const rawLine of skill.body.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (/^`{3,}/.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      if (/^#{2,3}\s+/.test(line)) {
        const key = line.toLowerCase();
        if (headings.has(key)) problems.push(`REPEATED HEADING in ${skill.dir}: ${line}`);
        else headings.add(key);
      }
      // A repeated long prose line is a paste accident; table rows and code are excluded above.
      if (line.length >= 60 && !line.startsWith("|")) {
        const key = line.toLowerCase();
        if (lines.has(key)) problems.push(`REPEATED LINE in ${skill.dir}: ${line.slice(0, 70)}...`);
        else lines.add(key);
      }
    }
  }

  const fingerprints = skills.map((skill) => ({ dir: skill.dir, set: shingles(skill.body) }));
  let highest = { a: "-", b: "-", score: 0 };
  for (let i = 0; i < fingerprints.length; i += 1) {
    for (let j = i + 1; j < fingerprints.length; j += 1) {
      const score = jaccard(fingerprints[i].set, fingerprints[j].set);
      if (score > highest.score) highest = { a: fingerprints[i].dir, b: fingerprints[j].dir, score };
      if (score >= OVERLAP_THRESHOLD) {
        problems.push(
          `OVERLAP ${(score * 100).toFixed(1)}% ${fingerprints[i].dir} <-> ${fingerprints[j].dir} - two skills claiming one job`,
        );
      }
    }
  }
  console.log(
    `  closest pair: ${highest.a} <-> ${highest.b} at ${(highest.score * 100).toFixed(1)}% (threshold ${OVERLAP_THRESHOLD * 100}%)`,
  );
}

// The plugin half of the catalog. A folder skill colliding with a plugin-registered skill would make the
// catalog ambiguous in exactly the way this script exists to prevent, and the folder scan above cannot
// see those files: they are `.md` prompt bodies with no frontmatter, named by their filename.
const pluginEntries = [];
const pluginsDir = join(ROOT, "plugins");
if (existsSync(pluginsDir)) {
  for (const plugin of readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!plugin.isDirectory()) continue;
    for (const area of ["skills", "prompts"]) {
      const areaDir = join(pluginsDir, plugin.name, area);
      if (!existsSync(areaDir)) continue;
      for (const file of readdirSync(areaDir)) {
        if (!file.endsWith(".md")) continue;
        const full = join(areaDir, file);
        if (!statSync(full).isFile()) continue;
        pluginEntries.push({
          name: file.replace(/\.md$/, ""),
          label: `${plugin.name}/${area}/${file}`,
          body: readFileSync(full, "utf8").replace(/^\uFEFF/, ""),
        });
      }
    }
  }
}

if (pluginEntries.length > 0) {
  console.log(`checked ${pluginEntries.length} plugin-registered skill bodies under plugins/`);
  const byPluginName = new Map();
  const byPluginBody = new Map();
  for (const entry of pluginEntries) {
    const nameKey = entry.name.toLowerCase();
    if (byPluginName.has(nameKey)) {
      problems.push(`DUPLICATE PLUGIN NAME "${entry.name}": ${byPluginName.get(nameKey)} and ${entry.label}`);
    } else {
      byPluginName.set(nameKey, entry.label);
    }
    const bodyKey = asciiFold(entry.body).replace(/\s+/g, " ").trim();
    if (byPluginBody.has(bodyKey)) {
      problems.push(`IDENTICAL PLUGIN BODY ${byPluginBody.get(bodyKey)} == ${entry.label}`);
    } else {
      byPluginBody.set(bodyKey, entry.label);
    }
  }

  // A folder skill and a plugin skill that share a name are the same job listed twice, whatever their
  // bodies say - so the name comparison is unconditional, not a by-product of the body comparison.
  for (const root of ROOTS) {
    const skillsDir = resolve(root);
    if (!existsSync(skillsDir)) continue;
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const clash = byPluginName.get(entry.name.toLowerCase());
      if (clash) {
        problems.push(`FOLDER/PLUGIN NAME COLLISION skills/${entry.name} == ${clash}`);
      }
    }
  }

  // A folder skill and a plugin skill that share a body are the same skill shipped twice.
  for (const root of ROOTS) {
    const skillsDir = resolve(root);
    if (!existsSync(skillsDir)) continue;
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = join(skillsDir, entry.name, "SKILL.md");
      if (!existsSync(file)) continue;
      const folderBody = asciiFold(parse(readFileSync(file, "utf8")).body).replace(/\s+/g, " ").trim();
      for (const pluginEntry of pluginEntries) {
        const pluginBody = asciiFold(pluginEntry.body).replace(/\s+/g, " ").trim();
        if (folderBody === pluginBody) {
          problems.push(`FOLDER/PLUGIN DUPLICATE skills/${entry.name} == ${pluginEntry.label}`);
        }
      }
    }
  }
}

if (problems.length > 0) {
  console.error(`FAIL - ${problems.length} problem(s)`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log("PASS - no duplicate name, description, body, heading or line, and no body overlap above the threshold");
