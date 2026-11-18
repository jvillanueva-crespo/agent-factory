#!/usr/bin/env node
// Appends a line to the factory log: .claude/factory/runs/<date>.jsonl (secrets stripped).
//   node record.mjs --issue 12 --phase plan --model opus --seconds 84 --tokens 31000 --result ok --note "2 questions"
import { join } from 'node:path';
import { append, parseArgs, repoRoot, runDir } from './lib.mjs';

const a = parseArgs();
if (!a.phase) { console.log('Usage: node record.mjs --issue <n> --phase <phase> [--model m] [--seconds s] [--tokens t] [--result r] [--note text]'); process.exit(2); }
const num = (v) => (v === undefined ? null : Number(v));
const line = {
  date: new Date().toISOString(), issue: a.issue ? Number(a.issue) : null, phase: a.phase, model: a.model ?? null,
  seconds: num(a.seconds), tokens: num(a.tokens), result: a.result ?? null, note: a.note ?? null,
};
const file = join(runDir(repoRoot()), `${line.date.slice(0, 10)}.jsonl`);
append(file, `${JSON.stringify(line)}\n`);
console.log(`Recorded in ${file}`);
