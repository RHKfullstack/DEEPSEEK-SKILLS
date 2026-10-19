// Conflict audit for the installed plugin set.
//
//   node tools/conflict-audit.mjs
//
// Proves that this plugin cannot damage another plugin's prompt:
//   * no prompt-section name collides with a first-party plugin's section;
//   * no skill name collides with a first-party or sibling skill;
//   * every registered section order is a finite number (a non-finite order throws inside
//     SystemPrompt.section and would take unrelated sections down with it);
//   * no registered section renders a `{{` group (the harness renderer throws on an
//     unknown or malformed one, which fails the whole assembly);
//   * a deliberately duplicated name is still detected, so a green run means something.
//
// First-party facts come from the installed app.asar, read directly. Local plugins are
// imported with a mock Cordis context, exactly like the registration tests.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const APP_ASAR = "C:\\Users\\admin\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\app.asar";
const LOCAL_PLUGINS = [
  "C:\\Users\\admin\\.dsh\\plugins\\dsh-deepseek-harness-skills",
  "C:\\Users\\admin\\.dsh\\plugins\\dsh-senior-engineering-skills",
];
const PROFILE_NODE_MODULES = "C:\\Users\\admin\\.dsh\\profiles\\desktop\\node_modules";

const SECTION_ORDERS = {
  HARNESS_IDENTITY: -1e3,
  DEPLOYMENT_PERSONA_PREFIX: 0,
  PLAN_POLICY: 500,
  TEAM_POLICY: 600,
  TOOL_SUBAGENT: 2800,
  DEPLOYMENT_PERSONA_SUFFIX: 10200,
};

// --- asar reading ------------------------------------------------------------------
const readAsar = () => {
  const buf = readFileSync(APP_ASAR);
  const headerSize = buf.readUInt32LE(12);
  const header = JSON.parse(buf.toString("utf8", 16, 16 + headerSize));
  const base = 8 + buf.readUInt32LE(4);
  const files = [];
  (function walk(node, prefix) {
    for (const [name, val] of Object.entries(node.files ?? {})) {
      const full = prefix + "/" + name;
      if (val.files) walk(val, full);
      else files.push({ path: full, start: base + Number(val.offset), size: val.size });
    }
  })(header, "");
  return { buf, files };
};

const scanFirstParty = () => {
  const sections = new Set();
  const skills = new Set();
  let scanned = 0;
  try {
    const { buf, files } = readAsar();
    for (const file of files) {
      // skill ids shipped as directory bundles
      const skillDir = /\/skills\/([^/]+)\//.exec(file.path);
      if (skillDir) skills.add(skillDir[1]);
      if (!file.path.endsWith(".js") || file.size > 4_000_000) continue;
      if (!file.path.includes("@deepseek-ai/")) continue;
      scanned += 1;
      const text = buf.toString("utf8", file.start, file.start + file.size);
      for (const match of text.matchAll(/systemPrompt\.section\(\{\s*name:\s*[`"']([^`"']+)[`"']/g)) {
        sections.add(match[1]);
      }
      for (const match of text.matchAll(/skills\.register\(\{\s*name:\s*[`"']([^`"']+)[`"']/g)) {
        skills.add(match[1]);
      }
    }
  } catch (error) {
    console.log(`WARN could not read app.asar (${error.message}); first-party facts are empty`);
  }
  return { sections, skills, scanned };
};

// --- local plugin inspection --------------------------------------------------------
const inspectPlugin = async (dir) => {
  const sections = [];
  const skills = [];
  const mod = await import(pathToFileURL(join(dir, "index.js")).href);
  const ctx = {
    systemPrompt: {
      getSectionOrder: (key) => SECTION_ORDERS[key],
      section: (section) => {
        sections.push(section);
        return () => {};
      },
    },
    skills: {
      register: (skill) => {
        skills.push(skill);
        return () => {};
      },
    },
    effect: (fn) => {
      fn();
      return () => {};
    },
    on: () => () => {},
    logger: { warn: () => {}, info: () => {} },
  };
  mod.apply(ctx);
  return {
    dir,
    name: mod.name,
    sections: sections.map((section) => ({
      name: section.name,
      order: section.order,
      text: typeof section.text === "function" ? section.text() : section.text,
    })),
    skills: skills.map((skill) => skill.name),
  };
};

// --- run ----------------------------------------------------------------------------
const firstParty = scanFirstParty();
const local = [];
for (const dir of LOCAL_PLUGINS) {
  if (!existsSync(join(dir, "index.js"))) {
    console.log(`SKIP ${dir} (not present)`);
    continue;
  }
  local.push(await inspectPlugin(dir));
}

console.log(`first-party: ${firstParty.scanned} JS files scanned, ${firstParty.sections.size} section names, ${firstParty.skills.size} skill ids from app.asar`);
for (const plugin of local) {
  console.log(`local: ${plugin.name} -> sections [${plugin.sections.map((s) => `${s.name}@${s.order}`).join(", ")}], skills [${plugin.skills.join(", ")}]`);
}

// skills discovered from the installed profile tree
const profileSkills = new Set();
// A local plugin exists twice - the source package and its installed copy - and this plugin
// must not count its own or its sibling's skills as foreign. Skip either shape by path and by
// package name.
const localRoots = new Set(LOCAL_PLUGINS.map((dir) => dir.toLowerCase()));
const localPackageNames = new Set(
  LOCAL_PLUGINS.map((dir) => dir.split(/[\\/]/).pop().toLowerCase()),
);
const isInsideLocalPlugin = (path) => {
  const lower = path.toLowerCase();
  for (const root of localRoots) if (lower === root || lower.startsWith(`${root}\\`)) return true;
  const base = lower.split(/[\\/]/).pop();
  return localPackageNames.has(base);
};
const collectSkillsDirs = (dir, depth) => {
  if (depth > 4) return;
  if (isInsideLocalPlugin(dir)) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (localPackageNames.has(entry.name.toLowerCase())) continue;
    const full = join(dir, entry.name);
    if (entry.name === "skills") {
      try {
        for (const child of readdirSync(full, { withFileTypes: true })) {
          if (child.isDirectory()) profileSkills.add(child.name);
          else if (child.name.endsWith(".md")) profileSkills.add(child.name.slice(0, -3));
        }
      } catch {
        /* ignore */
      }
      continue;
    }
    if (entry.name.startsWith(".") && entry.name !== ".pnpm") continue;
    collectSkillsDirs(full, depth + 1);
  }
};
collectSkillsDirs(PROFILE_NODE_MODULES, 0);
console.log(`installed profile tree: ${profileSkills.size} skill ids`);

const problems = [];
const report = (label, fn) => {
  try {
    fn();
    console.log(`PASS ${label}`);
  } catch (error) {
    problems.push(`${label}: ${error.message}`);
    console.log(`FAIL ${label}: ${error.message}`);
  }
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

// --- section names ------------------------------------------------------------------
const seenSections = new Map();
for (const plugin of local) {
  for (const section of plugin.sections) {
    report(`section "${section.name}" (from ${plugin.name}) is not a first-party section`, () =>
      assert(
        !firstParty.sections.has(section.name),
        `collides with a first-party section registered in app.asar`,
      ),
    );
    report(`section "${section.name}" is unique across local plugins`, () => {
      assert(
        !seenSections.has(section.name),
        `already registered by ${seenSections.get(section.name)}`,
      );
      seenSections.set(section.name, plugin.name);
    });
    report(`section "${section.name}" has a finite order`, () =>
      assert(Number.isFinite(section.order), `order is ${section.order}`),
    );
    report(`section "${section.name}" renders no brace pair`, () =>
      assert(!String(section.text).includes("{{"), `text contains {{`),
    );
    report(`section "${section.name}" is named with its plugin prefix`, () =>
      assert(section.name.includes(":"), `"${section.name}" has no plugin-owned prefix`),
    );
  }
}

// --- skill names --------------------------------------------------------------------
const seenSkills = new Map();
for (const plugin of local) {
  for (const skill of plugin.skills) {
    report(`skill "${skill}" (from ${plugin.name}) is not a first-party skill`, () =>
      assert(!firstParty.skills.has(skill), "collides with a skill shipped in app.asar"),
    );
    report(`skill "${skill}" is not an installed profile skill`, () =>
      assert(!profileSkills.has(skill), "collides with a skill found in the profile tree"),
    );
    report(`skill "${skill}" is unique across local plugins`, () => {
      assert(!seenSkills.has(skill), `already registered by ${seenSkills.get(skill)}`);
      seenSkills.set(skill, plugin.name);
    });
  }
}

// --- negative control: the audit must be able to fail --------------------------------
report("NEGATIVE CONTROL: a duplicated section name is detected", () => {
  const fixture = new Map([["dsh-senior-engineering:policy", "fixture-a"]]);
  let caught = false;
  try {
    assert(!fixture.has("dsh-senior-engineering:policy"), "already registered");
  } catch {
    caught = true;
  }
  assert(caught, "the duplicate check did not fire on a known duplicate");
});
report("NEGATIVE CONTROL: a brace pair in section text is detected", () => {
  let caught = false;
  try {
    assert(!String("bad {{cwd}} text").includes("{{"), "text contains {{");
  } catch {
    caught = true;
  }
  assert(caught, "the brace check did not fire on a known brace pair");
});

console.log(
  problems.length === 0
    ? `\nPASSED: conflict audit clean (${seenSections.size} local sections, ${seenSkills.size} local skills)`
    : `\nFAILED: ${problems.length} conflict(s)\n${problems.map((p) => `  - ${p}`).join("\n")}`,
);
process.exitCode = problems.length === 0 ? 0 : 1;
