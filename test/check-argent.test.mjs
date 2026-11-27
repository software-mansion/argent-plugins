/**
 * Pins the plugin's SessionStart hook (plugins/argent/hooks): that hooks.json (Claude
 * Code) and codex.json (Codex) still start check-argent.mjs, and that the script
 * stays silent when `argent` is on PATH at the plugin's version, tells the agent
 * how to install it when it isn't on PATH, and how to update Argent or the plugin
 * when the versions differ. The script is run for real against a PATH this test
 * controls.
 *
 * Run: node --test test/check-argent.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = fileURLToPath(new URL("../plugins/argent/", import.meta.url));
const HOOK_SCRIPT = join(PLUGIN_ROOT, "hooks", "check-argent.mjs");
const PLUGIN_VERSION = JSON.parse(
  readFileSync(join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"), "utf8")
).version;
const isWindows = process.platform === "win32";

/**
 * Runs the hook with PATH set to `pathDirs` alone. node itself is spawned by its
 * absolute path, so the PATH under test decides only whether `argent` is found.
 * @param {string[]} pathDirs
 * @param {string[]} [args] what the hooks file passes after the script
 * @param {string} [script] the hook to run, by default the plugin's own
 */
function runHook(pathDirs, args = [], script = HOOK_SCRIPT) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "PATH")
  );
  env.PATH = pathDirs.join(isWindows ? ";" : ":");
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env });
}

/**
 * A throwaway directory, removed after the test.
 * @param {import("node:test").TestContext} t
 */
function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "claude-plugin-hook-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * An `argent` stand-in the way npm installs one globally: an executable script on
 * macOS and Linux, a .cmd shim on Windows. Whatever it's run with, it prints
 * `version`, if given, and exits with `exitCode`.
 * @param {string} dir
 * @param {{ executable?: boolean, version?: string, exitCode?: number }} [options]
 */
function writeFakeArgent(dir, { executable = true, version, exitCode = 0 } = {}) {
  if (isWindows) {
    const lines = ["@echo off", ...(version ? [`echo ${version}`] : []), `exit /b ${exitCode}`];
    writeFileSync(join(dir, "argent.cmd"), lines.join("\r\n") + "\r\n");
  } else {
    const lines = ["#!/bin/sh", ...(version ? [`echo ${version}`] : []), `exit ${exitCode}`];
    writeFileSync(join(dir, "argent"), lines.join("\n") + "\n", {
      mode: executable ? 0o755 : 0o644,
    });
  }
}

/**
 * A copy of the hook in a plugin folder of its own, whose Claude Code and Codex
 * manifests name the given versions, so a test can pick the plugin's version.
 * Returns the copied script.
 * @param {import("node:test").TestContext} t
 * @param {{ claude: string, codex?: string }} versions
 */
function pluginCopy(t, { claude, codex = claude }) {
  const root = tempDir(t);
  mkdirSync(join(root, "hooks"));
  const script = join(root, "hooks", "check-argent.mjs");
  copyFileSync(HOOK_SCRIPT, script);
  for (const [folder, version] of [
    [".claude-plugin", claude],
    [".codex-plugin", codex],
  ]) {
    mkdirSync(join(root, folder));
    writeFileSync(join(root, folder, "plugin.json"), JSON.stringify({ name: "argent", version }));
  }
  return script;
}

/**
 * Runs a copy of the hook whose plugin is at `pluginVersion`, with an `argent`
 * on PATH that reports `argentVersion`.
 * @param {import("node:test").TestContext} t
 * @param {string} pluginVersion
 * @param {string} argentVersion
 * @param {string[]} [args]
 */
function runWithVersions(t, pluginVersion, argentVersion, args = []) {
  const bin = tempDir(t);
  writeFakeArgent(bin, { version: argentVersion });
  return runHook([bin], args, pluginCopy(t, { claude: pluginVersion }));
}

test("hooks.json starts check-argent.mjs with node on every SessionStart", () => {
  const config = JSON.parse(readFileSync(join(PLUGIN_ROOT, "hooks", "hooks.json"), "utf8"));
  const groups = config.hooks.SessionStart;
  assert.equal(groups.length, 1);
  // No matcher: the note has to come back after /clear and compaction too.
  assert.equal(groups[0].matcher, undefined);
  assert.deepEqual(groups[0].hooks, [
    {
      type: "command",
      command: "node",
      args: ["${CLAUDE_PLUGIN_ROOT}/hooks/check-argent.mjs"],
    },
  ]);
  assert.ok(existsSync(HOOK_SCRIPT), `${HOOK_SCRIPT} is missing`);
});

test("codex.json starts check-argent.mjs for Codex on every SessionStart", () => {
  const manifest = JSON.parse(
    readFileSync(join(PLUGIN_ROOT, ".codex-plugin", "plugin.json"), "utf8")
  );
  // Pointing Codex at its own file also stops it reading hooks.json, which it would
  // run without `args`.
  assert.equal(manifest.hooks, "./hooks/codex.json");
  const config = JSON.parse(readFileSync(join(PLUGIN_ROOT, "hooks", "codex.json"), "utf8"));
  const groups = config.hooks.SessionStart;
  assert.equal(groups.length, 1);
  assert.equal(groups[0].matcher, undefined);
  assert.deepEqual(groups[0].hooks, [
    { type: "command", command: 'node "${PLUGIN_ROOT}/hooks/check-argent.mjs" codex' },
  ]);
});

test("prints nothing when argent on PATH is at the plugin's version", (t) => {
  const bin = tempDir(t);
  writeFakeArgent(bin, { version: PLUGIN_VERSION });
  const result = runHook([tempDir(t), bin]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("prints nothing when argent on PATH doesn't report a version", (t) => {
  for (const fake of [{}, { version: "unknown" }, { version: "0.1.0", exitCode: 1 }]) {
    const bin = tempDir(t);
    writeFakeArgent(bin, fake);
    const result = runHook([bin]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "", JSON.stringify(fake));
  }
});

test("tells Claude to offer an Argent update when argent is older than the plugin", (t) => {
  // 0.9.0 sorts after 0.35.0 as text, so this also pins the numeric comparison.
  const result = runWithVersions(t, "0.35.0", "0.9.0");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.match(
    result.stdout,
    /The Argent plugin for Claude Code has the skills from Argent 0\.35\.0/
  );
  assert.match(result.stdout, /the `argent` command on PATH is the older Argent 0\.9\.0/);
  assert.match(result.stdout, /`argent update --yes --global --version 0\.35\.0`/);
  // Tied to Argent's first use, not to whether the request "needs Argent": an
  // agent asked to run an app and check it judged that it didn't, then used
  // Argent for every step and never mentioned the mismatch.
  assert.match(result.stdout, /The first time you call an Argent tool or run an `argent` command/);
  assert.match(result.stdout, /Run the update only after they agree\./);
  assert.match(result.stdout, /Reconnect for plugin:argent:argent in \/mcp/);
  assert.doesNotMatch(result.stdout, /not on PATH/);
});

test("tells Claude to offer a plugin update when argent is newer than the plugin", (t) => {
  const result = runWithVersions(t, "0.35.0", "0.36.1");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /the `argent` command on PATH is the newer Argent 0\.36\.1/);
  assert.match(result.stdout, /follow the server/);
  assert.match(result.stdout, /The first time you call an Argent tool or run an `argent` command/);
  assert.match(result.stdout, /`claude plugin update`/);
  assert.match(result.stdout, /\/reload-plugins/);
  assert.doesNotMatch(result.stdout, /argent update/);
});

test("a prerelease counts as the release it leads up to", (t) => {
  assert.equal(runWithVersions(t, "0.36.0", "0.36.0-next.3").stdout, "");
  assert.match(
    runWithVersions(t, "0.35.0", "0.36.0-next.3").stdout,
    /the newer Argent 0\.36\.0-next\.3/
  );
  assert.match(runWithVersions(t, "0.37.0", "0.36.0-next.3").stdout, /the older Argent/);
});

test("names Codex's update steps when Codex runs the hook", (t) => {
  const older = runWithVersions(t, "0.35.0", "0.34.0", ["codex"]);
  assert.match(older.stdout, /The Argent plugin for Codex has the skills/);
  assert.match(older.stdout, /the user has to restart Codex before the new tools appear/);
  assert.doesNotMatch(older.stdout, /Claude|\/mcp/);

  const newer = runWithVersions(t, "0.35.0", "0.36.0", ["codex"]);
  assert.match(newer.stdout, /`codex plugin marketplace upgrade`, then `codex plugin add`/);
  assert.match(newer.stdout, /after the user restarts Codex/);
  assert.doesNotMatch(newer.stdout, /Claude|\/plugin |\/reload-plugins/);
});

test("compares against the manifest of the tool that runs the hook", (t) => {
  const bin = tempDir(t);
  writeFakeArgent(bin, { version: "0.35.0" });
  const script = pluginCopy(t, { claude: "0.35.0", codex: "0.34.0" });
  assert.equal(runHook([bin], [], script).stdout, "");
  assert.match(runHook([bin], ["codex"], script).stdout, /the newer Argent 0\.35\.0/);
});

test("tells Claude to offer the install when argent is missing", (t) => {
  const result = runHook([tempDir(t)]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /The Argent plugin for Claude Code is enabled/);
  assert.match(result.stdout, /the `argent` command is not on PATH/);
  assert.match(result.stdout, /offer to install it with `npm install -g @swmansion\/argent`/);
  assert.match(result.stdout, /Run the install only after they agree\./);
  assert.match(result.stdout, /Reconnect for plugin:argent:argent in \/mcp/);
  assert.ok(result.stdout.includes(`The Node.js on PATH is ${process.version}.`), result.stdout);
  assert.match(result.stdout, /npm view @swmansion\/argent engines\.node/);
});

test("names Codex and its restart when Codex runs the hook", (t) => {
  const result = runHook([tempDir(t)], ["codex"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /The Argent plugin for Codex is enabled/);
  assert.match(result.stdout, /MCP server \(argent\) could not start/);
  assert.match(result.stdout, /the user has to restart Codex before Argent's tools appear/);
  assert.match(result.stdout, /Don't suggest `argent init` for Codex/);
  assert.doesNotMatch(result.stdout, /Claude|\/mcp/);
});

test("an empty PATH counts as argent missing", () => {
  const result = runHook([]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /the `argent` command is not on PATH/);
});

test(
  "an argent file without the execute bit counts as missing",
  { skip: isWindows && "Windows has no execute bit" },
  (t) => {
    const bin = tempDir(t);
    writeFakeArgent(bin, { executable: false });
    const result = runHook([bin]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /the `argent` command is not on PATH/);
  }
);
