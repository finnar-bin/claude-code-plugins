---
name: weekly
description: Weekly retro over all your Claude Code sessions across every project. Measures how much you pushed back and how well Claude, its skills, and its agents performed, keeps a durable history, and writes a markdown report (plus an artifact when available).
allowed-tools: Read, Write, Bash, Agent, Artifact, Skill
---

You are running my weekly Claude Code retro. It covers sessions from every
project on this machine, not just the current folder. All paths below are
relative to this file's own location, not the caller's cwd. `<script>` means
`scripts/extract.mjs`.

The window is always the last 7 days. This skill takes no arguments.

Everything stays local. The script makes no network calls and redacts secrets
before anything is handed to you. Never print raw transcript text back to me;
the report uses paraphrases only.

## 1. Check the environment

Run `node --version`. If Node isn't available, tell me this skill needs Node 18
or newer and stop.

Run `node <script> doctor` and show me only its warnings. If it reports no
transcripts, say so and stop.

## 2. Extract

Run `node <script> extract --since 7d`. It prints a JSON summary: sessions scanned, pending turns and
outcomes, `chunks`, `chunk_dir` and `out_dir`. Remember `out_dir`; everything
else lives under it. If `skipped_records` is above zero, mention that the
transcript format may have drifted.

## 3. Classify

If `chunks` is 0, skip to step 4.

Read `prompts/classify.md` in full. Then, in a single message, spawn one
subagent per chunk with the Agent tool (all in parallel; use `model: "haiku"`
if that alias is accepted, otherwise omit `model`). Each subagent's prompt is
the full text of `classify.md`, followed by:

- its input path `<chunk_dir>/chunk-<n>.json`
- its output path `<chunk_dir>/out-<n>.json`
- an instruction to read the input, write the output file, and reply only "done"

If the Agent tool isn't available, do the chunks yourself one at a time.

Check that every `out-<n>.json` exists. Re-run any missing chunk once; if it
still fails, continue without it and say how many chunks were skipped.

## 4. Ingest

Run `node <script> ingest <chunk_dir>/out-*.json`. If `rejected` is above zero,
mention it. Skip this step when there were no chunks.

## 5. Build the report

Run `node <script> report-data --since 7d` and read the JSON it prints.
Read `prompts/report.md` and follow it. Write the markdown report to
`<out_dir>/reports/<label>.md`.

## 6. Artifact (when available)

If the Artifact tool isn't available, skip this step and just point me to the
markdown file.

Otherwise publish the same report as an HTML page:

1. Load the `artifact-design` skill first, and `dataviz` too if the trend
   or breakdowns get charts.
2. Write the page to `<out_dir>/reports/<label>.html`, self-contained, with
   the numbers inlined.
3. Republish in place. If `<out_dir>/artifact.json` exists, read its `url`,
   read that artifact with `action: "read"`, and publish to the same `url`. If
   the read fails because it was deleted, publish fresh. After a fresh publish,
   write `{ "url": "<url>" }` to `<out_dir>/artifact.json`.

## 7. Wrap up

End with at most six lines: the headline numbers, the biggest pushback
category, the top suggested action, and the paths of the report (and artifact
link if any). Don't paste the report.
