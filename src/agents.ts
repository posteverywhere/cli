/**
 * `posteverywhere connect` (no platform): connect every coding agent on this
 * machine to the hosted PostEverywhere MCP server in one go.
 *
 * The hosted server does OAuth itself, so no API key is ever written. Each
 * client gets the remote URL in the shape its own docs describe; the user then
 * signs in once inside that client.
 *
 * Everything that touches the outside world (home dir, PATH lookups, child
 * processes, prompts, clock) comes through `AgentEnv`, so tests can run the
 * whole flow against a temp HOME with mocked CLIs.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import readline from 'node:readline';
import { parseJsonc, setMember, removeMember } from './jsonc.js';

export const MCP_URL = 'https://mcp.posteverywhere.ai';
export const SERVER_NAME = 'posteverywhere';

export interface RunResult { code: number; stdout: string; stderr: string }

export interface AgentEnv {
  home: string;
  platform: NodeJS.Platform;
  /** %APPDATA% on Windows. */
  appData: string;
  /** $XDG_CONFIG_HOME or ~/.config. */
  xdgConfig: string;
  /** $CODEX_HOME or ~/.codex. */
  codexHome: string;
  which(cmd: string): string | null;
  /** interactive: inherit the terminal (for browser logins). */
  run(cmd: string, args: string[], opts?: { interactive?: boolean }): RunResult;
  prompt(question: string): Promise<string>;
  now(): Date;
}

export function realEnv(): AgentEnv {
  const home = os.homedir();
  const platform = process.platform;
  return {
    home,
    platform,
    appData: process.env.APPDATA || path.join(home, 'AppData', 'Roaming'),
    xdgConfig: process.env.XDG_CONFIG_HOME || path.join(home, '.config'),
    codexHome: process.env.CODEX_HOME || path.join(home, '.codex'),
    which(cmd) {
      const exts = platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
      for (const dir of (process.env.PATH || '').split(path.delimiter)) {
        if (!dir) continue;
        for (const ext of exts) {
          const p = path.join(dir, cmd + ext);
          try { if (fs.statSync(p).isFile()) return p; } catch { /* keep looking */ }
        }
      }
      return null;
    },
    run(cmd, args, opts = {}) {
      const r = spawnSync(cmd, args, {
        stdio: opts.interactive ? 'inherit' : 'pipe',
        encoding: 'utf8',
        shell: platform === 'win32', // claude/codex/gemini are .cmd shims on Windows
        timeout: opts.interactive ? 10 * 60 * 1000 : 60 * 1000,
      });
      return {
        code: r.status ?? (r.error ? 127 : 1),
        stdout: String(r.stdout || ''),
        stderr: String(r.stderr || (r.error ? r.error.message : '')),
      };
    },
    prompt(question) {
      return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(question, (a) => { rl.close(); resolve(a); });
      });
    },
    now: () => new Date(),
  };
}

// ─── result model ─────────────────────────────────────────

export type Status = 'connected' | 'needs_step' | 'skipped' | 'failed' | 'planned';

export interface ClientResult {
  client: ClientId;
  name: string;
  status: Status;
  /** What the user must still do (needs_step), or why it was skipped or failed. */
  step?: string;
  reason?: string;
  files?: string[];
  backups?: string[];
  commands?: string[];
  /** Planned changes (dry run). */
  plan?: string[];
  /** Config to paste by hand when a file could not be edited safely. */
  snippet?: string;
}

export const CLIENT_IDS = ['claude-code', 'claude-desktop', 'cursor', 'windsurf', 'cline', 'zed', 'codex', 'gemini'] as const;
export type ClientId = typeof CLIENT_IDS[number];

export const CLIENT_NAMES: Record<ClientId, string> = {
  'claude-code': 'Claude Code',
  'claude-desktop': 'Claude Desktop',
  cursor: 'Cursor',
  windsurf: 'Windsurf',
  cline: 'Cline',
  zed: 'Zed',
  codex: 'Codex CLI',
  gemini: 'Gemini CLI',
};

interface Ctx {
  env: AgentEnv;
  mode: 'add' | 'remove';
  dryRun: boolean;
  /** Run browser logins in this terminal (TTY, not --json). */
  interactive: boolean;
  backedUp: Set<string>;
  stamp: string;
}

const exists = (p: string) => { try { fs.statSync(p); return true; } catch { return false; } };

// ─── per-client paths ─────────────────────────────────────

function claudeDesktopDir(env: AgentEnv) {
  if (env.platform === 'darwin') return path.join(env.home, 'Library', 'Application Support', 'Claude');
  if (env.platform === 'win32') return path.join(env.appData, 'Claude');
  return path.join(env.xdgConfig, 'Claude');
}

function vscodeUserDirs(env: AgentEnv): string[] {
  const editors = ['Code', 'Code - Insiders'];
  const base = env.platform === 'darwin' ? path.join(env.home, 'Library', 'Application Support')
    : env.platform === 'win32' ? env.appData
    : env.xdgConfig;
  return editors.map(e => path.join(base, e, 'User'));
}

/** Each entry: the file we edit, and the directory whose presence means "installed". */
function fileTargets(env: AgentEnv, id: ClientId): { file: string; marker: string }[] {
  switch (id) {
    case 'cursor':
      return [{ file: path.join(env.home, '.cursor', 'mcp.json'), marker: path.join(env.home, '.cursor') }];
    case 'windsurf': {
      // Windsurf is now also shipped as Devin Desktop, which reads its own file.
      const devinDir = env.platform === 'win32' ? path.join(env.appData, 'devin') : path.join(env.xdgConfig, 'devin');
      return [
        { file: path.join(env.home, '.codeium', 'windsurf', 'mcp_config.json'), marker: path.join(env.home, '.codeium', 'windsurf') },
        { file: path.join(devinDir, 'mcp_config.json'), marker: devinDir },
      ];
    }
    case 'cline':
      return [
        ...vscodeUserDirs(env).map(u => {
          const ext = path.join(u, 'globalStorage', 'saoudrizwan.claude-dev');
          return { file: path.join(ext, 'settings', 'cline_mcp_settings.json'), marker: ext };
        }),
        { file: path.join(env.home, '.cline', 'mcp.json'), marker: path.join(env.home, '.cline') },
      ];
    case 'zed': {
      const dir = env.platform === 'win32' ? path.join(env.appData, 'Zed') : path.join(env.xdgConfig, 'zed');
      return [{ file: path.join(dir, 'settings.json'), marker: dir }];
    }
    case 'gemini':
      return [{ file: path.join(env.home, '.gemini', 'settings.json'), marker: path.join(env.home, '.gemini', 'settings.json') }];
    default:
      return [];
  }
}

const ENTRY: Partial<Record<ClientId, { container: string; value: Record<string, string> }>> = {
  cursor: { container: 'mcpServers', value: { url: MCP_URL } },
  windsurf: { container: 'mcpServers', value: { serverUrl: MCP_URL } },
  cline: { container: 'mcpServers', value: { url: MCP_URL, type: 'streamableHttp' } },
  zed: { container: 'context_servers', value: { url: MCP_URL } },
  gemini: { container: 'mcpServers', value: { httpUrl: MCP_URL } },
};

const NEXT_STEP: Partial<Record<ClientId, string>> = {
  'claude-code': 'In Claude Code, run /mcp, pick posteverywhere, then choose Authenticate.',
  cursor: 'Restart Cursor, then open Cursor Settings -> MCP and sign in to posteverywhere when asked.',
  windsurf: 'Restart Windsurf, then sign in to posteverywhere when asked.',
  cline: 'In VS Code, open Cline -> MCP Servers and click Authenticate on posteverywhere.',
  zed: 'Open the Agent Panel in Zed and sign in to posteverywhere when asked.',
  codex: 'Run: codex mcp login posteverywhere',
  gemini: 'In Gemini CLI, run: /mcp auth posteverywhere',
  'claude-desktop': `Open Claude Desktop -> Settings -> Connectors -> Add custom connector, and paste ${MCP_URL}`,
};

// ─── detection ────────────────────────────────────────────

export interface Detection { client: ClientId; name: string; detected: boolean; via?: string }

export function detectClients(env: AgentEnv): Detection[] {
  return CLIENT_IDS.map((client) => {
    let via: string | undefined;
    if (client === 'claude-code') via = env.which('claude') ? 'claude on PATH' : undefined;
    else if (client === 'codex') via = env.which('codex') ? 'codex on PATH' : exists(path.join(env.codexHome, 'config.toml')) ? path.join(env.codexHome, 'config.toml') : undefined;
    else if (client === 'gemini') via = env.which('gemini') ? 'gemini on PATH' : exists(path.join(env.home, '.gemini', 'settings.json')) ? path.join(env.home, '.gemini', 'settings.json') : undefined;
    else if (client === 'claude-desktop') {
      const dir = claudeDesktopDir(env);
      via = exists(path.join(dir, 'claude_desktop_config.json')) ? path.join(dir, 'claude_desktop_config.json') : exists(dir) ? dir : undefined;
    } else {
      const hit = fileTargets(env, client).find(t => exists(t.file) || exists(t.marker));
      via = hit ? (exists(hit.file) ? hit.file : hit.marker) : undefined;
    }
    return { client, name: CLIENT_NAMES[client], detected: !!via, via };
  });
}

// ─── file edits ───────────────────────────────────────────

interface FileEdit { file: string; outcome: 'changed' | 'unchanged' | 'refused'; reason?: string; backup?: string; plan?: string }

function backupOnce(ctx: Ctx, file: string): string | undefined {
  if (ctx.backedUp.has(file) || !exists(file)) return undefined;
  const dest = `${file}.bak-posteverywhere-${ctx.stamp}`;
  fs.copyFileSync(file, dest);
  ctx.backedUp.add(file);
  return dest;
}

function editJson(ctx: Ctx, file: string, container: string, value: Record<string, string>): FileEdit {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (e: any) {
    if (e?.code !== 'ENOENT') return { file, outcome: 'refused', reason: `could not read the file (${e?.message || e})` };
    if (ctx.mode === 'remove') return { file, outcome: 'unchanged' };
  }
  const r = ctx.mode === 'add' ? setMember(text, container, SERVER_NAME, value) : removeMember(text, container, SERVER_NAME);
  if (r.kind === 'refused') return { file, outcome: 'refused', reason: r.reason };
  if (r.kind === 'unchanged') return { file, outcome: 'unchanged' };
  const plan = ctx.mode === 'add'
    ? `${exists(file) ? 'Edit' : 'Create'} ${file}: set ${container}.${SERVER_NAME} = ${JSON.stringify(value)}`
    : `Edit ${file}: remove ${container}.${SERVER_NAME}`;
  if (ctx.dryRun) return { file, outcome: 'changed', plan };
  try {
    const backup = backupOnce(ctx, file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, r.text);
    return { file, outcome: 'changed', backup, plan };
  } catch (e: any) {
    return { file, outcome: 'refused', reason: `could not write the file (${e?.message || e})` };
  }
}

function snippetFor(container: string, value: Record<string, string>) {
  return JSON.stringify({ [container]: { [SERVER_NAME]: value } }, null, 2);
}

function fileClient(ctx: Ctx, id: ClientId, base: ClientResult): ClientResult {
  const entry = ENTRY[id]!;
  const targets = fileTargets(ctx.env, id);
  // Prefer installs that exist; with none (explicit --client), use the first path.
  let chosen = targets.filter(t => exists(t.file) || exists(t.marker));
  if (!chosen.length) chosen = ctx.mode === 'add' ? targets.slice(0, 1) : [];
  if (!chosen.length) return { ...base, status: 'skipped', reason: 'not installed' };

  const edits = chosen.map(t => editJson(ctx, t.file, entry.container, entry.value));
  const changed = edits.filter(e => e.outcome === 'changed');
  const refused = edits.filter(e => e.outcome === 'refused');
  const res: ClientResult = {
    ...base,
    files: changed.map(e => e.file),
    backups: changed.map(e => e.backup).filter((b): b is string => !!b),
  };
  if (refused.length) {
    res.snippet = snippetFor(entry.container, entry.value);
    res.reason = refused.map(e => `${e.file}: ${e.reason}. Not changed.`).join(' ');
  }
  if (ctx.dryRun) {
    res.plan = changed.map(e => e.plan!);
    if (!changed.length && !refused.length) return { ...res, status: 'skipped', reason: ctx.mode === 'add' ? 'already set up' : 'nothing to remove' };
    return { ...res, status: changed.length ? 'planned' : 'failed' };
  }
  if (changed.length) {
    return { ...res, status: ctx.mode === 'add' ? 'needs_step' : 'connected', step: ctx.mode === 'add' ? NEXT_STEP[id] : undefined };
  }
  if (refused.length) return { ...res, status: 'failed', step: `Add this to ${refused[0].file} by hand:\n${res.snippet}` };
  return { ...res, status: 'skipped', reason: ctx.mode === 'add' ? 'already set up' : 'nothing to remove' };
}

// ─── CLI-driven clients ───────────────────────────────────

function readJsonQuiet(file: string): any {
  try { return parseJsonc(fs.readFileSync(file, 'utf8')).value; } catch { return undefined; }
}

function cmdLine(cmd: string, args: string[]) { return [cmd, ...args].join(' '); }

function runCmd(ctx: Ctx, res: ClientResult, cmd: string, args: string[], interactive = false): RunResult | null {
  (res.commands ||= []).push(cmdLine(cmd, args));
  if (ctx.dryRun) { (res.plan ||= []).push(`Run: ${cmdLine(cmd, args)}`); return null; }
  return ctx.env.run(cmd, args, { interactive });
}

const outputOf = (r: RunResult) => `${r.stderr}\n${r.stdout}`.trim();

function claudeCode(ctx: Ctx, base: ClientResult): ClientResult {
  const res: ClientResult = { ...base };
  if (!ctx.env.which('claude')) return { ...res, status: 'skipped', reason: 'the claude command was not found on PATH' };
  const userCfg = readJsonQuiet(path.join(ctx.env.home, '.claude.json'));
  const present = !!userCfg?.mcpServers?.[SERVER_NAME];
  if (ctx.mode === 'add') {
    if (present) return { ...res, status: 'skipped', reason: 'already added. If you have not signed in yet, run /mcp in Claude Code and choose Authenticate.' };
    const r = runCmd(ctx, res, 'claude', ['mcp', 'add', '--scope', 'user', '--transport', 'http', SERVER_NAME, MCP_URL]);
    if (!r) return { ...res, status: 'planned' };
    if (r.code === 0) return { ...res, status: 'needs_step', step: NEXT_STEP['claude-code'] };
    if (/already exists/i.test(outputOf(r))) return { ...res, status: 'skipped', reason: 'already added' };
    return { ...res, status: 'failed', reason: outputOf(r) || `claude exited with code ${r.code}` };
  }
  if (!present) return { ...res, status: 'skipped', reason: 'nothing to remove' };
  const r = runCmd(ctx, res, 'claude', ['mcp', 'remove', '--scope', 'user', SERVER_NAME]);
  if (!r) return { ...res, status: 'planned' };
  if (r.code === 0) return { ...res, status: 'connected' };
  if (/not found|no mcp server/i.test(outputOf(r))) return { ...res, status: 'skipped', reason: 'nothing to remove' };
  return { ...res, status: 'failed', reason: outputOf(r) || `claude exited with code ${r.code}` };
}

const TOML_HEADER = /^[ \t]*\[mcp_servers\.(?:posteverywhere|"posteverywhere")\][ \t]*(?:#.*)?$/m;

function codex(ctx: Ctx, base: ClientResult): ClientResult {
  const res: ClientResult = { ...base };
  const tomlPath = path.join(ctx.env.codexHome, 'config.toml');
  let toml = '';
  try { toml = fs.readFileSync(tomlPath, 'utf8'); } catch { /* no config yet */ }
  const present = TOML_HEADER.test(toml);
  const hasCli = !!ctx.env.which('codex');

  if (ctx.mode === 'add') {
    if (present) return { ...res, status: 'skipped', reason: 'already added. If you have not signed in yet, run: codex mcp login posteverywhere' };
    if (hasCli) {
      const r = runCmd(ctx, res, 'codex', ['mcp', 'add', SERVER_NAME, '--url', MCP_URL]);
      if (!r) { runCmd(ctx, res, 'codex', ['mcp', 'login', SERVER_NAME], true); return { ...res, status: 'planned' }; }
      if (r.code !== 0) {
        if (/already exists/i.test(outputOf(r))) return { ...res, status: 'skipped', reason: 'already added' };
        return { ...res, status: 'failed', reason: outputOf(r) || `codex exited with code ${r.code}` };
      }
      if (!ctx.interactive) return { ...res, status: 'needs_step', step: NEXT_STEP.codex };
      const login = runCmd(ctx, res, 'codex', ['mcp', 'login', SERVER_NAME], true)!;
      return login.code === 0 ? { ...res, status: 'connected' } : { ...res, status: 'needs_step', step: NEXT_STEP.codex };
    }
    // No codex binary: write config.toml directly.
    const block = `[mcp_servers.${SERVER_NAME}]\nurl = "${MCP_URL}"\n`;
    const next = (toml && !toml.endsWith('\n') ? toml + '\n' : toml) + (toml.trim() ? '\n' : '') + block;
    res.plan = [`${toml ? 'Edit' : 'Create'} ${tomlPath}: add [mcp_servers.${SERVER_NAME}] url = "${MCP_URL}"`];
    if (ctx.dryRun) return { ...res, status: 'planned' };
    const backup = backupOnce(ctx, tomlPath);
    fs.mkdirSync(path.dirname(tomlPath), { recursive: true });
    fs.writeFileSync(tomlPath, next);
    return { ...res, status: 'needs_step', step: NEXT_STEP.codex, files: [tomlPath], backups: backup ? [backup] : [] };
  }

  if (!present) return { ...res, status: 'skipped', reason: 'nothing to remove' };
  if (hasCli) {
    const r = runCmd(ctx, res, 'codex', ['mcp', 'remove', SERVER_NAME]);
    if (!r) return { ...res, status: 'planned' };
    return r.code === 0 ? { ...res, status: 'connected' } : { ...res, status: 'failed', reason: outputOf(r) || `codex exited with code ${r.code}` };
  }
  const next = removeTomlTable(toml);
  res.plan = [`Edit ${tomlPath}: remove [mcp_servers.${SERVER_NAME}]`];
  if (ctx.dryRun) return { ...res, status: 'planned' };
  const backup = backupOnce(ctx, tomlPath);
  fs.writeFileSync(tomlPath, next);
  return { ...res, status: 'connected', files: [tomlPath], backups: backup ? [backup] : [] };
}

/** Remove [mcp_servers.posteverywhere] and its sub-tables, up to the next other table. */
export function removeTomlTable(toml: string): string {
  const lines = toml.split('\n');
  const out: string[] = [];
  let inOurs = false;
  for (const line of lines) {
    const header = /^[ \t]*\[\[?([^\]]+)\]\]?/.exec(line);
    if (header) {
      const name = header[1].trim().replace(/"/g, '');
      const wasOurs = inOurs;
      inOurs =name === `mcp_servers.${SERVER_NAME}` || name.startsWith(`mcp_servers.${SERVER_NAME}.`);
      if (inOurs) {
        // Also drop the single blank line we added before the table.
        if (out.length && out[out.length - 1].trim() === '') out.pop();
        continue;
      }
      // Keep one blank line between the table before ours and the one after.
      if (wasOurs && out.length && out[out.length - 1].trim() !== '') out.push('');
    }
    if (!inOurs) out.push(line);
  }
  let res = out.join('\n');
  if (toml.endsWith('\n') && !res.endsWith('\n')) res += '\n';
  return res;
}

function gemini(ctx: Ctx, base: ClientResult): ClientResult {
  const res: ClientResult = { ...base };
  const settings = path.join(ctx.env.home, '.gemini', 'settings.json');
  const present = !!readJsonQuiet(settings)?.mcpServers?.[SERVER_NAME];
  if (!ctx.env.which('gemini')) {
    // No CLI on PATH: edit ~/.gemini/settings.json directly.
    const r = fileClient(ctx, 'gemini', base);
    return r.status === 'connected' || r.status === 'needs_step'
      ? { ...r, status: ctx.mode === 'add' ? 'needs_step' : 'connected' } : r;
  }
  if (ctx.mode === 'add') {
    if (present) return { ...res, status: 'skipped', reason: 'already added. If you have not signed in yet, run /mcp auth posteverywhere in Gemini CLI.' };
    const r = runCmd(ctx, res, 'gemini', ['mcp', 'add', '--scope', 'user', '--transport', 'http', SERVER_NAME, MCP_URL]);
    if (!r) return { ...res, status: 'planned' };
    if (r.code === 0) return { ...res, status: 'needs_step', step: NEXT_STEP.gemini };
    if (/already exists/i.test(outputOf(r))) return { ...res, status: 'skipped', reason: 'already added' };
    return { ...res, status: 'failed', reason: outputOf(r) || `gemini exited with code ${r.code}` };
  }
  if (!present) return { ...res, status: 'skipped', reason: 'nothing to remove' };
  const r = runCmd(ctx, res, 'gemini', ['mcp', 'remove', '--scope', 'user', SERVER_NAME]);
  if (!r) return { ...res, status: 'planned' };
  return r.code === 0 ? { ...res, status: 'connected' } : { ...res, status: 'failed', reason: outputOf(r) || `gemini exited with code ${r.code}` };
}

function claudeDesktop(ctx: Ctx, base: ClientResult): ClientResult {
  // Claude Desktop adds remote servers as a Connector inside the app, not via
  // claude_desktop_config.json (that file is for local servers only).
  if (ctx.mode === 'add') {
    if (ctx.dryRun) return { ...base, status: 'planned', plan: [`Show the step: ${NEXT_STEP['claude-desktop']}`] };
    return { ...base, status: 'needs_step', step: NEXT_STEP['claude-desktop'] };
  }
  const step = 'Open Claude Desktop -> Settings -> Connectors, choose PostEverywhere, then Remove.';
  if (ctx.dryRun) return { ...base, status: 'planned', plan: [`Show the step: ${step}`] };
  return { ...base, status: 'needs_step', step };
}

// ─── orchestration ────────────────────────────────────────

export interface ConnectOptions {
  remove?: boolean;
  dryRun?: boolean;
  all?: boolean;
  yes?: boolean;
  clients?: string[];
  /** Can we prompt and run browser logins in this terminal? */
  interactive?: boolean;
}

export interface ConnectReport {
  mode: 'add' | 'remove';
  dry_run: boolean;
  url: string;
  detected: Detection[];
  results: ClientResult[];
  exit_code: number;
}

export function parseClientList(list: string[]): { ids: ClientId[]; unknown: string[] } {
  const aliases: Record<string, ClientId> = {
    claude: 'claude-code', claudecode: 'claude-code', 'claude-code': 'claude-code',
    'claude-desktop': 'claude-desktop', claudedesktop: 'claude-desktop', desktop: 'claude-desktop',
    cursor: 'cursor', windsurf: 'windsurf', devin: 'windsurf', cline: 'cline', zed: 'zed',
    codex: 'codex', 'codex-cli': 'codex', gemini: 'gemini', 'gemini-cli': 'gemini',
  };
  const ids: ClientId[] = [];
  const unknown: string[] = [];
  for (const raw of list) {
    const id = aliases[raw.trim().toLowerCase()];
    if (id) { if (!ids.includes(id)) ids.push(id); } else if (raw.trim()) unknown.push(raw.trim());
  }
  return { ids, unknown };
}

export async function chooseClients(env: AgentEnv, detected: Detection[], mode: 'add' | 'remove', print: (s: string) => void): Promise<ClientId[]> {
  const ticked = new Set(detected.filter(d => d.detected).map(d => d.client));
  for (;;) {
    print('');
    print(mode === 'add' ? 'Connect PostEverywhere to these coding agents:' : 'Remove PostEverywhere from these coding agents:');
    detected.forEach((d, i) => {
      print(`  ${i + 1}. [${ticked.has(d.client) ? 'x' : ' '}] ${d.name}${d.detected ? '' : '  (not found)'}`);
    });
    const a = (await env.prompt('Press Enter to continue, or type numbers to toggle (e.g. 2,4), "a" for all, "n" for none, "q" to quit: ')).trim().toLowerCase();
    if (a === '') return CLIENT_IDS.filter(c => ticked.has(c));
    if (a === 'q') return [];
    if (a === 'a') { detected.forEach(d => ticked.add(d.client)); continue; }
    if (a === 'n') { ticked.clear(); continue; }
    for (const part of a.split(/[\s,]+/)) {
      const d = detected[Number(part) - 1];
      if (d) { if (ticked.has(d.client)) ticked.delete(d.client); else ticked.add(d.client); }
    }
  }
}

export async function connectAgents(env: AgentEnv, opts: ConnectOptions, print: (s: string) => void = () => {}): Promise<ConnectReport> {
  const mode = opts.remove ? 'remove' : 'add';
  const detected = detectClients(env);
  let selected: ClientId[];
  if (opts.clients && opts.clients.length) {
    const { ids, unknown } = parseClientList(opts.clients);
    if (unknown.length) throw new Error(`Unknown client: ${unknown.join(', ')}. Known: ${CLIENT_IDS.join(', ')}`);
    selected = ids;
  } else if (opts.all || opts.yes || !opts.interactive) {
    selected = detected.filter(d => d.detected).map(d => d.client);
  } else {
    selected = await chooseClients(env, detected, mode, print);
  }

  const ctx: Ctx = {
    env, mode,
    dryRun: !!opts.dryRun,
    interactive: !!opts.interactive,
    backedUp: new Set(),
    stamp: env.now().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'),
  };

  const results: ClientResult[] = [];
  for (const id of selected) {
    const base: ClientResult = { client: id, name: CLIENT_NAMES[id], status: 'skipped' };
    let r: ClientResult;
    try {
      if (id === 'claude-code') r = claudeCode(ctx, base);
      else if (id === 'claude-desktop') r = claudeDesktop(ctx, base);
      else if (id === 'codex') r = codex(ctx, base);
      else if (id === 'gemini') r = gemini(ctx, base);
      else r = fileClient(ctx, id, base);
    } catch (e: any) {
      r = { ...base, status: 'failed', reason: e?.message || String(e) };
    }
    results.push(r);
  }

  const failed = results.filter(r => r.status === 'failed').length;
  return {
    mode,
    dry_run: ctx.dryRun,
    url: MCP_URL,
    detected,
    results,
    exit_code: results.length > 0 && failed === results.length ? 1 : 0,
  };
}

export function formatReport(rep: ConnectReport): string {
  const lines: string[] = [];
  const by = (s: Status) => rep.results.filter(r => r.status === s);
  if (!rep.results.length) {
    lines.push('No coding agents selected.');
    lines.push(`Supported: ${CLIENT_IDS.join(', ')}. Pick one with --client, e.g. --client cursor`);
    return lines.join('\n');
  }
  if (rep.dry_run) {
    lines.push('Dry run. Nothing was changed. Planned changes:');
    for (const r of rep.results) {
      lines.push(`  ${r.name}:`);
      if (r.plan?.length) r.plan.forEach(p => lines.push(`    - ${p}`));
      else lines.push(`    - ${r.status === 'failed' ? 'cannot change' : 'skip'}${r.reason ? ` (${r.reason})` : ''}`);
      if (r.snippet) lines.push(`    Add by hand instead:\n${indent(r.snippet, 6)}`);
    }
    return lines.join('\n');
  }
  const done = by('connected');
  const steps = by('needs_step');
  const skipped = by('skipped');
  const failed = by('failed');
  const verbDone = rep.mode === 'add' ? 'Connected' : 'Removed';
  lines.push('');
  if (done.length) {
    lines.push(`${verbDone}:`);
    done.forEach(r => lines.push(`  - ${r.name}${r.files?.length ? ` (${r.files.join(', ')})` : ''}`));
  }
  if (steps.length) {
    lines.push('Needs one more step:');
    steps.forEach(r => lines.push(`  - ${r.name}: ${r.step}`));
  }
  if (skipped.length) {
    lines.push('Skipped:');
    skipped.forEach(r => lines.push(`  - ${r.name}${r.reason ? `: ${r.reason}` : ''}`));
  }
  if (failed.length) {
    lines.push('Failed:');
    failed.forEach(r => {
      lines.push(`  - ${r.name}${r.reason ? `: ${r.reason}` : ''}`);
      if (r.snippet) lines.push(`    Add this by hand:\n${indent(r.snippet, 6)}`);
    });
  }
  const backups = rep.results.flatMap(r => r.backups || []);
  if (backups.length) {
    lines.push('Backups:');
    backups.forEach(b => lines.push(`  - ${b}`));
  }
  if (rep.mode === 'add' && (done.length || steps.length)) {
    lines.push('');
    lines.push('Try asking your agent: list my PostEverywhere accounts');
  }
  return lines.join('\n');
}

function indent(s: string, n: number) { return s.split('\n').map(l => ' '.repeat(n) + l).join('\n'); }
