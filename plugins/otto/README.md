# otto

Takes a GitHub issue from triage through implementation, tests, and a capped
QA and review loop, entirely on your machine. It never commits, pushes, or opens
a PR. Everything is left uncommitted in its own git worktree for you to review;
`/otto:ship` is the separate step that publishes it.

## How it runs

```
Triage -> Implement -> Test -> Verify (static checks, QA + review, fix loop) -> handoff
```

1. **Triage** decides whether the issue is ready. If not, it drafts a comment
   for you (see `postTriageComment`) and stops.
2. **Implement** creates `.claude/worktrees/otto-<N>` on `<type>/<N>-<slug>`
   cut from `origin/<base>`, copies your gitignored env files, installs
   dependencies, and makes the first pass. Your own checkout is never touched
   and can stay dirty.
3. **Test** runs an existing test that covers the change, or writes one, using
   only a test system the repo already has. A failing test goes to a fix agent,
   capped at `maxRounds`.
4. **Verify** loops: deterministic static checks first (a failure goes straight
   to a fix), then QA and code review in parallel. Static-check fixes and QA
   rounds have separate caps. Fix agents are shown what earlier rounds
   reported, and a finding that survives a fix attempt stops the run instead of
   looping.
5. A final check confirms your own checkout is unchanged, an optional UI check
   runs, and a handoff file is written for `/otto:ship`.

## Arguments

Passed as the workflow's `args`.

| Arg | Default | Meaning |
|---|---|---|
| `issueNumber` | required | Issue in the current repo. Must be a positive integer. |
| `maxRounds` | `3` | Cap for QA/review rounds and for test-fix rounds. |
| `maxStaticRounds` | `maxRounds` | Cap for fixes triggered by static-check failures. |
| `baseBranch` | repo default | Branch to cut from and diff against. |
| `postTriageComment` | `false` | If true, triage posts the not-ready comment itself. Otherwise it only returns the draft. |
| `reuseWorktree` | `false` | Adopt an existing `otto-<N>` worktree and branch (e.g. from a run that stopped) instead of refusing. |
| `install` | `true` | `false` skips the dependency install in the worktree. |
| `envFiles` | `[]` | Extra gitignored files to copy in, e.g. `[".npmrc"]`. `.env`, `.env.*` and `cypress.env.json` are found automatically. |
| `checks` | discover | Exact commands to use as the static checks. |
| `uiCheck` | `false` | `true` always, `"auto"` when triage says the change touches UI. Advisory only. |
| `cheapModel` | session model | Model for triage, static checks, the guard and the handoff. |

A repo can also commit a `.otto.json` at its root:

```json
{ "checks": ["npm run lint", "npx tsc --noEmit"], "install": "npm ci", "envFiles": [".npmrc"] }
```

`install` can be a command or `false`. Explicit `args` win over `.otto.json`,
which wins over discovery.

## Results

| `status` | Meaning |
|---|---|
| `verified` | Clean pass. Includes `worktreePath`, `branch`, `reviewWarnings`, `qaInconclusive`, `test`, `uiCheck`, and `handoffFile`. |
| `not_ready` | Triage stopped. `commentBody` holds the drafted comment; `commentPosted` says if it was posted. |
| `needs_human` | Stopped with work in the worktree. `stage` is one of `test`, `static-cap`, `review-cap`, `repeat-findings`, `final-test`, `main-checkout-touched`. |
| `error` | An agent failed or aborted. Carries `stage`, `reason`, and the branch and worktree if they exist. |

## Shipping

After you've reviewed the diff in the worktree:

```
/otto:ship [issue number]   # inferred from the branch or Otto's leftovers if omitted
```

It shows what will be committed, asks before committing, drafts a PR body from
the handoff (acceptance checklist, test result, unfixed warnings), asks again
before pushing, then opens the PR. It copies the issue's labels onto the PR
(skipping any the repo lacks), assigns `@me`, and matches the repo's title
convention. If a `pr-creator` agent exists in your session it hands the PR to
that, telling it which worktree to use, and then checks the labels came
through; otherwise it uses `gh`. It never force-pushes.

## Safety model and limits

- **Worktree, not your checkout.** `EnterWorktree` can't be used from a
  repo-root session, and the shell's cwd resets between Bash calls, so every
  agent prefixes `cd "<worktree>" &&` on each call and uses absolute paths.
  That is an instruction the agents follow, not something enforced. The final
  check compares your checkout's `git status` to a snapshot and returns
  `needs_human` if anything changed. Editing files in your own checkout while
  Otto runs will trigger it too.
- **Env files** are copied (not linked) and checked with `git check-ignore`;
  a copy that isn't ignored is deleted so it can't be committed. Agents are told
  never to print env values.
- **No databases.** Agents are told never to connect to one, run migrations,
  or run tests that need a live database; they report it as a blocker.
- **One fix attempt per finding.** A finding that survives it goes to a human.
- Stale worktrees are not cleaned up automatically. Remove one with
  `git worktree remove .claude/worktrees/otto-<N>`.
