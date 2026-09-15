import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = process.cwd();
const work = path.join(root, 'reports/production-hardening-2026-09/phase-0');
fs.mkdirSync(work, { recursive: true });
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trimEnd();
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const inventory = git('status', '--porcelain=v1', '-uall').split('\n').filter(Boolean).map(line => {
  const name = line.slice(3);
  return { status: line.slice(0, 2), path: name, sha256: fs.existsSync(name) ? sha(fs.readFileSync(name)) : null };
});
const baseline = {
  startedAt: new Date().toISOString(), head: git('rev-parse', 'HEAD'), branch: git('branch', '--show-current'),
  status: git('status', '--porcelain=v1', '-uall'), inventory,
  runtime: { node: process.version, npm: execFileSync('cmd.exe', ['/d', '/c', 'npm --version'], { encoding: 'utf8', windowsHide: true }).trim(),
    electron: require('electron/package.json').version, chromium: null, typescript: require('typescript/package.json').version,
    platform: process.platform, arch: process.arch, release: os.release(), cpu: os.cpus()[0]?.model, memory: os.totalmem() },
  commands: [],
};
fs.writeFileSync(path.join(work, 'initial-state.json'), JSON.stringify(baseline, null, 2));
fs.writeFileSync(path.join(work, 'user-work.patch'), execFileSync('git', ['diff', '--binary', 'HEAD'], { cwd: root }));
const backups = path.join(work, 'user-work');
for (const file of inventory.filter(f => f.sha256)) {
  const target = path.join(backups, file.path);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(file.path, target);
}
const repairBranch = 'repair/production-hardening-2026-09';
if (!baseline.branch.startsWith('repair/production-hardening')) {
  if (git('branch', '--list', repairBranch)) throw new Error('Repair branch already exists; inspect its ancestry before switching');
  git('switch', '-c', repairBranch);
}
baseline.repairBranch = git('branch', '--show-current');
async function run(name, module, args, executable = process.execPath) {
  const log = path.join(work, name + '.log');
  const fd = fs.openSync(log, 'w');
  const start = Date.now();
  const command = { name, executable, args: executable === process.execPath ? [path.join(root, module), ...args] : args, startedAt: new Date().toISOString(), log };
  baseline.commands.push(command);
  const child = spawn(executable, command.args, { cwd: root, env: { ...process.env, NO_COLOR: '1' }, windowsHide: true, stdio: ['ignore', fd, fd] });
  const result = await new Promise(resolve => { child.on('error', error => resolve({ error: error.message, exitCode: null })); child.on('exit', (exitCode, signal) => resolve({ exitCode, signal })); });
  fs.closeSync(fd);
  Object.assign(command, result, { elapsedMs: Date.now() - start });
  fs.writeFileSync(path.join(work, name + '.result.json'), JSON.stringify(command, null, 2));
  console.log(JSON.stringify(command));
}
await Promise.allSettled([
  run('types', 'node_modules/typescript/bin/tsc', ['-b', '--pretty', 'false']),
  run('test-types', 'node_modules/typescript/bin/tsc', ['-p', 'tsconfig.test.json', '--noEmit', '--pretty', 'false']),
  run('lint', 'node_modules/eslint/bin/eslint.js', ['.']),
  run('unit-integration', 'node_modules/vitest/vitest.mjs', ['run', '--reporter=default', '--reporter=json', '--outputFile=' + path.join(work, 'vitest.json')]),
]);
// The official build is recorded separately, with its mandatory TypeScript gate intact.
await run('official-build', null, ['/d', '/c', 'npm run build'], 'cmd.exe');
await run('electron-e2e', 'node_modules/@playwright/test/cli.js', ['test', '--reporter=list,json']);
baseline.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(work, 'baseline.json'), JSON.stringify(baseline, null, 2));
