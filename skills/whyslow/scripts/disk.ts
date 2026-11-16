import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appName } from './diagnose.ts';
import { type Cleaned, HOME, diskSpace, fmt, history, ls, remember, sh } from './lib.ts';

export interface Opts {
  /** Skip found paths that contain any of these words. */
  keep: string[];
  /** Only take project folders idle this many days or more. */
  days: number;
}

export interface Target {
  id: string;
  /** Relative to the home folder. */
  paths?: string[];
  /** Finds absolute paths at scan time, for folders that vary per Mac. */
  find?: (o: Opts) => string[];
  /** The tool's own cleanup command, preferred over rm. */
  run?: [string, ...string[]];
  /** Apps that must be closed before cleaning. */
  apps?: string[];
  /** Set on personal data and VMs: whyslow only reports these and prints this hint. */
  manual?: string;
}

const APP_SUPPORT = join(HOME, 'Library/Application Support');
const MIN_KB = 50 * 1024;
const PROJECT_ROOTS = ['Documents', 'Desktop', 'Developer', 'Projects', 'code', 'dev', 'src', 'repos', 'git', 'GitHub', 'workspace'];
const BROWSER_APPS = ['Google Chrome', 'Brave Browser', 'Microsoft Edge', 'Arc', 'Dia', 'Firefox', 'Vivaldi', 'Opera'];
const JETBRAINS_APPS = ['IntelliJ IDEA', 'WebStorm', 'PyCharm', 'GoLand', 'CLion', 'Rider', 'RubyMine', 'PhpStorm', 'DataGrip', 'RustRover'];
/** Cache folders Chromium and Electron keep next to an app's data. */
const CHROMIUM_CACHES = [
  'Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache',
  'Service Worker/CacheStorage', 'CachedData', 'CachedExtensionVSIXs',
];

/** Dependency and build folders, trusted only when a marker file next to them (or inside, for venvs) proves what they are. */
const ARTIFACTS: Record<string, string[]> = {
  node_modules: [],
  '.next': ['package.json'],
  '.nuxt': ['package.json'],
  '.turbo': ['package.json'],
  '.parcel-cache': ['package.json'],
  '.venv': ['.venv/pyvenv.cfg'],
  venv: ['venv/pyvenv.cfg'],
  target: ['Cargo.toml', 'pom.xml'],
  Pods: ['Podfile'],
  build: ['pubspec.yaml', 'build.gradle', 'build.gradle.kts'],
  '.gradle': ['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'],
  '.dart_tool': ['pubspec.yaml'],
};

export const TARGETS: Target[] = [
  { id: 'npm', paths: ['.npm'], run: ['npm', 'cache', 'clean', '--force'] },
  { id: 'pnpm', paths: ['Library/pnpm/store'], run: ['pnpm', 'store', 'prune'] },
  { id: 'yarn', paths: ['Library/Caches/Yarn'] },
  { id: 'bun', paths: ['.bun/install/cache'] },
  { id: 'deno', paths: ['Library/Caches/deno'] },
  { id: 'pip', paths: ['Library/Caches/pip', 'Library/Caches/pypoetry'] },
  { id: 'uv', paths: ['.cache/uv'], run: ['uv', 'cache', 'clean'] },
  { id: 'conda', paths: ['miniconda3/pkgs', 'miniforge3/pkgs', 'anaconda3/pkgs', 'opt/anaconda3/pkgs'], run: ['conda', 'clean', '--all', '--yes'] },
  { id: 'cargo', paths: ['.cargo/registry/cache', '.cargo/registry/src', '.cargo/git/checkouts'] },
  { id: 'go', paths: ['Library/Caches/go-build'] },
  { id: 'maven', paths: ['.m2/repository'] },
  { id: 'gradle', paths: ['.gradle/caches', '.gradle/wrapper/dists'] },
  { id: 'composer', paths: ['.composer/cache', '.cache/composer'] },
  { id: 'pub', paths: ['.pub-cache'] },
  { id: 'cocoapods', paths: ['Library/Caches/CocoaPods'] },
  { id: 'test-browsers', paths: ['Library/Caches/ms-playwright', '.cache/puppeteer', 'Library/Caches/electron'] },
  { id: 'brew', paths: ['Library/Caches/Homebrew'], run: ['brew', 'cleanup', '--prune=all'] },
  {
    id: 'xcode',
    paths: ['DerivedData', 'iOS DeviceSupport', 'watchOS DeviceSupport', 'tvOS DeviceSupport']
      .map((d) => `Library/Developer/Xcode/${d}`)
      .concat('Library/Developer/CoreSimulator/Caches'),
    apps: ['Xcode', 'Simulator'],
  },
  { id: 'ios-updates', paths: ['Library/iTunes/iPhone Software Updates', 'Library/iTunes/iPad Software Updates'] },
  { id: 'jetbrains', paths: ['Library/Caches/JetBrains'], apps: JETBRAINS_APPS },
  { id: 'vscode', find: editorLeftovers },
  {
    id: 'browsers',
    paths: [
      'Google/Chrome', 'BraveSoftware', 'Microsoft Edge', 'Arc', 'company.thebrowser.Browser',
      'company.thebrowser.dia', 'Firefox', 'Vivaldi', 'com.operasoftware.Opera',
    ].map((d) => `Library/Caches/${d}`),
    apps: BROWSER_APPS,
  },
  { id: 'app-caches', find: appCaches },
  { id: 'spotify', paths: ['Library/Caches/com.spotify.client'], apps: ['Spotify'] },
  { id: 'projects', find: projectArtifacts },
  { id: 'vms', paths: ['Virtual Machines.localized', 'Parallels', 'Library/Containers/com.utmapp.UTM'], manual: 'delete unused VMs in their app (VMware Fusion, Parallels, UTM)' },
  { id: 'colima', paths: ['.colima', '.lima'], manual: 'colima delete (removes every image, container and volume in it)' },
  { id: 'docker', paths: ['Library/Containers/com.docker.docker'], manual: 'docker system prune -a with Docker Desktop running' },
  { id: 'simulators', paths: ['Library/Developer/CoreSimulator/Devices'], manual: 'xcrun simctl delete unavailable, then remove old runtimes in Xcode settings' },
  { id: 'xcode-archives', paths: ['Library/Developer/Xcode/Archives'], manual: 'delete old archives in Xcode > Window > Organizer' },
  { id: 'android', paths: ['.android/avd', 'Library/Android/sdk/system-images'], manual: 'delete unused emulators and system images in Android Studio' },
  { id: 'ai-models', paths: ['.ollama/models', '.cache/huggingface', '.lmstudio/models'], manual: 'ollama rm <model>, huggingface-cli delete-cache, or delete models in LM Studio' },
  { id: 'toolchains', paths: ['.nvm/versions/node', '.rustup/toolchains', '.pyenv/versions'], manual: 'remove old versions: nvm uninstall, rustup toolchain remove, pyenv uninstall' },
  { id: 'games', paths: ['Library/Application Support/Steam/steamapps'], manual: 'uninstall games you no longer play in Steam' },
  { id: 'photos', find: photoLibraries, manual: 'Photos > Settings > iCloud > Optimize Mac Storage, or delete media inside Photos, never in Finder' },
  { id: 'messages', paths: ['Library/Messages/Attachments'], manual: 'System Settings > General > Storage > Messages' },
  { id: 'whatsapp', paths: ['Library/Group Containers/group.net.whatsapp.WhatsApp.shared'], manual: 'WhatsApp > Settings > Storage and Data > Manage Storage' },
  { id: 'ios-backups', paths: ['Library/Application Support/MobileSync/Backup'], manual: 'Finder > your iPhone > Manage Backups' },
  { id: 'movies', paths: ['Movies'], manual: 'sort Movies by size in Finder; iMovie and Final Cut libraries live here' },
  { id: 'music', paths: ['Music'], manual: 'remove downloaded songs in Music, or GarageBand projects you no longer need' },
  { id: 'downloads', paths: ['Downloads'], manual: 'sort Downloads by size in Finder' },
  { id: 'trash', paths: ['.Trash'], manual: 'empty the Trash in Finder' },
];

export const isKept = (path: string, keep: string[]) =>
  keep.some((k) => path.toLowerCase().includes(k.toLowerCase()));

/** Lowercased app and executable names of every running process. */
function openApps(): string[] {
  return sh('ps', ['-Axo', 'comm=']).split('\n').flatMap((p) => (p ? [appName(p).toLowerCase(), basename(p).toLowerCase()] : []));
}

/** True when an app, or an Electron-style "<app> Helper", is running. Matches both ways so "Foo IDE" finds "Foo". */
export function isOpen(app: string, open: string[]): boolean {
  const a = app.toLowerCase();
  return open.some((o) => o === a || o.startsWith(`${a} `) || a.startsWith(`${o} `));
}

/** Whether a found folder really is a dependency or build folder. */
export function isArtifact(path: string, exists: (p: string) => boolean = existsSync): boolean {
  const markers = ARTIFACTS[basename(path)];
  return markers !== undefined && (!markers.length || markers.some((m) => exists(join(dirname(path), m))));
}

/** Days since anything at the top of a project changed; .git changes on every commit and checkout. */
// ponytail: top-level mtimes only, so weeks of uncommitted edits deep in src/ look idle; ask git if that misjudges.
export function idleDays(dir: string, now = Date.now()): number {
  let newest = 0;
  for (const name of ls(dir)) {
    try {
      newest = Math.max(newest, statSync(join(dir, name)).mtimeMs);
    } catch {
      // vanished or unreadable entries don't count
    }
  }
  return (now - newest) / 86_400_000;
}

/** Dependency and build folders under the usual project roots, in projects idle o.days or more. */
function projectArtifacts(o: Opts): string[] {
  const roots = PROJECT_ROOTS.map((r) => join(HOME, r)).filter(existsSync);
  if (!roots.length) return [];
  const names = Object.keys(ARTIFACTS).flatMap((n, i) => (i ? ['-o', '-name', n] : ['-name', n]));
  const found = sh('find', [...roots, '(', ...names, ')', '-type', 'd', '-prune'], 600_000).split('\n');
  return [...new Set(found)].filter((p) => p && isArtifact(p) && idleDays(dirname(p)) >= o.days);
}

/** Cache folders of every closed Electron or Chromium-based app, recognised by Chromium's own cache folders. */
function appCaches(): string[] {
  const open = openApps();
  return ls(APP_SUPPORT)
    .filter((app) => ['GPUCache', 'Code Cache'].some((c) => existsSync(join(APP_SUPPORT, app, c))) && !isOpen(app, open))
    .flatMap((app) => CHROMIUM_CACHES.map((c) => join(APP_SUPPORT, app, c)).filter(existsSync));
}

/** Extension folders a VS Code-based editor no longer lists in extensions.json (old versions, uninstalled ones). */
export function staleExtensions(dir: string): string[] {
  let listed: Set<string>;
  try {
    const json = JSON.parse(readFileSync(join(dir, 'extensions.json'), 'utf8')) as { relativeLocation?: string; location?: { path?: string } }[];
    listed = new Set(json.map((e) => e.relativeLocation ?? basename(e.location?.path ?? '')));
  } catch {
    return [];
  }
  // an empty list means the editor lost track, not that every extension is unused
  if (!listed.size) return [];
  return ls(dir).filter((n) => !n.startsWith('.') && !n.endsWith('.json') && !listed.has(n)).map((n) => join(dir, n));
}

/** Per-workspace editor storage whose project folder no longer exists. */
export function isStaleWorkspace(dir: string): boolean {
  try {
    const { folder, workspace } = JSON.parse(readFileSync(join(dir, 'workspace.json'), 'utf8')) as Record<string, unknown>;
    const uri = folder ?? workspace;
    return typeof uri === 'string' && uri.startsWith('file:') && !existsSync(fileURLToPath(uri));
  } catch {
    return false;
  }
}

/** Data folders (.vscode, .cursor, ...) of running VS Code-based editors, from each running app's product.json. */
function openEditorFolders(): Set<string> {
  const bundles = new Set(sh('ps', ['-Axo', 'comm=']).split('\n').map((p) => /^(.+?\.app)\//.exec(p)?.[1]));
  const folders = new Set<string>();
  for (const b of bundles) {
    try {
      if (b) folders.add((JSON.parse(readFileSync(join(b, 'Contents/Resources/app/product.json'), 'utf8')) as { dataFolderName: string }).dataFolderName);
    } catch {
      // not an editor built on VS Code
    }
  }
  return folders;
}

/**
 * Leftovers of every VS Code-based editor (VS Code, Cursor, Windsurf, VSCodium, ...). Extensions are skipped while
 * their editor runs, because a window keeps using an old version until it reloads.
 */
function editorLeftovers(): string[] {
  const open = openEditorFolders();
  const extensions = ls(HOME)
    .filter((d) => d.startsWith('.') && !open.has(d))
    .flatMap((d) => staleExtensions(join(HOME, d, 'extensions')));
  const storage = ls(APP_SUPPORT).flatMap((app) => {
    const dir = join(APP_SUPPORT, app, 'User/workspaceStorage');
    return ls(dir).map((w) => join(dir, w)).filter(isStaleWorkspace);
  });
  return [...extensions, ...storage];
}

function photoLibraries(): string[] {
  const pictures = join(HOME, 'Pictures');
  return ls(pictures).filter((n) => n.endsWith('.photoslibrary')).map((n) => join(pictures, n));
}

function pathsOf(t: Target, o: Opts): string[] {
  if (t.find) return t.find(o).filter((p) => !isKept(p, o.keep));
  return (t.paths ?? []).map((p) => join(HOME, p)).filter(existsSync);
}

type Sized = [kb: number, path: string];

function du(paths: string[]): Sized[] {
  if (!paths.length) return [];
  return sh('du', ['-sk', ...paths], 600_000).split('\n').flatMap((line): Sized[] => {
    const [kb = '', path] = line.split('\t');
    return path ? [[Number(kb) || 0, path]] : [];
  });
}

const total = (rows: Sized[]) => rows.reduce((sum, [kb]) => sum + kb, 0);

/** Refuses the home folder, its top-level folders and anything outside it. */
export function assertSafe(path: string): string {
  const rel = relative(HOME, path);
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).length < 2) {
    throw new Error(`refusing to delete ${path}`);
  }
  return path;
}

const tilde = (p: string) => p.replace(HOME, '~');

/** What a found target is made of: apps for app-caches, one line per folder otherwise. */
function details(t: Target, rows: Sized[]): string[] {
  if (t.id === 'app-caches') {
    const apps = new Map<string, number>();
    for (const [kb, p] of rows) {
      const app = relative(APP_SUPPORT, p).split(sep)[0] ?? p;
      apps.set(app, (apps.get(app) ?? 0) + kb);
    }
    return [`  apps: ${[...apps].sort((a, b) => b[1] - a[1]).map(([a, kb]) => `${a} ${fmt(kb)}`).join(', ')}`];
  }
  const sorted = [...rows].sort((a, b) => b[0] - a[0]);
  const shown = sorted.filter(([kb]) => kb >= 1024);
  const small = sorted.slice(shown.length);
  const lines = shown.map(([kb, p]) => `  ${fmt(kb).padStart(6)} ${tilde(p)}${t.id === 'projects' ? `, idle ${Math.floor(idleDays(dirname(p)))}d` : ''}`);
  if (small.length) lines.push(`  ${fmt(total(small)).padStart(6)} in ${small.length} smaller folders`);
  return lines;
}

export interface Row { target: Target; rows: Sized[]; kb: number }

export function scan(o: Opts): Row[] {
  return TARGETS.map((target) => {
    const rows = du(pathsOf(target, o));
    return { target, rows, kb: total(rows) };
  })
    .filter((r) => r.kb >= MIN_KB)
    .sort((a, b) => b.kb - a.kb);
}

export function renderScan(rows: Row[], o: Opts): string {
  const { freeKb, totalKb } = diskSpace();
  const lines = [`disk: ${fmt(freeKb)} free of ${fmt(totalKb)} (${Math.round((freeKb / totalKb) * 100)}%)`];
  for (const { target: t, rows: found, kb } of rows) {
    const what = t.find ? `, ${found.length} folders${t.id === 'projects' ? ` idle ${o.days}d+` : ''}` : '';
    const note = t.manual ? `manual: ${t.manual}` : `cache${what}`;
    lines.push(`${fmt(kb).padStart(6)}  ${t.id.padEnd(14)} ${note}`);
  }
  const cleanable = rows.filter((r) => !r.target.manual);
  if (cleanable.length) {
    lines.push(`cleanable ${fmt(cleanable.reduce((sum, r) => sum + r.kb, 0))}: whyslow clean ${cleanable.map((r) => r.target.id).join(' ')}`);
  }
  return lines.join('\n');
}

/** Biggest entries directly inside a folder, to drill into whatever the targets miss. */
export function big(dir: string, limit = 15): string {
  const rows = du(ls(dir).map((n) => join(dir, n))).sort((a, b) => b[0] - a[0]);
  if (!rows.length) return `big: nothing readable in ${tilde(dir)}`;
  const isDir = (p: string) => {
    try {
      return lstatSync(p).isDirectory();
    } catch {
      return false;
    }
  };
  const lines = [`big: ${tilde(dir)} ${fmt(total(rows))}`];
  for (const [kb, p] of rows.slice(0, limit)) lines.push(`${fmt(kb).padStart(6)}  ${basename(p)}${isDir(p) ? '/' : ''}`);
  const rest = rows.slice(limit);
  if (rest.length) lines.push(`${fmt(total(rest)).padStart(6)}  ${rest.length} more`);
  return lines.join('\n');
}

/** Dry run unless yes is set; returns one line per target. */
export function clean(ids: string[], o: Opts & { yes: boolean }): string {
  const lines: string[] = [];
  const before = diskSpace().freeKb;
  const open = openApps();
  const done: string[] = [];

  for (const id of ids) {
    const t = TARGETS.find((x) => x.id === id);
    if (!t) { lines.push(`skip ${id}: unknown target, run whyslow disk for ids`); continue; }
    if (t.manual) { lines.push(`skip ${id}: whyslow never deletes this; ${t.manual}`); continue; }
    const busy = (t.apps ?? []).filter((a) => isOpen(a, open));
    if (busy.length) { lines.push(`skip ${id}: quit ${busy.join(', ')} first`); continue; }

    const paths = pathsOf(t, o);
    if (!paths.length) { lines.push(`skip ${id}: nothing found`); continue; }
    const how = t.run ? t.run.join(' ') : `rm -rf ${paths.length} folder(s)`;
    if (!o.yes) {
      const rows = du(paths);
      lines.push(`would free ~${fmt(total(rows))} from ${id}: ${how}`);
      if (t.find) lines.push(...details(t, rows));
      continue;
    }

    if (t.run) {
      const [cmd, ...args] = t.run;
      try { execFileSync(cmd, args, { stdio: 'ignore', timeout: 600_000 }); }
      catch { lines.push(`fail ${id}: ${how}`); continue; }
    } else {
      for (const p of paths) rmSync(assertSafe(p), { recursive: true, force: true });
    }
    lines.push(`done ${id}: ${how}`);
    done.push(id);
  }

  if (!o.yes) return [...lines, 'dry run: add --yes to delete'].join('\n');
  const freedKb = Math.max(0, diskSpace().freeKb - before);
  if (done.length) remember({ kind: 'clean', t: Date.now(), freedKb, ids: done });
  const ever = history().filter((e): e is Cleaned => e.kind === 'clean').reduce((sum, c) => sum + c.freedKb, 0);
  lines.push(`freed ${fmt(freedKb)}${ever > freedKb ? `, ${fmt(ever)} in total (whyslow progress)` : ''}`);
  return lines.join('\n');
}
