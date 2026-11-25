# Argent plugin for Claude Code

[Argent](https://argent.swmansion.com) gives Claude Code direct control of iOS simulators, Android emulators and devices, TVs (Apple TV, Android TV, Fire TV), Electron/Chromium apps and native Mac apps. Claude can tap, swipe and type, record and replay e2e tests, diff screenshots against a baseline, read logs and network traffic, and profile with Hermes, React DevTools, Xcode Instruments and Perfetto.

This plugin registers Argent's MCP server and adds Argent's skills, which teach Claude the workflows for each platform. It works in Claude Code, and in Cowork when the session runs on your computer. Chat on claude.ai can't start Argent's server.

## Setup

The plugin starts the `argent` command, so install Argent globally first:

```bash
npm install -g @swmansion/argent
```

Argent needs Node.js 22.18 or later (but not 23.0 to 23.7), plus the tools for the platforms you work with, such as Xcode for iOS and tvOS, or the Android SDK Platform Tools and Android Emulator for Android. [Installation](https://docs.swmansion.com/argent/docs/fundamentals/installation) lists every platform's requirements.

Then add the plugin, from Anthropic's plugin directory or with this command in Claude Code:

```
/plugin install argent --marketplace software-mansion/argent-plugins
```

Once it's installed, ask Claude _"What can Argent do?"_ to list every tool.

If you already set Argent up for Claude Code with `argent init`, you don't need this plugin: it adds the same MCP server and a second copy of the skills.

## Tool approvals

Claude Code asks before each Argent tool runs. To let them run without asking, add this rule to `permissions.allow` in `~/.claude/settings.json`:

```json
"mcp__plugin_argent_argent__*"
```

## What the plugin runs

- **Argent's MCP server**, by starting the `argent mcp` command you installed.
- **A check at the start of each session** (`hooks/check-argent.mjs`, run with Node.js). It looks for `argent` on your PATH and, if it's missing, tells Claude so that Claude can offer to install it when you ask for something that needs Argent. It only checks your PATH and sends nothing anywhere.

## Privacy

Argent collects usage telemetry by default. Turn it off with `argent telemetry disable`. See the [Privacy Notice](https://github.com/software-mansion/argent/blob/main/Telemetry.md).
