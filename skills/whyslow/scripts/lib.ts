import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const HOME = homedir();
const HISTORY = join(HOME, 'Library/Application Support/whyslow/history.jsonl');

/** Runs a command and returns stdout; on failure returns whatever it printed. */
export function sh(cmd: string, args: string[] = [], timeout = 30_000): string {
  try {
    return execFileSync(cmd, args, {
      encoding: 'utf8',
      timeout,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (err) {
    // du and find exit 1 on unreadable folders but still print useful totals
    const out = (err as { stdout?: unknown }).stdout;
    return typeof out === 'string' ? out : '';
  }
}

/** Entry names in a folder; empty when it is missing or unreadable. */
export function ls(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

const UNIT_KB = { B: 1 / 1024, K: 1, M: 1024, G: 1024 ** 2, T: 1024 ** 3 } as const;

/** Parses sizes like "1012M+", "9793K" or "1.2G" into KiB; 0 when unparseable. */
export function parseSize(text: string): number {
  const m = /^([\d.]+)([BKMGT])/.exec(text.trim());
  return m ? Number(m[1]) * UNIT_KB[m[2] as keyof typeof UNIT_KB] : 0;
}

export function fmt(kb: number): string {
  if (kb >= 1024 ** 2) return `${(kb / 1024 ** 2).toFixed(1)}G`;
  if (kb >= 1024) return `${Math.round(kb / 1024)}M`;
  return `${Math.round(kb)}K`;
}

/** Free and total KiB of the data volume. */
export function diskSpace(): { freeKb: number; totalKb: number } {
  const out = sh('df', ['-k', '/System/Volumes/Data']) || sh('df', ['-k', '/']);
  const cols = out.trim().split('\n').at(-1)?.split(/\s+/) ?? [];
  return { totalKb: Number(cols[1]) || 0, freeKb: Number(cols[3]) || 0 };
}

export interface Check { kind: 'check'; t: number; score: number; swapKb: number; freePct: number; diskFreeKb: number }
export interface Cleaned { kind: 'clean'; t: number; freedKb: number; ids: string[] }
export type Entry = Check | Cleaned;

/** Every past diagnose and clean, oldest first; bad lines are skipped. */
export function history(): Entry[] {
  let text = '';
  try {
    text = readFileSync(HISTORY, 'utf8');
  } catch {
    return [];
  }
  return text.split('\n').flatMap((line) => {
    try {
      return line ? [JSON.parse(line) as Entry] : [];
    } catch {
      return [];
    }
  });
}

/** Appends one entry to the history; never fails the command that called it. */
// ponytail: the file only grows (about 120 bytes per run); trim it if anyone runs whyslow on a timer.
export function remember(entry: Entry): void {
  try {
    mkdirSync(dirname(HISTORY), { recursive: true });
    appendFileSync(HISTORY, `${JSON.stringify(entry)}\n`);
  } catch {
    // a read-only home folder only loses the history
  }
}
