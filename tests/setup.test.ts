import { it, expect } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'relay-setup-'));
  mkdirSync(join(root, 'scripts'));
  copyFileSync(resolve('scripts/setup.mjs'), join(root, 'scripts/setup.mjs'));
  copyFileSync(resolve('.env.example'), join(root, '.env.example'));
  writeFileSync(join(root, '.gitignore'), '.env\n');
  return root;
}
it('local setup saves offline configuration and preserves the session across reruns', () => {
  const root = fixture();
  try {
    const run = () =>
      spawnSync(process.execPath, [join(root, 'scripts/setup.mjs'), '--demo'], {
        encoding: 'utf8',
      });
    const first = run();
    expect(first.status).toBe(0);
    const a = readFileSync(join(root, '.env'), 'utf8');
    expect(a).toMatch(/^AGENT_MODE=demo$/m);
    expect(a).toMatch(/^SESSION_SECRET=[a-f0-9]{64}$/m);
    expect(run().status).toBe(0);
    expect(readFileSync(join(root, '.env'), 'utf8')).toBe(a);
    expect(first.stdout).not.toContain(a.match(/^SESSION_SECRET=(.+)$/m)![1]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
it('local setup refuses a symlink target', () => {
  const root = fixture();
  try {
    const outside = join(root, 'other.env');
    writeFileSync(outside, 'unchanged');
    symlinkSync(outside, join(root, '.env'));
    const r = spawnSync(process.execPath, [join(root, 'scripts/setup.mjs'), '--demo'], {
      encoding: 'utf8',
    });
    expect(r.status).not.toBe(0);
    expect(readFileSync(outside, 'utf8')).toBe('unchanged');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
it('local setup refuses to save when .env is not ignored', () => {
  const root = fixture();
  try {
    writeFileSync(join(root, '.gitignore'), '');
    const r = spawnSync(process.execPath, [join(root, 'scripts/setup.mjs'), '--demo'], {
      encoding: 'utf8',
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('Add .env to .gitignore');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
