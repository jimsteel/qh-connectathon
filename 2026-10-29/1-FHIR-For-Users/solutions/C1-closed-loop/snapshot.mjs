#!/usr/bin/env node
// One snapshot of B4 and B6 for the C1 test patient (no-login mode, Meld open endpoint).
//   node snapshot.mjs <label>     -> prints the numbers, writes results/<label>.json and screenshots/<label>-*.png
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshot } from './apps-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const label = process.argv[2] || 'now';
const s = await snapshot(label);
fs.mkdirSync(path.join(HERE, 'results'), { recursive: true });
fs.writeFileSync(path.join(HERE, 'results', `${label}.json`), JSON.stringify(s, null, 2) + '\n');
console.log(JSON.stringify(s, null, 2));
