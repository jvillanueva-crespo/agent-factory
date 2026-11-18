#!/usr/bin/env node
// Installs the factory in the current repo. Usage: node install.mjs [--force] [--skip-checks] [--no-blocks]
//   --force        overwrite existing agents, hooks and issue template
//   --skip-checks  do not check gh, git worktree, node or origin
//   --no-blocks    do not add the rules that stop reading generated folders (target/, node_modules/…)
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const force = process.argv.includes('--force');
const assets = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const sh = (c) => { try { return execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); } catch { return null; } };

// 1. Environment
const root = sh('git rev-parse --show-toplevel');
if (!root) { console.error('ERROR: run it inside a git repository.'); process.exit(1); }
if (!process.argv.includes('--skip-checks')) {
  const problems = [];
  if (Number(process.versions.node.split('.')[0]) < 18) problems.push(`node ${process.versions.node}: 18 or later is required → install Node LTS`);
  if (sh('gh auth status') === null) problems.push('gh is not signed in → run: gh auth login');
  if (sh('git worktree list') === null) problems.push('git worktree does not work → update git');
  if (!sh('git remote get-url origin')) problems.push('there is no origin remote → run: git remote add origin <url>');
  if (problems.length) { console.error(`Not installing; fix these first:\n- ${problems.join('\n- ')}`); process.exit(1); }
}

const report = [];
const copy = (from, to) => {
  mkdirSync(dirname(to), { recursive: true });
  if (existsSync(to) && !force) { report.push(`= already existed: ${to}`); return; }
  copyFileSync(from, to);
  report.push(`+ ${to}`);
};

// 2. Agents, hooks and issue template
for (const f of readdirSync(join(assets, 'agents'))) copy(join(assets, 'agents', f), join(root, '.claude', 'agents', f));
for (const f of readdirSync(join(assets, 'hooks'))) copy(join(assets, 'hooks', f), join(root, '.claude', 'hooks', f));
copy(join(assets, 'issue-template.md'), join(root, '.github', 'ISSUE_TEMPLATE', 'factory.md'));

// 3. settings.json: hooks + do not read generated folders (no duplicates, nothing overwritten)
const settingsPath = join(root, '.claude', 'settings.json');
let settings = {};
if (existsSync(settingsPath)) {
  try { settings = JSON.parse(readFileSync(settingsPath, 'utf8')); } catch { console.error(`ERROR: ${settingsPath} is not valid JSON; fix it and retry.`); process.exit(1); }
}
const hooks = [
  { matcher: 'Bash', command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/protect-git.mjs"' },
  { matcher: 'Read', command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/large-read.mjs"' },
];
settings.hooks ??= {};
settings.hooks.PreToolUse ??= [];
const existing = JSON.stringify(settings.hooks.PreToolUse);
for (const h of hooks) {
  if (existing.includes(h.command.replace(/"/g, '\\"'))) continue;
  settings.hooks.PreToolUse.push({ matcher: h.matcher, hooks: [{ type: 'command', command: h.command }] });
  report.push(`+ ${h.matcher} hook in .claude/settings.json`);
}
const generated = ['target', 'build', 'out', 'dist', 'node_modules', '.gradle'].map((d) => `Read(./${d}/**)`).concat('Read(./**/*.lock)');
settings.permissions ??= {};
settings.permissions.deny ??= [];
const newDeny = process.argv.includes('--no-blocks') ? [] : generated.filter((r) => !settings.permissions.deny.includes(r));
settings.permissions.deny.push(...newDeny);
if (newDeny.length) report.push(`+ do not read generated folders: ${newDeny.join(', ')}`);
if (!settings.model) { settings.model = 'sonnet'; report.push('+ default session model: sonnet (orchestrator)'); }
writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);

// 4. "## Factory" section in CLAUDE.md (or AGENTS.md if that is the one that exists)
const md = ['CLAUDE.md', 'AGENTS.md'].map((f) => join(root, f)).find((p) => existsSync(p)) ?? join(root, 'CLAUDE.md');
const current = existsSync(md) ? readFileSync(md, 'utf8') : '';
if (/^## Factory/m.test(current)) report.push(`= ${md} already had the ## Factory section`);
else {
  writeFileSync(md, (current ? `${current.trimEnd()}\n\n` : '') + readFileSync(join(assets, 'CLAUDE-factory.md'), 'utf8'));
  report.push(`+ ## Factory section in ${md} (check the commands)`);
}

// 5. Lessons memory and .gitignore for what only lives on your machine
const lessons = join(root, '.claude', 'factory', 'lessons.md');
if (!existsSync(lessons)) {
  mkdirSync(dirname(lessons), { recursive: true });
  writeFileSync(lessons, '# Factory lessons\n\nThe planner reads them before every plan. They are added on their own when a failure repeats.\n');
  report.push(`+ ${lessons}`);
}
const gi = join(root, '.gitignore');
const giText = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
const ignore = ['.claude/factory/runs/', '.claude/factory/wt/', '.claude/factory/lesson-candidates.json'].filter((l) => !giText.includes(l));
if (ignore.length) {
  writeFileSync(gi, `${giText.trimEnd()}${giText ? '\n' : ''}${ignore.join('\n')}\n`);
  report.push(`+ .gitignore: ${ignore.join(', ')}`);
}

// 6. Command suggestion depending on the project
const has = (f) => existsSync(join(root, f));
let suggestion = 'Unknown project type: fill in BUILD, TEST and TEST_REPORT by hand.';
if (has('pom.xml')) suggestion = 'Maven: BUILD mvn -q -B -DskipTests compile · TEST mvn -q -B test · TEST_REPORT target/surefire-reports/*.xml · MUTATION mvn -q -B org.pitest:pitest-maven:scmMutationCoverage -DanalyseLastCommit=false -DoriginBranch={base} -DoutputFormats=XML · MUTATION_REPORT target/pit-reports/**/mutations.xml';
else if (has('build.gradle') || has('build.gradle.kts')) suggestion = 'Gradle: BUILD ./gradlew -q compileJava · TEST ./gradlew -q test · TEST_REPORT build/test-results/**/*.xml · MUTATION with the info.solidsoft.pitest plugin';
else if (has('package.json')) suggestion = 'Node: TEST npm test (with a JUnit reporter, e.g. jest-junit or node --test --test-reporter=junit) · MUTATION npx stryker run --incremental · MUTATION_REPORT reports/mutation/mutation.json';
else if (has('pyproject.toml') || has('requirements.txt')) suggestion = 'Python: TEST pytest --junitxml=reports/junit.xml · TEST_REPORT reports/junit.xml · MUTATION mutmut run (report only)';

console.log(`Factory installed in ${root}\n${report.join('\n')}\n\nSuggestion for ## Factory → ${suggestion}`);
console.log('\nNext: review the ## Factory section, restart Claude Code and commit .claude/, .github/ and CLAUDE.md.');
