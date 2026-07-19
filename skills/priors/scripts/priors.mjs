#!/usr/bin/env node
// @ts-check
/* priors.mjs — reference keeper for the PRIORS standard (see PRIORS.md).
   Single file, zero dependencies, Node >= 18.
   The model proposes; this script disposes. All guarantees live in exit codes:
   0 = ok · 1 = refused (reason on stdout as JSON) · 2 = usage error.
   User-facing output is plain language (fixed / carried / your call / new);
   terms of art stay inside the data. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = '.priors';
const LEDGER = () => join(DIR, 'ledger.jsonl');
const RUNS = () => join(DIR, 'runs');

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
/* directions that reverse each other; candidates may extend via "opposes" */
const OPPOSES = {
  terser: 'expand', expand: 'terser',
  'proof-earlier': 'proof-later', 'proof-later': 'proof-earlier',
  'cta-singular': 'cta-multiple', 'cta-multiple': 'cta-singular',
  'hoist-resource': 'inline-resource', 'inline-resource': 'hoist-resource',
};
const SEV = ['minor', 'major', 'gate'];
const BINDING_SET = ['accepted', 'wontfix'];
const AGENT_VERDICTS = ['fixed', 'still-open', 'stale', 'challenged', 'obsolete-proposed'];
const HUMAN_VERDICTS = ['accepted', 'wontfix', 'obsolete', 'reopen'];

/* ── determinism utilities ── */
const canon = (o) => JSON.stringify(sortKeys(o));
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}
const normText = (s) => s.replace(/\s+/g, ' ').trim();
const sha12 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);

/* ── ledger primitives ── */
function loadLines(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
/** Fold ledger into state: id -> {prior, status, lastRun}. Append-only truth. */
function fold(lines) {
  /** @type {Record<string, {prior: any, status: string, lastRun: string}>} */
  const st = {};
  for (const l of lines) {
    if (l.t === 'prior') st[l.id] = { prior: l, status: 'open', lastRun: l.born };
    else if (l.t === 'event' && st[l.id]) {
      st[l.id].status = l.to === 'reopen' ? 'open' : l.to;
      st[l.id].lastRun = l.run || st[l.id].lastRun;
    }
  }
  return st;
}
const state = () => fold(loadLines(LEDGER()));
function nextId(st, staged) {
  const n = Object.keys(st).length + staged;
  return 'P-' + String(n + 1).padStart(4, '0');
}
function refuse(code, detail) {
  process.stdout.write(canon({ refused: code, ...detail }) + '\n');
  process.exit(1);
}
function usage(msg) { process.stderr.write(msg + '\n'); process.exit(2); }
function arg(flag) { const i = process.argv.indexOf(flag); return i > -1 ? process.argv[i + 1] : undefined; }

/* ── facet validation ── */
function expandType(c) {
  const facets = c.type ? { ...TYPES[c.type], ...(c.facets || {}) } : c.facets;
  if (!facets) usage('candidate needs "type" (one of ' + Object.keys(TYPES).join('/') + ') or explicit "facets"');
  for (const [k, vals] of Object.entries(FACETS))
    if (!vals.includes(facets[k])) usage(`facet ${k}=${facets[k]} invalid; allowed: ${vals.join(', ')}`);
  // coherence rules (PRIORS.md §2)
  if (facets.obligation === 'inject-as-instruction' && facets.activation !== 'run-start') usage('inject requires activation run-start');
  if (facets.obligation === 'disposition-required' && facets.activation !== 'verify-phase') usage('disposition-required requires verify-phase');
  if (facets.obligation === 'veto-only' && facets.activation !== 'propose-gate') usage('veto-only requires propose-gate');
  if (facets.scope === 'repo-wide' && facets.lifecycle === 'stale-on-scope-change') usage('repo-wide scope cannot be stale-on-scope-change');
  if (facets.authority === 'binding') usage('authority is never self-assigned: priors are born advisory; use `decide` to promote');
  return facets;
}

/* ── verbs ── */
function init() {
  mkdirSync(RUNS(), { recursive: true });
  if (!existsSync(LEDGER())) writeFileSync(LEDGER(), '');
  render(true);
  console.log('priors: ready (.priors/ created — commit it with your repo)');
}

function hashCmd() {
  const text = arg('--text');
  const file = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : null;
  if (text !== undefined) return console.log(sha12(normText(text)));
  if (file) return console.log(sha12(normText(readFileSync(file, 'utf8'))));
  usage('priors hash <file> | priors hash --text "..."');
}

/** Deterministic exposure: the keeper selects; the model never "fails to find". */
function relevant() {
  const ns = arg('--ns') || usage('relevant needs --ns');
  let run = arg('--run');
  const scopesFile = arg('--scopes');
  const scopes = scopesFile ? JSON.parse(readFileSync(scopesFile, 'utf8')) : {};
  mkdirSync(RUNS(), { recursive: true });
  if (!run) {
    const n = readdirSync(RUNS()).filter((d) => d.startsWith('run-')).length + 1;
    run = 'run-' + String(n).padStart(3, '0');
  }
  mkdirSync(join(RUNS(), run), { recursive: true });
  const st = state();
  const inject = [], verify = [], settled = [], floors = [];
  for (const { prior, status } of Object.values(st)) {
    if (prior.ns !== ns || status === 'obsolete') continue;
    const f = prior.facets;
    if (f.activation === 'run-start' && ['open', ...BINDING_SET].includes(status))
      inject.push({ id: prior.id, claim: prior.claim, status });
    else if (f.activation === 'verify-phase' && ['open', 'stale', 'challenged'].includes(status)) {
      const cur = scopes[prior.scope_ref];
      const scopeState = cur === undefined ? 'missing' : cur === prior.scope_hash ? 'unchanged' : 'changed';
      verify.push({ id: prior.id, claim: prior.claim, scope_ref: prior.scope_ref, scopeState, severity: prior.severity });
    } else if (BINDING_SET.includes(status)) settled.push(prior.id);
    if (f.activation === 'propose-gate' && status === 'open')
      floors.push({ id: prior.id, scope_ref: prior.scope_ref, depth: prior.depth || 'major' });
  }
  const out = { run, ns, inject, verify, settled: settled.length, floors };
  writeFileSync(join(RUNS(), run, 'relevant.json'), canon({ ...out, scopes }) + '\n');
  process.stdout.write(canon(out) + '\n');
}

function disposition() {
  const [id, verdict] = [process.argv[3], process.argv[4]];
  const run = arg('--run') || usage('disposition needs --run');
  if (!AGENT_VERDICTS.includes(verdict)) usage('agent verdicts: ' + AGENT_VERDICTS.join(' | ') + ' — accepted/wontfix are human words: use `decide`');
  const st = state();
  if (!st[id]) refuse('UNKNOWN_PRIOR', { id });
  if (BINDING_SET.includes(st[id].status)) refuse('BINDING_IMMUTABLE', { id, status: st[id].status, hint: 'only a human `decide reopen` can touch this' });
  appendFileSync(join(RUNS(), run, 'dispositions.jsonl'), canon({ t: 'event', id, action: 'disposition', to: verdict, run, by: 'agent' }) + '\n');
  console.log(`${id} → ${verdict}`);
}

/** The human door — the only source of binding status. */
function decide() {
  const [id, verdict] = [process.argv[3], process.argv[4]];
  if (!HUMAN_VERDICTS.includes(verdict)) usage('decide verdicts: ' + HUMAN_VERDICTS.join(' | '));
  const st = state();
  if (!st[id]) refuse('UNKNOWN_PRIOR', { id });
  const reason = arg('--because');
  if (verdict === 'reopen' && !reason) usage('reopen requires --because "reason" (the ratchet unlocks loudly, never silently)');
  appendFileSync(LEDGER(), canon({ t: 'event', id, action: 'decide', to: verdict, by: 'human', ...(reason ? { reason } : {}) }) + '\n');
  render(true);
  console.log(`${id} → ${verdict} (your call — this sticks)`);
}

/** propose: dedup, re-raise veto, reversal escalation, coverage floor. */
function propose() {
  const run = arg('--run') || usage('propose needs --run');
  const ns = arg('--ns') || usage('propose needs --ns');
  const file = process.argv[3];
  if (!file || file.startsWith('--')) usage('propose <candidate.json> --run R --ns N');
  const c = JSON.parse(readFileSync(file, 'utf8'));
  const facets = expandType(c);
  if (facets.scope !== 'repo-wide' && (!c.scope_ref || !c.scope_hash)) usage('non-repo-wide candidates need scope_ref and scope_hash');
  if (!c.claim) usage('candidate needs a claim');
  const st = state();
  // overlay this run's staged dispositions — a same-run "fixed" must already
  // count for the reversal/re-raise checks, or the veto has a blind spot
  const dispFile = join(RUNS(), run, 'dispositions.jsonl');
  if (existsSync(dispFile)) for (const d of loadLines(dispFile)) if (st[d.id]) st[d.id].status = d.to;
  const stagedFile = join(RUNS(), run, 'staged.jsonl');
  const staged = loadLines(stagedFile);
  for (const { prior, status } of Object.values(st)) {
    if (prior.ns !== ns) continue;
    const sameRef = prior.scope_ref && prior.scope_ref === c.scope_ref;
    const sameHash = sameRef && prior.scope_hash === c.scope_hash;
    const sameDir = c.direction && prior.direction === c.direction;
    const reverses = c.direction && prior.direction &&
      (OPPOSES[c.direction] === prior.direction || (c.opposes || []).includes(prior.direction));
    // 1 · dedup vs the SEEN set (any status) on unchanged scope
    if (sameHash && sameDir) refuse('DUPLICATE', { of: prior.id, status, hint: 'already known — disposition it instead of re-proposing' });
    // 2 · re-raise of a human decision on unchanged scope
    if (sameHash && BINDING_SET.includes(status)) refuse('RERAISE', { of: prior.id, status, hint: 'decided by a human; unchanged code — not re-arguable' });
    // 3 · reversal of applied/decided advice → tradeoff escalation, never a finding
    if (sameRef && reverses && ['fixed', ...BINDING_SET].includes(status)) {
      appendFileSync(join(RUNS(), run, 'escalations.jsonl'), canon({ candidate: c, conflicts_with: prior.id, run }) + '\n');
      refuse('REVERSAL', { of: prior.id, hint: 'this would reverse settled direction "' + prior.direction + '" — recorded as a tradeoff for the human; decide once' });
    }
    // 4 · coverage floor: unchanged scope may not be dredged below contracted depth
    if (prior.facets.activation === 'propose-gate' && status === 'open' && c.severity &&
        !c.scope_changed && c.scope_ref && c.scope_ref.startsWith(prior.scope_ref === '*' ? '' : prior.scope_ref) &&
        SEV.indexOf(c.severity) < SEV.indexOf(prior.depth || 'major'))
      refuse('BELOW_FLOOR', { of: prior.id, depth: prior.depth || 'major', hint: 'below the contracted review depth on unchanged code — request a deeper pass explicitly' });
  }
  const id = nextId(st, staged.length);
  const rec = sortKeys({ t: 'prior', id, ns, type: c.type || 'custom', facets, scope_ref: c.scope_ref, scope_hash: c.scope_hash,
    claim: normText(c.claim), direction: c.direction, severity: c.severity, depth: c.depth, evidence: c.evidence, born: run });
  appendFileSync(stagedFile, JSON.stringify(rec) + '\n');
  console.log(`${id} staged (new)`);
}

/** commit: fail-closed — full disposition coverage or nothing ledgers. */
function commit() {
  const run = arg('--run') || usage('commit needs --run');
  const rel = JSON.parse(readFileSync(join(RUNS(), run, 'relevant.json'), 'utf8'));
  const disp = loadLines(join(RUNS(), run, 'dispositions.jsonl'));
  const done = new Set(disp.map((d) => d.id));
  const missing = rel.verify.filter((v) => !done.has(v.id)).map((v) => v.id);
  if (missing.length) refuse('INCOMPLETE_DISPOSITIONS', { missing, hint: 'every carried prior must be dispositioned before this run can be recorded' });
  const staged = loadLines(join(RUNS(), run, 'staged.jsonl'));
  const esc = loadLines(join(RUNS(), run, 'escalations.jsonl'));
  for (const d of disp) appendFileSync(LEDGER(), canon(d) + '\n');
  for (const s of staged) appendFileSync(LEDGER(), canon(s) + '\n');
  render(true);
  const n = (v) => disp.filter((d) => d.to === v).length;
  const calls = n('challenged') + n('obsolete-proposed') + esc.length;
  console.log(`Checked against ${rel.verify.length} priors:`);
  if (n('fixed')) console.log(`  ✓ ${n('fixed')} fixed — nice work`);
  if (n('still-open')) console.log(`  → ${n('still-open')} carried (same items as last run, unchanged)`);
  if (n('stale')) console.log(`  ~ ${n('stale')} touched by changes — re-judged this run`);
  if (calls) console.log(`  ? ${calls} need your call — \`priors status --calls\` to review`);
  console.log(`New this run: ${staged.length}`);
}

function status() {
  const st = state();
  const calls = arg('--calls') !== undefined || process.argv.includes('--calls');
  const byNs = {};
  for (const { prior, status: s } of Object.values(st)) {
    byNs[prior.ns] ||= { open: 0, settled: 0, learned: 0, calls: [] };
    if (BINDING_SET.includes(s)) byNs[prior.ns].settled++;
    else if (prior.facets.obligation === 'inject-as-instruction' && s === 'open') byNs[prior.ns].learned++;
    else if (s === 'open' || s === 'stale') byNs[prior.ns].open++;
    if (['challenged', 'obsolete-proposed'].includes(s)) byNs[prior.ns].calls.push(prior.id + ' — ' + prior.claim);
  }
  for (const [ns, c] of Object.entries(byNs)) {
    console.log(`${ns}: ${c.open} open · ${c.settled} decided by you · ${c.learned} lessons locked`);
    if (calls) for (const q of c.calls) console.log('  ? ' + q);
  }
  if (!Object.keys(byNs).length) console.log('no priors yet — first run writes them');
}

function render(quiet) {
  const st = state();
  const rows = Object.values(st).map(({ prior: p, status: s }) =>
    `| ${p.id} | ${p.ns} | ${p.type} | ${s} | ${p.scope_ref || '—'} | ${(p.claim || '').slice(0, 72)} |`);
  writeFileSync(join(DIR, 'PRIORS.md'),
    '# Priors — what is already settled here\n\n*Rendered by the keeper; do not edit — the truth is `ledger.jsonl`.*\n\n' +
    '| id | area | type | status | where | what |\n|---|---|---|---|---|---|\n' + rows.join('\n') + '\n');
  if (!quiet) console.log('rendered .priors/PRIORS.md');
}

/* ── entry ── */
const VERBS = { init, hash: hashCmd, relevant, disposition, decide, propose, commit, status, render: () => render(false) };
export const __test = { canon, sha12, normText, fold, expandType, TYPES, FACETS, OPPOSES };
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const verb = process.argv[2];
  if (!verb || !VERBS[verb]) usage('priors <init|hash|relevant|disposition|decide|propose|commit|status|render>');
  VERBS[verb]();
}
