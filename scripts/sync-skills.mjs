#!/usr/bin/env node
// Makes the plugin match one Argent release: replaces plugin/skills with the
// skills from a checkout of the argent repository at tag v<version>, and sets
// the plugin's version to <version>. The sync workflow runs it for each new
// stable release.
//
// With --check it changes nothing and fails when the plugin differs from that
// release. CI runs it that way, because the skills are maintained in the argent
// repository and the next sync overwrites any edit made to them here.
//
//   node scripts/sync-skills.mjs --source <argent checkout> --version <X.Y.Z> [--check]
//
// --plugin <dir> points it at a plugin folder other than plugin/; the tests use it.

import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const USAGE =
  "Usage: node scripts/sync-skills.mjs --source <argent checkout> --version <X.Y.Z> [--check]";

// Where a checkout of the argent repository keeps the skills, and the manifest
// whose version tells which release the checkout is: every workspace package
// in that repository carries the release version.
const SOURCE_SKILLS = join("packages", "skills", "skills");
const SOURCE_MANIFEST = join("packages", "skills", "package.json");

// Files an operating system leaves behind. Anthropic's plugin directory
// refuses a plugin folder that contains any of them.
const OS_JUNK = new Set([".DS_Store", "Thumbs.db", "desktop.ini", "__MACOSX"]);

/** @param {string} message */
function fail(message) {
  console.error(message);
  process.exit(1);
}

/**
 * Every file under `dir` except OS junk, as sorted "/"-separated relative paths.
 * @param {string} dir
 */
function listFiles(dir) {
  /** @type {string[]} */
  const files = [];
  /** @param {string} current */
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (OS_JUNK.has(entry.name)) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.push(relative(dir, path).split(sep).join("/"));
    }
  };
  walk(dir);
  return files.sort();
}

/**
 * How the skills in `actualDir` differ from the ones in `expectedDir`, one line each.
 * @param {string} expectedDir
 * @param {string} actualDir
 */
function skillDifferences(expectedDir, actualDir) {
  const expected = listFiles(expectedDir);
  const actual = existsSync(actualDir) ? listFiles(actualDir) : [];
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const lines = [];
  for (const file of expected) {
    if (!actualSet.has(file)) {
      lines.push(`missing: skills/${file}`);
    } else if (!readFileSync(join(expectedDir, file)).equals(readFileSync(join(actualDir, file)))) {
      lines.push(`changed: skills/${file}`);
    }
  }
  for (const file of actual) {
    if (!expectedSet.has(file)) lines.push(`extra: skills/${file}`);
  }
  return lines;
}

/** @type {{ source?: string, version?: string, plugin: string, check: boolean }} */
let options;
try {
  ({ values: options } = parseArgs({
    options: {
      source: { type: "string" },
      version: { type: "string" },
      plugin: { type: "string", default: fileURLToPath(new URL("../plugin", import.meta.url)) },
      check: { type: "boolean", default: false },
    },
  }));
} catch (error) {
  fail(`${error.message}\n${USAGE}`);
}
const { source, version, plugin, check } = options;
if (!source || !version) fail(USAGE);

// Prereleases go to npm's `next` tag. The plugin follows stable releases only.
if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`${version} is not a stable X.Y.Z version.`);

let sourceVersion;
try {
  sourceVersion = JSON.parse(readFileSync(join(source, SOURCE_MANIFEST), "utf8")).version;
} catch (error) {
  fail(`${error.message}\nIs ${source} a checkout of the argent repository?`);
}
if (sourceVersion !== version) {
  fail(
    `${source} is at ${sourceVersion}, not ${version}. ` +
      `Check out tag v${version} of the argent repository.`
  );
}

const sourceSkills = join(source, SOURCE_SKILLS);
if (!existsSync(sourceSkills) || !listFiles(sourceSkills).some((f) => f.endsWith("/SKILL.md"))) {
  fail(`${sourceSkills} has no skills.`);
}

const manifestPath = join(plugin, ".claude-plugin", "plugin.json");
let manifestText;
try {
  manifestText = readFileSync(manifestPath, "utf8");
} catch (error) {
  fail(error.message);
}
const pluginSkills = join(plugin, "skills");

if (check) {
  const problems = skillDifferences(sourceSkills, pluginSkills);
  const pluginVersion = JSON.parse(manifestText).version;
  if (pluginVersion !== version) {
    problems.unshift(`plugin.json version is ${pluginVersion}, not ${version}`);
  }
  if (problems.length > 0) {
    console.error(`The plugin doesn't match Argent ${version}:`);
    for (const line of problems) console.error(`  ${line}`);
    console.error(
      "\nThe skills are maintained in the argent repository, in packages/skills/skills, and\n" +
        "the sync workflow copies each release here. Make skill changes there instead."
    );
    process.exit(1);
  }
  console.log(`The plugin matches Argent ${version}.`);
  process.exit(0);
}

// Only the value of the top-level "version" key is replaced, so the rest of
// plugin.json keeps its formatting. Top-level keys are the ones indented by
// exactly two spaces.
const versionLine = /^( {2}"version":\s*")[^"]*(")/m;
const updatedManifest = manifestText.replace(versionLine, `$1${version}$2`);
if (JSON.parse(updatedManifest).version !== version) {
  fail(`Can't find a top-level "version" key to set in ${manifestPath}.`);
}

rmSync(pluginSkills, { recursive: true, force: true });
cpSync(sourceSkills, pluginSkills, {
  recursive: true,
  filter: (path) => !OS_JUNK.has(basename(path)),
});
writeFileSync(manifestPath, updatedManifest);
console.log(
  `Copied ${listFiles(pluginSkills).length} skill files from Argent ${version} and set the plugin version.`
);
