// Shared utilities for the factory scripts. No dependencies: Node >= 18 only.
import { execSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const repoRoot = () => execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();

// Reads the "## Factory" section of CLAUDE.md (or AGENTS.md): lines like "- KEY: value".
export function readConfig(dir = repoRoot()) {
  const cfg = {
    BASE_BRANCH: 'main', BUILD: '', TEST: '', LINT: '', TEST_REPORT: '',
    MUTATION: '', MUTATION_REPORT: '', MUTATION_THRESHOLD: '70', PROTECTED: '',
    MAX_PARALLEL: '3', SIZE_S: '2,3', SIZE_M: '5,8',
  };
  for (const f of ['CLAUDE.md', 'AGENTS.md']) {
    const p = join(dir, f);
    if (!existsSync(p)) continue;
    const m = readFileSync(p, 'utf8').match(/^## Factory[ \t]*\r?$([\s\S]*?)(?=^## |(?![\s\S]))/m);
    if (!m) continue;
    for (const l of m[1].split(/\r?\n/)) {
      const kv = l.match(/^\s*-\s*([A-Z_]+):\s*(.*?)\s*$/);
      if (kv) cfg[kv[1]] = kv[2].replace(/^`|`$/g, '');
    }
    break;
  }
  return cfg;
}

// Arguments: "--key value" and "--flag".
export function parseArgs(argv = process.argv.slice(2)) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      a[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    } else a._.push(argv[i]);
  }
  return a;
}

export const runDir = (dir, issue) => {
  const d = join(dir, '.claude', 'factory', 'runs', issue ? String(issue) : '');
  mkdirSync(d, { recursive: true });
  return d;
};

// Runs a shell command and returns {ok, code, output}. Never throws.
export function run(cmd, cwd) {
  if (!cmd) return { ok: true, code: 0, output: '' };
  const r = spawnSync(cmd, { cwd, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, code: r.status, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

export const git = (cmd, cwd) => run(`git ${cmd}`, cwd);

// Minimal glob: ** = any path, * = anything without "/". Paths use "/".
export function globToRegex(glob) {
  let g = glob.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (g.endsWith('/')) g += '**'; // "target/" = everything inside
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') {
      if (g[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}
export const matchesGlob = (path, globs) => globs.some((g) => globToRegex(g).test(path.replace(/\\/g, '/')));

// Lists files matching a glob relative to dir (skips node_modules and .git).
export function findFiles(dir, glob) {
  const re = globToRegex(glob);
  const out = [];
  const visit = (d) => {
    for (const n of readdirSync(d)) {
      if (n === 'node_modules' || n === '.git') continue;
      const p = join(d, n);
      if (statSync(p).isDirectory()) visit(p);
      else if (re.test(relative(dir, p).split(sep).join('/'))) out.push(p);
    }
  };
  if (existsSync(dir)) visit(dir);
  return out;
}

// Minimal JUnit XML parser: [{name, classname, status: pass|fail|skipped, seconds, error}].
export function readJUnit(xml) {
  const cases = [];
  const re = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  let m;
  while ((m = re.exec(xml))) {
    const at = (n) => (m[1].match(new RegExp(`\\b${n}="([^"]*)"`)) || [])[1] ?? '';
    const body = m[3] ?? '';
    let status = 'pass';
    let error = '';
    const f = body.match(/<(failure|error)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/);
    if (f) {
      status = 'fail';
      error = ((f[2].match(/message="([^"]*)"/) || [])[1] || f[3] || '').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    } else if (/<skipped\b/.test(body)) status = 'skipped';
    cases.push({ name: at('name'), classname: at('classname'), status, seconds: Number(at('time')) || 0, error: error.trim().split('\n').slice(0, 2).join(' ').slice(0, 160) });
  }
  return cases;
}

const SECRETS = [/gh[opsu]_[A-Za-z0-9]{20,}/g, /github_pat_[A-Za-z0-9_]{20,}/g, /sk-[A-Za-z0-9_-]{20,}/g, /Bearer\s+[A-Za-z0-9._-]{20,}/g, /AKIA[0-9A-Z]{16}/g];
export const stripSecrets = (t) => SECRETS.reduce((s, re) => s.replace(re, '[secret]'), String(t));

export const write = (p, t) => writeFileSync(p, stripSecrets(t));
export const append = (p, t) => appendFileSync(p, stripSecrets(t));

// The AC-n ids that appear in a text, unique and in order.
export const acIds = (t) => [...new Set(String(t).match(/\bAC-\d+\b/g) || [])];

// AC id a test belongs to, from its name: loginOk_AC1, test_AC_2_x, AC3Test…
export const acOfTest = (t) => {
  const m = `${t.classname ?? ''} ${t.name ?? t}`.match(/AC[-_]?(\d+)/i);
  return m ? `AC-${m[1]}` : null;
};

// Is this a test file? (Java, JS/TS, Python, Go conventions)
export const isTestFile = (path) => /(^|\/)(src\/test|test|tests|__tests__|spec)\//i.test(path)
  || /(Test|Tests|IT)\.\w+$|\.(test|spec)\.\w+$|(^|\/)test_[^/]+\.py$|_test\.\w+$/.test(path);

// Last n non-empty lines of a long output.
export const tail = (t, n = 6) => String(t).split(/\r?\n/).filter((l) => l.trim()).slice(-n).map((l) => l.slice(0, 200));
