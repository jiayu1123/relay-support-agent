import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'node:fs';
import { connect, migrate } from '../server/db.js';
import { evaluate } from '../server/evaluation.js';
const mode = process.argv.includes('--mode=openai') ? 'openai' : 'demo';
if (mode === 'openai' && !process.env.OPENAI_API_KEY)
  throw new Error('Set OPENAI_API_KEY to run paid live-model evaluations.');
const db = await connect(undefined, ':memory:');
await migrate(db);
try {
  const report = await evaluate(db, 'cli', mode);
  mkdirSync('data', { recursive: true });
  writeFileSync(`data/evaluation-${mode}.json`, JSON.stringify(report, null, 2));
  console.log(
    `${report.passed}/${report.total} scenarios passed · ${report.checks} assertions · ${report.durationMs}ms · ${mode}`,
  );
  for (const r of report.results)
    if (!r.passed)
      console.log(
        'FAIL',
        r.name,
        r.checks.filter((c: any) => !c.passed),
        r.error || '',
      );
  if (report.passed !== report.total) process.exitCode = 1;
} finally {
  await db.close();
}
