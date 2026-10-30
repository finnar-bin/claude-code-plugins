# retro

Weekly retro over your Claude Code sessions, across every project on the
machine. Run `/retro:weekly` to see how much you pushed back, how often Claude
needed rework, and how each skill and agent performed, then get concrete
suggestions (a CLAUDE.md rule, a skill tweak, a permission change).

## How it works

1. `scripts/extract.mjs` scans `<config>/projects/**` transcripts and computes
   per-session metrics deterministically: human turns, interrupts, tool
   denials, tool errors, files re-edited, commits and PRs, subagents and
   skills used, tokens, and cost.
2. Your follow-up messages are redacted and handed to subagents that label each
   one (approval, wrong approach, missed requirement, convention violation,
   and so on) and grade each session's outcome.
3. Labels and metrics are appended to a small history in `<config>/retros/`, so
   trends survive after Claude Code deletes old transcripts.
4. The report is written as markdown, and published as an artifact (updated in
   place each run) when the Artifact tool is available.

## Files

Everything is per-user and lives outside the plugin, in `<config>/retros/`
(`<config>` is `$CLAUDE_CONFIG_DIR`, else `~/.claude`):

```
history/sessions.jsonl   one row per session (metrics, outcome)
history/pushback.jsonl   one row per labeled follow-up (category, paraphrase)
reports/<week>.md        the retro (and .html when an artifact is made)
```

History holds numbers and short paraphrases only, never verbatim prompts or code.

## Usage

```
/retro:weekly            last 7 days
```

Needs Node 18+. To check your setup: `node scripts/extract.mjs doctor`.

## Privacy

No network calls from the script. Secrets are redacted (API keys, tokens, webhook
URLs, credentials in URLs, private keys) before text reaches the classifier.
Classification runs through your own Claude Code session, so redacted follow-up
text is sent to the model like any other prompt. Transcript retention is
Claude Code's `cleanupPeriodDays` (default 30), so run the retro at least that
often.

## Caveats

- Transcripts are an internal, undocumented format. The extractor parses
  defensively and reports unreadable records, but a Claude Code update could
  change what's available.
- A session that spans several weeks is counted once, in the week of its last
  activity.
- Tested on Linux with Node 26 only.
