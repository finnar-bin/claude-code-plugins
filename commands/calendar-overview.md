---
description: What's happening today and what's coming up tomorrow
allowed-tools: mcp__claude_ai_Google_Calendar__list_events
---

You are giving me a quick readout of my calendar.

Check `$ARGUMENTS`: if it is exactly `json`, you're being invoked by the
orchestrator — do steps 1–3 and 5 only, skip the human-readable report in
step 4 entirely, emit nothing but the JSON block. Otherwise (no argument,
or anything else), you're being run directly — do steps 1–4 as normal and
skip step 5 entirely (no JSON block).

Do the following:

1. Determine the local timezone (e.g. `date +%Z` or
   `timedatectl show --property=Timezone`) — needed to bound "today" and
   "tomorrow" correctly and to interpret event times.

   If the Calendar tool isn't available or the call errors (connector not
   configured, needs re-auth), this run's `status` is `error`, `error`
   names the actual problem, skip straight to step 5 with an empty
   `items` array, and say the real problem plainly in your reply.

2. Fetch events from today 00:00 through the end of tomorrow (two
   calendar days) in that timezone:
   ```
   startTime: <today 00:00, local tz>
   endTime: <day after tomorrow 00:00, local tz>
   timeZone: <local tz>
   orderBy: startTime
   pageSize: 50
   ```
   Skip anything with `status: "cancelled"`, and skip anything where my
   own attendee entry (`self: true`) has `responseStatus: "declined"` —
   those aren't actually happening for me.

3. Bucket what's left into **Today** and **Tomorrow** by the event's
   local start date. For each event work out:
   - `title` → the event's `summary` (or "(no title)" if blank)
   - `actor` → the organizer (name/email)
   - `timestamp` → the event's start (`dateTime`, or `date` for an
     all-day event)
   - `age_days` → for this connector this means "days until it happens,"
     not "days overdue": `0` for Today, `1` for Tomorrow
   - `summary` → one plain-language sentence: the time range, who's
     involved, and anything worth noting (all-day, out-of-office, no
     attendees, etc.)
   - `label` → `"RSVP needed"` if my own attendee entry (`self: true`)
     has `responseStatus` of `needsAction` or `tentative`; otherwise a
     short descriptor of the entry itself (`"Meeting"`, `"Out of
     office"`, `"Focus time"`, `"All-day"`)
   - `urgency` → `attention` if `label` is `"RSVP needed"` (I owe a
     response), otherwise `fyi` — this connector is about awareness, not
     action, except for pending invites

4. Print a terse readout, table format, don't deviate:
   `## 📅 Today`
   `| Time | Event | Details |`
   `## 📅 Tomorrow`
   `| Time | Event | Details |`
   Skip a section entirely if it has no events (say so in one line
   instead, e.g. "Nothing on the calendar today."). Don't restate raw API
   output. Don't pad with commentary.

5. After the human-readable report, append a single fenced ```json code
   block conforming EXACTLY to the schema at
   `schema/connector-report.schema.json` (source: `"calendar"`). Include
   every surviving event from both Today and Tomorrow in full. `status` /
   `error` → `"ok"` / `null` unless step 1 hit a failure mode. Do not
   deviate from the schema's field names, types, or enum values.

If there's genuinely nothing on the calendar for either day (no error,
just an open schedule), say so plainly in whichever form applies — a
plain sentence in the human-readable report, or `status: "ok"` with an
empty `items` array in JSON mode — not an error.
