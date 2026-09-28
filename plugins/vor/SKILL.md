---
name: vor
description: Unified dashboard across GitHub, Gmail, Calendar, and Slack — republishes the same artifact in place every run
allowed-tools: Read, Write, Bash, Agent, Artifact
---

You are building my unified daily dashboard from four sources: GitHub,
Gmail, Calendar, and Slack.

This skill depends on the Agent tool (to spawn subagents) and the
Artifact tool (to publish the page) being available in this environment —
it will not work in a plain Claude Code CLI install without them.

Do the following:

1. Gather each source in parallel, out of your own context:
   - Read the full contents of `connectors/gh-overview.md`,
     `connectors/gmail-overview.md`, `connectors/calendar-overview.md`,
     and `connectors/slack-overview.md` (paths relative to this file's
     own location, not the caller's cwd).
   - In a single message, spawn one subagent per file (four total, all in
     parallel) using the Agent tool, `subagent_type` omitted or
     `"general-purpose"` so each has full tool access (Bash for the
     GitHub one, the relevant MCP connector for the other three). Give
     each subagent that file's full instructions as its prompt verbatim —
     each one already ends by emitting a single fenced ```json code block
     and nothing else, so no extra instruction is needed beyond handing
     over the file's contents.

2. From each subagent's response, extract the fenced ```json block and
   parse it. If a subagent's response doesn't contain a valid block
   conforming to `schema/connector-report.schema.json` (wrong shape,
   missing fields, extra fields), treat that source as `status: "error"`,
   `error: "connector returned malformed output"` rather than guessing at
   partial data.

3. Merge:
   - Keep `calendar`'s items separate from the other three — they drive
     the persistent top band, not a tab. Split its items into `today`
     (`age_days` is `0`) and `tomorrow` (`age_days` is `1`, remember this
     connector inverts `age_days` to mean "days until"); within `today`,
     pull out any item whose `urgency` is `attention` (an unanswered
     RSVP) into a short "needs a response" list — everything else in
     `today` feeds the terrain drawing.
   - For each of `github`, `gmail`, `slack` independently: group that
     source's own `items` by `urgency` into four buckets (`attention`,
     `waiting`, `fyi`, `resolved`), dropping any bucket that's empty for
     that source. Within each bucket, sort by `age_days` ascending
     (newest first). Each source keeps its own bucket set —
     nothing is merged across sources anymore; that's what the tabs are
     for.
   - Separately, collect every source (all four) whose `status` isn't
     `"ok"` — keep its `source` and `error` for the health strip below.

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

Reuse `morning`'s design tokens everywhere, and its Visual anchor
treatment specifically for the persistent Calendar band. The rest —
Gmail, Slack, GitHub, each behind its own tab — stays a denser, tabular
view, not a 30-second glance.

**Tokens** (same as `morning`): bg `#FCFCFB` · wash `#F9F9F7` · ink
`#2E2C27` · ink-soft `#6B6A63` · ink-grey `#B4B3A8` · hairline `#E4E3DC` ·
line `#E1E1DF` · clay `#C6613F` (hover `#AE5133`). Fraunces for the
Calendar band's headline only — embed this repo's own
`assets/fonts/fraunces-latin-600-normal.woff2` as a base64 `@font-face`
data URI (never a Google Fonts link or CDN reference; if this command is
ever run from outside this repo's directory, resolve the font path
relative to wherever this file itself lives, not the caller's cwd).
Everything else system sans (`-apple-system, "Segoe UI", sans-serif`).

**Layout** (top to bottom, in this order — everything above the tab bar
is persistent and stays on screen no matter which tab is active):

- Slim top strip, wash background: a line reading "Vör · generated
  <friendly local timestamp>", then — only if any of the four sources
  isn't `ok` — one clay-colored line per failing source (e.g. "⚠️ Gmail
  — needs re-authentication"). Render nothing here if every source is
  `ok`.
- Persistent Calendar band, directly below the strip, styled like
  `morning`'s Visual anchor:
  - Day-date line (small, ink-soft): full weekday + date.
  - Classify today from its event count/density alone — HEAVY (≥5
    events, or a run of 3+ back-to-back) · NORMAL · OPEN (≤1 event) —
    and write one serif headline line in that register, same voice as
    `morning`'s (name what's distinct about the day if something is,
    otherwise name its shape — never both).
  - One SVG terrain strip (~840×140, full band width): a single
    unbroken stroke drawn as actual terrain, not a straight rule —
    elevation at each point follows how packed that stretch of the day
    is, the same elevation-follows-load logic as `morning`'s Visual
    anchor (overlapping/back-to-back events raise a hill, gaps read as
    valleys, weight from each event's dot-size feeds the local load). A
    day with little on it flattens to still water — never invent hills
    the schedule doesn't back; a single light event should barely
    disturb the line, only real density should rise. One dot per
    today's event placed along the stroke by time-of-day (left edge
    00:00, right edge 24:00), filled ink `#2E2C27` and sized by rough
    weight (a plain "Meeting"/"Focus time" gets a small dot, anything I
    organize or that's flagged important gets a larger one). An
    unanswered RSVP (`urgency: attention`) renders hollow/grey `#B4B3A8`
    instead of filled, since it isn't confirmed yet. The connector
    doesn't carry event duration, so skip overlap detection entirely —
    if two dots land on the same point, nudge them apart slightly
    rather than stacking or inventing a duration. Each dot carries a
    native SVG `<title>` (the event's title) as a hover tooltip, and is
    wrapped in a link to the event's calendar `url` when one exists —
    a deliberate deviation from `morning`, which has no hover
    affordances anywhere on its page.
  - Three left-aligned columns under the drawing splitting today into
    morning / afternoon / evening (like `morning`'s acts), faint
    hairline dividers between them: bold time range, then one sentence
    naming what's actually there, earned from the data — never padded
    on a quiet stretch.
  - If today has any unanswered RSVP, one compact list under the
    columns headed "Needs a response": bold linked title, one sentence
    (who, when, that it's unanswered). Fold in anything from tomorrow
    worth flagging the same way (say "tomorrow" instead of a time).
    Render nothing here if there's nothing to answer.
  - If the calendar connector itself errored, this band collapses to
    just its day-date line — no drawing, no columns, no RSVP list (the
    top strip above already carries the error line).
- Tab bar, directly below the Calendar band: three tabs, in this fixed
  order — Gmail, Slack, GitHub. Plain CSS/JS (radio inputs, or a few
  lines of vanilla JS toggling `hidden`/`aria-selected`), no framework.
  Default active tab: the first of the three (in that order) that has
  any `attention`-bucket items, or Gmail if none do. Remember the
  viewer's last-selected tab in `localStorage`, wrapped in try/catch —
  a per-viewer convenience only, never required for a correct first
  render.
- Each tab's own body: one section per non-empty urgency bucket for
  that source alone, bg background, hairline divider between sections.
  Heading + a real HTML table (not markdown): `Title | From | Age |
  What it needs` — no `Source` column now that the tab itself says
  which source it is, and no `Label` column either — it's redundant
  once items are already grouped under their bucket heading. GitHub's
  tab specifically replaces that column with `Repo` (the repo portion
  of the item's `id`, e.g. `zesty-io/manager-ui` from
  `zesty-io/manager-ui#4327`), since with items spanning many repos
  that's more useful there than the label was. One row per item, title
  cell linked to `url` when present. Same headings as before, skip any
  bucket empty for that source:
  - `## 🔴 Needs attention` (`attention`)
  - `## 🟡 Waiting on others` (`waiting`)
  - `## ⚪ FYI` (`fyi`)
  - `## 🟢 Resolved` (`resolved`)
  - If every bucket is empty for that source, replace its tab body with
    one calm line: "Nothing needs you here."
- No cards/chips/badges as decoration beyond the table itself and the
  tab bar's own selected-state underline — hairline rules between rows,
  clay reserved for the health-warning lines, the terrain's confirmed
  dots, link hover states, and the active tab's underline.
- Mobile: single column, 16px side gutter, no page-wide horizontal
  scroll; the tab bar scrolls horizontally as a row rather than
  wrapping if it doesn't fit; let wide tables scroll horizontally
  within themselves rather than clipping columns.

**Build check**: skip the Playwright/screenshot render check on routine
runs — the data changes every run but the HTML/CSS template doesn't, so
re-rendering and screenshotting each time verifies nothing new and just
burns time. Only do a Playwright render check on a run where you've
actually edited this skill's template/CSS/layout logic (i.e. you're
changing how the page is built, not just refreshing its data), and even
then only if Playwright + Chromium are already available in this
environment — don't install them for this.

If a source is unreachable in a given run for reasons outside its own
error handling (e.g. a subagent itself failed to spawn or timed out),
treat it the same as that connector reporting `status: "error"`.
