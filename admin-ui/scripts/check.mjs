import {readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
async function visit(folder) {
  for (const entry of await readdir(folder, {withFileTypes:true})) {
    if (entry.name === 'test-results' || entry.name === 'node_modules') continue;
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) await visit(file);
    else if (/\.(cjs|mjs|js)$/.test(file)) {
      const result = spawnSync(process.execPath, ['--check',file], {encoding:'utf8'});
      if (result.status !== 0) { process.stderr.write(result.stderr); process.exitCode = 1; }
    }
  }
}
await visit(root);
if (!process.exitCode) console.log('JavaScript syntax checks passed.');
