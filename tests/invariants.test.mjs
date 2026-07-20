// @ts-check
/* End-to-end invariant and adversarial tests for the reference keeper.
   Run: node --test tests/invariants.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const KEEPER = resolve(dirname(fileURLToPath(import.meta.url)), '../skills/priors/scripts/priors.mjs');

function keeper(cwd, args, expectFail = false, input) {
  try {
    return {
      out: execFileSync('node', [KEEPER, ...args], { cwd, encoding: 'utf8', input }),
      err: '', code: 0,
    };
  } catch (e) {
    if (!expectFail) throw e;
    return {
      out: e.stdout?.toString() || '', err: e.stderr?.toString() || '', code: e.status,
    };
  }
}
function fresh(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'priors-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return cwd;
}
function candidate(cwd, name, obj) {
  const file = join(cwd, name);
  writeFileSync(file, JSON.stringify(obj));
  return file;
}
function scopes(cwd, value) {
  const file = join(cwd, 'scopes.json');
  writeFileSync(file, JSON.stringify(value));
  return file;
}
function begin(cwd, ns, value, extra = []) {
  scopes(cwd, value);
  return JSON.parse(keeper(cwd, ['relevant', '--ns', ns, '--scopes', 'scopes.json', ...extra]).out);
}
function proposal(cwd, run, name, obj, ns = 'review', expectFail = false) {
  return keeper(cwd, ['propose', candidate(cwd, name, obj), '--ns', ns, '--run', run], expectFail);
}

/** Seed five committed review findings. */
function seed(cwd) {
  keeper(cwd, ['init']);
  const initialScopes = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`src/f${i + 1}.ts#fn`, `hash-v1-${i + 1}`]));
  const rel = begin(cwd, 'review', initialScopes);
  for (let i = 1; i <= 5; i++) proposal(cwd, rel.run, `c${i}.json`, {
    type: 'conclusion', scope_ref: `src/f${i}.ts#fn`, scope_hash: `hash-v1-${i}`,
    claim: `finding number ${i}`, direction: 'hoist-resource', severity: 'major',
  });
  keeper(cwd, ['commit', '--run', rel.run]);
  return rel.run;
}

test('replay: fixed acknowledged, carried keep identity, no re-discovery', (t) => {
  const cwd = fresh(t);
  seed(cwd);
  const current = {
    'src/f1.ts#fn': 'hash-v2-1', 'src/f2.ts#fn': 'hash-v2-2', 'src/f3.ts#fn': 'hash-v2-3',
    'src/f4.ts#fn': 'hash-v1-4', 'src/f5.ts#fn': 'hash-v1-5',
  };
  const rel = begin(cwd, 'review', current);
  assert.equal(rel.verify.length, 5);
  assert.equal(rel.verify.filter((v) => v.scopeState === 'changed').length, 3);
  for (const v of rel.verify)
    keeper(cwd, ['disposition', v.id, v.scopeState === 'changed' ? 'fixed' : 'still-open', '--run', rel.run]);
  const dup = proposal(cwd, rel.run, 'dup.json', {
    type: 'conclusion', scope_ref: 'src/f4.ts#fn', scope_hash: 'hash-v1-4',
    claim: 'finding number 4 reworded', direction: 'hoist-resource', severity: 'major',
  }, 'review', true);
  assert.equal(dup.code, 1);
  assert.match(dup.out, /DUPLICATE/);
  const summary = keeper(cwd, ['commit', '--run', rel.run]).out;
  assert.match(summary, /3 fixed/);
  assert.match(summary, /2 carried/);
  assert.match(summary, /New this run: 0/);
  assert.match(keeper(cwd, ['status']).out, /3 fixed/);
});

test('carried means carried: still-open reappears in the next run', (t) => {
  const cwd = fresh(t);
  seed(cwd);
  const current = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`src/f${i + 1}.ts#fn`, `hash-v1-${i + 1}`]));
  const r2 = begin(cwd, 'review', current);
  for (const v of r2.verify) keeper(cwd, ['disposition', v.id, 'still-open', '--run', r2.run]);
  keeper(cwd, ['commit', '--run', r2.run]);
  const r3 = begin(cwd, 'review', current);
  assert.equal(r3.verify.length, 5);
});

test('human wontfix blocks the same issue, but not unrelated findings in its scope', (t) => {
  const cwd = fresh(t);
  seed(cwd);
  keeper(cwd, ['decide', 'P-0004', 'wontfix']);
  const rel = begin(cwd, 'review', { 'src/f4.ts#fn': 'hash-v1-4' });
  const reraised = proposal(cwd, rel.run, 'reraised.json', {
    type: 'conclusion', scope_ref: 'src/f4.ts#fn', scope_hash: 'hash-v1-4',
    claim: 'raising it again', direction: 'hoist-resource', severity: 'major',
  }, 'review', true);
  assert.equal(reraised.code, 1);
  assert.match(reraised.out, /RERAISE/);
  const unrelated = proposal(cwd, rel.run, 'unrelated.json', {
    type: 'conclusion', scope_ref: 'src/f4.ts#fn', scope_hash: 'hash-v1-4',
    claim: 'input is not validated', direction: 'validate-input', severity: 'major',
  });
  assert.match(unrelated.out, /staged/);
});

test('reversal on the current applied hash persists as a human call', (t) => {
  const cwd = fresh(t);
  seed(cwd);
  const rel = begin(cwd, 'review', { 'src/f1.ts#fn': 'hash-v2-1' });
  keeper(cwd, ['disposition', 'P-0001', 'fixed', '--run', rel.run]);
  const reversed = proposal(cwd, rel.run, 'reverse.json', {
    type: 'conclusion', scope_ref: 'src/f1.ts#fn', scope_hash: 'hash-v2-1',
    claim: 'actually inline it again', direction: 'inline-resource', severity: 'major',
  }, 'review', true);
  assert.equal(reversed.code, 1);
  assert.match(reversed.out, /REVERSAL/);
  keeper(cwd, ['commit', '--run', rel.run]);
  const calls = keeper(cwd, ['status', '--calls']).out;
  assert.match(calls, /run-002-C-01/);
  assert.match(calls, /decide P-0001 reopen/);
});

test('fail-closed: commit refuses until every applicable prior is handled', (t) => {
  const cwd = fresh(t);
  seed(cwd);
  const rel = begin(cwd, 'review', { 'src/f1.ts#fn': 'hash-v1-1' });
  const result = keeper(cwd, ['commit', '--run', rel.run], true);
  assert.equal(result.code, 1);
  assert.match(result.out, /INCOMPLETE_DISPOSITIONS/);
});

test('nothing new before old: propose refuses while obligations remain', (t) => {
  const cwd = fresh(t);
  seed(cwd);
  const rel = begin(cwd, 'review', { 'src/f1.ts#fn': 'hash-v1-1', 'src/new.ts#fn': 'new-hash' });
  const result = proposal(cwd, rel.run, 'early.json', {
    type: 'conclusion', scope_ref: 'src/new.ts#fn', scope_hash: 'new-hash',
    claim: 'new issue', direction: 'validate-input', severity: 'major',
  }, 'review', true);
  assert.equal(result.code, 1);
  assert.match(result.out, /PRIOR_OBLIGATIONS_OPEN/);
});

test('coverage floor is derived from trusted parent scope state', (t) => {
  const cwd = fresh(t);
  keeper(cwd, ['init']);
  const r1 = begin(cwd, 'review', { 'src/': 'tree-v1' });
  proposal(cwd, r1.run, 'coverage.json', {
    type: 'coverage', scope_ref: 'src/', scope_hash: 'tree-v1',
    claim: 'reviewed src at depth major', depth: 'major',
  });
  keeper(cwd, ['commit', '--run', r1.run]);

  const r2 = begin(cwd, 'review', { 'src/': 'tree-v1', 'src/util.ts#fmt': 'child-v1' });
  const low = proposal(cwd, r2.run, 'low.json', {
    type: 'conclusion', scope_ref: 'src/util.ts#fmt', scope_hash: 'child-v1',
    claim: 'nit: rename variable', direction: 'rename', severity: 'minor', scope_changed: true,
  }, 'review', true);
  assert.equal(low.code, 1);
  assert.match(low.out, /BELOW_FLOOR/);
  keeper(cwd, ['commit', '--run', r2.run]);

  const r3 = begin(cwd, 'review', { 'src/': 'tree-v2', 'src/util.ts#fmt': 'child-v2' });
  const changed = proposal(cwd, r3.run, 'changed.json', {
    type: 'conclusion', scope_ref: 'src/util.ts#fmt', scope_hash: 'child-v2',
    claim: 'nit in changed code', direction: 'rename', severity: 'minor', scope_changed: false,
  });
  assert.match(changed.out, /staged/);
});

test('attention forgetting archives after five missing runs and resurrects identity', (t) => {
  const cwd = fresh(t);
  keeper(cwd, ['init']);
  const r1 = begin(cwd, 'review', { 'src/gone.ts#fn': 'hash-v1' });
  proposal(cwd, r1.run, 'gone.json', {
    type: 'conclusion', scope_ref: 'src/gone.ts#fn', scope_hash: 'hash-v1',
    claim: 'finding in code that will vanish', direction: 'hoist-resource', severity: 'major',
  });
  keeper(cwd, ['commit', '--run', r1.run]);
  for (let i = 0; i < 5; i++) {
    const r = begin(cwd, 'review', {});
    keeper(cwd, ['commit', '--run', r.run]);
  }
  const asleep = begin(cwd, 'review', {});
  assert.equal(asleep.verify.length, 0);
  assert.equal(asleep.archived, 1);
  keeper(cwd, ['commit', '--run', asleep.run]);
  const awake = begin(cwd, 'review', { 'src/gone.ts#fn': 'hash-v1' });
  assert.equal(awake.verify[0].id, 'P-0001');
  assert.equal(awake.verify[0].resurrected, true);
});

test('redact scrubs ledger and active run materializations, preserving sequence', (t) => {
  const cwd = fresh(t);
  keeper(cwd, ['init']);
  const r1 = begin(cwd, 'review', { cli: 'v1' });
  proposal(cwd, r1.run, 'secret.json', {
    type: 'behavioral', scope_ref: 'cli', scope_hash: 'v1',
    claim: 'credential marker SECRET_XYZ works for auth', direction: 'use-token',
  });
  keeper(cwd, ['commit', '--run', r1.run]);
  const r2 = begin(cwd, 'review', { cli: 'v1' });
  assert.match(JSON.stringify(r2.inject), /SECRET_XYZ/);
  keeper(cwd, ['redact', 'P-0001', '--because', 'captured a credential']);
  const hits = [];
  const visit = (dir) => {
    for (const name of readdirSync(dir)) {
      const file = join(dir, name);
      if (statSync(file).isDirectory()) visit(file);
      else if (readFileSync(file, 'utf8').includes('SECRET_XYZ')) hits.push(file);
    }
  };
  visit(join(cwd, '.priors'));
  assert.deepEqual(hits, []);
  keeper(cwd, ['abort', '--run', r2.run]);
  const r3 = begin(cwd, 'review', { 'src/a.ts#f': 'h1' });
  const next = proposal(cwd, r3.run, 'next.json', {
    type: 'conclusion', scope_ref: 'src/a.ts#f', scope_hash: 'h1',
    claim: 'a new finding', direction: 'rename', severity: 'major',
  });
  assert.match(next.out, /P-0002 staged/);
});

test('authority is never self-assigned', (t) => {
  const cwd = fresh(t);
  keeper(cwd, ['init']);
  const rel = begin(cwd, 'review', {});
  const result = proposal(cwd, rel.run, 'binding.json', {
    type: 'calibration', facets: { authority: 'binding' },
    claim: 'I declare myself law', direction: 'x',
  }, 'review', true);
  assert.equal(result.code, 2);
  assert.match(result.err, /authority is never self-assigned/);
});

test('candidate cannot spoof or invent scope state', (t) => {
  const cwd = fresh(t);
  seed(cwd);
  keeper(cwd, ['decide', 'P-0004', 'wontfix']);
  const rel = begin(cwd, 'review', { 'src/f4.ts#fn': 'real-hash', 'src/new.ts#fn': 'new-hash' });
  const spoof = proposal(cwd, rel.run, 'spoof.json', {
    type: 'conclusion', scope_ref: 'src/f4.ts#fn', scope_hash: 'invented-hash',
    claim: 'same issue', direction: 'hoist-resource', severity: 'major',
  }, 'review', true);
  assert.equal(spoof.code, 1);
  assert.match(spoof.out, /SCOPE_MISMATCH/);
  const unknown = proposal(cwd, rel.run, 'unknown.json', {
    type: 'conclusion', scope_ref: 'src/not-in-snapshot.ts#fn', scope_hash: 'x',
    claim: 'unknown scope issue', direction: 'rename', severity: 'major',
  }, 'review', true);
  assert.equal(unknown.code, 1);
  assert.match(unknown.out, /UNKNOWN_SCOPE/);
});

test('reaffirmed stale prior adopts the new trusted hash with the same id', (t) => {
  const cwd = fresh(t);
  keeper(cwd, ['init']);
  const r1 = begin(cwd, 'review', { 'src/a.ts#f': 'hash-v1' });
  proposal(cwd, r1.run, 'old.json', {
    type: 'conclusion', scope_ref: 'src/a.ts#f', scope_hash: 'hash-v1',
    claim: 'issue survives refactors', direction: 'rename', severity: 'major',
  });
  keeper(cwd, ['commit', '--run', r1.run]);
  const r2 = begin(cwd, 'review', { 'src/a.ts#f': 'hash-v2' });
  assert.equal(r2.verify[0].scopeState, 'changed');
  keeper(cwd, ['disposition', 'P-0001', 'reaffirmed', '--run', r2.run]);
  keeper(cwd, ['commit', '--run', r2.run]);
  const r3 = begin(cwd, 'review', { 'src/a.ts#f': 'hash-v2' });
  assert.equal(r3.verify[0].id, 'P-0001');
  assert.equal(r3.verify[0].scopeState, 'unchanged');
});

test('commit is idempotent, sealed, and removes committed staging', (t) => {
  const cwd = fresh(t);
  keeper(cwd, ['init']);
  const rel = begin(cwd, 'review', { 'src/a.ts#f': 'h1' });
  proposal(cwd, rel.run, 'one.json', {
    type: 'conclusion', scope_ref: 'src/a.ts#f', scope_hash: 'h1',
    claim: 'one issue', direction: 'rename', severity: 'major',
  });
  const first = keeper(cwd, ['commit', '--run', rel.run]).out;
  const before = readFileSync(join(cwd, '.priors/ledger.jsonl'), 'utf8');
  assert.equal(existsSync(join(cwd, '.priors/runs', rel.run)), false);
  const second = keeper(cwd, ['commit', '--run', rel.run]).out;
  const after = readFileSync(join(cwd, '.priors/ledger.jsonl'), 'utf8');
  assert.equal(second, first);
  assert.equal(after, before);
  const late = proposal(cwd, rel.run, 'late.json', {
    type: 'conclusion', scope_ref: 'src/a.ts#f', scope_hash: 'h1',
    claim: 'late issue', direction: 'validate-input', severity: 'major',
  }, 'review', true);
  assert.match(late.out, /RUN_COMMITTED/);
});

test('run ids are path-safe and only one uncommitted run may exist', (t) => {
  const cwd = fresh(t);
  keeper(cwd, ['init']);
  scopes(cwd, {});
  const traversal = keeper(cwd, ['relevant', '--ns', 'review', '--scopes', 'scopes.json', '--run', '../../escape'], true);
  assert.equal(traversal.code, 2);
  assert.match(traversal.err, /run ids must match/);
  const r1 = begin(cwd, 'review', {});
  const second = keeper(cwd, ['relevant', '--ns', 'review', '--scopes', 'scopes.json'], true);
  assert.equal(second.code, 1);
  assert.match(second.out, /ACTIVE_RUN_EXISTS/);
  keeper(cwd, ['abort', '--run', r1.run]);
  const restarted = begin(cwd, 'review', {});
  assert.equal(restarted.run, 'run-001');
});

test('writer lock refuses live contention and recovers an abandoned lock', (t) => {
  const cwd = fresh(t);
  keeper(cwd, ['init']);
  scopes(cwd, {});
  const lock = join(cwd, '.priors/keeper.lock');
  writeFileSync(lock, String(process.pid));
  const live = keeper(cwd, ['relevant', '--ns', 'review', '--scopes', 'scopes.json'], true);
  assert.equal(live.code, 1);
  assert.match(live.out, /KEEPER_LOCKED/);
  rmSync(lock);
  writeFileSync(lock, '99999999');
  const recovered = keeper(cwd, ['relevant', '--ns', 'review', '--scopes', 'scopes.json']);
  assert.match(recovered.out, /run-001/);
  assert.equal(existsSync(lock), false);
});

test('empty committed runs count toward review nudges', (t) => {
  const cwd = fresh(t);
  keeper(cwd, ['init']);
  const r1 = begin(cwd, 'review', {});
  proposal(cwd, r1.run, 'calibration.json', {
    type: 'calibration', claim: 'keep responses terse', direction: 'terser', review_every: 2,
  });
  keeper(cwd, ['commit', '--run', r1.run]);
  keeper(cwd, ['decide', 'P-0001', 'accepted']);
  const r2 = begin(cwd, 'review', {});
  assert.equal(r2.nudges.length, 0);
  keeper(cwd, ['commit', '--run', r2.run]);
  const r3 = begin(cwd, 'review', {});
  assert.equal(r3.nudges.length, 0);
  keeper(cwd, ['commit', '--run', r3.run]);
  const r4 = begin(cwd, 'review', {});
  assert.equal(r4.nudges[0].id, 'P-0001');
  assert.match(keeper(cwd, ['status', '--calls']).out, /P-0001 — still true/);
});

test('raw hashing preserves bytes for tool-version fingerprints', (t) => {
  const cwd = fresh(t);
  const bytes = Buffer.from('tool 1.0\n  build 7\n');
  const file = join(cwd, 'version.txt');
  writeFileSync(file, bytes);
  const expected = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
  assert.equal(keeper(cwd, ['hash', '--raw', file]).out.trim(), expected);
  assert.equal(keeper(cwd, ['hash', '--stdin-raw'], false, bytes).out.trim(), expected);
  assert.notEqual(keeper(cwd, ['hash', file]).out.trim(), expected);
});
