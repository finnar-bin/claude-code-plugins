# Report instructions

Input is the JSON printed by `report-data`. Every number in the report must
come from that JSON; don't estimate or invent. Keep the tone of a blameless
retro: the goal is to improve how the user works with Claude Code, not to score
anyone.

## Sections

1. **Headline**: sessions, follow-up turns, pushback rate, clean-session rate,
   and how each moved against `previous`. Say plainly when the sample is small
   (under ~10 sessions or ~30 follow-ups) and that trends aren't reliable yet.
2. **Pushback by category**: from `current.by_category`, most common first.
   Mention interrupts, denials and tool errors as mechanical friction signals.
3. **By project**: `by_repo`, one line each.
4. **Skills and agents**: `skills` and `agents`. Show pushback rate after each,
   but only call one out as strong or weak when `turns_after` is at least 5.
5. **Outcomes**: `outcomes` distribution.
6. **Trend**: `trend`, last up to 8 weeks.
7. **Examples**: a few from `examples`, paraphrased as given.
8. **Actions**: 3 to 5 concrete suggestions tied to the data, e.g. a recurring
   `convention_violation` becomes a CLAUDE.md rule, repeated `missed_requirement`
   after a skill suggests tightening that skill's prompt, high denials suggests
   adjusting permission rules. Don't pad: fewer is fine if the data is thin.

If `current.unclassified` is above zero, say how many follow-ups weren't
classified so the user knows the rates are partial.

## Output

Always write the full report as markdown to `<out dir>/reports/<label>.md`,
where `<label>` is the ISO week of the window's end (for example `2026-W44`).
If the Artifact tool is available, also publish it as an artifact (see the
skill for the republish-in-place rule). Dataviz: load the `dataviz` skill if it
exists and you chart the trend; otherwise a simple table is fine.
