// Verify every URL cited by the senior skill bodies with a real HTTP request.
//
//   node tools/verify-skill-sources.mjs
//
// HEAD first, then GET as a fallback because several standards sites reject HEAD. Reports the
// ACTUAL status for each URL. Nothing here is a claim about content quality - only that the
// source resolves.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SKILLS_DIR = fileURLToPath(new URL("../skills/", import.meta.url));
const files = readdirSync(SKILLS_DIR).filter((name) => name.endsWith(".md")).sort();

// Example commands in the skill bodies contain obvious placeholders (curl https://HOST/).
// They are not citations, so they are reported separately instead of as failures.
const PLACEHOLDER_HOSTS = new Set(["host", "target", "example.com", "example.org", "localhost"]);
const isPlaceholder = (url) => {
  if (url.includes("<") || url.includes(">")) return true;
  try {
    return PLACEHOLDER_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return true;
  }
};

const byFile = new Map();
const all = new Set();
const placeholders = new Set();
for (const file of files) {
  const text = readFileSync(join(SKILLS_DIR, file), "utf8");
  const urls = [...new Set(text.match(/https?:\/\/[^\s)>\]`"',]+/g) ?? [])].map((url) =>
    url.replace(/[.,;:]+$/, ""),
  );
  const real = [];
  for (const url of urls) {
    if (isPlaceholder(url)) placeholders.add(url);
    else {
      real.push(url);
      all.add(url);
    }
  }
  byFile.set(file, real);
}

// Some standards hosts (csrc.nist.gov in particular) intermittently answer 404 or reset a
// HEAD under a rapid sweep while serving the same URL 200 to curl a second later. A single
// failure is therefore not evidence of a dead source: retry once before reporting.
const attempt = async (url, method) => {
  try {
    const response = await fetch(url, {
      method,
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
      headers: { "user-agent": "dsh-senior-engineering-skills source check" },
    });
    return { status: response.status, method, finalUrl: response.url };
  } catch (error) {
    return { status: "ERROR", method, error: String(error.message ?? error) };
  }
};

const check = async (url) => {
  const head = await attempt(url, "HEAD");
  if (typeof head.status === "number" && head.status < 400) return head;
  const get = await attempt(url, "GET");
  if (typeof get.status === "number" && get.status < 400) return get;
  await new Promise((resolve) => setTimeout(resolve, 2_500));
  const retry = await attempt(url, "GET");
  return { ...retry, retried: true, firstStatus: get.status };
};

const results = new Map();
for (const url of [...all].sort()) {
  results.set(url, await check(url));
}

let ok = 0;
let bad = 0;
for (const file of files) {
  console.log(`\n### ${file} (${byFile.get(file).length} URLs)`);
  for (const url of byFile.get(file)) {
    const result = results.get(url);
    const good = typeof result.status === "number" && result.status < 400;
    if (good) ok += 1;
    else bad += 1;
    console.log(`  ${good ? "OK  " : "BAD "} ${String(result.status).padEnd(5)} via ${result.method}  ${url}`);
  }
}

console.log(`\nunique URLs: ${all.size}`);
console.log(`resolving citations: ${ok}`);
console.log(`non-resolving citations: ${bad}`);
if (bad > 0) {
  console.log("\nNON-RESOLVING:");
  for (const [url, result] of results) {
    if (typeof result.status === "number" && result.status < 400) continue;
    console.log(`  ${result.status} ${url}${result.error ? ` (${result.error})` : ""}`);
  }
}
process.exitCode = bad === 0 ? 0 : 1;
