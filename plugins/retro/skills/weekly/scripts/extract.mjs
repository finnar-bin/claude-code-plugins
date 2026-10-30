#!/usr/bin/env node
// Retro extractor: turns Claude Code transcripts into durable per-session metrics.
// Zero dependencies, no network. Reads <config>/projects/**, writes <config>/retros/.
//
// Commands:
//   doctor                  check environment and transcript readability
//   extract [--since 7d]    scan transcripts, upsert history, write pending.json
//   ingest <file.json>      store classifier output (pushback labels, outcomes)
//   report-data [--since 7d] [--until DATE]   aggregate history as JSON on stdout
//
// Options: --config-dir DIR (default $CLAUDE_CONFIG_DIR or ~/.claude), --out-dir DIR, --all,
//          --regrade (extract only: re-grade outcomes and summaries for sessions already graded)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const EXTRACTOR_VERSION = 1;
const DAY = 864e5;
const CATEGORIES = [
  "not_pushback",
  "wrong_approach",
  "missed_requirement",
  "convention_violation",
  "factual_error",
  "scope_creep",
  "quality_bug",
  "other_correction",
];
const OUTCOMES = ["done_first_try", "done_after_corrections", "abandoned", "unclear"];
// standout sessions shown in the report
const TOP_FRICTION = 5;
const TOP_CLEAN = 5;
const CLEAN_MIN_FOLLOWUPS = 3; // a clean session only counts if it had real back-and-forth

// ---------- helpers ----------

function die(msg) {
  console.error(`retro: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  let cmd = "extract";
  let rest = argv;
  if (argv[0] && !argv[0].startsWith("--")) [cmd, ...rest] = argv;
  const o = { _: [] };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith("--")) {
      o._.push(a);
      continue;
    }
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) o[a.slice(2)] = true;
    else {
      o[a.slice(2)] = next;
      i++;
    }
  }
  return { cmd, o };
}

function parseTime(v, fallbackDays, now) {
  if (v === undefined || v === true) return now - fallbackDays * DAY;
  const m = /^(\d+)d$/.exec(v);
  if (m) return now - Number(m[1]) * DAY;
  const t = Date.parse(v);
  if (Number.isNaN(t)) die(`can't parse time "${v}" (use e.g. 7d or 2026-10-26)`);
  return t;
}

function isoWeek(ms) {
  const d = new Date(ms);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y = t.getUTCFullYear();
  const w = Math.ceil(((t - Date.UTC(y, 0, 1)) / DAY + 1) / 7);
  return `${y}-W${String(w).padStart(2, "0")}`;
}

function readJsonl(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return { records: [], bad: 0 };
  }
  const records = [];
  let bad = 0;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      bad++;
    }
  }
  return { records, bad };
}

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
  fs.renameSync(tmp, file);
}

// ---------- redaction ----------

const REDACTIONS = [
  [/https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/g, "[REDACTED_URL]"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, "[REDACTED_KEY]"],
  [/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g, "[REDACTED]"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, "[REDACTED]"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, "[REDACTED]"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, "[REDACTED]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED]"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, "[REDACTED_JWT]"],
  [/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{16,}/gi, "$1 [REDACTED]"],
  [/([a-z][a-z0-9+.-]*:\/\/)[^\s:@/]+:[^\s@/]+@/gi, "$1[REDACTED]@"],
  [
    /\b((?:api[_-]?key|secret|token|passw(?:or)?d|authorization)["']?\s*[:=]\s*["']?)[^\s"',;]{8,}/gi,
    "$1[REDACTED]",
  ],
];

function redact(s, max) {
  let out = String(s ?? "");
  for (const [re, rep] of REDACTIONS) out = out.replace(re, rep);
  out = out.replace(/\s+/g, " ").trim();
  return max && out.length > max ? `${out.slice(0, max)}…` : out;
}

// ---------- repo label ----------

const repoCache = new Map();

function repoOf(cwd) {
  if (!cwd) return "unknown";
  if (repoCache.has(cwd)) return repoCache.get(cwd);
  const norm = cwd.replace(/\\/g, "/");
  let label;
  const wt = norm.match(/^(.*)\/\.claude\/worktrees\//);
  if (wt) label = path.basename(wt[1]);
  else {
    // walk up looking for .git; a worktree's .git file points back at the main repo
    let dir = cwd;
    for (let i = 0; i < 12 && !label; i++) {
      const g = path.join(dir, ".git");
      try {
        const st = fs.statSync(g);
        if (st.isDirectory()) label = path.basename(dir);
        else {
          const m = /gitdir:\s*(.+)/.exec(fs.readFileSync(g, "utf8"));
          const common = m && m[1].trim().replace(/\\/g, "/").match(/^(.*)\/\.git\/worktrees\//);
          label = path.basename(common ? common[1] : dir);
        }
      } catch {
        const up = path.dirname(dir);
        if (up === dir) break;
        dir = up;
      }
    }
  }
  label ||= path.basename(cwd) || "unknown";
  repoCache.set(cwd, label);
  return label;
}

// ---------- transcript discovery ----------

function findTranscripts(configDir) {
  const root = path.join(configDir, "projects");
  const out = [];
  let dirs = [];
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return out;
  }
  for (const d of dirs) {
    const pdir = path.join(root, d.name);
    let entries = [];
    try {
      entries = fs.readdirSync(pdir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const f of entries) {
      if (!f.isFile() || !f.name.endsWith(".jsonl")) continue;
      const id = f.name.slice(0, -6);
      const subDir = path.join(pdir, id, "subagents");
      let subs = [];
      try {
        subs = fs.readdirSync(subDir).filter((n) => n.endsWith(".jsonl")).map((n) => path.join(subDir, n));
      } catch {}
      const file = path.join(pdir, f.name);
      out.push({ file, id, projectDir: d.name, subs, mtime: fs.statSync(file).mtimeMs });
    }
  }
  return out;
}

// ---------- session analysis ----------

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const COMMIT_RE = /\bgit\s+(?:-C\s+\S+\s+)?commit\b/;
const PR_RE = /\bgh\s+pr\s+create\b/;
const NON_PROMPT_RE = /^<(command-name|command-message|local-command|system-reminder|task-notification)/;

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((b) => b && b.type === "text").map((b) => b.text || "").join("\n");
}

function bump(obj, key, n = 1) {
  obj[key] = (obj[key] || 0) + n;
}

function newSeg() {
  return { skills: new Set(), agents: new Set() };
}

function analyze(t) {
  const { records, bad } = readJsonl(t.file);
  const st = {
    first: Infinity, last: -Infinity, title: null, cwd: null, branch: null, version: null, cost: null,
    turns: [], interrupts: 0, interruptsTool: 0, denials: 0, toolCalls: 0, toolErrors: 0,
    edits: 0, editFiles: new Map(), commits: 0, prs: 0, skills: {}, commands: {}, models: {},
    usage: new Map(), lastText: "", firstPrompt: "", seg: newSeg(), bad,
  };
  const pending = new Map();

  for (const r of records) {
    const ts = Date.parse(r.timestamp);
    if (!Number.isNaN(ts)) {
      st.first = Math.min(st.first, ts);
      st.last = Math.max(st.last, ts);
    }
    if (!st.cwd && r.cwd) st.cwd = r.cwd;
    if (r.gitBranch) st.branch = r.gitBranch;
    if (r.version) st.version = r.version;

    if (r.type === "ai-title" && r.aiTitle) st.title = r.aiTitle;
    else if (r.type === "cost-state") st.cost = r;
    else if (r.type === "assistant") {
      const m = r.message || {};
      if (m.id && m.usage) st.usage.set(m.id, m.usage);
      if (r.requestedModel) bump(st.models, r.requestedModel);
      if (r.attributionSkill) {
        st.seg.skills.add(r.attributionSkill);
        bump(st.skills, r.attributionSkill, 0);
      }
      for (const b of Array.isArray(m.content) ? m.content : []) {
        if (b.type === "text" && b.text) st.lastText = b.text;
        if (b.type !== "tool_use") continue;
        st.toolCalls++;
        const inp = b.input || {};
        if (b.name === "Skill" && inp.skill) {
          st.seg.skills.add(inp.skill);
          bump(st.skills, inp.skill, 0);
        } else if (b.name === "Agent" || b.name === "Task") st.seg.agents.add(inp.subagent_type || "general-purpose");
        else if (EDIT_TOOLS.has(b.name) && (inp.file_path || inp.notebook_path)) {
          st.edits++;
          const f = inp.file_path || inp.notebook_path;
          st.editFiles.set(f, (st.editFiles.get(f) || 0) + 1);
        } else if (b.name === "Bash" && typeof inp.command === "string") {
          if (COMMIT_RE.test(inp.command)) pending.set(b.id, "commit");
          else if (PR_RE.test(inp.command)) pending.set(b.id, "pr");
        }
      }
    } else if (r.type === "user") {
      const content = r.message?.content;
      const blocks = Array.isArray(content) ? content : [];
      const results = blocks.filter((b) => b.type === "tool_result");
      if (results.length) {
        const denied = r.toolDenialKind === "user-rejected";
        if (denied) st.denials++;
        for (const b of results) {
          if (b.is_error && !denied && !r.toolDenialKind) st.toolErrors++;
          const kind = pending.get(b.tool_use_id);
          if (kind && !b.is_error) st[kind === "commit" ? "commits" : "prs"]++;
        }
        continue;
      }
      const text = textOf(content).trim();
      if (text.startsWith("[Request interrupted by user")) {
        st.interrupts++;
        if (text.includes("for tool use")) st.interruptsTool++;
        continue;
      }
      const cmd = /<command-name>\/?([^<]+)<\/command-name>/.exec(text);
      if (cmd) {
        bump(st.commands, cmd[1].trim());
        continue;
      }
      const typed = /^\/([A-Za-z][\w:.-]*)(\s|$)/.exec(text);
      if (typed) {
        bump(st.commands, typed[1]);
        continue;
      }
      if (!text || r.isMeta || r.isCompactSummary || r.isSidechain) continue;
      if (NON_PROMPT_RE.test(text) || text.startsWith("This session is being continued")) continue;
      if (r.origin?.kind && r.origin.kind !== "human") continue;

      const i = st.turns.length;
      if (i === 0) st.firstPrompt = text;
      st.turns.push({
        i,
        ts: Number.isNaN(ts) ? null : ts,
        text: redact(text, 800),
        prev: redact(st.lastText, 400),
        ctx: { skills: [...st.seg.skills], agents: [...st.seg.agents] },
      });
      st.seg = newSeg();
      st.lastText = "";
    }
  }

  // subagents: count by type, keep their errors and tokens separate from the main thread
  const subagents = {};
  let subToolErrors = 0;
  let subTok = { in: 0, out: 0 };
  for (const file of t.subs) {
    let type = "unknown";
    try {
      type = JSON.parse(fs.readFileSync(file.replace(/\.jsonl$/, ".meta.json"), "utf8")).agentType || type;
    } catch {}
    bump(subagents, type);
    const sub = readJsonl(file);
    st.bad += sub.bad;
    const seen = new Map();
    for (const r of sub.records) {
      if (r.type === "assistant" && r.message?.id && r.message.usage) seen.set(r.message.id, r.message.usage);
      if (r.type === "user" && Array.isArray(r.message?.content))
        for (const b of r.message.content)
          if (b.type === "tool_result" && b.is_error && !r.toolDenialKind) subToolErrors++;
    }
    for (const u of seen.values()) {
      subTok.in += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
      subTok.out += u.output_tokens || 0;
    }
  }

  const tok = { in: 0, out: 0, cache_read: 0, cache_write: 0 };
  for (const u of st.usage.values()) {
    tok.in += u.input_tokens || 0;
    tok.out += u.output_tokens || 0;
    tok.cache_read += u.cache_read_input_tokens || 0;
    tok.cache_write += u.cache_creation_input_tokens || 0;
  }

  const end = Number.isFinite(st.last) ? st.last : t.mtime;
  const start = Number.isFinite(st.first) ? st.first : end;
  const row = {
    session: t.id,
    repo: repoOf(st.cwd),
    cwd: st.cwd,
    branch: st.branch,
    title: st.title,
    version: st.version,
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    week: isoWeek(end),
    human_turns: st.turns.length,
    followups: Math.max(0, st.turns.length - 1),
    interrupts: st.interrupts,
    interrupts_tool: st.interruptsTool,
    denials: st.denials,
    tool_calls: st.toolCalls,
    tool_errors: st.toolErrors,
    edits: st.edits,
    files_reedited: [...st.editFiles.values()].filter((n) => n >= 2).length,
    commits: st.commits,
    prs: st.prs,
    subagents,
    subagent_tool_errors: subToolErrors,
    subagent_tokens: subTok,
    skills: st.skills,
    commands: st.commands,
    models: st.models,
    tokens: tok,
    cost_usd: st.cost?.totalCostUSD ?? null,
    lines_added: st.cost?.totalLinesAdded ?? null,
    lines_removed: st.cost?.totalLinesRemoved ?? null,
    skipped_records: st.bad,
    outcome: null,
    outcome_note: null,
    summary: null,
    extractor_version: EXTRACTOR_VERSION,
  };
  const digest = {
    session: t.id,
    repo: row.repo,
    title: row.title,
    first_prompt: redact(st.firstPrompt, 300),
    last_assistant: redact(st.lastText || "", 300),
    followups: row.followups,
    interrupts: row.interrupts,
    denials: row.denials,
    tool_errors: row.tool_errors,
    commits: row.commits,
    prs: row.prs,
  };
  return { row, turns: st.turns, digest };
}

// ---------- commands ----------

function paths(o) {
  const configDir = o["config-dir"] || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  const outDir = o["out-dir"] || path.join(configDir, "retros");
  return {
    configDir,
    outDir,
    sessions: path.join(outDir, "history", "sessions.jsonl"),
    pushback: path.join(outDir, "history", "pushback.jsonl"),
    pending: path.join(outDir, "pending.json"),
  };
}

function doctor(o) {
  const p = paths(o);
  const lines = [];
  const warn = [];
  lines.push(`node ${process.version} on ${process.platform}`);
  lines.push(`config dir: ${p.configDir}`);
  lines.push(`output dir: ${p.outDir}`);
  const ts = findTranscripts(p.configDir);
  if (!ts.length) warn.push(`no transcripts found under ${path.join(p.configDir, "projects")}`);
  lines.push(`transcripts: ${ts.length} across ${new Set(ts.map((t) => t.projectDir)).size} project dirs`);
  if (ts.length) {
    const oldest = Math.min(...ts.map((t) => t.mtime));
    lines.push(`oldest transcript: ${new Date(oldest).toISOString().slice(0, 10)}`);
    let parsed = 0;
    let unknown = 0;
    let bad = 0;
    for (const t of ts.slice(-5)) {
      const r = readJsonl(t.file);
      bad += r.bad;
      for (const rec of r.records) {
        parsed++;
        if (!rec.type) unknown++;
      }
    }
    lines.push(`sample parse: ${parsed} records, ${bad} unparseable lines, ${unknown} without a type`);
    if (bad > 0 || (parsed && unknown / parsed > 0.2)) warn.push("transcript format may have changed; numbers could be off");
  }
  let retention = 30;
  let explicit = false;
  try {
    const s = JSON.parse(fs.readFileSync(path.join(p.configDir, "settings.json"), "utf8"));
    if (Number.isFinite(s.cleanupPeriodDays)) {
      retention = s.cleanupPeriodDays;
      explicit = true;
    }
  } catch {}
  lines.push(`transcript retention: ${retention} days${explicit ? "" : " (default)"}`);
  if (retention < 14) warn.push(`retention is ${retention} days; run the retro at least that often or sessions are lost`);
  lines.push(`history: ${fs.existsSync(p.sessions) ? readJsonl(p.sessions).records.length : 0} sessions stored`);
  console.log(lines.join("\n"));
  if (warn.length) console.log(`\nwarnings:\n- ${warn.join("\n- ")}`);
}

function extract(o) {
  const p = paths(o);
  const now = Date.now();
  const since = o.all ? 0 : parseTime(o.since, 7, now);
  const found = findTranscripts(p.configDir).filter((t) => t.mtime >= since);

  const stored = new Map(readJsonl(p.sessions).records.map((r) => [r.session, r]));
  const labeled = readJsonl(p.pushback).records;
  const classified = new Set(labeled.map((r) => `${r.session}#${r.turn}`));
  const pbCount = new Map();
  for (const r of labeled) if (r.category !== "not_pushback") pbCount.set(r.session, (pbCount.get(r.session) || 0) + 1);
  const turns = [];
  const digests = [];
  let skipped = 0;

  for (const t of found) {
    const { row, turns: tt, digest } = analyze(t);
    skipped += row.skipped_records;
    const old = stored.get(row.session);
    // keep an existing grade only if the session hasn't moved since it was graded
    if (old && old.end === row.end && !o.regrade) {
      row.outcome = old.outcome;
      row.outcome_note = old.outcome_note;
      row.summary = old.summary ?? null;
    }
    stored.set(row.session, row);
    for (const x of tt)
      if (x.i >= 1 && !classified.has(`${row.session}#${x.i}`))
        turns.push({ session: row.session, repo: row.repo, turn: x.i, text: x.text, prev_assistant: x.prev, ctx: x.ctx });
    if (row.human_turns > 0 && !row.outcome) {
      digest.pushback = pbCount.get(row.session) || 0;
      digests.push(digest);
    }
  }

  const rows = [...stored.values()].sort((a, b) => a.start.localeCompare(b.start));
  writeJsonl(p.sessions, rows);
  fs.mkdirSync(p.outDir, { recursive: true });
  fs.writeFileSync(
    p.pending,
    JSON.stringify({ generated: new Date(now).toISOString(), categories: CATEGORIES, outcomes: OUTCOMES, turns, sessions: digests }, null, 1),
  );
  // chunk the work so each classifier subagent gets a small, self-contained file
  const chunkDir = path.join(p.outDir, "pending");
  fs.rmSync(chunkDir, { recursive: true, force: true });
  fs.mkdirSync(chunkDir, { recursive: true });
  const turnsPer = Number(o.chunk) || 40;
  const sessionsPer = 10;
  const chunks = Math.max(Math.ceil(turns.length / turnsPer), Math.ceil(digests.length / sessionsPer));
  for (let i = 0; i < chunks; i++)
    fs.writeFileSync(
      path.join(chunkDir, `chunk-${i}.json`),
      JSON.stringify({
        categories: CATEGORIES,
        outcomes: OUTCOMES,
        turns: turns.slice(i * turnsPer, (i + 1) * turnsPer),
        sessions: digests.slice(i * sessionsPer, (i + 1) * sessionsPer),
      }),
    );
  console.log(
    JSON.stringify({
      scanned_sessions: found.length,
      stored_sessions: rows.length,
      pending_turns: turns.length,
      pending_outcomes: digests.length,
      chunks,
      chunk_dir: chunkDir,
      skipped_records: skipped,
      out_dir: p.outDir,
    }),
  );
}

function ingest(o) {
  const p = paths(o);
  if (!o._.length) die("usage: ingest <classifier-output.json> [more.json ...]");
  const input = { pushback: [], outcomes: [], classifier_version: undefined };
  for (const file of o._) {
    try {
      const part = JSON.parse(fs.readFileSync(file, "utf8"));
      input.pushback.push(...(part.pushback || []));
      input.outcomes.push(...(part.outcomes || []));
      input.classifier_version ??= part.classifier_version;
    } catch (e) {
      console.error(`retro: skipping ${file}: ${e.message}`);
    }
  }
  let pending = { turns: [] };
  try {
    pending = JSON.parse(fs.readFileSync(p.pending, "utf8"));
  } catch {}
  const known = new Map(pending.turns.map((t) => [`${t.session}#${t.turn}`, t]));
  const sessions = new Map(readJsonl(p.sessions).records.map((r) => [r.session, r]));
  const rows = new Map(readJsonl(p.pushback).records.map((r) => [`${r.session}#${r.turn}`, r]));
  const version = o["classifier-version"] || input.classifier_version || 1;
  let added = 0;
  let rejected = 0;

  for (const x of input.pushback || []) {
    const key = `${x.session}#${x.turn}`;
    const src = known.get(key);
    if (!src || !CATEGORIES.includes(x.category)) {
      rejected++;
      continue;
    }
    rows.set(key, {
      session: x.session,
      turn: x.turn,
      repo: src.repo,
      category: x.category,
      summary: redact(x.summary, 200),
      ctx: src.ctx,
      classifier_version: version,
    });
    added++;
  }
  let graded = 0;
  for (const x of input.outcomes || []) {
    const s = sessions.get(x.session);
    if (!s || !OUTCOMES.includes(x.outcome)) {
      rejected++;
      continue;
    }
    s.outcome = x.outcome;
    s.outcome_note = redact(x.note, 200);
    s.summary = x.summary ? redact(x.summary, 300) : null;
    graded++;
  }
  writeJsonl(p.pushback, [...rows.values()]);
  writeJsonl(p.sessions, [...sessions.values()]);
  console.log(JSON.stringify({ pushback_added: added, outcomes_graded: graded, rejected }));
}

function aggregate(sess, pbBySession) {
  const a = {
    sessions: sess.length, human_turns: 0, followups: 0, classified: 0, pushback: 0, unclassified: 0,
    interrupts: 0, denials: 0, tool_calls: 0, tool_errors: 0, files_reedited: 0, commits: 0, prs: 0,
    cost_usd: 0, clean_sessions: 0, by_category: {},
  };
  let active = 0;
  for (const s of sess) {
    const rows = pbBySession.get(s.session) || [];
    const hits = rows.filter((r) => r.category !== "not_pushback");
    const unclassified = Math.max(0, s.followups - rows.length);
    a.human_turns += s.human_turns;
    a.followups += s.followups;
    a.classified += rows.length;
    a.pushback += hits.length;
    a.unclassified += unclassified;
    a.interrupts += s.interrupts;
    a.denials += s.denials;
    a.tool_calls += s.tool_calls;
    a.tool_errors += s.tool_errors;
    a.files_reedited += s.files_reedited;
    a.commits += s.commits;
    a.prs += s.prs;
    a.cost_usd += s.cost_usd || 0;
    for (const r of hits) bump(a.by_category, r.category);
    if (s.human_turns > 0) {
      active++;
      if (!hits.length && !s.interrupts && !s.denials && !unclassified) a.clean_sessions++;
    }
  }
  a.pushback_rate = a.classified ? +(a.pushback / a.classified).toFixed(3) : null;
  a.clean_rate = active ? +(a.clean_sessions / active).toFixed(3) : null;
  a.cost_usd = +a.cost_usd.toFixed(2);
  return a;
}

// a skill can show up bare ("google-workspace") and namespaced ("anthropic-skills:google-workspace");
// fold the bare form into the namespaced one when both exist
function skillCanon(sess, pbBySession) {
  const all = new Set();
  for (const s of sess) {
    Object.keys(s.skills).forEach((n) => all.add(n));
    Object.keys(s.commands).forEach((n) => all.add(n));
    for (const r of pbBySession.get(s.session) || []) (r.ctx?.skills || []).forEach((n) => all.add(n));
  }
  const namespaced = [...all].filter((n) => n.includes(":"));
  return (n) => (n.includes(":") ? n : namespaced.find((x) => x.endsWith(`:${n}`)) || n);
}

function attribution(sess, pbBySession, field) {
  const names = new Map();
  const slot = (n) => {
    if (!names.has(n)) names.set(n, { name: n, sessions: 0, turns_after: 0, pushback_after: 0 });
    return names.get(n);
  };
  const canon = field === "skills" ? skillCanon(sess, pbBySession) : (n) => n;
  for (const s of sess) {
    // built-ins (/cd, /compact) aren't skills: keep a command only if it's namespaced or also seen as a skill
    const cmds = Object.keys(s.commands).filter((c) => c.includes(":") || c in s.skills);
    const used = field === "skills" ? [...Object.keys(s.skills), ...cmds] : Object.keys(s.subagents);
    for (const n of new Set(used.map(canon))) slot(n).sessions++;
    for (const r of pbBySession.get(s.session) || []) {
      for (const n of new Set((r.ctx?.[field] || []).map(canon))) {
        const x = slot(n);
        x.turns_after++;
        if (r.category !== "not_pushback") x.pushback_after++;
      }
    }
  }
  return [...names.values()]
    .map((x) => ({ ...x, pushback_rate: x.turns_after ? +(x.pushback_after / x.turns_after).toFixed(3) : null }))
    .sort((a, b) => b.sessions - a.sessions);
}

// The outcome grader runs alongside pushback labeling, so it can't always see the labels.
// Don't let it call a session with several corrections a first-try success.
const FIRST_TRY_MAX_PUSHBACK = 2;
function effectiveOutcome(s, pbBySession) {
  if (s.outcome !== "done_first_try") return s.outcome ?? null;
  const hits = (pbBySession.get(s.session) || []).filter((r) => r.category !== "not_pushback").length;
  return hits > FIRST_TRY_MAX_PUSHBACK ? "done_after_corrections" : s.outcome;
}

// the sessions worth a closer look: most friction, and clean ones with real back-and-forth
function standouts(cur, pbBySession) {
  const active = cur.filter((s) => s.human_turns > 0);
  const detail = (s) => {
    const rows = pbBySession.get(s.session) || [];
    const hits = rows.filter((r) => r.category !== "not_pushback");
    const cats = {};
    for (const r of hits) bump(cats, r.category);
    return {
      session: s.session.slice(0, 8),
      title: s.title,
      repo: s.repo,
      date: s.start.slice(0, 10),
      followups: s.followups,
      pushback: hits.length,
      pushback_rate: s.followups ? +(hits.length / s.followups).toFixed(3) : null,
      by_category: cats,
      interrupts: s.interrupts,
      denials: s.denials,
      tool_errors: s.tool_errors,
      files_reedited: s.files_reedited,
      outcome: effectiveOutcome(s, pbBySession),
      note: s.outcome_note ?? null,
      summary: s.summary ?? null,
      skills: Object.keys(s.skills),
      agents: Object.keys(s.subagents),
      cost_usd: s.cost_usd,
      pushback_examples: hits.slice(0, 3).map((r) => r.summary),
      _hits: hits.length,
      _unclassified: Math.max(0, s.followups - rows.length),
    };
  };
  const all = active.map(detail);
  const strip = ({ _hits, _unclassified, ...rest }) => rest;
  const friction = all
    .filter((d) => d._hits || d.interrupts || d.denials)
    .sort((a, b) => b._hits - a._hits || b.interrupts + b.denials - (a.interrupts + a.denials) || b.followups - a.followups)
    .slice(0, TOP_FRICTION);
  const clean = all
    .filter((d) => !d._hits && !d.interrupts && !d.denials && !d._unclassified && d.followups >= CLEAN_MIN_FOLLOWUPS)
    .sort((a, b) => b.followups - a.followups)
    .slice(0, TOP_CLEAN);
  return { active_sessions: active.length, shown: friction.length + clean.length, friction: friction.map(strip), clean: clean.map(strip) };
}

function reportData(o) {
  const p = paths(o);
  const now = Date.now();
  const until = o.until ? parseTime(o.until, 0, now) : now;
  const since = parseTime(o.since, 7, until);
  const span = until - since;
  const all = readJsonl(p.sessions).records;
  const pb = readJsonl(p.pushback).records;
  const pbBySession = new Map();
  for (const r of pb) {
    if (!pbBySession.has(r.session)) pbBySession.set(r.session, []);
    pbBySession.get(r.session).push(r);
  }
  const inRange = (s, lo, hi) => {
    const e = Date.parse(s.end);
    return e >= lo && e < hi;
  };
  const cur = all.filter((s) => inRange(s, since, until));
  const prev = all.filter((s) => inRange(s, since - span, since));

  const repos = {};
  for (const s of cur) (repos[s.repo] ||= []).push(s);

  const weeks = {};
  for (const s of all) (weeks[s.week] ||= []).push(s);
  const trend = Object.keys(weeks)
    .sort()
    .slice(-8)
    .map((w) => {
      const a = aggregate(weeks[w], pbBySession);
      return { week: w, sessions: a.sessions, followups: a.followups, pushback: a.pushback, pushback_rate: a.pushback_rate, clean_rate: a.clean_rate, cost_usd: a.cost_usd };
    });

  const outcomes = {};
  for (const s of cur) bump(outcomes, effectiveOutcome(s, pbBySession) || "ungraded");

  // examples: round-robin across categories (most common first), preferring sessions not yet shown
  const titles = new Map(cur.map((s) => [s.session, s.title]));
  const byCat = {};
  for (const s of cur)
    for (const r of pbBySession.get(s.session) || []) if (r.category !== "not_pushback") (byCat[r.category] ||= []).push(r);
  const cats = Object.keys(byCat).sort((a, b) => byCat[b].length - byCat[a].length);
  const shown = {};
  const examples = [];
  while (examples.length < 12 && cats.some((c) => byCat[c].length)) {
    for (const c of cats) {
      if (examples.length >= 12 || !byCat[c].length) continue;
      let best = 0;
      byCat[c].forEach((r, i) => {
        if ((shown[r.session] || 0) < (shown[byCat[c][best].session] || 0)) best = i;
      });
      const [r] = byCat[c].splice(best, 1);
      shown[r.session] = (shown[r.session] || 0) + 1;
      examples.push({ repo: r.repo, category: r.category, summary: r.summary, session_title: titles.get(r.session) || null, ctx: r.ctx });
    }
  }

  console.log(
    JSON.stringify(
      {
        window: { since: new Date(since).toISOString(), until: new Date(until).toISOString() },
        current: aggregate(cur, pbBySession),
        previous: aggregate(prev, pbBySession),
        by_repo: Object.entries(repos).map(([repo, s]) => ({ repo, ...aggregate(s, pbBySession) })),
        skills: attribution(cur, pbBySession, "skills"),
        agents: attribution(cur, pbBySession, "agents"),
        outcomes,
        examples,
        standouts: standouts(cur, pbBySession),
        trend,
      },
      null,
      1,
    ),
  );
}

const { cmd, o } = parseArgs(process.argv.slice(2));
const commands = { doctor, extract, ingest, "report-data": reportData };
if (!commands[cmd]) die(`unknown command "${cmd}" (doctor | extract | ingest | report-data)`);
commands[cmd](o);
