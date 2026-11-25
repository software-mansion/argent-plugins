#!/usr/bin/env node
// SessionStart hook of the Argent plugin for Claude Code, wired up in hooks.json.
//
// Installing the plugin doesn't install Argent. The plugin starts its MCP server
// as `argent mcp` and the skills run `argent` commands, so both need the CLI on
// PATH, and Claude Code starts the server without checking: when the command is
// missing, the server only shows as failed in /mcp. This hook catches that case
// and tells Claude, which offers the install to the user. It prints nothing when
// `argent` is on PATH, so a working setup costs no context.
//
// Claude Code adds a SessionStart hook's plain stdout to Claude's context. The
// hook runs as `node <this file>` rather than through a shell, so it behaves the
// same on Windows without Git Bash, and `process.version` is the Node.js that a
// global `argent` would run on.

import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";

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
  // The Node.js range is `engines.node` in packages/argent/package.json of the
  // argent repository.
  console.log(
    [
      "The Argent plugin for Claude Code is enabled, but the `argent` command is not on PATH. The plugin's Argent MCP server (plugin:argent:argent) could not start, and the `argent` commands in the Argent skills will fail.",
      "",
      "If the user asks for something that needs Argent, such as driving an iOS simulator, Android emulator, device, TV, Mac app or Electron app, running e2e tests, comparing screenshots or profiling, tell them Argent isn't installed and offer to install it with `npm install -g @swmansion/argent`. Run the install only after they agree. Otherwise, don't bring it up.",
      "",
      `Argent needs Node.js 22.18 or later, but not 23.0 to 23.7. The Node.js on PATH is ${process.version}. After the install, the user has to select Reconnect for plugin:argent:argent in /mcp, or restart Claude Code, before Argent's tools appear.`,
      "",
      "Don't suggest `argent init` for Claude Code: this plugin already provides Argent's MCP server and skills.",
    ].join("\n")
  );
}
