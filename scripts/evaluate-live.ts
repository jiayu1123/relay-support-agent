import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { LIVE_STATE_CASES } from '../server/live-state-cases.js';
import { evaluateLiveRemote } from '../server/live-evaluation.js';

const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
if (!process.argv.includes('--confirm-paid'))
  throw new Error(
    'Live evaluation makes paid model calls on the target server. Add --confirm-paid to opt in. No calls were made.',
  );
const url = arg('base-url');
if (!url) throw new Error('Provide --base-url=https://your-relay-service.');
const repeats = Number(arg('repeats') || 1),
  output = arg('output') || 'data/live-evaluation.json';
console.log(
  `Starting live evaluation against ${new URL(url).origin}. Model usage is billed to that service’s configured API project.`,
);
const suite = arg('suite') || 'core';
if (!['core', 'state'].includes(suite)) throw new Error('Use --suite=core or --suite=state.');
const report = await evaluateLiveRemote(url, {
  ...(suite === 'state' ? { cases: LIVE_STATE_CASES, suiteVersion: 'relay-state-v1' } : {}),
  repeats,
  onCase: (r, n, total) =>
    console.log(
      `${n}/${total} ${r.passed ? 'PASS' : 'FAIL'} ${r.id}${r.error ? ' · ' + r.error : ''}`,
    ),
});
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(
  `${report.passed}/${report.total} contracts passed; task outcomes ${report.taskPassed}/${report.total}; status ${report.status}. Report: ${output}`,
);
if (report.passed !== report.total || report.status !== 'completed') process.exitCode = 1;
