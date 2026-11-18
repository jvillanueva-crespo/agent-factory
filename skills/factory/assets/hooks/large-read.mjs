#!/usr/bin/env node
// PreToolUse (Read): blocks reading large files in full.
// It forces Grep or Read with offset/limit, which spends far fewer tokens.
import { readFileSync, statSync } from 'node:fs';

const LIMIT = 400;
const BINARY = /\.(png|jpe?g|gif|webp|pdf|ipynb)$/i;

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let input;
  try { input = JSON.parse(raw); } catch { process.exit(0); }
  const file = input?.tool_input?.file_path;
  if (!file || input?.tool_input?.limit || BINARY.test(file)) process.exit(0);

  let lines = 0;
  try {
    if (!statSync(file).isFile()) process.exit(0);
    lines = readFileSync(file, 'utf8').split('\n').length;
  } catch { process.exit(0); }

  if (lines > LIMIT) {
    process.stderr.write(
      `BLOCKED: ${file} has ${lines} lines. Locate with Grep and read only the range you need (Read with offset and limit).\n`
    );
    process.exit(2);
  }
  process.exit(0);
});
