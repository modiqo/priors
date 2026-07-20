#!/usr/bin/env node
// @ts-check
/* priors.mjs — reference keeper for the PRIORS standard (see PRIORS.md).
   Single file, zero dependencies, Node >= 18.
   The model proposes; this script disposes. All guarantees live in exit codes:
   0 = ok · 1 = refused (reason on stdout as JSON) · 2 = usage error.
   v0.3 hardens the trust boundary: scopes come from the recorded run snapshot,
   runs are single-writer and atomically committed, retries are idempotent, and
   committed staging data is removed. */
import { createHash } from 'node:crypto';
import {
  appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync,
  readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = '.priors';
const LEDGER = () => join(DIR, 'ledger.jsonl');
const RUNS = () => join(DIR, 'runs');
const LOCK = () => join(DIR, 'keeper.lock');
const ARCHIVE_K = 5;

/* ── registry: the grammar (facets) and the vocabulary (type presets) ── */
const FACETS = {
  scope: ['content-hash', 'tool-version', 'env-fingerprint', 'repo-wide'],
  activation: ['run-start', 'verify-phase', 'propose-gate'],
  obligation: ['disposition-required', 'inject-as-instruction', 'veto-only'],
  authority: ['advisory', 'binding'],
  lifecycle: ['stale-on-scope-change', 'challenged-on-failure', 'only-by-supersession'],
};
const TYPES = {
  conclusion:  { scope: 'content-hash', activation: 'verify-phase', obligation: 'disposition-required', authority: 'advisory', lifecycle: 'stale-on-scope-change' },
  behavioral:  { scope: 'tool-version', activation: 'run-start', obligation: 'inject-as-instruction', authority: 'advisory', lifecycle: 'challenged-on-failure' },
  coverage:    { scope: 'content-hash', activation: 'propose-gate', obligation: 'veto-only', authority: 'advisory', lifecycle: 'stale-on-scope-change' },
  calibration: { scope: 'repo-wide', activation: 'run-start', obligation: 'inject-as-instruction', authority: 'advisory', lifecycle: 'only-by-supersession' },
};
const OPPOSES = {
  terser: 'expand', expand: 'terser',
  'proof-earlier': 'proof-later', 'proof-later': 'proof-earlier',
  'cta-singular': 'cta-multiple', 'cta-multiple': 'cta-singular',
  'hoist-resource': 'inline-resource', 'inline-resource': 'hoist-resource',
};
const SEV = ['minor', 'major', 'gate'];
const BINDING_SET = ['accepted', 'wontfix'];
const AGENT_VERDICTS = ['fixed', 'still-open', 'stale', 'reaffirmed', 'challenged', 'obsolete-proposed'];
const HUMAN_VERDICTS = ['accepted', 'wontfix', 'obsolete', 'reopen', 'keep'];
const RUN_RE = /^run-\d{3,}$/;

/* ── deterministic serialization and CLI errors ── */
const canon = (o) => JSON.stringify(sortKeys(o));
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}
const normText = (s) => s.replace(/\s+/g, ' ').trim();
const sha12 = (data) => createHash('sha256').update(data).digest('hex').slice(0, 12);

class CliError extends Error {
  constructor(exitCode, output, stream = 'stdout') {
    super(output);
    this.exitCode = exitCode;
    this.output = output;
    this.stream = stream;
  }
}
function refuse(code, detail = {}) { throw new CliError(1, canon({ refused: code, ...detail }) + '\n'); }
function usage(msg) { throw new CliError(2, msg + '\n', 'stderr'); }
function arg(flag) { const i = process.argv.indexOf(flag); return i > -1 ? process.argv[i + 1] : undefined; }

/* ── files, locks, ledger fold ── */
function loadLines(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
function atomicWrite(file, content) {
  const temp = file + '.tmp-' + process.pid;
  writeFileSync(temp, content);
  renameSync(temp, file);
}
function writeLines(file, lines) {
  atomicWrite(file, lines.length ? lines.map(canon).join('\n') + '\n' : '');
}
function withLock(fn) {
  mkdirSync(DIR, { recursive: true });
  let fd;
  for (let attempt = 0; attempt < 2 && fd === undefined; attempt++) {
    try {
      fd = openSync(LOCK(), 'wx');
      writeFileSync(fd, String(process.pid));
    } catch (e) {
      if (!(e && e.code === 'EEXIST')) throw e;
      let stale = false;
      try {
        const owner = Number(readFileSync(LOCK(), 'utf8'));
        if (!Number.isInteger(owner) || owner <= 0) stale = true;
        else process.kill(owner, 0);
      } catch (probe) {
        if (probe && ['ESRCH', 'ENOENT', 'EINVAL'].includes(probe.code)) stale = true;
      }
      if (stale && attempt === 0) {
        if (existsSync(LOCK())) unlinkSync(LOCK());
        continue;
      }
      refuse('KEEPER_LOCKED', { hint: 'another keeper process is writing; retry after it finishes' });
    }
  }
  try { return fn(); }
  finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(LOCK())) unlinkSync(LOCK());
  }
}
function validateRun(run) {
  if (!run || !RUN_RE.test(run)) usage('run ids must match run-NNN (for example run-004)');
  return run;
}
const runDir = (run) => join(RUNS(), validateRun(run));
const runCommit = (lines, run) => lines.find((l) => l.t === 'run' && l.action === 'commit' && l.run === run);

function applyEvent(e, l, runIndex) {
  if (l.action === 'scope-missing') e.miss++;
  else if (l.action === 'disposition') {
    e.miss = 0;
    e.lastRun = l.run || e.lastRun;
    if (l.scope_hash) e.scopeHash = l.scope_hash;
    e.status = ['still-open', 'reaffirmed'].includes(l.to) ? 'open' : l.to;
  } else if (l.action === 'decide') {
    e.miss = 0;
    e.status = l.to === 'reopen' ? 'open' : l.to === 'keep' ? 'accepted' : l.to;
    e.humanIdx = runIndex;
  } else if (l.action === 'redact') e.status = 'redacted';
}

/** Fold the append-only ledger into current prior state, committed-run order,
    and unresolved human calls. Effective scope hashes come from re-judgments,
    while the original prior record remains immutable. */
function fold(lines) {
  /** @type {Record<string, any>} */
  const st = {};
  const runsOrder = [];
  const calls = [];
  const seeRun = (r) => { if (r && !runsOrder.includes(r)) runsOrder.push(r); };
  for (const l of lines) {
    if (l.t === 'prior') {
      seeRun(l.born);
      st[l.id] = {
        prior: l, status: l.redacted ? 'redacted' : 'open', scopeHash: l.scope_hash,
        lastRun: l.born, miss: 0, humanIdx: l.redacted ? -1 : runsOrder.length - 1,
      };
    } else if (l.t === 'event' && st[l.id]) {
      seeRun(l.run);
      applyEvent(st[l.id], l, runsOrder.length - 1);
      if (l.action === 'decide') {
        for (const call of calls) if (!call.resolved && call.conflicts_with === l.id) {
          call.resolved = true;
          call.resolution = l.to;
        }
      }
    } else if (l.t === 'call') {
      seeRun(l.run);
      calls.push({ ...l, resolved: Boolean(l.redacted) });
    } else if (l.t === 'run' && l.action === 'commit') seeRun(l.run);
  }
  return { st, runsOrder, calls };
}
const state = () => fold(loadLines(LEDGER()));
const isArchived = (e) => e.miss >= ARCHIVE_K && !BINDING_SET.includes(e.status) && e.status !== 'redacted';
function nextId(st, staged) {
  const nums = [...Object.keys(st), ...staged.map((p) => p.id)]
    .map((id) => /^P-(\d+)$/.exec(id)?.[1]).filter(Boolean).map(Number);
  return 'P-' + String((nums.length ? Math.max(...nums) : 0) + 1).padStart(4, '0');
}
function nextRunId(lines) {
  const nums = [];
  for (const l of lines) {
    for (const value of [l.run, l.born]) {
      const m = typeof value === 'string' && /^run-(\d+)$/.exec(value);
      if (m) nums.push(Number(m[1]));
    }
  }
  if (existsSync(RUNS())) for (const name of readdirSync(RUNS())) {
    const m = /^run-(\d+)$/.exec(name);
    if (m) nums.push(Number(m[1]));
  }
  return 'run-' + String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0');
}
function activeRun() {
  if (!existsSync(RUNS())) return null;
  return readdirSync(RUNS()).find((name) => RUN_RE.test(name) && existsSync(join(RUNS(), name, 'relevant.json'))) || null;
}
function requireOpenRun(run, lines = loadLines(LEDGER())) {
  validateRun(run);
  if (runCommit(lines, run)) refuse('RUN_COMMITTED', { run, hint: 'this run is sealed; start a new run' });
  const dir = runDir(run);
  const relevantFile = join(dir, 'relevant.json');
  if (!existsSync(relevantFile)) refuse('UNKNOWN_RUN', { run });
  return { dir, rel: JSON.parse(readFileSync(relevantFile, 'utf8')) };
}

/* ── facet validation ── */
function expandType(c) {
  const facets = c.type ? { ...TYPES[c.type], ...(c.facets || {}) } : c.facets;
  if (!facets) usage('candidate needs "type" (one of ' + Object.keys(TYPES).join('/') + ') or explicit "facets"');
  for (const [k, vals] of Object.entries(FACETS))
    if (!vals.includes(facets[k])) usage(`facet ${k}=${facets[k]} invalid; allowed: ${vals.join(', ')}`);
  if (facets.obligation === 'inject-as-instruction' && facets.activation !== 'run-start') usage('inject requires activation run-start');
  if (facets.obligation === 'disposition-required' && facets.activation !== 'verify-phase') usage('disposition-required requires verify-phase');
  if (facets.obligation === 'veto-only' && facets.activation !== 'propose-gate') usage('veto-only requires propose-gate');
  if (facets.scope === 'repo-wide' && facets.lifecycle === 'stale-on-scope-change') usage('repo-wide scope cannot be stale-on-scope-change');
  if (facets.authority === 'binding') usage('authority is never self-assigned: priors are born advisory; use `decide` to promote');
  return facets;
}

/* ── verbs ── */
function init() {
  withLock(() => {
    mkdirSync(RUNS(), { recursive: true });
    if (!existsSync(LEDGER())) writeFileSync(LEDGER(), '');
    render(true);
  });
  console.log('priors: ready (.priors/ created — commit it with your repo)');
}

function hashCmd() {
  const text = arg('--text');
  const rawFile = arg('--raw');
  if (process.argv.includes('--stdin-raw')) return console.log(sha12(readFileSync(0)));
  if (rawFile !== undefined) return console.log(sha12(readFileSync(rawFile)));
  const file = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : null;
  if (text !== undefined) return console.log(sha12(normText(text)));
  if (file) return console.log(sha12(normText(readFileSync(file, 'utf8'))));
  usage('priors hash <text-file> | hash --text "..." | hash --raw <file> | hash --stdin-raw');
}

/** Deterministic exposure: the keeper selects; the model never fails to find. */
function relevant() {
  const ns = arg('--ns') || usage('relevant needs --ns');
  const requestedRun = arg('--run');
  const scopesFile = arg('--scopes');
  const scopes = scopesFile ? JSON.parse(readFileSync(scopesFile, 'utf8')) : {};
  if (!scopes || Array.isArray(scopes) || typeof scopes !== 'object' || Object.values(scopes).some((v) => typeof v !== 'string'))
    usage('scopes must be a JSON object mapping scope references to hash strings');
  const out = withLock(() => {
    mkdirSync(RUNS(), { recursive: true });
    const lines = loadLines(LEDGER());
    const active = activeRun();
    if (active) refuse('ACTIVE_RUN_EXISTS', { run: active, hint: `commit it or abort it with: priors abort --run ${active}` });
    const run = requestedRun ? validateRun(requestedRun) : nextRunId(lines);
    if (runCommit(lines, run) || existsSync(runDir(run))) refuse('RUN_EXISTS', { run });
    mkdirSync(runDir(run), { recursive: false });
    const { st, runsOrder } = fold(lines);
    const inject = [], verify = [], nudges = [], floors = [];
    let settled = 0, archived = 0;
    for (const e of Object.values(st)) {
      const { prior, status } = e;
      if (prior.ns !== ns || status === 'obsolete' || status === 'redacted') continue;
      const f = prior.facets;
      if (f.activation === 'run-start' && ['open', ...BINDING_SET].includes(status)) {
        inject.push({ id: prior.id, claim: prior.claim, status });
        if (prior.review_every && (runsOrder.length - 1 - e.humanIdx) >= prior.review_every)
          nudges.push({ id: prior.id, claim: prior.claim, ask: 'still true? reply: decide ' + prior.id + ' keep — or retire it' });
      } else if (f.activation === 'verify-phase' && ['open', 'stale', 'challenged'].includes(status)) {
        const cur = scopes[prior.scope_ref];
        const scopeState = cur === undefined ? 'missing' : cur === e.scopeHash ? 'unchanged' : 'changed';
        if (isArchived(e)) {
          if (cur === undefined) { archived++; continue; }
          verify.push({ id: prior.id, claim: prior.claim, scope_ref: prior.scope_ref, severity: prior.severity,
            scopeState, current_hash: cur, resurrected: true });
        } else verify.push({ id: prior.id, claim: prior.claim, scope_ref: prior.scope_ref,
          severity: prior.severity, scopeState, ...(cur === undefined ? {} : { current_hash: cur }) });
      } else if (BINDING_SET.includes(status)) settled++;
      if (f.activation === 'propose-gate' && status === 'open') {
        const cur = scopes[prior.scope_ref];
        floors.push({ id: prior.id, scope_ref: prior.scope_ref, depth: prior.depth || 'major',
          scopeState: cur === undefined ? 'missing' : cur === e.scopeHash ? 'unchanged' : 'changed' });
      }
    }
    const result = { run, ns, inject, verify, nudges, settled, archived, floors };
    atomicWrite(join(runDir(run), 'relevant.json'), canon({ ...result, scopes }) + '\n');
    return result;
  });
  process.stdout.write(canon(out) + '\n');
}

function disposition() {
  const [id, verdict] = [process.argv[3], process.argv[4]];
  const run = arg('--run') || usage('disposition needs --run');
  if (!AGENT_VERDICTS.includes(verdict)) usage('agent verdicts: ' + AGENT_VERDICTS.join(' | ') + ' — accepted/wontfix/keep are human words: use `decide`');
  withLock(() => {
    const lines = loadLines(LEDGER());
    const { dir, rel } = requireOpenRun(run, lines);
    const { st } = fold(lines);
    if (!st[id]) refuse('UNKNOWN_PRIOR', { id });
    if (st[id].prior.ns !== rel.ns) refuse('PRIOR_OUTSIDE_RUN', { id, run, ns: rel.ns });
    if (BINDING_SET.includes(st[id].status)) refuse('BINDING_IMMUTABLE', { id, status: st[id].status, hint: 'only a human `decide reopen` can touch this' });
    if (st[id].status === 'redacted') refuse('REDACTED', { id });
    const item = rel.verify.find((v) => v.id === id);
    const injected = rel.inject.find((v) => v.id === id);
    if (!item && !(verdict === 'challenged' && injected)) refuse('PRIOR_OUTSIDE_RUN', { id, run, hint: 'only priors exposed by this run may be updated' });
    if (verdict === 'challenged' && !injected) refuse('CHALLENGE_REQUIRES_INJECTED_PRIOR', { id });
    if (item?.scopeState === 'missing') refuse('MISSING_SCOPE', { id, hint: 'missing scopes are tracked automatically at commit' });
    if (verdict === 'reaffirmed' && item?.scopeState !== 'changed') refuse('REAFFIRM_REQUIRES_CHANGE', { id });
    if (verdict === 'still-open' && item?.scopeState === 'changed')
      refuse('CHANGED_SCOPE_REQUIRES_REJUDGMENT', { id, hint: 'use reaffirmed if the same claim survives under the new hash; otherwise fixed or obsolete-proposed' });
    if (verdict === 'stale' && item?.scopeState !== 'changed') refuse('STALE_REQUIRES_CHANGE', { id });
    const dispFile = join(dir, 'dispositions.jsonl');
    if (loadLines(dispFile).some((d) => d.id === id)) refuse('ALREADY_DISPOSITIONED', { id, run });
    const event = { t: 'event', id, action: 'disposition', to: verdict, run, by: 'agent',
      ...(item?.current_hash ? { scope_hash: item.current_hash } : {}) };
    appendFileSync(dispFile, canon(event) + '\n');
  });
  console.log(`${id} → ${verdict}`);
}

/** The human door. Process identity cannot prove humanity, so harnesses MUST
    expose this verb only in response to an explicit human decision. */
function decide() {
  const [id, verdict] = [process.argv[3], process.argv[4]];
  if (!HUMAN_VERDICTS.includes(verdict)) usage('decide verdicts: ' + HUMAN_VERDICTS.join(' | '));
  const reason = arg('--because');
  if (verdict === 'reopen' && !reason) usage('reopen requires --because "reason" (the ratchet unlocks loudly, never silently)');
  withLock(() => {
    const lines = loadLines(LEDGER());
    const { st } = fold(lines);
    if (!st[id]) refuse('UNKNOWN_PRIOR', { id });
    if (st[id].status === 'redacted') refuse('REDACTED', { id });
    const active = activeRun();
    if (active) refuse('ACTIVE_RUN_EXISTS', { run: active, hint: 'human decisions are recorded between runs; commit or abort the active run first' });
    lines.push(sortKeys({ t: 'event', id, action: 'decide', to: verdict, by: 'human', ...(reason ? { reason } : {}) }));
    writeLines(LEDGER(), lines);
    render(true);
  });
  console.log(`${id} → ${verdict} (your call — this sticks)`);
}

function scrubValue(value, id, contentHash) {
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, id, contentHash));
  if (value && typeof value === 'object') {
    if (value.id === id) return { id, redacted: true, content_hash: contentHash };
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubValue(v, id, contentHash)]));
  }
  return value;
}
function scrubRunMaterializations(id, contentHash) {
  if (!existsSync(RUNS())) return;
  const updates = [];
  const visit = (dir) => {
    for (const name of readdirSync(dir)) {
      const file = join(dir, name);
      if (statSync(file).isDirectory()) visit(file);
      else if (name.endsWith('.json') || name.endsWith('.jsonl')) {
        const rows = readFileSync(file, 'utf8').split('\n');
        const scrubbed = rows.map((row) => row ? canon(scrubValue(JSON.parse(row), id, contentHash)) : '').join('\n');
        updates.push([file, scrubbed]);
      }
    }
  };
  visit(RUNS());
  for (const [file, content] of updates) atomicWrite(file, content);
}

/** Record forgetting — remove content from the ledger and every current run
    materialization. Git history remains a separate concern. */
function redact() {
  const id = process.argv[3];
  const reason = arg('--because') || usage('redact requires --because "reason"');
  withLock(() => {
    const lines = loadLines(LEDGER());
    const original = lines.find((l) => l.t === 'prior' && l.id === id);
    if (!original) refuse('UNKNOWN_PRIOR', { id });
    if (original.redacted) refuse('ALREADY_REDACTED', { id });
    const contentHash = sha12(canon(original));
    const out = lines.map((l) => {
      if (l.t === 'prior' && l.id === id)
        return sortKeys({ t: 'prior', id: l.id, ns: l.ns, redacted: true, content_hash: contentHash, born: l.born });
      if (l.t === 'event' && l.id === id && l.reason) {
        const { reason: oldReason, ...rest } = l;
        return sortKeys({ ...rest, reason_redacted: true, reason_hash: sha12(oldReason) });
      }
      if (l.t === 'call' && l.conflicts_with === id)
        return sortKeys({ t: 'call', call_id: l.call_id, kind: l.kind, run: l.run,
          ns: l.ns, conflicts_with: id, redacted: true });
      return l;
    });
    out.push(sortKeys({ t: 'event', id, action: 'redact', by: 'human', reason }));
    scrubRunMaterializations(id, contentHash);
    writeLines(LEDGER(), out);
    render(true);
  });
  console.log(`${id} redacted — content removed from current .priors data, removal remembered. Note: git history still holds old content; scrub history separately if this was a secret.`);
}

function obligationsOpen(rel, dir) {
  const done = new Set(loadLines(join(dir, 'dispositions.jsonl')).map((d) => d.id));
  return rel.verify.filter((v) => v.scopeState !== 'missing' && !done.has(v.id)).map((v) => v.id);
}

/** propose: trusted scope snapshot, dedup, re-raise veto, reversal escalation,
    and coverage floor. Agent-supplied scope_changed is deliberately ignored. */
function propose() {
  const run = arg('--run') || usage('propose needs --run');
  const ns = arg('--ns') || usage('propose needs --ns');
  const file = process.argv[3];
  if (!file || file.startsWith('--')) usage('propose <candidate.json> --run R --ns N');
  let stagedId;
  withLock(() => {
    const lines = loadLines(LEDGER());
    const { dir, rel } = requireOpenRun(run, lines);
    if (rel.ns !== ns) refuse('RUN_NAMESPACE_MISMATCH', { run, expected: rel.ns, received: ns });
    const open = obligationsOpen(rel, dir);
    if (open.length) refuse('PRIOR_OBLIGATIONS_OPEN', { missing: open, hint: 'honor every carried prior before proposing anything new' });
    const c = JSON.parse(readFileSync(file, 'utf8'));
    const facets = expandType(c);
    if (!c.claim) usage('candidate needs a claim');
    let scopeRef = c.scope_ref;
    let scopeHash = c.scope_hash;
    if (facets.scope !== 'repo-wide') {
      if (!scopeRef) usage('non-repo-wide candidates need scope_ref');
      if (!Object.prototype.hasOwnProperty.call(rel.scopes, scopeRef))
        refuse('UNKNOWN_SCOPE', { scope_ref: scopeRef, hint: 'include every candidate scope in scopes.json before relevant' });
      const trusted = rel.scopes[scopeRef];
      if (scopeHash !== undefined && scopeHash !== trusted)
        refuse('SCOPE_MISMATCH', { scope_ref: scopeRef, expected: trusted, received: scopeHash, hint: 'candidate hashes cannot override the recorded run snapshot' });
      scopeHash = trusted;
    }
    const folded = fold(lines);
    const st = folded.st;
    const dispFile = join(dir, 'dispositions.jsonl');
    for (const d of loadLines(dispFile)) if (st[d.id]) applyEvent(st[d.id], d, folded.runsOrder.length - 1);
    const stagedFile = join(dir, 'staged.jsonl');
    const staged = loadLines(stagedFile);
    const stagedEntries = staged.map((prior) => ({ prior, status: 'open', scopeHash: prior.scope_hash }));
    const claim = normText(c.claim);
    for (const { prior, status, scopeHash: priorHash } of [...Object.values(st), ...stagedEntries]) {
      if (prior.ns !== ns || prior.redacted) continue;
      const sameRef = prior.scope_ref && prior.scope_ref === scopeRef;
      const sameHash = sameRef && priorHash === scopeHash;
      const sameClaim = claim === normText(prior.claim || '');
      const sameDir = c.direction && prior.direction === c.direction;
      const sameIssue = sameClaim || sameDir;
      const reverses = c.direction && prior.direction &&
        (OPPOSES[c.direction] === prior.direction || (c.opposes || []).includes(prior.direction));
      if (sameHash && sameIssue && BINDING_SET.includes(status))
        refuse('RERAISE', { of: prior.id, status, hint: 'decided by a human; unchanged scope — not re-arguable' });
      if (sameHash && sameIssue) refuse('DUPLICATE', { of: prior.id, status, hint: 'already known — disposition it instead of re-proposing' });
      if (sameHash && reverses && ['fixed', ...BINDING_SET].includes(status)) {
        const escalationFile = join(dir, 'escalations.jsonl');
        const duplicateCall = loadLines(escalationFile).some((e) => e.conflicts_with === prior.id &&
          e.candidate?.claim === claim && e.candidate?.direction === c.direction);
        if (!duplicateCall)
          appendFileSync(escalationFile, canon({ candidate: { claim, direction: c.direction }, conflicts_with: prior.id, run }) + '\n');
        refuse('REVERSAL', { of: prior.id, hint: 'this reverses a settled direction on the same scope state — recorded as a tradeoff for the human' });
      }
      const coverageHash = rel.scopes[prior.scope_ref];
      if (prior.facets.activation === 'propose-gate' && status === 'open' && c.severity &&
          coverageHash !== undefined && coverageHash === priorHash && scopeRef &&
          scopeRef.startsWith(prior.scope_ref === '*' ? '' : prior.scope_ref) &&
          SEV.indexOf(c.severity) < SEV.indexOf(prior.depth || 'major'))
        refuse('BELOW_FLOOR', { of: prior.id, depth: prior.depth || 'major', hint: 'below the contracted review depth on unchanged code — request a deeper pass explicitly' });
    }
    stagedId = nextId(st, staged);
    const rec = sortKeys({ t: 'prior', id: stagedId, ns, type: c.type || 'custom', facets,
      scope_ref: scopeRef, scope_hash: scopeHash, claim, direction: c.direction, severity: c.severity,
      depth: c.depth, evidence: c.evidence, review_every: c.review_every, born: run });
    appendFileSync(stagedFile, JSON.stringify(rec) + '\n');
  });
  console.log(`${stagedId} staged (new)`);
}

function summaryFor(rel, disp, staged, esc, nowArchived) {
  const n = (v) => disp.filter((d) => d.to === v).length;
  const calls = n('challenged') + n('obsolete-proposed') + esc.length + (rel.nudges || []).length;
  const lines = [`Checked against ${rel.verify.length} priors:`];
  if (n('fixed')) lines.push(`  ✓ ${n('fixed')} fixed — nice work`);
  if (n('still-open') || n('reaffirmed')) lines.push(`  → ${n('still-open') + n('reaffirmed')} carried (same identities, current scope state)`);
  if (n('stale')) lines.push(`  ~ ${n('stale')} touched by changes — queued for re-judgment`);
  if (calls) lines.push(`  ? ${calls} need your call — \`priors status --calls\` to review`);
  if (nowArchived) lines.push(`  … ${nowArchived} resting — the code they point at is gone; they wake if it returns`);
  lines.push(`New this run: ${staged.length}`);
  return lines;
}

/** Commit is a one-shot transaction. A run commit record makes retries
    idempotent, including the narrow crash window after the ledger rename. */
function commit() {
  const run = validateRun(arg('--run') || usage('commit needs --run'));
  let summary;
  withLock(() => {
    const lines = loadLines(LEDGER());
    const existing = runCommit(lines, run);
    if (existing) {
      summary = existing.summary;
      if (existsSync(runDir(run))) rmSync(runDir(run), { recursive: true, force: true });
      return;
    }
    const { dir, rel } = requireOpenRun(run, lines);
    const disp = loadLines(join(dir, 'dispositions.jsonl'));
    const duplicateDisps = disp.filter((d, i) => disp.findIndex((x) => x.id === d.id) !== i).map((d) => d.id);
    if (duplicateDisps.length) refuse('DUPLICATE_DISPOSITIONS', { ids: [...new Set(duplicateDisps)] });
    const malformedDisps = disp.filter((d) => {
      const item = rel.verify.find((v) => v.id === d.id);
      return d.t !== 'event' || d.action !== 'disposition' || d.by !== 'agent' || d.run !== run ||
        !AGENT_VERDICTS.includes(d.to) || (item?.current_hash && d.scope_hash !== item.current_hash);
    }).map((d) => d.id || '(missing id)');
    if (malformedDisps.length) refuse('MALFORMED_DISPOSITIONS', { ids: malformedDisps });
    const allowed = new Set([...rel.verify.map((v) => v.id), ...rel.inject.map((v) => v.id)]);
    const foreign = disp.filter((d) => !allowed.has(d.id)).map((d) => d.id);
    if (foreign.length) refuse('PRIOR_OUTSIDE_RUN', { ids: foreign, run });
    const done = new Set(disp.map((d) => d.id));
    const required = rel.verify.filter((v) => v.scopeState !== 'missing');
    const missing = required.filter((v) => !done.has(v.id)).map((v) => v.id);
    if (missing.length) refuse('INCOMPLETE_DISPOSITIONS', { missing, hint: 'every carried prior must be dispositioned before this run can be recorded' });
    const staged = loadLines(join(dir, 'staged.jsonl'));
    const esc = loadLines(join(dir, 'escalations.jsonl'));
    const existingIds = new Set(Object.keys(fold(lines).st));
    const stagedIds = staged.map((s) => s.id);
    const stagedCollisions = stagedIds.filter((id, i) => stagedIds.indexOf(id) !== i || existingIds.has(id));
    if (stagedCollisions.length) refuse('STAGED_ID_COLLISION', { ids: [...new Set(stagedCollisions)] });
    const malformed = staged.filter((s) => s.t !== 'prior' || s.ns !== rel.ns || s.born !== run ||
      (s.facets?.scope !== 'repo-wide' && rel.scopes[s.scope_ref] !== s.scope_hash))
      .map((s) => s.id || '(missing id)');
    if (malformed.length) refuse('MALFORMED_STAGING', { ids: malformed });
    const additions = [...disp];
    for (const v of rel.verify) if (v.scopeState === 'missing' && !done.has(v.id))
      additions.push(sortKeys({ t: 'event', id: v.id, action: 'scope-missing', run }));
    additions.push(...staged);
    esc.forEach((e, i) => additions.push(sortKeys({
      t: 'call', call_id: `${run}-C-${String(i + 1).padStart(2, '0')}`, kind: 'reversal',
      run, ns: rel.ns, conflicts_with: e.conflicts_with, claim: e.candidate.claim,
      direction: e.candidate.direction,
    })));
    const projected = fold([...lines, ...additions]);
    const nowArchived = Object.values(projected.st).filter((e) => e.prior.ns === rel.ns && isArchived(e)).length;
    summary = summaryFor(rel, disp, staged, esc, nowArchived);
    additions.push(sortKeys({ t: 'run', action: 'commit', run, ns: rel.ns, summary }));
    writeLines(LEDGER(), [...lines, ...additions]);
    rmSync(dir, { recursive: true, force: true });
    render(true);
  });
  console.log(summary.join('\n'));
}

function abort() {
  const run = validateRun(arg('--run') || usage('abort needs --run'));
  withLock(() => {
    const lines = loadLines(LEDGER());
    if (runCommit(lines, run)) refuse('RUN_COMMITTED', { run, hint: 'committed runs are immutable' });
    const dir = runDir(run);
    if (!existsSync(dir)) refuse('UNKNOWN_RUN', { run });
    rmSync(dir, { recursive: true, force: true });
  });
  console.log(`${run} aborted — uncommitted staging removed; the ledger was untouched`);
}

function status() {
  const { st, runsOrder, calls: ledgerCalls } = state();
  const showCalls = process.argv.includes('--calls');
  const byNs = {};
  for (const e of Object.values(st)) {
    const { prior, status: s } = e;
    byNs[prior.ns] ||= { open: 0, fixed: 0, retired: 0, settled: 0, learned: 0, resting: 0, calls: [] };
    if (s === 'redacted') continue;
    if (isArchived(e)) byNs[prior.ns].resting++;
    else if (s === 'fixed') byNs[prior.ns].fixed++;
    else if (s === 'obsolete') byNs[prior.ns].retired++;
    else if (BINDING_SET.includes(s)) byNs[prior.ns].settled++;
    else if (prior.facets?.obligation === 'inject-as-instruction' && s === 'open') byNs[prior.ns].learned++;
    else if (s === 'open' || s === 'stale') byNs[prior.ns].open++;
    if (['challenged', 'obsolete-proposed'].includes(s))
      byNs[prior.ns].calls.push(`${prior.id} — ${prior.claim} (decide ${prior.id} keep | obsolete)`);
    if (prior.review_every && ['open', ...BINDING_SET].includes(s) &&
        (runsOrder.length - 1 - e.humanIdx) >= prior.review_every)
      byNs[prior.ns].calls.push(`${prior.id} — still true? decide ${prior.id} keep | obsolete`);
  }
  for (const call of ledgerCalls.filter((c) => !c.resolved)) {
    byNs[call.ns] ||= { open: 0, fixed: 0, retired: 0, settled: 0, learned: 0, resting: 0, calls: [] };
    byNs[call.ns].calls.push(`${call.call_id} — ${call.claim} reverses ${call.conflicts_with}; decide ${call.conflicts_with} reopen --because "accept ${call.call_id}" | keep`);
  }
  for (const [ns, c] of Object.entries(byNs)) {
    console.log(`${ns}: ${c.open} open · ${c.fixed} fixed · ${c.settled} decided by you · ${c.learned} lessons locked` +
      (c.retired ? ` · ${c.retired} retired` : '') + (c.resting ? ` · ${c.resting} resting` : ''));
    if (showCalls) for (const q of c.calls) console.log('  ? ' + q);
  }
  if (!Object.keys(byNs).length) console.log('no priors yet — first run writes them');
}

function render(quiet) {
  mkdirSync(DIR, { recursive: true });
  const { st } = state();
  const rows = Object.values(st).map((e) => {
    const p = e.prior, s = e.status === 'redacted' ? 'redacted' : isArchived(e) ? 'resting' : e.status;
    return `| ${p.id} | ${p.ns || '—'} | ${p.type || '—'} | ${s} | ${p.scope_ref || '—'} | ${p.redacted ? '▇▇▇ [redacted]' : (p.claim || '').slice(0, 72)} |`;
  });
  atomicWrite(join(DIR, 'PRIORS.md'),
    '# Priors — what is already settled here\n\n*Rendered by the keeper; do not edit — the truth is `ledger.jsonl`.*\n\n' +
    '| id | area | type | status | where | what |\n|---|---|---|---|---|---|\n' + rows.join('\n') + '\n');
  if (!quiet) console.log('rendered .priors/PRIORS.md');
}

/* ── entry ── */
const VERBS = { init, hash: hashCmd, relevant, disposition, decide, redact, propose, commit, abort, status, render: () => render(false) };
export const __test = { canon, sha12, normText, fold, expandType, TYPES, FACETS, OPPOSES, ARCHIVE_K };
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const verb = process.argv[2];
    if (!verb || !VERBS[verb]) usage('priors <init|hash|relevant|disposition|decide|redact|propose|commit|abort|status|render>');
    VERBS[verb]();
  } catch (e) {
    if (!(e instanceof CliError)) throw e;
    (e.stream === 'stderr' ? process.stderr : process.stdout).write(e.output);
    process.exitCode = e.exitCode;
  }
}
