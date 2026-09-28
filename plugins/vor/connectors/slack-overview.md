---
description: Surface Slack mentions/DMs needing a reply and my own messages awaiting one, filtering out bot noise
allowed-tools: mcp__claude_ai_Slack__slack_search_public_and_private, mcp__claude_ai_Slack__slack_read_thread, mcp__claude_ai_Slack__slack_read_channel
---

You are triaging my Slack for me. Do the following:

1. Find my own Slack user ID from the `slack_search_public_and_private`
   tool's own description (it states something like "Current logged in
   user's user_id is U0XXXXXXX") — never hardcode one, since it's
   specific to whoever installed this.

   If the Slack tool isn't available or a call errors (connector not
   configured, needs re-auth), this run's `status` is `error`, `error`
   names the actual problem, skip straight to step 6 with an empty
   `items` array.

2. Run narrow, cheap first-pass searches covering the last 7 days — use
   `response_format: "concise"` and `include_context: false` on both to
   keep the payload small; do not fetch full message bodies yet:
   - **Mentions**: `keywords: ["<@MY_USER_ID>"]`,
     `filters: "after:<7 days ago>"`, default channel types
   - **DMs and group DMs**: `keywords: []`,
     `filters: "is:dm after:<7 days ago>"`, `channel_types: "im,mpim"`

   If either search's result is too large to read directly (a truncation
   error pointing to a saved file), don't read the whole file into
   context — grep/slice it, or hand it to a subagent with clear
   instructions to extract just the human-authored candidates and report
   back a short list.

3. Drop obvious bot/app/notification senders with no real content or no
   specific ask (CI bots, ticketing bots, app notifications) from both
   result sets — judgment-based, no hardcoded blacklist.

4. For each mention thread and each DM/group-DM conversation that
   survives, pull enough context via `slack_read_thread` /
   `slack_read_channel` to work out who sent the most recent substantive
   message, then sort into ONE of:
   - **Needs a reply** — someone else sent last, I haven't replied or
     reacted with any emoji since, AND it reads as a genuine, still-open
     question or ask.
   - **Waiting on a reply** — I sent last (a question or request), and
     nobody's responded since.
   - **Drop it** — anything else: already answered or reacted to, the
     conversation moved on and clearly doesn't need my input anymore, or
     it's small talk/FYI with no real ask. A message being technically
     "unreplied" does NOT automatically mean it still needs a response —
     use judgment. Only keep it if there's an obvious, still-open ask.

5. For each surviving item, work out:
   - `actor` → the other person (sender for "Needs a reply"; counterpart
     for "Waiting on a reply")
   - `title` → a short paraphrase (≤8 words), since Slack messages don't
     have subjects
   - `timestamp` → the relevant message's timestamp, ISO 8601
   - `age_days` → days between that timestamp and now
   - `summary` → one plain-language sentence: what's being asked/awaited
     and where (e.g. "in #growth-model-launch" or "in a DM")
   - `label` → `"Mention"`, `"DM"`, or `"Group DM"` for Needs-a-reply
     items; `"Awaiting reply"` for Waiting-on-a-reply items
   - `url` → the message's permalink
   - `urgency` → `attention` for Needs-a-reply items, `waiting` for
     Waiting-on-a-reply items

6. Emit a single fenced ```json code block conforming EXACTLY to the
   schema at `schema/connector-report.schema.json` (source: `"slack"`).
   Include every surviving item from both buckets in full. Do not
   deviate from the schema's field names, types, or enum values. Return
   ONLY this JSON block — no other commentary.

If nothing survives in either bucket (no error, just a quiet week),
that's `status: "ok"` with an empty `items` array, not an error.
