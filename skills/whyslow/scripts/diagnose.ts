import { join } from 'node:path';
import { type Check, type Cleaned, type Entry, HOME, diskSpace, fmt, history, ls, parseSize, remember, sh } from './lib.ts';

export interface Proc { pid: number; kb: number; cpu: number; path: string }
export interface App { name: string; kb: number; cpu: number; count: number }
export interface Finding { level: 'warn' | 'bad'; key: string; text: string; fix?: string }
export interface Job { label: string; kb: number; running: boolean }
export interface Listener { name: string; pid: number; ports: number[]; kb: number }

export interface Snapshot {
  ramKb: number;
  cpus: number;
  load1: number;
  uptimeDays: number;
  swapUsedKb: number;
  swapTotalKb: number;
  compressedKb: number;
  freePct: number;
  diskFreeKb: number;
  diskTotalKb: number;
  cpuLimitPct: number;
  procs: Proc[];
  jobs: Job[];
}

const BROWSERS = new Set([
  'Safari', 'Google Chrome', 'Arc', 'Dia', 'Brave Browser', 'Microsoft Edge',
  'Firefox', 'Opera', 'Vivaldi', 'Zen', 'Comet', 'Chromium',
]);

const VMS = [
  { match: /^limactl$/, name: 'Colima/Lima VM', fix: 'colima stop' },
  { match: /^com\.apple\.Virtualization\.VirtualMachine$/, name: 'Apple Virtualization VM', fix: 'stop it in the app that started it' },
  { match: /^qemu-system/, name: 'QEMU VM', fix: 'stop it in UTM or colima stop' },
  { match: /^VMware Fusion$/, name: 'VMware Fusion', fix: 'suspend the VM and quit VMware' },
  { match: /^Parallels Desktop$/, name: 'Parallels', fix: 'suspend the VM and quit Parallels' },
  { match: /^Docker$/, name: 'Docker Desktop', fix: 'quit Docker Desktop' },
  { match: /^OrbStack$/, name: 'OrbStack', fix: 'orb stop' },
];

const LAUNCH_DIRS = [join(HOME, 'Library/LaunchAgents'), '/Library/LaunchAgents', '/Library/LaunchDaemons'];

const BLOATED = [
  { name: 'CursorUIViewService', overKb: 200 * 1024, fix: 'killall CursorUIViewService' },
  { name: 'WindowServer', overKb: 1024 ** 2, fix: 'restart the Mac' },
  { name: 'mds_stores', overKb: 1024 ** 2, fix: 'Spotlight is indexing; exclude dev folders in Spotlight settings' },
];

export function collect(): Snapshot {
  const [mem = '0', cpus = '1', load = '', boot = ''] = sh('sysctl', ['-n', 'hw.memsize', 'hw.ncpu', 'vm.loadavg', 'kern.boottime']).split('\n');
  const swap = sh('sysctl', ['-n', 'vm.swapusage']);
  const vm = sh('vm_stat');
  const pageKb = Number(/page size of (\d+)/.exec(vm)?.[1] ?? 16_384) / 1024;
  const bootSec = Number(/sec = (\d+)/.exec(boot)?.[1] ?? Date.now() / 1000);
  const disk = diskSpace();
  const procs = processes();
  return {
    ramKb: Number(mem) / 1024,
    cpus: Number(cpus) || 1,
    load1: Number(/[\d.]+/.exec(load)?.[0] ?? 0),
    uptimeDays: (Date.now() / 1000 - bootSec) / 86_400,
    swapUsedKb: parseSize(/used = (\S+)/.exec(swap)?.[1] ?? ''),
    swapTotalKb: parseSize(/total = (\S+)/.exec(swap)?.[1] ?? ''),
    compressedKb: Number(/occupied by compressor:\s+(\d+)/.exec(vm)?.[1] ?? 0) * pageKb,
    freePct: Number(/free percentage: (\d+)/.exec(sh('memory_pressure'))?.[1] ?? 100),
    diskFreeKb: disk.freeKb,
    diskTotalKb: disk.totalKb,
    cpuLimitPct: Number(/CPU_Speed_Limit\s*=\s*(\d+)/.exec(sh('pmset', ['-g', 'therm']))?.[1] ?? 100),
    procs,
    jobs: launchJobs(procs),
  };
}

/** Joins top's memory footprint (counts compressed pages) with ps paths and CPU. */
export function processes(): Proc[] {
  const mem = new Map<number, number>();
  for (const line of sh('top', ['-l', '1', '-stats', 'pid,mem']).split('\n')) {
    const m = /^(\d+)\s+(\S+)/.exec(line);
    if (m) mem.set(Number(m[1]), parseSize(m[2] ?? ''));
  }
  return sh('ps', ['-Axo', 'pid=,pcpu=,comm=']).split('\n').flatMap((line) => {
    const m = /^\s*(\d+)\s+([\d.]+)\s+(.+)$/.exec(line);
    if (!m) return [];
    const pid = Number(m[1]);
    return [{ pid, kb: mem.get(pid) ?? 0, cpu: Number(m[2]), path: m[3] ?? '' }];
  });
}

/** Owning app of an executable: the outermost .app bundle, else the file name without a rewritten title (redis). */
export function appName(path: string): string {
  return /\/([^/]+)\.app\//.exec(path)?.[1] ?? path.split('/').at(-1)?.split(' ')[0] ?? path;
}

/** Program path a launchd plist starts; empty for shells and interpreters, which can't be told apart. */
function programOf(plist: string): string {
  try {
    const j = JSON.parse(sh('plutil', ['-convert', 'json', '-o', '-', plist])) as { Program?: string; ProgramArguments?: string[] };
    const program = j.Program ?? j.ProgramArguments?.[0] ?? '';
    return program.startsWith('/') && !/^\/(usr\/)?bin\//.test(program) ? program : '';
  } catch {
    return '';
  }
}

/** Running third-party launchd jobs of this login session, by label, with their pid. */
// ponytail: Apple's own jobs are told apart by label prefix; com.openssh is the only non-com.apple one seen so far.
function launchctlRunning(): Map<string, number> {
  const live = new Map<string, number>();
  for (const line of sh('launchctl', ['list']).split('\n')) {
    const [pid = '', , label] = line.split('\t');
    if (label && /^\d+$/.test(pid) && !/^(com\.apple\.|application\.|com\.openssh\.)/.test(label)) live.set(label, Number(pid));
  }
  return live;
}

/** Third-party launchd jobs (the macOS systemctl): plists in the LaunchAgents and LaunchDaemons folders, plus jobs apps register from inside their bundle. */
export function launchJobs(procs: Proc[]): Job[] {
  const live = launchctlRunning();
  const kbOf = (pid: number) => procs.find((p) => p.pid === pid)?.kb ?? 0;
  const files = LAUNCH_DIRS.flatMap((dir) =>
    ls(dir).filter((f) => f.endsWith('.plist')).map((f): Job => {
      const label = f.slice(0, -'.plist'.length);
      const program = programOf(join(dir, f));
      const mine = program ? procs.filter((p) => p.path === program || p.path.startsWith(`${program} `)) : [];
      const pid = live.get(label);
      live.delete(label);
      const kb = mine.length ? mine.reduce((sum, p) => sum + p.kb, 0) : pid ? kbOf(pid) : 0;
      return { label, kb, running: mine.length > 0 || pid !== undefined };
    }),
  );
  return [...files, ...[...live].map(([label, pid]) => ({ label, kb: kbOf(pid), running: true }))];
}

/** User processes listening on TCP ports below the ephemeral range: dev servers, databases, local tools. */
export function listeners(procs: Proc[]): Listener[] {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const found = new Map<number, Listener>();
  let pid = 0;
  for (const line of sh('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn'], 10_000).split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    const port = line.startsWith('n') ? Number(/:(\d+)$/.exec(line)?.[1] ?? 0) : 0;
    const p = byPid.get(pid);
    if (!port || port >= 49_152 || !p || /^\/(System|usr\/(?!local\/))/.test(p.path)) continue;
    const l = found.get(pid) ?? { name: appName(p.path), pid, ports: [], kb: p.kb };
    if (!l.ports.includes(port)) l.ports.push(port);
    found.set(pid, l);
  }
  return [...found.values()].sort((a, b) => b.kb - a.kb);
}

/** Running Docker containers; empty when Docker is missing or stopped. */
const containers = () => sh('docker', ['ps', '--format', '{{.Names}} ({{.Image}})'], 5_000).split('\n').filter(Boolean);

export function groupApps(procs: Proc[]): App[] {
  const apps = new Map<string, App>();
  for (const p of procs) {
    const name = appName(p.path);
    const app = apps.get(name) ?? { name, kb: 0, cpu: 0, count: 0 };
    app.kb += p.kb;
    app.cpu += p.cpu;
    app.count++;
    apps.set(name, app);
  }
  return [...apps.values()].sort((a, b) => b.kb - a.kb);
}

const list = (apps: App[]) =>
  apps.map((a) => `${a.name} ${fmt(a.kb)}${a.count > 1 ? ` x${a.count}` : ''}`).join(', ');

export function analyze(s: Snapshot, apps = groupApps(s.procs)): Finding[] {
  const out: Finding[] = [];

  const memLevel = s.swapUsedKb > s.ramKb / 2 || s.freePct < 20 ? 'bad' : s.swapUsedKb > 1024 ** 2 ? 'warn' : undefined;
  if (memLevel) {
    out.push({
      level: memLevel,
      key: 'memory',
      text: `swap ${fmt(s.swapUsedKb)}/${fmt(s.swapTotalKb)}, compressed ${fmt(s.compressedKb)}, ${s.freePct}% free of ${fmt(s.ramKb)} RAM`,
      fix: 'quit the heavy apps listed under top',
    });
  }

  if (s.load1 > s.cpus) {
    const busy = [...apps].sort((a, b) => b.cpu - a.cpu).slice(0, 3);
    out.push({ level: 'bad', key: 'cpu', text: `load ${s.load1.toFixed(1)} on ${s.cpus} cores; busiest ${busy.map((a) => `${a.name} ${Math.round(a.cpu)}%`).join(', ')}` });
  }

  for (const vm of VMS) {
    const app = apps.find((a) => vm.match.test(a.name));
    if (app) out.push({ level: 'warn', key: 'vm', text: `${vm.name} running (${fmt(app.kb)})`, fix: vm.fix });
  }

  const browsers = apps.filter((a) => BROWSERS.has(a.name));
  if (browsers.length > 1) {
    out.push({ level: 'warn', key: 'browsers', text: `${browsers.length} open: ${list(browsers)}`, fix: 'keep one browser open' });
  }

  for (const b of BLOATED) {
    const app = apps.find((a) => a.name === b.name);
    if (app && app.kb > b.overKb) out.push({ level: 'warn', key: 'bloat', text: `${b.name} ${fmt(app.kb)}`, fix: b.fix });
  }

  const background = s.jobs.filter((j) => j.running);
  const backgroundKb = background.reduce((sum, j) => sum + j.kb, 0);
  if (backgroundKb > 512 * 1024) {
    out.push({ level: 'warn', key: 'background', text: `${background.length} launchd jobs running ${fmt(backgroundKb)}`, fix: 'whyslow services' });
  }

  if (s.uptimeDays >= 14) {
    out.push({ level: 'warn', key: 'uptime', text: `${Math.floor(s.uptimeDays)} days since restart`, fix: 'restart to clear leaks and swap' });
  }

  const diskPct = s.diskTotalKb ? (s.diskFreeKb / s.diskTotalKb) * 100 : 100;
  const diskLevel = diskPct < 10 ? 'bad' : diskPct < 20 ? 'warn' : undefined;
  if (diskLevel) {
    out.push({ level: diskLevel, key: 'disk', text: `${fmt(s.diskFreeKb)} free of ${fmt(s.diskTotalKb)} (${Math.round(diskPct)}%)`, fix: 'whyslow disk' });
  }

  if (s.cpuLimitPct < 100) {
    out.push({ level: 'bad', key: 'thermal', text: `CPU throttled to ${s.cpuLimitPct}%`, fix: 'cool the Mac and check the busiest app' });
  }

  return out.sort((a, b) => Number(b.level === 'bad') - Number(a.level === 'bad'));
}

/** 100 when nothing is wrong; each main cause costs 20, each smaller one 8. */
export function score(findings: Finding[]): number {
  return Math.max(0, 100 - findings.reduce((sum, f) => sum + (f.level === 'bad' ? 20 : 8), 0));
}

export function render(s: Snapshot, apps: App[], findings: Finding[]): string {
  const lines = [
    `whyslow: ${fmt(s.ramKb)} RAM, ${s.cpus} cores, load ${s.load1.toFixed(1)}, up ${Math.floor(s.uptimeDays)}d, score ${score(findings)}/100`,
    `top: ${list(apps.slice(0, 6))}`,
    ...findings.map((f) => `${f.level === 'bad' ? '!!' : '! '} ${f.key}: ${f.text}${f.fix ? ` | fix: ${f.fix}` : ''}`),
  ];
  if (!findings.length) lines.push('ok: nothing looks wrong');
  return lines.join('\n');
}

const ago = (ms: number) =>
  ms < 3_600_000 ? `${Math.max(1, Math.round(ms / 60_000))}m` : ms < 86_400_000 ? `${Math.round(ms / 3_600_000)}h` : `${Math.round(ms / 86_400_000)}d`;

export function compare(a: Check, b: Check): string {
  const verdict = b.score > a.score ? 'better' : b.score < a.score ? 'worse' : 'same';
  return `${verdict}, score ${a.score} -> ${b.score}, swap ${fmt(a.swapKb)} -> ${fmt(b.swapKb)}, ` +
    `free memory ${a.freePct}% -> ${b.freePct}%, disk free ${fmt(a.diskFreeKb)} -> ${fmt(b.diskFreeKb)}`;
}

export function diagnose(): string {
  const s = collect();
  const apps = groupApps(s.procs);
  const findings = analyze(s, apps);
  const now: Check = { kind: 'check', t: Date.now(), score: score(findings), swapKb: s.swapUsedKb, freePct: s.freePct, diskFreeKb: s.diskFreeKb };
  const last = history().filter((e): e is Check => e.kind === 'check').at(-1);
  remember(now);
  const out = render(s, apps, findings);
  return last ? `${out}\nvs last check ${ago(now.t - last.t)} ago: ${compare(last, now)}` : out;
}

/** First check against the latest one, plus everything clean has freed. */
export function progress(entries: Entry[] = history()): string {
  const checks = entries.filter((e): e is Check => e.kind === 'check');
  const cleans = entries.filter((e): e is Cleaned => e.kind === 'clean');
  const [first, last] = [checks[0], checks.at(-1)];
  const lines = first && last && first !== last
    ? [
      `progress: ${checks.length} checks over ${ago(last.t - first.t)} since ${new Date(first.t).toLocaleDateString('en-CA')}`,
      `first -> now: ${compare(first, last)}`,
    ]
    : [`progress: ${checks.length} check${checks.length === 1 ? '' : 's'} so far; run whyslow again later to compare`];
  if (cleans.length) {
    const freed = cleans.reduce((sum, c) => sum + c.freedKb, 0);
    const ids = [...new Set(cleans.flatMap((c) => c.ids))].join(', ');
    lines.push(`cleaned: ${fmt(freed)} freed in ${cleans.length} run${cleans.length === 1 ? '' : 's'} (${ids})`);
  }
  return lines.join('\n');
}

export function renderServices(jobs: Job[], listening: Listener[], docker: string[]): string {
  const running = jobs.filter((j) => j.running).sort((a, b) => b.kb - a.kb);
  const idle = jobs.filter((j) => !j.running);
  const lines = [`services: ${jobs.length} third-party launchd jobs, ${running.length} running ${fmt(running.reduce((sum, j) => sum + j.kb, 0))}`];
  for (const j of running) {
    const brew = /^homebrew\.mxcl\.(.+)$/.exec(j.label)?.[1];
    lines.push(`${fmt(j.kb).padStart(6)}  ${j.label}${brew ? ` | stop: brew services stop ${brew}` : ''}`);
  }
  if (idle.length) lines.push(`not running: ${idle.map((j) => j.label).join(', ')}`);
  if (listening.length) lines.push(`listening: ${listening.map((l) => `${l.name}[${l.pid}] :${l.ports.join(',:')} ${fmt(l.kb)}`).join(', ')}`);
  if (docker.length) lines.push(`docker: ${docker.length} up: ${docker.join(', ')}`);
  lines.push('fix: turn launchd jobs off in System Settings > General > Login Items & Extensions or uninstall their app; kill <pid> for a forgotten server; docker stop <name>');
  return lines.join('\n');
}

export function services(): string {
  const procs = processes();
  return renderServices(launchJobs(procs), listeners(procs), containers());
}
