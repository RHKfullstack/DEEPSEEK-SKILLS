/**
 * dsh-deepseek-skills — one installable bundle for the whole pack.
 *
 * The repository used to ship two self-contained plugins under `plugins/` and a
 * folder of filesystem skills under `skills/`. Installing the repository URL
 * therefore failed with "This package declares no bundle": the root had no
 * package.json, so DSH had nothing to mount.
 *
 * This entry point fixes that by composing everything in one place:
 *   - `plugins/dsh-deepseek-harness-skills`  -> sandbox-mode, plannable, organizer + policy sections
 *   - `plugins/dsh-senior-engineering-skills` -> the eleven senior-* audits + senior policy section
 *   - `skills/<name>/SKILL.md`               -> the design, frontend and stack skills
 *
 * Both nested plugins are plain ESM modules exporting `apply(ctx)`; calling them
 * with this context keeps their own registration and prompt wiring intact, so
 * there is exactly one source of truth per skill.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { apply as applyHarness } from "./plugins/dsh-deepseek-harness-skills/index.js";
import { apply as applySenior } from "./plugins/dsh-senior-engineering-skills/index.js";

export const name = "dsh-deepseek-skills";
export const inject = ["systemPrompt", "skills"];

const ROOT = fileURLToPath(new URL("./", import.meta.url));
const SKILLS_DIR = join(ROOT, "skills");

/** Read `name` and `description` from a leading YAML frontmatter block. */
function parseFrontmatter(text) {
  const body = text.replace(/^\uFEFF/, "");
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(body);
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  if (!fields.name || !fields.description) return null;
  return { ...fields, body: body.slice(match[0].length) };
}

/** Every `skills/<name>/SKILL.md` with valid frontmatter. Exported for the install check. */
export function collectSkills() {
  if (!existsSync(SKILLS_DIR)) return [];
  const out = [];
  for (const entry of readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(SKILLS_DIR, entry.name);
    const file = join(dir, "SKILL.md");
    if (!existsSync(file)) continue;
    const parsed = parseFrontmatter(readFileSync(file, "utf8"));
    if (!parsed) {
      throw new Error(`dsh-deepseek-skills: skills/${entry.name}/SKILL.md has no name/description frontmatter`);
    }
    if (parsed.name !== entry.name) {
      throw new Error(
        `dsh-deepseek-skills: skills/${entry.name}/SKILL.md declares name "${parsed.name}"`,
      );
    }
    out.push({ dir, ...parsed });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function apply(ctx) {
  // The two nested plugins keep their own registrations, prompt sections and references.
  applyHarness(ctx);
  applySenior(ctx);

  // The folder skills are registered here, with the skill's own directory as the resource base
  // so any relative `references/...` path inside the body resolves as written.
  for (const skill of collectSkills()) {
    ctx.effect(() =>
      ctx.skills.register({
        name: skill.name,
        description: skill.description,
        whenToUse: skill.description,
        source: "dsh-deepseek-skills",
        resourceBase: { kind: "directory", path: skill.dir },
        content: skill.body,
      }),
    );
  }
}
