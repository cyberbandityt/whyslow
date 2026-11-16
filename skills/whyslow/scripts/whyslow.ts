#!/usr/bin/env -S node --no-warnings
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { diagnose, progress, services } from './diagnose.ts';
import { big, clean, renderScan, scan } from './disk.ts';
import { HOME } from './lib.ts';

const HELP = `whyslow: why your Mac is slow and what fills its disk

  whyslow [diagnose]          memory, swap, CPU, VMs, browsers, leaks, background items, uptime, disk; scores 0-100
  whyslow progress            first check against now, and the space clean has freed
  whyslow services            launchd jobs (the macOS systemctl), listening servers and Docker containers
  whyslow disk                caches, app data and project build folders, largest first
  whyslow big [folder]        biggest items in a folder (default: home), to drill down
  whyslow clean <id...>       dry run: what clean would delete
  whyslow clean <id...> --yes delete it

--keep a,b  skip found folders whose path contains any of these words (disk, clean)
--days N    only take project folders idle N days or more (default 30, 0 for all)`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    yes: { type: 'boolean', short: 'y', default: false },
    keep: { type: 'string', default: '' },
    days: { type: 'string', default: '30' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

const keep = values.keep.split(',').map((w) => w.trim()).filter(Boolean);
const days = Number(values.days);
const [cmd = 'diagnose', ...ids] = positionals;

if (values.help || cmd === 'help') {
  console.log(HELP);
} else if (process.platform !== 'darwin') {
  console.error('whyslow only supports macOS');
  process.exitCode = 1;
} else if (!(days >= 0)) {
  console.error('--days needs a number of days, such as --days 90');
  process.exitCode = 1;
} else if (cmd === 'diagnose') {
  console.log(diagnose());
} else if (cmd === 'progress') {
  console.log(progress());
} else if (cmd === 'services') {
  console.log(services());
} else if (cmd === 'disk') {
  console.log(renderScan(scan({ keep, days }), { keep, days }));
} else if (cmd === 'big') {
  console.log(big(resolve((ids[0] ?? HOME).replace(/^~(?=\/|$)/, HOME))));
} else if (cmd === 'clean' && ids.length) {
  console.log(clean(ids, { yes: values.yes, keep, days }));
} else {
  console.error(HELP);
  process.exitCode = 1;
}
