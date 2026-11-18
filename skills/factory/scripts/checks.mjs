#!/usr/bin/env node
// Deterministic gate of the factory (0 tokens). Run it from the repo root.
//   node checks.mjs --mode red      --issue 12
//   node checks.mjs --mode green    --issue 12 --red-sha <sha> [--ac AC-1,AC-2] [--step 1]
//   node checks.mjs --mode mutation --issue 12
// It works in its own worktree (.claude/factory/wt/issue-<n>) on origin/factory/issue-<n>.
// It prints at most 15 lines; the full output goes to .claude/factory/runs/<n>/.
// Exit code: 0 = OK, 1 = FAIL, 2 = usage or environment error.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  acOfTest, findFiles, git, matchesGlob, parseArgs, readConfig, readJUnit, repoRoot, run, runDir, tail, write,
} from './lib.mjs';

const a = parseArgs();
const mode = a.mode;
const issue = a.issue;
if (!['red', 'green', 'mutation'].includes(mode) || !issue) {
  console.log('Usage: node checks.mjs --mode red|green|mutation --issue <n> [--red-sha <sha>] [--ac AC-1,AC-2] [--step <n>]');
  process.exit(2);
}

const dir = repoRoot();
const cfg = readConfig(dir);
const branch = a.branch || `factory/issue-${issue}`;
const base = `origin/${cfg.BASE_BRANCH}`;
const outDir = runDir(dir, issue);
const suffix = mode === 'green' && a.step ? `-${a.step}` : '';
const logPath = join(outDir, `checks-${mode}${suffix}.log`);
let log = '';
const failures = [];
const notes = [];

const finish = (ok, extra = []) => {
  write(logPath, log);
  const lines = [`VERDICT: ${ok ? 'OK' : 'FAIL'} (checks ${mode}${suffix}, issue #${issue})`, ...failures, ...notes, ...extra];
  console.log([...lines.slice(0, 14), `LOG: ${logPath}`].join('\n'));
  process.exit(ok ? 0 : 1);
};

// 1. Own worktree with the issue branch, clean and up to date.
const wt = join(dir, '.claude', 'factory', 'wt', `issue-${issue}`);
const f = git(`fetch origin ${cfg.BASE_BRANCH} ${branch}`, dir);
log += `$ git fetch\n${f.output}\n`;
if (!f.ok) { failures.push(`Could not fetch ${branch} from origin.`); finish(false); }
if (!existsSync(wt)) {
  mkdirSync(join(dir, '.claude', 'factory', 'wt'), { recursive: true });
  const w = git(`worktree add --detach "${wt}" origin/${branch}`, dir);
  log += `$ git worktree add\n${w.output}\n`;
  if (!w.ok) { failures.push('Could not create the checks worktree.'); finish(false); }
} else {
  const r = git(`checkout --detach --force origin/${branch}`, wt);
  git('clean -fd', wt);
  log += `$ git checkout origin/${branch}\n${r.output}\n`;
  if (!r.ok) { failures.push('Could not update the checks worktree.'); finish(false); }
}

const step = (name, cmd) => {
  if (!cmd) return { ok: true, output: '' };
  const r = run(cmd, wt);
  log += `\n===== ${name}: ${cmd} (code ${r.code})\n${r.output}\n`;
  return r;
};

// JUnit results from the worktree (and a copy in runs/<n>/junit/).
const readTests = () => {
  if (!cfg.TEST_REPORT) return null;
  const xmls = cfg.TEST_REPORT.split(',').flatMap((g) => findFiles(wt, g.trim()));
  if (!xmls.length) return null;
  const dj = join(outDir, 'junit');
  mkdirSync(dj, { recursive: true });
  const cases = [];
  for (const x of xmls) {
    copyFileSync(x, join(dj, basename(x)));
    cases.push(...readJUnit(readFileSync(x, 'utf8')));
  }
  return cases;
};
const fmt = (t) => `${t.classname ? `${t.classname}.` : ''}${t.name}${t.error ? ` — ${t.error}` : ''}`;
const save = (name, data) => writeFileSync(join(outDir, name), JSON.stringify({ issue, mode, date: new Date().toISOString(), ...data }, null, 2));

// ---------- RED: the new tests must fail and the old ones keep passing ----------
if (mode === 'red') {
  const t = step('TEST', cfg.TEST);
  const cases = readTests();
  const sha = git('rev-parse HEAD', wt).output.trim();
  if (!cases) {
    if (t.ok) failures.push('The tests pass without code: they prove nothing. Redo the tests for the criteria.');
    else notes.push('Tests do not compile or fail without a JUnit report: valid if the new classes are missing.');
    save('results-red.json', { ok: !t.ok, sha, tests: [] });
    finish(!t.ok, t.ok ? [] : tail(t.output, 3));
  }
  const fresh = cases.filter((c) => acOfTest(c));
  const passWithoutCode = fresh.filter((c) => c.status === 'pass');
  const brokenOld = cases.filter((c) => !acOfTest(c) && c.status === 'fail');
  if (!fresh.length) failures.push('No tests with an AC in the name (for example loginOk_AC1).');
  passWithoutCode.slice(0, 5).forEach((c) => failures.push(`Passes without code: ${fmt(c)}`));
  brokenOld.slice(0, 5).forEach((c) => failures.push(`Existing test broken: ${fmt(c)}`));
  const ok = fresh.length > 0 && !passWithoutCode.length && !brokenOld.length;
  save('results-red.json', { ok, sha, tests: cases });
  finish(ok, ok ? [`Red verified: ${fresh.length} new tests fail, ${cases.length - fresh.length} existing pass. RED_SHA: ${sha}`] : []);
}

// ---------- GREEN: build, lint, tests (this subtask's), frozen tests, protected paths ----------
if (mode === 'green') {
  const b = step('BUILD', cfg.BUILD);
  if (!b.ok) { failures.push('BUILD fails:', ...tail(b.output, 4)); finish(false); }
  const l = step('LINT', cfg.LINT);
  if (!l.ok) failures.push('LINT fails:', ...tail(l.output, 3));

  const diff = git(`diff --name-only ${base}...HEAD`, wt).output.split(/\r?\n/).filter(Boolean);
  writeFileSync(join(outDir, 'diff.patch'), git(`diff ${base}...HEAD`, wt).output);
  const protectedGlobs = cfg.PROTECTED.split(',').map((s) => s.trim()).filter(Boolean);
  diff.filter((p) => matchesGlob(p, protectedGlobs)).slice(0, 3).forEach((p) => failures.push(`Protected path modified: ${p}`));

  if (a['red-sha']) {
    const frozen = git(`show --name-only --pretty=format: ${a['red-sha']}`, wt).output.split(/\r?\n/).filter(Boolean);
    const touched = git(`diff --name-only ${a['red-sha']} HEAD`, wt).output.split(/\r?\n/).filter(Boolean);
    touched.filter((p) => frozen.includes(p)).slice(0, 3).forEach((p) => failures.push(`Frozen test modified since red: ${p}`));
  } else notes.push('No --red-sha: frozen tests are not checked.');

  const t = step('TEST', cfg.TEST);
  const cases = readTests();
  const required = a.ac ? String(a.ac).split(',').map((s) => s.trim()) : null;
  if (cases) {
    const broken = cases.filter((c) => c.status === 'fail' && (!required || !acOfTest(c) || required.includes(acOfTest(c))));
    broken.slice(0, 6).forEach((c) => failures.push(`Fails: ${fmt(c)}`));
    if (broken.length > 6) failures.push(`… and ${broken.length - 6} more (see log).`);
    const pending = required ? cases.filter((c) => c.status === 'fail' && acOfTest(c) && !required.includes(acOfTest(c))).length : 0;
    if (pending) notes.push(`${pending} tests of pending subtasks are still red (expected).`);
    notes.push(`Tests: ${cases.filter((c) => c.status === 'pass').length} pass, ${cases.filter((c) => c.status === 'fail').length} fail, ${cases.filter((c) => c.status === 'skipped').length} skipped.`);
  } else {
    if (!t.ok) failures.push('TEST fails:', ...tail(t.output, 4));
    if (required) notes.push('No JUnit report (TEST_REPORT): cannot split by AC; every test must pass.');
  }
  const ok = !failures.length;
  save(`results-green${suffix}.json`, { ok, ac: required, tests: cases ?? [], diff });
  if (!required) save('results-green.json', { ok, tests: cases ?? [], diff });
  finish(ok);
}

// ---------- MUTATION: diff only; score and surviving mutants ----------
if (mode === 'mutation') {
  if (!cfg.MUTATION) {
    save('results-mutation.json', { ok: true, skipped: true });
    console.log('VERDICT: OK (mutation skipped: no MUTATION in ## Factory)');
    process.exit(0);
  }
  const m = step('MUTATION', cfg.MUTATION.replaceAll('{base}', base));
  const reports = (cfg.MUTATION_REPORT || '').split(',').flatMap((g) => (g.trim() ? findFiles(wt, g.trim()) : []));
  if (!reports.length) { failures.push('Mutation report not found (MUTATION_REPORT).', ...tail(m.output, 3)); finish(false); }

  const mutants = [];
  const dm = join(outDir, 'mutation');
  mkdirSync(dm, { recursive: true });
  for (const rep of reports) {
    copyFileSync(rep, join(dm, basename(rep)));
    const txt = readFileSync(rep, 'utf8');
    if (rep.endsWith('.xml')) { // PIT
      for (const x of txt.matchAll(/<mutation\b([^>]*)>([\s\S]*?)<\/mutation>/g)) {
        const tag = (n) => (x[2].match(new RegExp(`<${n}>([^<]*)</${n}>`)) || [])[1] ?? '';
        const status = (x[1].match(/status='([^']*)'|status="([^"]*)"/) || []).slice(1).find(Boolean) || '';
        const pkg = tag('mutatedClass').split('.').slice(0, -1).join('/');
        mutants.push({ status, file: `${pkg ? `${pkg}/` : ''}${tag('sourceFile')}`, line: tag('lineNumber'), change: tag('description') || tag('mutator') });
      }
    } else { // Stryker (mutation-testing-report-schema)
      const j = JSON.parse(txt);
      for (const [file, info] of Object.entries(j.files ?? {})) {
        for (const mu of info.mutants ?? []) mutants.push({ status: mu.status, file, line: mu.location?.start?.line ?? '', change: mu.replacement ?? mu.mutatorName });
      }
    }
  }
  const detected = (s) => /^(KILLED|TIMED_OUT|Killed|Timeout)$/.test(s);
  const valid = (s) => !/^(RUN_ERROR|NON_VIABLE|MEMORY_ERROR|CompileError|RuntimeError|Ignored|Pending)$/.test(s);
  const validOnes = mutants.filter((x) => valid(x.status));
  const alive = validOnes.filter((x) => !detected(x.status));
  const score = validOnes.length ? Math.round((100 * (validOnes.length - alive.length)) / validOnes.length) : 100;
  const threshold = Number(cfg.MUTATION_THRESHOLD) || 70;
  writeFileSync(join(dm, 'alive.txt'), alive.map((v) => `${v.file}:${v.line} — ${v.change} (${v.status})`).join('\n'));
  const ok = score >= threshold;
  save('results-mutation.json', { ok, score, threshold, total: validOnes.length, alive });
  notes.push(`Mutation: ${score} % (${validOnes.length - alive.length}/${validOnes.length} detected, threshold ${threshold} %).`);
  if (!ok) alive.slice(0, 8).forEach((v) => failures.push(`Alive: ${v.file}:${v.line} — ${v.change}`));
  finish(ok);
}
