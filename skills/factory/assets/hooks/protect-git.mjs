#!/usr/bin/env node
// PreToolUse (Bash): the factory never merges, never pushes to the base branch and never force-pushes.
// Exiting with code 2 blocks the command and the stderr text reaches Claude.
let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let cmd = '';
  try { cmd = JSON.parse(raw)?.tool_input?.command ?? ''; } catch { process.exit(0); }

  const block = (msg) => { process.stderr.write(`BLOCKED by the factory: ${msg}\n`); process.exit(2); };

  if (/gh\s+pr\s+merge/.test(cmd)) block('a person always does the merge.');

  if (/git\s+push/.test(cmd)) {
    if (/(--force|--force-with-lease|\s-f(\s|$)|\s\+)/.test(cmd)) block('no force-push.');
    if (/(^|[\s:/])(main|master|develop)(\s|$)/.test(cmd))
      block('nothing is pushed to the base branch; use HEAD:refs/heads/factory/issue-<n>.');
  }
  process.exit(0);
});
