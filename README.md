# claude-code-plugins

Nar's personal collection of [Claude Code](https://claude.com/claude-code) plugins.

Each plugin lives in its own directory under `plugins/`, with its own
`plugin.json` manifest and version. They're independently installable —
installing one doesn't pull in the others.

## Install

From a Claude Code session, register this repo as a marketplace:

```
/plugin marketplace add finnar-bin/claude-code-plugins
```

> The marketplace's registered name is `finnar-bin-plugins`, not
> `claude-code-plugins` — Anthropic reserves the latter for their own
> official marketplaces, so it had to be renamed. You'll refer to it as
> `finnar-bin-plugins` when installing (see below).

Then install whichever plugin you want:

```
/plugin install vor@finnar-bin-plugins
/plugin install otto@finnar-bin-plugins
```

To pick up updates later, either enable auto-update for the marketplace
(`/plugin` → **Marketplaces** → `finnar-bin-plugins` → **Enable
auto-update**), or refresh manually:

```
/plugin marketplace update finnar-bin-plugins
/plugin install vor@finnar-bin-plugins
```

This repo is currently private — you'll need to be added as a
collaborator (or have access via your own fork) before
`/plugin marketplace add` can clone it.

## Plugins

### vor

Unified daily dashboard across GitHub, Gmail, Calendar, and Slack.
Invoked as `/vor` — gathers each source in parallel, triages items into
urgency buckets (needs attention / waiting on others / FYI / resolved),
and publishes a single dashboard artifact that updates in place on every
run rather than creating a new one each time.

Requires the `Agent` and `Artifact` tools, plus MCP connectors for
Gmail, Google Calendar, and Slack, and the `gh` CLI (authenticated) for
GitHub. See [`plugins/vor/SKILL.md`](plugins/vor/SKILL.md) for details.

### otto

Takes a GitHub issue from triage through implementation, tests, and a
capped QA/review loop, run as a Workflow against your current local
checkout. Triages the issue (commenting and stopping if it's missing the
information needed to start), implements a first pass, ensures test
coverage using whatever testing system the repo already has, then loops
static checks + QA + code review (capped at `maxRounds`, default 3)
until clean or it flags the issue for a human. Never commits, pushes, or
opens a PR itself — every change is left uncommitted in the working tree
for review.

Takes `args.issueNumber` (required) and `args.maxRounds` (optional).
Requires the `Workflow` and `Agent` tools, the `gh` CLI (authenticated),
and a clean git working tree in a repo with the target issue. See
[`plugins/otto/workflows/otto.js`](plugins/otto/workflows/otto.js) for
details.
