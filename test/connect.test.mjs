// Tests for `posteverywhere connect` (coding agent connector).
// Runs against the built output: `npm test` builds first, then `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { connectAgents, removeTomlTable, MCP_URL } from '../dist/agents.js';
import { setMember, removeMember, parseJsonc } from '../dist/jsonc.js';

function makeEnv({ bins = [], responses = {} } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-connect-'));
  const calls = [];
  const env = {
    home,
    platform: 'linux',
    appData: path.join(home, 'AppData', 'Roaming'),
    xdgConfig: path.join(home, '.config'),
    codexHome: path.join(home, '.codex'),
    which: (cmd) => (bins.includes(cmd) ? `/usr/bin/${cmd}` : null),
    run: (cmd, args, opts = {}) => {
      calls.push({ cmd, args, interactive: !!opts.interactive });
      const key = `${cmd} ${args.slice(0, 2).join(' ')}`;
      return responses[key] || { code: 0, stdout: '', stderr: '' };
    },
    prompt: async () => '',
    now: () => new Date('2026-10-02T12:00:00.000Z'),
  };
  return { env, home, calls };
}

const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const read = (file) => fs.readFileSync(file, 'utf8');
const json = (file) => parseJsonc(read(file)).value;
const STAMP = '20261002T120000Z';

// ─── file-based clients ──────────────────────────────────

const FILE_CASES = [
  { id: 'cursor', file: (h) => path.join(h, '.cursor', 'mcp.json'), container: 'mcpServers', value: { url: MCP_URL } },
  { id: 'windsurf', file: (h) => path.join(h, '.codeium', 'windsurf', 'mcp_config.json'), container: 'mcpServers', value: { serverUrl: MCP_URL } },
  { id: 'cline', file: (h) => path.join(h, '.config', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'), container: 'mcpServers', value: { url: MCP_URL, type: 'streamableHttp' } },
  { id: 'zed', file: (h) => path.join(h, '.config', 'zed', 'settings.json'), container: 'context_servers', value: { url: MCP_URL } },
  { id: 'gemini', file: (h) => path.join(h, '.gemini', 'settings.json'), container: 'mcpServers', value: { httpUrl: MCP_URL } },
];

for (const c of FILE_CASES) {
  test(`${c.id}: keeps other servers, backs up, is idempotent, and --remove restores`, async () => {
    const { env, home } = makeEnv();
    const file = c.file(home);
    const original = JSON.stringify({ theme: 'dark', [c.container]: { other: { command: 'other-mcp', args: ['--x'] } } }, null, 2) + '\n';
    write(file, original);

    const r1 = await connectAgents(env, { yes: true });
    const res = r1.results.find(r => r.client === c.id);
    assert.equal(res.status, 'needs_step', JSON.stringify(res));
    assert.ok(res.step);
    const after = json(file);
    assert.deepEqual(after[c.container].posteverywhere, c.value);
    assert.deepEqual(after[c.container].other, { command: 'other-mcp', args: ['--x'] });
    assert.equal(after.theme, 'dark');
    const backup = `${file}.bak-posteverywhere-${STAMP}`;
    assert.equal(read(backup), original, 'backup holds the original bytes');

    const firstWrite = read(file);
    const r2 = await connectAgents(env, { yes: true });
    assert.equal(r2.results.find(r => r.client === c.id).status, 'skipped');
    assert.equal(read(file), firstWrite, 'second run changes nothing');

    const r3 = await connectAgents(env, { yes: true, remove: true });
    assert.equal(r3.results.find(r => r.client === c.id).status, 'connected');
    assert.equal(read(file), original, 'remove restores the original file');
  });
}

test('creates a missing config file when the app is installed', async () => {
  const { env, home } = makeEnv();
  fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
  const rep = await connectAgents(env, { yes: true });
  assert.equal(rep.results.length, 1);
  assert.deepEqual(json(path.join(home, '.cursor', 'mcp.json')), { mcpServers: { posteverywhere: { url: MCP_URL } } });
  assert.deepEqual(rep.results[0].backups, [], 'nothing to back up for a new file');
});

test('zed: JSONC comments and trailing commas are kept', async () => {
  const { env, home } = makeEnv();
  const file = path.join(home, '.config', 'zed', 'settings.json');
  const original = `// Zed settings
//
// For information on how to configure Zed, see the Zed docs.
{
  "theme": "One Dark", // my theme
  /* block comment */
  "ui_font_size": 16,
}
`;
  write(file, original);
  await connectAgents(env, { clients: ['zed'] });
  const text = read(file);
  assert.ok(text.includes('// my theme'));
  assert.ok(text.includes('/* block comment */'));
  assert.ok(text.startsWith('// Zed settings'));
  assert.deepEqual(json(file).context_servers, { posteverywhere: { url: MCP_URL } });

  await connectAgents(env, { clients: ['zed'], remove: true });
  assert.equal(read(file), original);
});

test('a file that cannot be parsed is refused, not written, and a snippet is given', async () => {
  const { env, home } = makeEnv();
  const file = path.join(home, '.cursor', 'mcp.json');
  const broken = '{ "mcpServers": { "a": { "url": "x" } ';
  write(file, broken);
  const rep = await connectAgents(env, { yes: true });
  const r = rep.results[0];
  assert.equal(r.status, 'failed');
  assert.match(r.snippet, /"posteverywhere"/);
  assert.equal(read(file), broken);
  assert.equal(fs.existsSync(`${file}.bak-posteverywhere-${STAMP}`), false);
  assert.equal(rep.exit_code, 1, 'every target failed');
});

test('a container that is not an object is refused', () => {
  const r = setMember('{"mcpServers": []}', 'mcpServers', 'posteverywhere', { url: MCP_URL });
  assert.equal(r.kind, 'refused');
});

test('--dry-run writes nothing and runs nothing', async () => {
  const { env, home, calls } = makeEnv({ bins: ['claude', 'codex', 'gemini'] });
  const cursor = path.join(home, '.cursor', 'mcp.json');
  const original = '{\n  "mcpServers": {}\n}\n';
  write(cursor, original);
  fs.mkdirSync(path.join(home, '.config', 'zed'), { recursive: true });
  const before = snapshot(home);
  const rep = await connectAgents(env, { yes: true, dryRun: true });
  assert.equal(calls.length, 0);
  assert.deepEqual(snapshot(home), before);
  assert.ok(rep.results.every(r => r.status === 'planned'), JSON.stringify(rep.results));
  const cc = rep.results.find(r => r.client === 'claude-code');
  assert.deepEqual(cc.commands, [`claude mcp add --scope user --transport http posteverywhere ${MCP_URL}`]);
});

function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else out[p] = read(p);
    }
  };
  walk(dir);
  return out;
}

// ─── CLI-driven clients (subprocesses mocked) ────────────

test('claude-code: runs claude mcp add at user scope, skips when present, removes', async () => {
  const { env, home, calls } = makeEnv({ bins: ['claude'] });
  const rep = await connectAgents(env, { clients: ['claude-code'] });
  assert.deepEqual(calls[0], { cmd: 'claude', args: ['mcp', 'add', '--scope', 'user', '--transport', 'http', 'posteverywhere', MCP_URL], interactive: false });
  assert.equal(rep.results[0].status, 'needs_step');
  assert.match(rep.results[0].step, /\/mcp/);

  write(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { posteverywhere: { type: 'http', url: MCP_URL } } }));
  const again = await connectAgents(env, { clients: ['claude-code'] });
  assert.equal(again.results[0].status, 'skipped');
  assert.equal(calls.length, 1, 'no second add');

  const rm = await connectAgents(env, { clients: ['claude-code'], remove: true });
  assert.deepEqual(calls[1].args, ['mcp', 'remove', '--scope', 'user', 'posteverywhere']);
  assert.equal(rm.results[0].status, 'connected');
});

test('claude-code: "already exists" from the CLI counts as skipped', async () => {
  const { env } = makeEnv({ bins: ['claude'], responses: { 'claude mcp add': { code: 1, stdout: '', stderr: 'MCP server posteverywhere already exists in user config' } } });
  const rep = await connectAgents(env, { clients: ['claude-code'] });
  assert.equal(rep.results[0].status, 'skipped');
});

test('codex: add then browser login when interactive', async () => {
  const { env, calls } = makeEnv({ bins: ['codex'] });
  const rep = await connectAgents(env, { clients: ['codex'], interactive: true, yes: true });
  assert.deepEqual(calls.map(c => [c.cmd, ...c.args]), [
    ['codex', 'mcp', 'add', 'posteverywhere', '--url', MCP_URL],
    ['codex', 'mcp', 'login', 'posteverywhere'],
  ]);
  assert.equal(calls[1].interactive, true);
  assert.equal(rep.results[0].status, 'connected');
});

test('codex: non-interactive leaves login as the next step', async () => {
  const { env, calls } = makeEnv({ bins: ['codex'] });
  const rep = await connectAgents(env, { clients: ['codex'] });
  assert.equal(calls.length, 1);
  assert.equal(rep.results[0].status, 'needs_step');
  assert.equal(rep.results[0].step, 'Run: codex mcp login posteverywhere');
});

test('codex without the CLI: edits config.toml, idempotent, remove restores', async () => {
  const { env, home } = makeEnv();
  const toml = path.join(home, '.codex', 'config.toml');
  const original = 'model = "gpt-5"\n\n[mcp_servers.other]\ncommand = "x"\n';
  write(toml, original);
  const rep = await connectAgents(env, { yes: true });
  assert.equal(rep.results[0].client, 'codex');
  assert.match(read(toml), /\[mcp_servers\.posteverywhere\]\nurl = "https:\/\/mcp\.posteverywhere\.ai"/);
  assert.ok(read(toml).includes('[mcp_servers.other]'));
  assert.equal(read(`${toml}.bak-posteverywhere-${STAMP}`), original);
  const second = read(toml);
  await connectAgents(env, { yes: true });
  assert.equal(read(toml), second);
  await connectAgents(env, { yes: true, remove: true });
  assert.equal(read(toml), original);
});

test('removeTomlTable drops our sub-tables too', () => {
  const t = 'a = 1\n\n[mcp_servers.posteverywhere]\nurl = "u"\n\n[mcp_servers.posteverywhere.env]\nX = "1"\n\n[other]\nb = 2\n';
  assert.equal(removeTomlTable(t), 'a = 1\n\n[other]\nb = 2\n');
});

test('gemini: uses the CLI at user scope, then /mcp auth', async () => {
  const { env, calls } = makeEnv({ bins: ['gemini'] });
  const rep = await connectAgents(env, { clients: ['gemini'] });
  assert.deepEqual(calls[0].args, ['mcp', 'add', '--scope', 'user', '--transport', 'http', 'posteverywhere', MCP_URL]);
  assert.equal(rep.results[0].step, 'In Gemini CLI, run: /mcp auth posteverywhere');
});

test('claude-desktop: no file edits, just the connector step', async () => {
  const { env, home } = makeEnv();
  const cfg = path.join(home, '.config', 'Claude', 'claude_desktop_config.json');
  write(cfg, '{"mcpServers":{}}');
  const rep = await connectAgents(env, { yes: true });
  const r = rep.results.find(x => x.client === 'claude-desktop');
  assert.equal(r.status, 'needs_step');
  assert.match(r.step, /Settings -> Connectors -> Add custom connector/);
  assert.equal(read(cfg), '{"mcpServers":{}}');
});

test('nothing detected and nothing chosen: exit 0', async () => {
  const { env } = makeEnv();
  const rep = await connectAgents(env, { yes: true });
  assert.equal(rep.results.length, 0);
  assert.equal(rep.exit_code, 0);
});

test('unknown --client is an error', async () => {
  const { env } = makeEnv();
  await assert.rejects(connectAgents(env, { clients: ['notepad'] }), /Unknown client/);
});

test('interactive checklist: detected clients are pre-ticked and can be toggled', async () => {
  const { env, home } = makeEnv();
  fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
  fs.mkdirSync(path.join(home, '.codeium', 'windsurf'), { recursive: true });
  const answers = ['4', '']; // untick Windsurf (4th in the list), then accept
  env.prompt = async () => answers.shift();
  const rep = await connectAgents(env, { interactive: true });
  assert.deepEqual(rep.results.map(r => r.client), ['cursor']);
});

// ─── JSONC editor edge cases ─────────────────────────────

test('jsonc: insert into an empty object and remove again', () => {
  const t = '{\n  "mcpServers": {}\n}\n';
  const a = setMember(t, 'mcpServers', 'posteverywhere', { url: MCP_URL });
  assert.equal(a.kind, 'changed');
  assert.deepEqual(parseJsonc(a.text).value, { mcpServers: { posteverywhere: { url: MCP_URL } } });
  const b = removeMember(a.text, 'mcpServers', 'posteverywhere');
  assert.deepEqual(parseJsonc(b.text).value, {});
});

test('jsonc: replaces an outdated entry in place', () => {
  const t = '{\n  "mcpServers": {\n    "posteverywhere": { "command": "npx", "args": ["-y", "@posteverywhere/mcp"] },\n    "b": {}\n  }\n}\n';
  const a = setMember(t, 'mcpServers', 'posteverywhere', { url: MCP_URL });
  assert.deepEqual(parseJsonc(a.text).value, { mcpServers: { posteverywhere: { url: MCP_URL }, b: {} } });
});

test('jsonc: removing the last member keeps a comment after the previous comma', () => {
  const t = '{\n  "a": 1, // keep me\n  "posteverywhere": { "url": "u" }\n}\n';
  const wrapped = `{\n  "mcpServers": ${t.trim().split('\n').join('\n  ')}\n}\n`;
  const r = removeMember(wrapped, 'mcpServers', 'posteverywhere');
  assert.equal(r.kind, 'changed');
  assert.ok(r.text.includes('// keep me'));
  assert.deepEqual(parseJsonc(r.text).value, { mcpServers: { a: 1 } });
});
