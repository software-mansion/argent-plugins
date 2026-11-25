/**
 * Runs scripts/sync-skills.mjs against throwaway argent checkouts and plugin
 * folders: what a sync copies, removes and rewrites, what it refuses, and what
 * --check reports.
 *
 * Run: node --test test/sync-skills.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../scripts/sync-skills.mjs", import.meta.url));
const REAL_MANIFEST = fileURLToPath(
  new URL("../plugin/.claude-plugin/plugin.json", import.meta.url)
);

// Formatted like the real plugin.json, so a test can tell a rewrite of the
// version value from a rewrite of the whole file.
const manifest = (/** @type {string} */ version) => `{
  "name": "argent",
  "version": "${version}",
  "mcpServers": {
    "argent": {
      "type": "stdio",
      "command": "argent",
      "args": ["mcp"]
    }
  }
}
`;

const RELEASE_SKILLS = {
  "argent-a/SKILL.md": "---\ndescription: a\n---\nA, as released\n",
  "argent-b/SKILL.md": "---\ndescription: b\n---\nB\n",
  "argent-b/references/notes.md": "notes\n",
};

/**
 * A throwaway directory, removed after the test.
 * @param {import("node:test").TestContext} t
 */
function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "sync-skills-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * @param {string} root
 * @param {Record<string, string>} files relative path -> content
 */
function writeFiles(root, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

/**
 * @param {string} prefix
 * @param {Record<string, string>} skills
 */
function under(prefix, skills) {
  return Object.fromEntries(Object.entries(skills).map(([path, c]) => [`${prefix}/${path}`, c]));
}

/**
 * A checkout of the argent repository at `version`.
 * @param {import("node:test").TestContext} t
 * @param {string} version
 * @param {Record<string, string>} skills
 */
function argentCheckout(t, version, skills) {
  const root = tempDir(t);
  writeFiles(root, {
    "packages/skills/package.json": JSON.stringify({ name: "@argent/skills", version }),
    ...under("packages/skills/skills", skills),
  });
  return root;
}

/**
 * A plugin folder at `version`.
 * @param {import("node:test").TestContext} t
 * @param {string} version
 * @param {Record<string, string>} skills
 */
function pluginFolder(t, version, skills) {
  const root = tempDir(t);
  writeFiles(root, { ".claude-plugin/plugin.json": manifest(version), ...under("skills", skills) });
  return root;
}

/**
 * @param {string} source
 * @param {string} plugin
 * @param {string} version
 * @param {...string} extra
 */
function sync(source, plugin, version, ...extra) {
  return spawnSync(
    process.execPath,
    [SCRIPT, "--source", source, "--plugin", plugin, "--version", version, ...extra],
    { encoding: "utf8" }
  );
}

/**
 * @param {string} plugin
 * @param {string} path
 */
const read = (plugin, path) => readFileSync(join(plugin, path), "utf8");

test("copies the release's skills, drops the ones it no longer has, and sets the version", (t) => {
  const source = argentCheckout(t, "0.35.0", RELEASE_SKILLS);
  const plugin = pluginFolder(t, "0.34.0", {
    "argent-a/SKILL.md": "A, older\n",
    "argent-retired/SKILL.md": "gone in 0.35.0\n",
  });

  const result = sync(source, plugin, "0.35.0");

  assert.equal(result.status, 0, result.stderr);
  for (const [path, content] of Object.entries(RELEASE_SKILLS)) {
    assert.equal(read(plugin, `skills/${path}`), content);
  }
  assert.ok(!existsSync(join(plugin, "skills", "argent-retired")));
  assert.equal(read(plugin, ".claude-plugin/plugin.json"), manifest("0.35.0"));
});

test("sets the version in the real plugin.json without touching anything else", (t) => {
  const source = argentCheckout(t, "9.9.9", RELEASE_SKILLS);
  const plugin = tempDir(t);
  const original = readFileSync(REAL_MANIFEST, "utf8");
  writeFiles(plugin, { ".claude-plugin/plugin.json": original });

  const result = sync(source, plugin, "9.9.9");

  assert.equal(result.status, 0, result.stderr);
  const updated = read(plugin, ".claude-plugin/plugin.json");
  assert.deepEqual(JSON.parse(updated), { ...JSON.parse(original), version: "9.9.9" });
  assert.equal(updated.split("\n").length, original.split("\n").length);
});

test("leaves files an operating system drops behind out of the copy", (t) => {
  const source = argentCheckout(t, "0.35.0", {
    ...RELEASE_SKILLS,
    ".DS_Store": "",
    "argent-a/Thumbs.db": "",
  });
  const plugin = pluginFolder(t, "0.34.0", {});

  assert.equal(sync(source, plugin, "0.35.0").status, 0);
  assert.ok(!existsSync(join(plugin, "skills", ".DS_Store")));
  assert.ok(!existsSync(join(plugin, "skills", "argent-a", "Thumbs.db")));
});

test("refuses a checkout of another release and changes nothing", (t) => {
  const source = argentCheckout(t, "0.34.0", RELEASE_SKILLS);
  const plugin = pluginFolder(t, "0.34.0", { "argent-a/SKILL.md": "A, older\n" });

  const result = sync(source, plugin, "0.35.0");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /is at 0\.34\.0, not 0\.35\.0/);
  assert.equal(read(plugin, "skills/argent-a/SKILL.md"), "A, older\n");
  assert.equal(read(plugin, ".claude-plugin/plugin.json"), manifest("0.34.0"));
});

test("refuses a prerelease", (t) => {
  const source = argentCheckout(t, "0.35.0-next.1", RELEASE_SKILLS);
  const plugin = pluginFolder(t, "0.34.0", {});

  const result = sync(source, plugin, "0.35.0-next.1");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /not a stable X\.Y\.Z version/);
});

test("refuses a checkout without skills and changes nothing", (t) => {
  const source = argentCheckout(t, "0.35.0", {});
  const plugin = pluginFolder(t, "0.34.0", { "argent-a/SKILL.md": "A, older\n" });

  const result = sync(source, plugin, "0.35.0");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /has no skills/);
  assert.equal(read(plugin, "skills/argent-a/SKILL.md"), "A, older\n");
});

test("--check passes when the plugin matches the release", (t) => {
  const source = argentCheckout(t, "0.35.0", RELEASE_SKILLS);
  const plugin = pluginFolder(t, "0.35.0", RELEASE_SKILLS);

  const result = sync(source, plugin, "0.35.0", "--check");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /matches Argent 0\.35\.0/);
});

test("--check lists every difference and changes nothing", (t) => {
  const source = argentCheckout(t, "0.35.0", RELEASE_SKILLS);
  const plugin = pluginFolder(t, "0.34.0", {
    "argent-a/SKILL.md": "A, edited here\n",
    "argent-b/SKILL.md": RELEASE_SKILLS["argent-b/SKILL.md"],
    "argent-c/SKILL.md": "added here\n",
  });

  const result = sync(source, plugin, "0.35.0", "--check");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /plugin\.json version is 0\.34\.0, not 0\.35\.0/);
  assert.match(result.stderr, /changed: skills\/argent-a\/SKILL\.md/);
  assert.match(result.stderr, /missing: skills\/argent-b\/references\/notes\.md/);
  assert.match(result.stderr, /extra: skills\/argent-c\/SKILL\.md/);
  assert.equal(read(plugin, "skills/argent-a/SKILL.md"), "A, edited here\n");
  assert.equal(read(plugin, ".claude-plugin/plugin.json"), manifest("0.34.0"));
});
