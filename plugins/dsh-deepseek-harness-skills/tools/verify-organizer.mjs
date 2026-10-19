// PART-003 verification: is the `organizer` skill registered, pinned, and shippable?
//
//   node tools/verify-organizer.mjs
//
// Run from the plugin root (the directory holding index.js). Exits 0 only when every check
// passes. Every check prints the real observation it made, so a reader can see WHAT was
// verified rather than being told that it was.
//
// What this proves and what it does not:
//   * it proves the plugin module registers the three expected skills and three expected
//     prompt sections, that every declared resource base exists on disk, and that the text
//     handed to the harness is byte-identical to the markdown on disk with no live template
//     placeholder left in it;
//   * it does NOT prove the running app renders the section. A running surface keeps the
//     previously imported module in memory until it restarts, so that step is reported as an
//     unavailable check rather than silently claimed.

import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pluginRoot = fileURLToPath(new URL("../", import.meta.url));
const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

let failures = 0;
const check = (label, fn) => {
  try {
    const observation = fn();
    console.log(`PASS ${label}${observation ? ` -- ${observation}` : ""}`);
  } catch (error) {
    failures += 1;
    process.exitCode = 1;
    console.log(`FAIL ${label}: ${error.message}`);
  }
};
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

// The harness resolves the scale policy through this table. Only TEAM_POLICY is needed here;
// the literal fallback is what the plugin uses when the key is missing.
const SECTION_ORDERS = { TEAM_POLICY: 600 };

const makeCtx = () => {
  const state = { sections: [], skills: [], effects: 0 };
  const ctx = {
    systemPrompt: {
      getSectionOrder: (name) => SECTION_ORDERS[name],
      section: (section) => {
        state.sections.push(section);
        return () => {};
      },
    },
    skills: {
      register: (skill) => {
        state.skills.push(skill);
        return () => {};
      },
    },
    effect: (fn) => {
      state.effects += 1;
      fn();
      return () => {};
    },
    on: () => () => {},
    logger: { warn: () => {}, info: () => {} },
  };
  return { ctx, state };
};

const mod = await import(new URL("../index.js", import.meta.url));
const live = makeCtx();
mod.apply(live.ctx);

const byName = (list, name) => list.find((entry) => entry.name === name);

check("plugin still exports the expected identity", () => {
  assert(mod.name === "dsh-deepseek-harness-skills", `name is ${mod.name}`);
  assert(
    JSON.stringify(mod.inject) === JSON.stringify(["systemPrompt", "skills"]),
    `inject is ${JSON.stringify(mod.inject)}`,
  );
  return `name=${mod.name} inject=${mod.inject.join("+")}`;
});

check("exactly three skills are registered", () => {
  const names = live.state.skills.map((skill) => skill.name).sort();
  assert(
    JSON.stringify(names) === JSON.stringify(["organizer", "plannable", "sandbox-mode"]),
    `registered: ${names.join(", ")}`,
  );
  return names.join(", ");
});

check("exactly three prompt sections are registered", () => {
  const names = live.state.sections.map((section) => section.name).sort();
  assert(
    JSON.stringify(names) ===
      JSON.stringify([
        "deepseek-harness:organizer-policy",
        "deepseek-harness:scale-policy",
        "deepseek-harness:skills-policy",
      ]),
    `registered: ${names.join(", ")}`,
  );
  return names.join(", ");
});

check("organizer-policy renders at order 170", () => {
  const section = byName(live.state.sections, "deepseek-harness:organizer-policy");
  assert(section, "organizer-policy section is missing");
  assert(section.order === 170, `order is ${section.order}`);
  assert(typeof section.text === "function", "text is not a live reader function");
  // Byte length, not UTF-16 code units: the file contains em dashes, so the two differ.
  return `order=${section.order} bytes=${Buffer.byteLength(section.text())}`;
});

check("organizer skill declares an on-disk resource base", () => {
  const skill = byName(live.state.skills, "organizer");
  assert(skill, "organizer is not registered");
  assert(skill.resourceBase?.kind === "directory", "resourceBase is not a directory base");
  assert(existsSync(skill.resourceBase.path), `path does not exist: ${skill.resourceBase.path}`);
  assert(statSync(skill.resourceBase.path).isDirectory(), "resource base is not a directory");
  return skill.resourceBase.path;
});

check("every declared resource base exists on disk", () => {
  const observed = [];
  for (const skill of live.state.skills) {
    const base = skill.resourceBase;
    if (base?.kind !== "directory") {
      observed.push(`${skill.name}:${base?.kind ?? "none"}`);
      continue;
    }
    assert(existsSync(base.path), `${skill.name} base missing: ${base.path}`);
    observed.push(`${skill.name}:ok`);
  }
  return observed.join(" ");
});

check("organizer content is byte-identical to prompts/organizer.md", () => {
  const skill = byName(live.state.skills, "organizer");
  const onDisk = read("../prompts/organizer.md");
  // The plugin escapes non-builtin {{...}} before handing text to the harness. `organizer.md`
  // contains no such placeholder, so the two must be equal exactly.
  assert(
    skill.content === onDisk,
    `content differs: registered ${Buffer.byteLength(skill.content)} bytes vs file ${Buffer.byteLength(onDisk)} bytes`,
  );
  // Byte length, not UTF-16 code units: the file contains em dashes, so the two differ.
  return `${Buffer.byteLength(onDisk)} bytes`;
});

check("the registered organizer text carries no live template placeholder", () => {
  const skill = byName(live.state.skills, "organizer");
  const placeholders = skill.content.match(/\{\{(?:cwd|model|provider)\}\}/g) ?? [];
  assert(placeholders.length === 0, `unexpected template placeholder(s): ${placeholders.join(", ")}`);
  return "none";
});

check("whenToUse pins the skill as always-on", () => {
  const skill = byName(live.state.skills, "organizer");
  assert(
    /Always-on: load it on every turn\.$/.test(skill.whenToUse),
    `whenToUse does not end with the pin sentence: "${skill.whenToUse}"`,
  );
  return skill.whenToUse.slice(-42);
});

check("the skills policy pins organizer as always-on", () => {
  const policy = read("../prompts/skills-policy.md");
  assert(/Nine skills are always-on/.test(policy), "the always-on count was not updated");
  assert(/`organizer`/.test(policy), "organizer is not named in the always-on rule");
  assert(
    /call `skill` with `organizer`/.test(policy),
    "the greeting sequence does not load organizer",
  );
  return "nine always-on, organizer named and sequenced";
});

check("the four bundled reference modules exist and resolve against the base", () => {
  const base = byName(live.state.skills, "organizer").resourceBase.path;
  const modules = ["sources.md", "paths.md", "safety.md", "backups.md"];
  const sizes = [];
  for (const name of modules) {
    const path = `${base}\\${name}`;
    assert(existsSync(path), `missing module: ${name}`);
    sizes.push(`${name}=${statSync(path).size}B`);
  }
  // The body names the modules as bare filenames and states the base directory once. A row
  // written as `references/organizer/<name>` would resolve against this base to a doubled path
  // (references/organizer/references/organizer/<name>), and a substring check would not notice.
  const body = read("../prompts/organizer.md");
  for (const name of modules) {
    assert(body.includes(`\`${name}\``), `the body's bundled-references table omits ${name}`);
    assert(
      !body.includes(`references/organizer/${name}`),
      `the body names ${name} with the base path prefixed, which doubles when resolved`,
    );
  }
  assert(
    body.includes("references/organizer/"),
    "the body no longer states the resource base directory for the modules",
  );
  return sizes.join(" ");
});

check("no section name collides with a harness-owned name", () => {
  const harnessNames = [
    "harness:identity",
    "deployment:persona-prefix",
    "deployment:persona-suffix",
    "team:policy",
    "plan:policy",
    "tool:subagent",
    "file-reference",
  ];
  const collisions = live.state.sections
    .map((section) => section.name)
    .filter((name) => harnessNames.includes(name));
  assert(collisions.length === 0, `collision(s): ${collisions.join(", ")}`);
  return "none";
});

check("the plugin module can be imported twice without state leaking", () => {
  const second = makeCtx();
  mod.apply(second.ctx);
  assert(
    second.state.skills.length === live.state.skills.length,
    `second apply registered ${second.state.skills.length} skills, first registered ${live.state.skills.length}`,
  );
  assert(
    second.state.sections.length === live.state.sections.length,
    `second apply registered ${second.state.sections.length} sections`,
  );
  return `skills=${second.state.skills.length} sections=${second.state.sections.length}`;
});

console.log("");
console.log(`plugin root: ${pluginRoot}`);
if (failures === 0) {
  console.log("ORGANIZER REGISTRATION OK -- every check passed");
} else {
  console.log(`ORGANIZER REGISTRATION FAILED -- ${failures} check(s) failed`);
}
