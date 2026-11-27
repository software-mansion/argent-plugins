#!/usr/bin/env node
// SessionStart hook of the Argent plugin, wired up in hooks.json for Claude Code
// and in codex.json for Codex, which passes `codex` as the first argument.
//
// Installing the plugin doesn't install Argent. The plugin starts its MCP server
// as `argent mcp` and the skills run `argent` commands, so both need the CLI on
// PATH, and the agent starts the server without checking: when the command is
// missing, the server only shows as failed. The skills also come from a single
// Argent release, the one the plugin's version names, while users install and
// update Argent on their own, so the two can drift apart either way. This hook
// catches a missing `argent` and a version that differs from the plugin's, and
// tells the agent, which offers the install or the update to the user. It prints
// nothing when `argent` is on PATH at the plugin's version, so a working setup
// costs no context.
//
// Claude Code and Codex both add a SessionStart hook's plain stdout to the
// agent's context. Claude Code runs this file as `node <this file>` rather than
// through a shell, so it behaves the same on Windows without Git Bash. Codex
// always runs hooks through a shell and ignores `args`, so codex.json gives the
// whole command as one string. Either way `process.version` is the Node.js that
// a global `argent` would run on.

import { spawnSync } from "node:child_process";
import { accessSync, constants, readFileSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";

// What differs between the tools that run this hook. Claude Code passes no argument.
const AGENTS = {
  "claude-code": {
    name: "Claude Code",
    manifest: ".claude-plugin/plugin.json",
    server: "plugin:argent:argent",
    afterInstall: "select Reconnect for plugin:argent:argent in /mcp, or restart Claude Code,",
    updatePlugin:
      "from the Installed tab of /plugin, or with `claude plugin update` and the plugin's ID from `claude plugin list`, such as `argent@swmansion`. The new version loads after /reload-plugins or in a new session",
  },
  "codex": {
    name: "Codex",
    manifest: ".codex-plugin/plugin.json",
    server: "argent",
    afterInstall: "restart Codex",
    updatePlugin:
      "with `codex plugin marketplace upgrade`, then `codex plugin add` with the plugin's ID from `codex plugin list`, such as `argent@swmansion`. The new version loads after the user restarts Codex",
  },
};
const agent = AGENTS[process.argv[2] ?? "claude-code"] ?? AGENTS["claude-code"];

/**
 * The runnable file that `name` resolves to on PATH, the way a shell would find
 * it, or null. On Windows npm's global shims are `argent.cmd` and `argent.ps1`,
 * so the bare name is tried with each PATHEXT extension instead.
 * @param {string} name
 */
function findOnPath(name) {
  const isWindows = process.platform === "win32";
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const extensions = isWindows
    ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];
  for (const dir of dirs) {
    for (const extension of extensions) {
      const file = join(dir, name + extension);
      try {
        if (!statSync(file).isFile()) continue;
        if (!isWindows) accessSync(file, constants.X_OK);
        return file;
      } catch {
        // Not there, or not runnable: try the next one.
      }
    }
  }
  return null;
}

/**
 * The first version number in `text`, with its major, minor and patch as
 * numbers, or null. A prerelease suffix stays in `text` but not in `numbers`,
 * so 0.36.0-next.3 compares as the 0.36.0 it leads up to.
 * @param {unknown} text
 */
function parseVersion(text) {
  const match = /(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?/.exec(String(text ?? ""));
  return match ? { text: match[0], numbers: match.slice(1, 4).map(Number) } : null;
}

/**
 * What `argent --version` prints, or null when it fails, takes too long or
 * prints no version.
 * @param {string} file
 */
function argentVersion(file) {
  /** @type {import("node:child_process").SpawnSyncOptionsWithStringEncoding} */
  const options = {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 5000,
    windowsHide: true,
  };
  // Only cmd.exe runs the .cmd shims that npm installs on Windows. The command
  // goes to it as one string, because Node.js deprecates `shell` with an args array.
  const result = /\.(bat|cmd)$/i.test(file)
    ? spawnSync(`"${file}" --version`, { ...options, shell: true })
    : spawnSync(file, ["--version"], options);
  return result.status === 0 ? parseVersion(result.stdout) : null;
}

/** The version in this plugin's manifest for the running tool, or null. */
function pluginVersion() {
  try {
    const manifest = new URL(`../${agent.manifest}`, import.meta.url);
    return parseVersion(JSON.parse(readFileSync(manifest, "utf8")).version);
  } catch {
    return null;
  }
}

/**
 * Below zero when `a` is older than `b`, above zero when newer, zero when equal.
 * @param {{ numbers: number[] }} a
 * @param {{ numbers: number[] }} b
 */
function compareVersions(a, b) {
  const index = a.numbers.findIndex((number, i) => number !== b.numbers[i]);
  return index === -1 ? 0 : a.numbers[index] - b.numbers[index];
}

const argent = findOnPath("argent");

if (!argent) {
  // npm only warns when Node.js is outside Argent's `engines` range, and installs
  // anyway, so Claude checks the range before installing. It reads the range
  // from npm because a copy here would go stale.
  console.log(
    [
      `The Argent plugin for ${agent.name} is enabled, but the \`argent\` command is not on PATH. The plugin's Argent MCP server (${agent.server}) could not start, and the \`argent\` commands in the Argent skills will fail.`,
      "",
      "If the user asks for something that needs Argent, such as driving an iOS simulator, Android emulator, device, TV, Mac app or Electron app, running e2e tests, comparing screenshots or profiling, tell them Argent isn't installed and offer to install it with `npm install -g @swmansion/argent`. Run the install only after they agree. Otherwise, don't bring it up.",
      "",
      `The Node.js on PATH is ${process.version}. Before installing, compare it with the Node.js versions Argent supports, from \`npm view @swmansion/argent engines.node\`, and if it's outside that range, ask the user to switch Node.js first. After the install, the user has to ${agent.afterInstall} before Argent's tools appear.`,
      "",
      `Don't suggest \`argent init\` for ${agent.name}: this plugin already provides Argent's MCP server and skills.`,
    ].join("\n")
  );
} else {
  const installed = argentVersion(argent);
  const plugin = pluginVersion();
  // Without both versions there's nothing to compare: an `argent` on PATH that
  // doesn't report its version still counts as installed.
  const difference = installed && plugin ? compareVersions(installed, plugin) : 0;

  if (installed && plugin && difference < 0) {
    // `argent update` updates the install with the package manager that made it.
    // --global picks the install on PATH, which is the one the plugin runs, and
    // pinning the plugin's version makes the two match.
    console.log(
      [
        `The Argent plugin for ${agent.name} has the skills from Argent ${plugin.text}, but the \`argent\` command on PATH is the older Argent ${installed.text}.`,
        "",
        `The first time you call an Argent tool or run an \`argent\` command in this session, tell the user their Argent is older than the plugin and offer to update it with \`argent update --yes --global --version ${plugin.text}\`, then continue with their request. Run the update only after they agree. If you don't use Argent in this session, don't bring it up. After the update, the user has to ${agent.afterInstall} before the new tools appear.`,
      ].join("\n")
    );
  } else if (installed && plugin && difference > 0) {
    console.log(
      [
        `The Argent plugin for ${agent.name} has the skills from Argent ${plugin.text}, but the \`argent\` command on PATH is the newer Argent ${installed.text}. The skills can leave out newer tools and options, or describe tools as they were in ${plugin.text}. Where a skill and the tool descriptions from Argent's MCP server disagree, follow the server.`,
        "",
        `The first time you call an Argent tool or run an \`argent\` command in this session, tell the user the plugin is older than their Argent and offer to update the plugin, then continue with their request. If you don't use Argent in this session, don't bring it up. The user can update the plugin ${agent.updatePlugin}.`,
      ].join("\n")
    );
  }
}
