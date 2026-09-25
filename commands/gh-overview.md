---
description: Fetch and triage GitHub issues/PRs involving me across all repos
allowed-tools: Bash(gh:*)
---

You are triaging GitHub for me. Do the following:

1. Get my username: `gh api user -q .login`

2. Fetch open items I'm involved in:
   ```
   gh search issues --involves=@me --state=open --json number,title,repository,url,updatedAt,labels,body --limit 50
   gh search prs --involves=@me --state=open --json number,title,repository,url,updatedAt,labels,isDraft,reviewDecision,body,statusCheckRollup --limit 50
   ```

   If per-PR detail (reviewDecision, statusCheckRollup, reviewRequests, etc.) needs fetching separately, don't loop `gh pr view`/`gh api` once per PR in a shell `while`/`for` loop — that has been observed to hang indefinitely (each network call inside the loop can stall). Instead batch everything into a single `gh api graphql` call using aliased fields per PR (e.g. `pr0: repository(owner:..., name:...) { pullRequest(number:...) { ... } }`, one alias per item).

   If a loop over items is unavoidable, first check which shell is running (e.g. `echo $ZSH_VERSION $BASH_VERSION` or `ps -p $$ -o comm=`) before using shell-specific builtins — `mapfile`/`readarray` are bash-only and fail silently or hang under zsh. Prefer a portable `while IFS= read -r line; do ... done < file` loop instead, since this repo's shell may be zsh (see gitStatus context / `Shell: zsh`).

3. For each item, work out ONE category:
   - **Needs your review** — you're requested as reviewer, or it's your PR with unresolved review comments
   - **Waiting on others** — your issue/PR, ball is in someone else's court
   - **CI failing** — statusCheckRollup shows a failing/error check on your own PR
   - **Mentioned you** — you're @-mentioned in the body/comments, no clear action yet
   - **FYI** — everything else

4. Print a terse overview grouped by category, presented in a table format that is easy to read. Include only items updated within the last 7 days — anything older is stale and belongs in #5 instead, not here. Add an appropriate emojis per category. It is important that you follow this exact format per item and not deviate:
    `## [emoji] Category`
    `| repo | [#123](url) | title | one-sentence plain-language summary of what it actually needs from me |`

   Skip the categories that have zero items. Don't restate the raw JSON. Don't pad with commentary.

5. Below the main overview, add a brief stale-items summary (everything with no update in 7+ days, i.e. excluded from #4) grouped by repo. One line per repo:
   `- repo — N stale item(s), last activity <most recent updatedAt among them>`
   Sort by most-recently-updated repo first. Keep this to the grouped line list only, no per-item detail here.

   Then ask which repo (if any) they'd like the full detail for. If they name one, show that repo's stale items following the exact table format from #4.

6. End with: "Tell me a number or paste a link and I'll dig in — I can open it, summarize the thread, draft a reply, or check the CI logs."

If `gh` isn't authenticated or a search returns nothing, say so plainly instead of guessing.
