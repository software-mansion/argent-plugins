# Argent plugin for Claude Code

This repository holds the plugin that brings [Argent](https://argent.swmansion.com) to Claude Code through Anthropic's plugin directory. The plugin itself is the [`plugins/argent/`](plugins/argent) folder, and [its README](plugins/argent/README.md) is what the directory shows to users. Argent's own code lives in [software-mansion/argent](https://github.com/software-mansion/argent).

## Install

From Anthropic's plugin directory: find Argent under **Customize > Plugins** on claude.ai, or run `/plugin directory` in Claude Code.

From this repository, which is also a plugin marketplace named `swmansion`:

```
/plugin install argent --marketplace software-mansion/argent-plugins
```

That adds the marketplace and installs the plugin in one step, in Claude Code 2.1.275 or later. On older versions, run `/plugin marketplace add software-mansion/argent-plugins`, then `/plugin install argent@swmansion`.

Either way, Argent itself has to be installed too: `npm install -g @swmansion/argent`.

## Layout

| Path                              | What it is                                                                               |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| `plugins/argent/`                 | The plugin: the folder submitted to the directory, and the only folder users get         |
| `plugins/argent/skills/`          | Argent's skills, copied from the argent repository by the sync workflow. Don't edit here |
| `plugins/argent/hooks/`           | The check at session start for a missing `argent` command                                |
| `.claude-plugin/marketplace.json` | Makes this repository a marketplace named `swmansion`, listing the plugin                |
| `scripts/sync-skills.mjs`         | Copies the skills from an Argent release and sets the plugin version                     |
| `test/`                           | Tests for the hook and the sync script                                                   |

## Releases

The plugin follows Argent's stable releases, and nobody releases it by hand:

1. Once a stable release is on npm, the argent repository's [`sync-claude-plugin.yml`](https://github.com/software-mansion/argent/blob/main/.github/workflows/sync-claude-plugin.yml) starts [`sync.yml`](.github/workflows/sync.yml) here with the version, and waits for it.
2. `sync.yml` copies `packages/skills/skills` from tag `v<version>` of the argent repository, sets `version` in `plugins/argent/.claude-plugin/plugin.json`, runs the tests and validation, and pushes the result to `main`.
3. The directory follows `main`. It scans the new commit and publishes it as the plugin's new version.

A failed sync also fails the run in the argent repository. To retry, or to re-sync or roll back to a given release, run **Sync with Argent** from this repository's Actions tab with that version.

Skill changes belong in the argent repository: CI fails when `plugins/argent/skills` differs from the release that `plugin.json` names. Everything else in `plugins/argent/`, such as the manifest, the hook and the README, is edited here. Claude Code only updates an installed plugin when its version changes, so those edits reach users with the next Argent release.

The sync depends on two pieces of setup:

- **The plugin-sync GitHub App.** The argent repository starts the sync with a token from an org-owned GitHub App that is installed on this repository only, with the **Actions: write** permission. Its client ID is the `CLAUDE_PLUGIN_SYNC_CLIENT_ID` variable in the argent repository, and its private key the `CLAUDE_PLUGIN_SYNC_PRIVATE_KEY` secret.
- **Pushing to `main`.** `sync.yml` pushes straight to `main` with `GITHUB_TOKEN`, so any branch protection on `main` must still allow that push.

## Directory submission

Submitted from [claude.ai/directory/manage](https://claude.ai/directory/manage) with repository `software-mansion/argent-plugins`, plugin path `plugins/argent`, and branch `main`. The repository and folder can't be changed after submitting.

Expect the directory to hold versions for a reviewer: the MCP server is the `argent` command installed on the user's machine rather than a file in the plugin, and the hook is a Node.js script, which the validator doesn't read through. A hold isn't a rejection, but a person reads the version before it goes live.

## Developing

- `npm test` runs the tests.
- `npm run validate` runs the directory's checks with Claude Code.
- `claude --plugin-dir plugins/argent` loads your working copy for one session.
- To try skills from a local argent checkout before they're released, run `npm run sync -- --source ../argent --version <that checkout's version>`, then undo it with `git checkout plugins/argent && git clean -fd plugins/argent`.
