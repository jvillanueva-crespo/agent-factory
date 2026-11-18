#!/usr/bin/env node
// Issue size (S, M or L) without a model: counts AC-n, files and modules from Explore's map.
//   node size.mjs --issue-file issue.md --map-file map.txt
// If the issue says "Size: S|M|L", that wins. Thresholds in ## Factory: SIZE_S=criteria,files and SIZE_M=criteria,files.
import { readFileSync } from 'node:fs';
import { acIds, parseArgs, readConfig, repoRoot } from './lib.mjs';

const a = parseArgs();
if (!a['issue-file']) { console.log('Usage: node size.mjs --issue-file <issue.md> [--map-file <map.txt>]'); process.exit(2); }
const issue = readFileSync(a['issue-file'], 'utf8');
const map = a['map-file'] ? readFileSync(a['map-file'], 'utf8') : '';

let cfg;
try { cfg = readConfig(repoRoot()); } catch { cfg = readConfig('.'); }
const threshold = (v, def) => { const [c, f] = String(v || def).split(',').map(Number); return { ac: c, files: f }; };
const S = threshold(cfg.SIZE_S, '2,3');
const M = threshold(cfg.SIZE_M, '5,8');

const noComments = issue.replace(/<!--[\s\S]*?-->/g, '');
const manual = noComments.match(/Size[^\n:]*:\s*[*_`]*\s*([SML])\b/i) // "Size: M"
  || noComments.match(/^#+\s*Size[^\n]*\n\s*[*_`]*([SML])[*_`]*\s*$/im); // template section
if (manual) { console.log(`SIZE: ${manual[1].toUpperCase()} (set by the issue)`); process.exit(0); }

const ac = acIds(issue).length;
const block = (map.match(/FILES:([\s\S]*?)(?=^[A-Z ]{4,}:|(?![\s\S]))/m) || [])[1] || '';
const files = [...new Set((block.match(/[\w./\\-]+\.[A-Za-z]\w*/g) || []).map((p) => p.replace(/\\/g, '/')))];
const modules = new Set(files.map((p) => p.split('/').slice(0, -1).join('/') || '.')).size;

let size = 'L';
let reason;
if (!ac) reason = 'the issue has no AC-n';
else if (!files.length) reason = 'Explore did not locate any files';
else if (ac <= S.ac && files.length <= S.files && modules <= 1) size = 'S';
else if (ac <= M.ac && files.length <= M.files) size = 'M';
console.log(`SIZE: ${size} (${reason ?? `AC=${ac}, files=${files.length}, modules=${modules}`})`);
