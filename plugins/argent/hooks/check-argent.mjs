#!/usr/bin/env node
// SessionStart hook of the Argent plugin, wired up in hooks.json for Claude Code
// and in codex.json for Codex, which passes `codex` as the first argument.
//
// Installing the plugin doesn't install Argent. The plugin starts its MCP server
// as `argent mcp` and the skills run `argent` commands, so both need the CLI on
// PATH, and the agent starts the server without checking: when the command is
// missing, the server only shows as failed. This hook catches that case and
// tells the agent, which offers the install to the user. It prints nothing when
// `argent` is on PATH, so a working setup costs no context.
//
// Claude Code and Codex both add a SessionStart hook's plain stdout to the
// agent's context. Claude Code runs this file as `node <this file>` rather than
// through a shell, so it behaves the same on Windows without Git Bash. Codex
// always runs hooks through a shell and ignores `args`, so codex.json gives the
// whole command as one string. Either way `process.version` is the Node.js that
// a global `argent` would run on.

import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";

// What differs between the tools that run this hook. Claude Code passes no argument.
const AGENTS = {
  "claude-code": {
    name: "Claude Code",
    server: "plugin:argent:argent",
    afterInstall: "select Reconnect for plugin:argent:argent in /mcp, or restart Claude Code,",
  },
  "codex": {
    name: "Codex",
    server: "argent",
    afterInstall: "restart Codex",
  },
};
const agent = AGENTS[process.argv[2] ?? "claude-code"] ?? AGENTS["claude-code"];

/**
 * Whether `name` resolves to a runnable file on PATH, the way a shell would find
 * it. On Windows npm's global shims are `argent.cmd` and `argent.ps1`, so the
 * bare name is tried with each PATHEXT extension instead.
 * @param {string} name
 */
function isOnPath(name) {
  const isWindows = process.platform === "win32";
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const extensions = isWindows
    ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];
  return dirs.some((dir) =>
    extensions.some((extension) => {
      const file = join(dir, name + extension);
      try {
        if (!statSync(file).isFile()) return false;
        if (!isWindows) accessSync(file, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    })
  );
}

if (!isOnPath("argent")) {
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
}
