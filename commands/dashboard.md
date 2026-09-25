---
description: Unified dashboard across GitHub, Gmail, Calendar, and Slack — republishes the same artifact in place every run
allowed-tools: Read, Write, Bash, Agent, Artifact
---

You are building my unified daily dashboard from four sources: GitHub,
Gmail, Calendar, and Slack.

This command depends on the Agent tool (to spawn subagents) and the
Artifact tool (to publish the page) being available in this environment —
it will not work in a plain Claude Code CLI install without them.

Do the following:

1. Gather each source in parallel, out of your own context:
   - Read the full contents of `commands/gh-overview.md`,
     `commands/gmail-overview.md`, `commands/calendar-overview.md`, and
     `commands/slack-overview.md`.
   - In a single message, spawn one subagent per file (four total, all in
     parallel) using the Agent tool, `subagent_type` omitted or
     `"general-purpose"` so each has full tool access (Bash for the
     GitHub one, the relevant MCP connector for the other three). Give
     each subagent that file's full instructions as its prompt, with
     `$ARGUMENTS` resolved to the literal string `json`, plus an explicit
     instruction: "Return ONLY the final fenced ```json code block
     described in these instructions — no other commentary, no
     human-readable report."

2. From each subagent's response, extract the fenced ```json block and
   parse it. If a subagent's response doesn't contain a valid block
   conforming to `schema/connector-report.schema.json` (wrong shape,
   missing fields, extra fields), treat that source as `status: "error"`,
   `error: "connector returned malformed output"` rather than guessing at
   partial data.

3. Merge:
   - For every item in every source's `items` array, tag it with that
     source's own `source` value — the item objects themselves don't
     carry `source`, only the envelope does.
   - Group all tagged items by `urgency` into four buckets: `attention`,
     `waiting`, `fyi`, `resolved`. Drop any bucket that ends up empty
     across all four sources.
   - Within each bucket, sort by `age_days` descending (oldest/most
     overdue first). Note `calendar` uses `age_days` inverted (days
     *until*, not days overdue) — its values will naturally be small
     (0–1) and sort toward the bottom of a mixed bucket, which is fine;
     don't special-case it.
   - Separately, collect every source whose `status` isn't `"ok"` —
     keep its `source` and `error` for the health strip below.

4. Get the current UTC timestamp (`date -u +%Y-%m-%dT%H:%M:%SZ`) to use
   as this run's `generated_at`.

5. Build the dashboard HTML page — see Design below — then publish it:
   - `mkdir -p ~/.vor` if it doesn't exist, then check whether
     `~/.vor/state.json` exists and contains a `dashboard_url`.
   - If it does: `read` that URL with the Artifact tool first (required
     before updating an artifact from a past conversation), then publish
     your new HTML to that same `url` so it updates in place — same
     link, new content.
   - If it doesn't: publish without a `url` (creates a new artifact),
     then write the returned URL into `~/.vor/state.json` as
     `{"dashboard_url": "<url>"}` so every future run updates this same
     artifact instead of creating another one.
   - Title it `"Vör"`, icon `"eye"`.

## Design

Reuse `morning`'s design tokens, not its layout — this is a denser,
tabular dashboard, not a 30-second glance.

**Tokens** (same as `morning`): bg `#FCFCFB` · wash `#F9F9F7` · ink
`#2E2C27` · ink-soft `#6B6A63` · ink-grey `#B4B3A8` · hairline `#E4E3DC` ·
line `#E1E1DF` · clay `#C6613F` (hover `#AE5133`). Fraunces for the page
headline only — embed this repo's own `assets/fonts/fraunces-latin-600-normal.woff2`
as a base64 `@font-face` data URI (never a Google Fonts link or CDN
reference; if this command is ever run from outside this repo's
directory, resolve the font path relative to wherever this file itself
lives, not the caller's cwd). Everything else system sans
(`-apple-system, "Segoe UI", sans-serif`).

**Layout**:
- One top band, wash background: a line reading "Vör · generated
  <friendly local timestamp>", then — only if any source isn't `ok` —
  one clay-colored line per failing source (e.g. "⚠️ Gmail — needs
  re-authentication"). Render nothing here if every source is `ok`.
- One section per non-empty urgency bucket, bg background, hairline
  divider between sections. Heading + a real HTML table (not markdown):
  `Source | Label | Title | From | Age | What it needs`, one row per
  item, title cell linked to `url` when present. Headings, skip any
  bucket with nothing in it:
  - `## 🔴 Needs attention` (`attention`)
  - `## 🟡 Waiting on others` (`waiting`)
  - `## ⚪ FYI` (`fyi`)
  - `## 🟢 Resolved` (`resolved`)
- If every bucket is empty across all four sources, replace the whole
  body below the header with one calm line: "Nothing needs you right
  now."
- No cards/chips/badges as decoration beyond the table itself — hairline
  rules between rows, clay reserved for the health-warning lines and
  link hover states only.
- Mobile: single column, 16px side gutter, no page-wide horizontal
  scroll; let wide tables scroll horizontally within themselves rather
  than clipping columns.

**Build check**: if Playwright + a Chromium build are already available
in this environment (check before installing anything), render the file
and glance at a screenshot before publishing, same as the `morning`
skill's render check. If they're not already available, skip installing
them for this — unlike a one-off brief, this command is meant to be run
repeatedly, so paying a one-time ~165MB browser download on every routine
run isn't worth it. The layout here is plain HTML/CSS with no scripted
behavior, so the risk of a silent breakage is low.

If a source is unreachable in a given run for reasons outside its own
error handling (e.g. a subagent itself failed to spawn or timed out),
treat it the same as that connector reporting `status: "error"`.
