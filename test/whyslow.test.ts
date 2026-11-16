import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { analyze, appName, progress, renderServices, score, type Proc, type Snapshot } from '../skills/whyslow/scripts/diagnose.ts';
import { assertSafe, isArtifact, isKept, isOpen, isStaleWorkspace, staleExtensions } from '../skills/whyslow/scripts/disk.ts';
import { type Check, HOME, fmt, parseSize } from '../skills/whyslow/scripts/lib.ts';

const GB = 1024 ** 2;
const DAY = 86_400_000;
const proc = (path: string, kb: number): Proc => ({ pid: 1, kb, cpu: 1, path });

const healthy: Snapshot = {
  ramKb: 16 * GB,
  cpus: 8,
  load1: 1.2,
  uptimeDays: 3,
  swapUsedKb: 0,
  swapTotalKb: 0,
  compressedKb: 0,
  freePct: 60,
  diskFreeKb: 200 * GB,
  diskTotalKb: 500 * GB,
  cpuLimitPct: 100,
  procs: [proc('/Applications/Safari.app/Contents/MacOS/Safari', 2 * GB)],
  jobs: [],
};

test('parseSize reads top and sysctl sizes, fmt prints them back', () => {
  assert.equal(parseSize('1012M+'), 1012 * 1024);
  assert.equal(parseSize('9793K'), 9793);
  assert.equal(parseSize('6474.50M'), 6474.5 * 1024);
  assert.equal(parseSize('n/a'), 0);
  assert.equal(fmt(1.5 * GB), '1.5G');
  assert.equal(fmt(894 * 1024), '894M');
});

test('appName groups helpers under the outermost app bundle', () => {
  assert.equal(
    appName('/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Renderer).app/Contents/MacOS/Code Helper (Renderer)'),
    'Visual Studio Code',
  );
  assert.equal(appName('/opt/homebrew/bin/limactl'), 'limactl');
  assert.equal(appName('/opt/homebrew/opt/redis/bin/redis-server 127.0.0.1:6379'), 'redis-server');
});

test('a healthy Mac has no findings and a perfect score', () => {
  assert.deepEqual(analyze(healthy), []);
  assert.equal(score([]), 100);
});

test('a swapping 8GB Mac flags the real causes, worst first', () => {
  const slow: Snapshot = {
    ...healthy,
    ramKb: 8 * GB,
    swapUsedKb: 6.3 * GB,
    swapTotalKb: 7 * GB,
    freePct: 38,
    uptimeDays: 38,
    diskFreeKb: 29 * GB,
    diskTotalKb: 228 * GB,
    procs: [
      proc('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', GB),
      proc('/Applications/Firefox.app/Contents/MacOS/firefox', 2 * GB),
      proc('/opt/homebrew/bin/limactl', 329 * 1024),
      proc('/System/Library/CursorUIViewService.app/Contents/MacOS/CursorUIViewService', 449 * 1024),
    ],
    jobs: [{ label: 'homebrew.mxcl.postgresql@16', kb: 600 * 1024, running: true }],
  };
  const findings = analyze(slow);
  assert.deepEqual(findings.map((f) => `${f.level}:${f.key}`), [
    'bad:memory', 'warn:vm', 'warn:browsers', 'warn:bloat', 'warn:background', 'warn:uptime', 'warn:disk',
  ]);
  assert.equal(score(findings), 100 - 20 - 6 * 8);
});

test('progress compares the first check with the latest and sums cleans', () => {
  const check = (t: number, s: number, swapGb: number): Check =>
    ({ kind: 'check', t, score: s, swapKb: swapGb * GB, freePct: 30, diskFreeKb: 20 * GB });
  assert.match(progress([]), /0 checks so far/);
  const out = progress([
    check(0, 40, 6),
    { kind: 'clean', t: DAY, freedKb: 12 * GB, ids: ['npm', 'projects'] },
    check(14 * DAY, 84, 1),
  ]);
  assert.match(out, /2 checks over 14d/);
  assert.match(out, /better, score 40 -> 84, swap 6.0G -> 1.0G/);
  assert.match(out, /cleaned: 12.0G freed in 1 run \(npm, projects\)/);
});

test('services lists running jobs by memory, then servers and containers', () => {
  const out = renderServices(
    [
      { label: 'com.example.updater', kb: 0, running: false },
      { label: 'homebrew.mxcl.redis', kb: 20 * 1024, running: true },
      { label: 'com.example.sync', kb: 90 * 1024, running: true },
    ],
    [{ name: 'node', pid: 4123, ports: [3000, 9229], kb: 400 * 1024 }],
    ['api (postgres:16)'],
  );
  const lines = out.split('\n');
  assert.equal(lines[0], 'services: 3 third-party launchd jobs, 2 running 110M');
  assert.match(lines[1] ?? '', /com\.example\.sync$/);
  assert.match(lines[2] ?? '', /homebrew\.mxcl\.redis \| stop: brew services stop redis$/);
  assert.equal(lines[3], 'not running: com.example.updater');
  assert.equal(lines[4], 'listening: node[4123] :3000,:9229 400M');
  assert.equal(lines[5], 'docker: 1 up: api (postgres:16)');
});

test('keep filter matches path words case-insensitively', () => {
  assert.equal(isKept('/Users/a/Documents/Client-API/node_modules', ['client']), true);
  assert.equal(isKept('/Users/a/Documents/side-project/node_modules', ['client', 'work']), false);
});

test('isOpen matches apps, their helpers and longer folder names', () => {
  const open = ['visual studio code', 'code helper (renderer)', 'slack'];
  assert.equal(isOpen('Code', open), true);
  assert.equal(isOpen('Slack', open), true);
  assert.equal(isOpen('Slack Beta', open), true);
  assert.equal(isOpen('Discord', open), false);
});

test('build folders count only next to the file that made them', () => {
  const has = (...files: string[]) => (p: string) => files.some((f) => p.endsWith(f));
  assert.equal(isArtifact('/p/web/node_modules', has()), true);
  assert.equal(isArtifact('/p/crate/target', has('/p/crate/Cargo.toml')), true);
  assert.equal(isArtifact('/p/notes/target', has()), false);
  assert.equal(isArtifact('/p/app/build', has('/p/app/build.gradle.kts')), true);
  assert.equal(isArtifact('/p/site/build', has('/p/site/package.json')), false);
  assert.equal(isArtifact('/p/api/.venv', has('/p/api/.venv/pyvenv.cfg')), true);
  assert.equal(isArtifact('/p/src', has()), false);
});

test('editor leftovers: unlisted extensions and storage of deleted folders', () => {
  const dir = mkdtempSync(join(tmpdir(), 'whyslow-'));
  try {
    const ext = join(dir, 'extensions');
    for (const name of ['acme.lint-1.0.0', 'acme.lint-1.1.0', 'acme.theme-2.0.0']) mkdirSync(join(ext, name), { recursive: true });
    writeFileSync(join(ext, '.obsolete'), '{}');
    writeFileSync(join(ext, 'extensions.json'), JSON.stringify([{ relativeLocation: 'acme.lint-1.1.0' }, { relativeLocation: 'acme.theme-2.0.0' }]));
    assert.deepEqual(staleExtensions(ext), [join(ext, 'acme.lint-1.0.0')]);
    writeFileSync(join(ext, 'extensions.json'), '[]');
    assert.deepEqual(staleExtensions(ext), []);

    const ws = join(dir, 'ws');
    mkdirSync(ws);
    writeFileSync(join(ws, 'workspace.json'), JSON.stringify({ folder: pathToFileURL(join(dir, 'gone')).href }));
    assert.equal(isStaleWorkspace(ws), true);
    writeFileSync(join(ws, 'workspace.json'), JSON.stringify({ folder: pathToFileURL(dir).href }));
    assert.equal(isStaleWorkspace(ws), false);
    writeFileSync(join(ws, 'workspace.json'), JSON.stringify({ folder: 'vscode-remote://ssh-remote+box/home/me' }));
    assert.equal(isStaleWorkspace(ws), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('assertSafe refuses home, top-level folders and paths outside home', () => {
  assert.throws(() => assertSafe(HOME));
  assert.throws(() => assertSafe(`${HOME}/Documents`));
  assert.throws(() => assertSafe(`${HOME}/../other`));
  assert.throws(() => assertSafe('/etc/hosts'));
  assert.equal(assertSafe(`${HOME}/Library/Caches/Yarn`), `${HOME}/Library/Caches/Yarn`);
});
