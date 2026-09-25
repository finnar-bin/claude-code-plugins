---
description: Fetch and triage GitHub issues/PRs involving me across all repos
allowed-tools: Bash(gh:*)
---

You are triaging GitHub for me. Do the following:

1. Get my username: `gh api user -q .login`

   Before going further, check for these specific failure modes rather
   than treating any error the same as "no results":
   - `gh` not found on PATH → this run's `status` is `error`, `error` is
     `"gh CLI isn't installed"`
   - `gh` installed but this command (or `gh auth status`) fails with an
     auth error → `status` is `error`, `error` is `"gh isn't authenticated
     — run gh auth login"`

   If either happens, skip straight to step 4 with an empty `items` array
   and the `status`/`error` set accordingly — don't attempt step 2.

2. Fetch open items I'm involved in:
   ```
   gh search issues --involves=@me --state=open --json number,title,repository,url,updatedAt,labels,body,author --limit 50
   gh search prs --involves=@me --state=open --json number,title,repository,url,updatedAt,labels,isDraft,reviewDecision,body,statusCheckRollup,author --limit 50
   ```

   If per-PR detail (reviewDecision, statusCheckRollup, reviewRequests, etc.) needs fetching separately, don't loop `gh pr view`/`gh api` once per PR in a shell `while`/`for` loop — that has been observed to hang indefinitely (each network call inside the loop can stall). Instead batch everything into a single `gh api graphql` call using aliased fields per PR (e.g. `pr0: repository(owner:..., name:...) { pullRequest(number:...) { ... } }`, one alias per item).

   If a loop over items is unavoidable, first check which shell is running (e.g. `echo $ZSH_VERSION $BASH_VERSION` or `ps -p $$ -o comm=`) before using shell-specific builtins — `mapfile`/`readarray` are bash-only and fail silently or hang under zsh. Prefer a portable `while IFS= read -r line; do ... done < file` loop instead, since the shell running this may be zsh.

   If one of the two searches errors (rate limit, network, etc.) but the
   other succeeds, don't discard the good half: proceed with whichever
   items you got, and this run's `status` is `partial` with `error`
   naming which search failed and why.

3. For each item, work out ONE category, which doubles as its `label`, and
   maps to a normalized `urgency`:
   - **Needs your review** — you're requested as reviewer, or it's your PR with unresolved review comments → `urgency: attention`
   - **CI failing** — statusCheckRollup shows a failing/error check on your own PR → `urgency: attention`
   - **Waiting on others** — your issue/PR, ball is in someone else's court → `urgency: waiting`
   - **Mentioned you** — you're @-mentioned in the body/comments, no clear action yet → `urgency: fyi`
   - **FYI** — everything else → `urgency: fyi`

   This connector doesn't currently track anything as `resolved` (it only
   looks at open items).

4. Emit a single fenced ```json code block conforming EXACTLY to the
   schema at `schema/connector-report.schema.json` (source: `"github"`).
   Include EVERY item from step 2 in full. Map fields as follows:
   - `status` / `error` → `"ok"` / `null` unless step 1 or step 2 hit a
     failure mode, per those steps
   - `id` → `"<repo>#<number>"`
   - `urgency` / `label` → from the mapping in step 3
   - `title` → the item's title
   - `actor` → the item's author
   - `timestamp` → `updatedAt`
   - `age_days` → days between `updatedAt` and now
   - `summary` → one plain-language sentence: what it actually needs from
     me
   - `url` → the item's url

   Do not deviate from the schema's field names, types, or enum values.
   Return ONLY this JSON block — no other commentary.

If a search genuinely returns nothing (no error, just no open items),
that's `status: "ok"` with an empty `items` array, not an error.
