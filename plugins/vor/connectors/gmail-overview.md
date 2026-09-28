---
description: Surface genuinely important, non-marketing emails and how long they've sat unread
allowed-tools: mcp__claude_ai_Gmail__search_threads, mcp__claude_ai_Gmail__get_thread
---

You are triaging my Gmail inbox. Do the following:

1. Search unread inbox mail from the last 30 days, letting Gmail's own
   categorization do the first pass of noise-filtering:
   ```
   query: in:inbox is:unread -category:promotions -category:social -category:forums newer_than:30d
   view: THREAD_VIEW_MINIMAL
   pageSize: 50
   ```

   If this call errors — the tool isn't available (Gmail connector not
   configured), or the error says something like "needs you to sign in
   again" / re-authenticate — that's a failure, not an empty inbox. This
   run's `status` is `error`, `error` names the actual problem (e.g. "Gmail
   MCP connector needs re-authentication — run /mcp"), skip straight to
   step 4 with an empty `items` array.

2. Apply judgment on what's left. Gmail's categories catch most bulk mail,
   but promotional/automated noise still lands in Primary or Updates
   (newsletters, "you have new followers"-style pings, drip marketing,
   generic digests). Drop anything that reads as one-to-many broadcast
   content with no specific ask of me, regardless of sender. Keep anything
   that:
   - is a direct message from a real person (colleague, client, contact)
     with a request, question, or decision
   - is a transactional/automated notice that still requires a decision or
     action from me (a security alert, a payment failure, a document
     awaiting signature, a support reply, a genuine deadline)

   If a snippet alone isn't enough to tell broadcast content from a genuine
   ask, use `get_thread` to read the full message before deciding. Never
   rely on a fixed sender/domain blacklist — judge each email by its actual
   content and structure (mass-broadcast language, "unsubscribe" framing,
   no specific ask), since a hardcoded list won't generalize across
   inboxes.

3. For each surviving thread, work out:
   - Sender (name, plus org/domain if the name alone isn't informative) →
     `actor`
   - Subject → `title`
   - When the unread message arrived → `timestamp` (ISO 8601)
   - Days unattended = days between that timestamp and now → `age_days`
     (unread = unattended; this connector doesn't currently track
     read-but-unreplied mail)
   - One plain-language sentence: what it's actually about and why it's
     worth a look → `summary`
   - A short 2-4 word tag naming the specific reason it's flagged (e.g.
     "Needs reply", "Needs signature", "Security alert", "Payment issue") →
     `label`
   - The thread's Gmail link → `url`
   - `urgency` is always `"attention"` for this connector — everything
     that survives the filter in step 2 is, by definition, something worth
     your attention. (`waiting`/`fyi`/`resolved` aren't used here; this
     connector doesn't yet track sent mail awaiting reply or resolved
     threads.)

4. Emit a single fenced ```json code block conforming EXACTLY to the
   schema at `schema/connector-report.schema.json` (source: `"gmail"`).
   Include every surviving item in full. Do not deviate from the schema's
   field names, types, or enum values. Return ONLY this JSON block — no
   other commentary.

If the search genuinely returns nothing (no error, just no unread mail
worth surfacing), that's `status: "ok"` with an empty `items` array, not
an error.
