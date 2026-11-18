#!/usr/bin/env node
// Traceability matrix + test report for an issue (0 tokens).
//   node traceability.mjs --issue 12 --plan-file plan.md --traces-file traces.txt
// Reads what checks.mjs left in .claude/factory/runs/<n>/ and writes traceability.md there.
// In reverse: changed code that appears in no AC's TRACES shows up as "Code without a requirement".
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { acOfTest, isTestFile, parseArgs, repoRoot, runDir, write } from './lib.mjs';

const a = parseArgs();
if (!a.issue || !a['plan-file']) { console.log('Usage: node traceability.mjs --issue <n> --plan-file <plan.md> [--traces-file <traces.txt>]'); process.exit(2); }
const d = runDir(repoRoot(), a.issue);
const load = (n) => (existsSync(join(d, n)) ? JSON.parse(readFileSync(join(d, n), 'utf8')) : null);
const red = load('results-red.json');
const green = load('results-green.json');
const mutation = load('results-mutation.json');
const plan = readFileSync(a['plan-file'], 'utf8');
const traces = a['traces-file'] && existsSync(a['traces-file']) ? readFileSync(a['traces-file'], 'utf8') : '';

// Criteria from the plan: first line of each AC-n; "manual" on the line = you test it.
const acs = new Map();
for (const l of plan.split(/\r?\n/)) {
  const m = l.match(/\b(AC-\d+)\b\s*[:.)\]—-]*\s*(.*)/);
  if (m && !acs.has(m[1])) acs.set(m[1], { text: m[2].split(' · ')[0].replace(/\*\*|`/g, '').slice(0, 70), manual: /\bmanual\b/i.test(l), files: [] });
}
// TRACES: "AC-n — files — tests"
for (const l of traces.split(/\r?\n/)) {
  const id = (l.match(/\bAC-\d+\b/) || [])[0];
  if (!id) continue;
  if (!acs.has(id)) acs.set(id, { text: '(not in the plan)', manual: false, files: [] });
  const files = (l.match(/[\w./\\-]+\.[A-Za-z]\w*/g) || []).map((p) => p.replace(/\\/g, '/')).filter((p) => !isTestFile(p));
  acs.get(id).files.push(...files);
}

const same = (x, y) => x === y || x.endsWith(`/${y}`) || y.endsWith(`/${x}`);
const tests = green?.tests ?? [];
const rows = [];
let covered = 0; let failing = 0; let noTest = 0; let manuals = 0;
for (const [id, ac] of acs) {
  const own = tests.filter((t) => acOfTest(t) === id);
  const isManual = ac.manual && !own.length;
  const redOk = red && !isManual ? ((red.tests ?? []).some((t) => acOfTest(t) === id && t.status === 'fail') || (red.ok && !(red.tests ?? []).length)) : null;
  const alive = (mutation?.alive ?? []).filter((v) => ac.files.some((f) => same(v.file, f))).length;
  let status;
  if (isManual) { status = 'manual 👤'; manuals++; } else if (!own.length) { status = 'no test ⚠️'; noTest++; } else if (own.some((t) => t.status === 'fail')) { status = 'fails ❌'; failing++; } else { status = 'covered ✅'; covered++; }
  rows.push(`| ${id} | ${ac.text || '—'} | ${[...new Set(ac.files)].map((f) => `\`${f.split('/').pop()}\``).join(', ') || '—'} | ${own.map((t) => `\`${t.name}\``).join(', ') || '—'} | ${redOk === null ? '—' : redOk ? '✓' : '✗'} | ${mutation && !mutation.skipped ? (alive ? `${alive} alive` : '✓') : '—'} | ${status} |`);
}

const traced = [...acs.values()].flatMap((c) => c.files);
const noRequirement = (green?.diff ?? []).filter((p) => !isTestFile(p) && !p.startsWith('.claude/') && !/\.(md|txt)$/i.test(p) && !traced.some((f) => same(p, f)));

const passing = tests.filter((t) => t.status === 'pass').length;
const failed = tests.filter((t) => t.status === 'fail');
const skipped = tests.filter((t) => t.status === 'skipped').length;
const secs = tests.reduce((s, t) => s + t.seconds, 0).toFixed(1);
const fresh = tests.filter((t) => acOfTest(t));

const md = [
  `## Traceability · issue #${a.issue}`,
  '',
  '| AC | Requirement | Files | Tests | Red | Mutation | Status |',
  '|---|---|---|---|---|---|---|',
  ...rows,
  '',
  `**Summary:** ${covered} covered, ${failing} failing, ${noTest} without a test, ${manuals} manual.`,
  mutation && !mutation.skipped ? `**Mutation:** ${mutation.score} % (threshold ${mutation.threshold} %)${mutation.ok ? '' : ' ⚠️ below the threshold'}.` : '**Mutation:** not configured.',
  '',
  '### Code without a requirement',
  noRequirement.length ? noRequirement.map((p) => `- ⚠️ \`${p}\`: no AC asks for it (an extra?)`).join('\n') : 'None: all the changed code answers to some AC.',
  '',
  '### Test report',
  tests.length ? `${passing} pass · ${failed.length} fail · ${skipped} skipped · ${secs} s · ${fresh.length} new in this issue` : 'No JUnit report.',
  ...failed.slice(0, 10).map((t) => `- ❌ \`${t.classname ? `${t.classname}.` : ''}${t.name}\`: ${t.error}`),
].join('\n');

const out = join(d, 'traceability.md');
write(out, `${md}\n`);
console.log([`MATRIX: ${out}`, `AC: ${covered} covered, ${failing} failing, ${noTest} without a test, ${manuals} manual`, `Code without a requirement: ${noRequirement.length}`].join('\n'));
