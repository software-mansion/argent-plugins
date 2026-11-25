# Argent plugin for Claude Code and Codex

[Argent](https://argent.swmansion.com) gives Claude Code direct control of iOS simulators, Android emulators and devices, TVs (Apple TV, Android TV, Fire TV), Electron/Chromium apps and native Mac apps. Claude can tap, swipe and type, record and replay e2e tests, diff screenshots against a baseline, read logs and network traffic, and profile with Hermes, React DevTools, Xcode Instruments and Perfetto.

This plugin registers Argent's MCP server and adds Argent's skills, which teach Claude the workflows for each platform. It works in Claude Code, in Cowork when the session runs on your computer, and in Codex. Chat on claude.ai can't start Argent's server.

## Setup

The plugin starts the `argent` command, so install Argent globally first:

```bash
npm install -g @swmansion/argent
```

Argent needs a supported version of Node.js, plus the tools for the platforms you work with, such as Xcode for iOS and tvOS, or the Android SDK Platform Tools and Android Emulator for Android. [Installation](https://docs.swmansion.com/argent/docs/fundamentals/installation) lists every requirement, including the Node.js versions.

Then add the plugin. In Claude Code, install it from Anthropic's plugin directory or with this command:

```
/plugin install argent --marketplace software-mansion/argent-plugins
```

In Codex, add this repository as a marketplace, then install Argent from it, or from `/plugins` in Codex:

```bash
codex plugin marketplace add software-mansion/argent-plugins
codex plugin add argent@swmansion
```

Once it's installed, ask _"What can Argent do?"_ to list every tool.

If you already set Argent up for Claude Code or Codex with `argent init`, you don't need this plugin there: it adds the same MCP server and a second copy of the skills.

## Tool approvals in Claude Code

Claude Code asks before each Argent tool runs. To let them run without asking, add this rule to `permissions.allow` in `~/.claude/settings.json`:

```json
"mcp__plugin_argent_argent__*"
```

## What the plugin runs

- **Argent's MCP server**, by starting the `argent mcp` command you installed.
- **A check at the start of each session** (`hooks/check-argent.mjs`, run with Node.js). It looks for `argent` on your PATH and, if it's missing, tells the agent so that it can offer to install it when you ask for something that needs Argent. It only checks your PATH and sends nothing anywhere. Codex runs it only after you trust it in `/hooks`.

## Privacy

Argent collects usage telemetry by default. Turn it off with `argent telemetry disable`. See the [Privacy Notice](https://github.com/software-mansion/argent/blob/main/Telemetry.md).
