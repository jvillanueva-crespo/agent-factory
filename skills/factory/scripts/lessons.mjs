#!/usr/bin/env node
// Two-level lessons. Every failure enters as a candidate; if the same key repeats, it moves on its own to lessons.md.
//   node lessons.mjs --issue 12 --phase checks-green --key empty-dto-field --text "Validate empty required fields in DTOs"
// The key is chosen by the orchestrator (short, no spaces) to recognise the same failure in another issue or round.
// The text is written by the orchestrator from factory results: issue or review text is never copied.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, repoRoot, stripSecrets } from './lib.mjs';

const a = parseArgs();
if (!a.key || !a.text) { console.log('Usage: node lessons.mjs --issue <n> --phase <phase> --key <short-key> --text <lesson>'); process.exit(2); }
const dir = join(repoRoot(), '.claude', 'factory');
const lessonsPath = join(dir, 'lessons.md');
const candidatesPath = join(dir, 'lesson-candidates.json');
const MAX = 30;
const DAYS = 60;

const today = new Date();
let candidates = existsSync(candidatesPath) ? JSON.parse(readFileSync(candidatesPath, 'utf8')) : [];
candidates = candidates.filter((c) => (today - new Date(c.date)) / 86400000 <= DAYS); // they expire after 60 days

const key = String(a.key).toLowerCase().replace(/[^a-z0-9-]+/g, '-');
const text = stripSecrets(String(a.text)).replace(/\s+/g, ' ').trim();
const origin = `#${a.issue ?? '?'}, ${a.phase ?? '?'}, ${today.toISOString().slice(0, 10)}`;
const previous = candidates.find((c) => c.key === key);

let lessons = existsSync(lessonsPath) ? readFileSync(lessonsPath, 'utf8') : '# Factory lessons\n\nThe planner reads them before every plan. They are added on their own when a failure repeats.\n';
if (previous) {
  if (!lessons.includes(`[${key}]`)) {
    lessons = `${lessons.trimEnd()}\n- [${key}] ${text} (${previous.origin}; ${origin})\n`;
    writeFileSync(lessonsPath, lessons);
  }
  candidates = candidates.filter((c) => c.key !== key);
  console.log(`PROMOTED: [${key}] moves to lessons.md (it repeated).`);
} else {
  candidates.push({ key, text, origin, date: today.toISOString() });
  console.log(`CANDIDATE: [${key}] noted; it moves to lessons.md if it repeats within ${DAYS} days.`);
}
writeFileSync(candidatesPath, `${JSON.stringify(candidates, null, 2)}\n`);
const n = lessons.split('\n').filter((l) => l.startsWith('- ')).length;
if (n > MAX) console.log(`WARNING: lessons.md has ${n} lessons (max ${MAX}): consider consolidating them.`);
