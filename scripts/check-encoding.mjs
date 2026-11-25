#!/usr/bin/env node
/**
 * Encoding gate.
 *
 * Catches the corruption the frontmatter validator cannot see: UTF-8 that was decoded as cp1252 and
 * re-encoded (mojibake), a leftover replacement character, a UTF-16 file, and a BOM that hides the
 * first line of a SKILL.md from the loader.
 *
 * The check is done on bytes. Console output is not evidence: Windows PowerShell 5.1 renders a correct
 * em dash and a corrupted one identically, which is how this pack carried mojibake for 36 days.
 *
 * A file that documents the corruption carries `<!-- deliberate-mojibake-examples -->` and is skipped;
 * the exemption is reported by name so it stays visible.
 *
 * Run: node scripts/check-encoding.mjs
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MARKER = "deliberate-mojibake-examples";
const TEXT_EXTENSIONS = new Set([".md", ".js", ".mjs", ".cjs", ".json", ".yml", ".yaml", ".ps1", ".txt", ".php", ".py"]);
const SKIP_DIRECTORIES = new Set([".git", "node_modules", ".github/workflows/node_modules"]);

// UTF-8 bytes of cp1252-misread characters, as hex. Even-offset matches only: a hit at an odd index
// spans two bytes and is not a character.
const PATTERNS = [
  ["mojibake a-circumflex (c3a2)", "c3a2"],
  ["mojibake A-tilde (c383)", "c383"],
  ["stray euro sign (e282ac)", "e282ac"],
  ["replacement character (efbfbd)", "efbfbd"],
];
const BOMS = [
  ["UTF-8 BOM (efbbbf)", "efbbbf"],
  ["UTF-16LE BOM (fffe)", "fffe"],
  ["UTF-16BE BOM (feff)", "feff"],
];

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      walk(join(dir, entry.name), out);
      continue;
    }
    if (TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) out.push(join(dir, entry.name));
  }
  return out;
}

function countHexEvenOffsets(hex, pattern) {
  let count = 0;
  let index = hex.indexOf(pattern);
  while (index >= 0) {
    if (index % 2 === 0) count += 1;
    index = hex.indexOf(pattern, index + 2);
  }
  return count;
}

const findings = [];
const exempt = [];

if (!existsSync(join(ROOT, "skills"))) {
  console.error(`FAIL - no skills directory under ${ROOT}`);
  process.exit(1);
}

const files = walk(ROOT, []);
for (const file of files) {
  const bytes = readFileSync(file);
  const text = bytes.toString("utf8");
  const rel = relative(ROOT, file);

  if (text.includes(MARKER)) {
    exempt.push(rel);
    continue;
  }

  const hex = bytes.toString("hex");
  const hits = [];
  for (const [label, pattern] of PATTERNS) {
    const count = countHexEvenOffsets(hex, pattern);
    if (count > 0) hits.push(`${label} x${count}`);
  }
  for (const [label, pattern] of BOMS) {
    if (hex.startsWith(pattern)) hits.push(label);
  }
  if (/^(fffe|feff)/.test(hex)) hits.push("not UTF-8 (UTF-16 BOM)");

  if (hits.length > 0) findings.push({ file: rel, hits });
}

console.log(`scanned ${files.length} text files under ${ROOT}`);
if (exempt.length > 0) {
  console.log(`exempt by marker (${exempt.length}): ${exempt.join(", ")}`);
}

if (findings.length > 0) {
  console.error(`FAIL - ${findings.length} file(s) carry encoding damage`);
  for (const finding of findings) console.error(`  ${finding.file}: ${finding.hits.join(", ")}`);
  process.exit(1);
}
console.log("PASS - no mojibake, replacement character, UTF-16 file or BOM in any tracked text file");
