const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (file.endsWith('.js')) execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  }
}
walk('api'); walk('scripts'); walk('tests');
for (const file of fs.readdirSync('.').filter(file => file.endsWith('.html'))) {
  for (const match of fs.readFileSync(file, 'utf8').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/application\/ld\+json|src=/.test(match[1])) new vm.Script(match[2], { filename: file });
  }
}
console.log('Backend and frontend syntax checks passed.');
