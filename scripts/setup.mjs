import {
  existsSync,
  lstatSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createInterface, emitKeypressEvents } from 'node:readline';

const root = resolve(import.meta.dirname, '..');
const target = resolve(root, '.env');
if (Number(process.versions.node.split('.')[0]) < 24)
  throw new Error('Relay requires Node.js 24 or newer.');
if (existsSync(target) && (!lstatSync(target).isFile() || lstatSync(target).isSymbolicLink()))
  throw new Error('Refusing to write a symlink or non-file .env.');
const original = existsSync(target)
  ? readFileSync(target, 'utf8')
  : readFileSync(resolve(root, '.env.example'), 'utf8');
function readValue(name) {
  const line = original.split(/\r?\n/).find((l) => l.startsWith(name + '='));
  return line?.slice(name.length + 1).trim() || '';
}
let content = original;
function setValue(name, value) {
  if (/[\r\n\0]/.test(value)) throw new Error('Invalid configuration value.');
  const pattern = new RegExp('^' + name + '=.*$', 'm');
  const line = name + '=' + value;
  content = pattern.test(content)
    ? content.replace(pattern, () => line)
    : content.trimEnd() + '\n' + line + '\n';
}
async function question(prompt) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await new Promise((r) => rl.question(prompt, r));
  } finally {
    rl.close();
  }
}
async function hiddenKey() {
  if (!process.stdin.isTTY)
    throw new Error('Run interactive setup in your own terminal. No key was written.');
  process.stdout.write('Paste your API key (hidden; Enter skips): ');
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolveKey, reject) => {
    let value = '';
    const cleanup = () => {
      process.stdin.removeListener('keypress', onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
    };
    function onKey(text, key = {}) {
      if (key.ctrl && key.name === 'c') {
        cleanup();
        reject(new Error('Setup cancelled. No configuration saved.'));
        return;
      }
      if (key.name === 'return' || key.name === 'enter') {
        cleanup();
        resolveKey(value);
        return;
      }
      if (key.name === 'backspace') {
        value = value.slice(0, -1);
        return;
      }
      if (text && !key.ctrl && !key.meta) {
        value += text.replace(/[\r\n\x00-\x1f\x7f]/g, '');
      }
    }
    process.stdin.on('keypress', onKey);
  });
}
console.log('\nRelay — local setup\nYour configuration stays in the ignored .env file.\n');
try {
  const existingKey = readValue('OPENAI_API_KEY');
  let mode = readValue('AGENT_MODE') || 'demo';
  if (process.argv.includes('--demo')) {
    mode = 'demo';
  } else {
    const choice = (
      await question(
        existingKey
          ? 'Use existing API key? [y = live / Enter = offline demo]: '
          : 'Mode [1 = offline demo / 2 = OpenAI]: ',
      )
    )
      .trim()
      .toLowerCase();
    if (existingKey && choice === 'y') mode = 'openai';
    else if (!existingKey && choice === '2') {
      const entered = await hiddenKey();
      if (entered) {
        if (!/^sk-[A-Za-z0-9_-]{16,}$/.test(entered))
          throw new Error('Key format not recognized. No configuration saved.');
        setValue('OPENAI_API_KEY', entered);
        mode = 'openai';
      } else mode = 'demo';
    } else mode = 'demo';
  }
  setValue('AGENT_MODE', mode);
  if (!readValue('SESSION_SECRET')) setValue('SESSION_SECRET', randomBytes(32).toString('hex'));
  const ignored = resolve(root, '.gitignore');
  if (!existsSync(ignored) || !readFileSync(ignored, 'utf8').split(/\r?\n/).includes('.env'))
    throw new Error('Add .env to .gitignore before saving configuration.');
  const temp = target + '.' + randomBytes(8).toString('hex') + '.tmp';
  try {
    writeFileSync(temp, content, { mode: 0o600, flag: 'wx' });
    renameSync(temp, target);
    chmodSync(target, 0o600);
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
  console.log(`\nConfiguration saved. Mode: ${mode}. No credentials were displayed.\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Setup failed.');
  process.exitCode = 1;
}
