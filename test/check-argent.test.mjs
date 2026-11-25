/**
 * Pins the plugin's SessionStart hook (plugins/argent/hooks): that hooks.json (Claude
 * Code) and codex.json (Codex) still start check-argent.mjs, and that the script
 * stays silent when `argent` is on PATH and tells the agent how to install it when
 * it isn't. The script is run for real against a PATH this test controls.
 *
 * Run: node --test test/check-argent.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = fileURLToPath(new URL("../plugins/argent/", import.meta.url));
const HOOK_SCRIPT = join(PLUGIN_ROOT, "hooks", "check-argent.mjs");
const isWindows = process.platform === "win32";

/**
 * Runs the hook with PATH set to `pathDirs` alone. node itself is spawned by its
 * absolute path, so the PATH under test decides only whether `argent` is found.
 * @param {string[]} pathDirs
 * @param {string[]} [args] what the hooks file passes after the script
 */
function runHook(pathDirs, args = []) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "PATH")
  );
  env.PATH = pathDirs.join(isWindows ? ";" : ":");
  return spawnSync(process.execPath, [HOOK_SCRIPT, ...args], { encoding: "utf8", env });
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
 * macOS and Linux, a .cmd shim on Windows.
 * @param {string} dir
 * @param {{ executable?: boolean }} [options]
 */
function writeFakeArgent(dir, { executable = true } = {}) {
  if (isWindows) {
    writeFileSync(join(dir, "argent.cmd"), "@echo off\r\n");
  } else {
    writeFileSync(join(dir, "argent"), "#!/bin/sh\n", { mode: executable ? 0o755 : 0o644 });
  }
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

test("prints nothing when argent is on PATH", (t) => {
  const bin = tempDir(t);
  writeFakeArgent(bin);
  const result = runHook([tempDir(t), bin]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
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
