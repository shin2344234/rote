// Native Messaging host. Chrome starts it for one request, passes the request on
// stdin, reads one reply from stdout, and the process exits.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

const TIMEOUT_MS = 240000;
const installed = path.join(homedir(), '.local', 'bin', 'claude.exe');
// A script path runs through Node, because Windows can't start a .js file or an npm .cmd shim without a shell.
const command = (file) => (/\.[cm]?js$/i.test(file) ? [process.execPath, file] : [file]);
const CLAUDE = { name: 'Claude Code', command: command(process.env.CLAUDE_BIN ?? (existsSync(installed) ? installed : 'claude')) };
const npmCodex = path.join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
const CODEX = { name: 'Codex', command: command(process.env.CODEX_BIN ?? (existsSync(npmCodex) ? npmCodex : 'codex')) };

function reply(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32LE(body.length);
  process.stdout.write(Buffer.concat([length, body]), () => process.exit(0));
}

function run(tool, args, input, cwd) {
  return new Promise((resolve, reject) => {
    const [file, ...first] = tool.command;
    const child = spawn(file, [...first, ...args], { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${tool.name} took longer than four minutes.`));
    }, TIMEOUT_MS);
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`Could not start ${tool.name} at ${tool.command.at(-1)}: ${error.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

// An empty working directory and no setting sources keep project files, hooks,
// plugins and MCP servers out of the run. The --bare flag would do the same but
// it requires an API key, and this route exists to use the Claude Code sign-in.
async function ask({ system, prompt, schema, model, engine }) {
  if (typeof prompt !== 'string' || typeof system !== 'string' || !schema) throw new Error('The bridge received an incomplete request.');
  if (engine === 'codex') return askCodex({ system, prompt, schema, model });
  if (!/^[\w.-]+$/.test(model ?? '')) throw new Error('The bridge received an invalid model name.');
  const cwd = mkdtempSync(path.join(tmpdir(), 'resume-autofill-'));
  try {
    const { code, stdout, stderr } = await run(CLAUDE, [
      '-p',
      '--output-format', 'json',
      '--json-schema', JSON.stringify(schema),
      '--system-prompt', system,
      '--model', model,
      '--tools', '',
      '--setting-sources', '',
      '--strict-mcp-config',
      '--disable-slash-commands',
      '--no-session-persistence',
    ], prompt, cwd);
    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      throw new Error(`Claude Code exited with code ${code}: ${(stderr || stdout).slice(0, 400)}`);
    }
    if (parsed.is_error) throw new Error(`Claude Code reported an error: ${String(parsed.result ?? parsed.subtype).slice(0, 400)}`);
    if (parsed.structured_output === undefined) throw new Error('Claude Code returned no structured answer.');
    return parsed.structured_output;
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

// Codex has no system prompt flag, so the instructions lead the prompt. An empty
// working directory, a read-only sandbox and no user config keep project files,
// rules and MCP servers out of the run. The sign-in still comes from the Codex home folder.
// An empty model leaves the choice to Codex.
async function askCodex({ system, prompt, schema, model }) {
  if (model && !/^[\w.-]+$/.test(model)) throw new Error('The bridge received an invalid model name.');
  const cwd = mkdtempSync(path.join(tmpdir(), 'resume-autofill-'));
  const files = mkdtempSync(path.join(tmpdir(), 'resume-autofill-io-'));
  const schemaFile = path.join(files, 'schema.json');
  const answerFile = path.join(files, 'answer.json');
  try {
    writeFileSync(schemaFile, JSON.stringify(schema));
    const { code, stdout, stderr } = await run(CODEX, [
      'exec',
      '--skip-git-repo-check',
      '--ephemeral',
      '--ignore-user-config',
      '--ignore-rules',
      '--sandbox', 'read-only',
      '--color', 'never',
      '--cd', cwd,
      '--output-schema', schemaFile,
      '--output-last-message', answerFile,
      ...(model ? ['--model', model] : []),
      '-',
    ], `${system}\n\n${prompt}`, cwd);
    if (!existsSync(answerFile)) throw new Error(`Codex exited with code ${code} and no answer: ${(stderr || stdout).slice(-400)}`);
    const text = readFileSync(answerFile, 'utf8');
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Codex returned something other than JSON: ${text.slice(0, 200)}`);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(files, { recursive: true, force: true });
  }
}

// Tells the options page which tools this PC has, so it can say what is missing.
async function found(tool) {
  try {
    const { code, stdout } = await run(tool, ['--version'], '', tmpdir());
    return code === 0 ? { found: true, version: stdout.trim().split('\n')[0] } : { found: false };
  } catch {
    return { found: false };
  }
}

async function handle(request) {
  if (request?.type === 'status') {
    const [claude, codex] = await Promise.all([found(CLAUDE), found(CODEX)]);
    return { ok: true, claude, codex };
  }
  if (request?.type === 'ping') {
    const tool = request.engine === 'codex' ? CODEX : CLAUDE;
    const { code, stdout, stderr } = await run(tool, ['--version'], '', tmpdir());
    if (code !== 0) throw new Error(`${tool.name} exited with code ${code}: ${stderr.slice(0, 400)}`);
    return { ok: true, version: stdout.trim() };
  }
  if (request?.type === 'ask') return { ok: true, result: await ask(request) };
  throw new Error('The bridge received an unknown request.');
}

let buffered = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  buffered = Buffer.concat([buffered, chunk]);
  if (buffered.length < 4) return;
  const size = buffered.readUInt32LE(0);
  if (buffered.length < 4 + size) return;
  process.stdin.pause();
  const body = buffered.subarray(4, 4 + size).toString('utf8');
  Promise.resolve()
    .then(() => handle(JSON.parse(body)))
    .then(reply)
    .catch((error) => reply({ ok: false, error: error.message ?? String(error) }));
});
