#!/usr/bin/env node
/**
 * posteverywhere — the PostEverywhere CLI.
 *
 * Log in once (`posteverywhere login`), connect accounts, and post/schedule to
 * Instagram, TikTok, YouTube, LinkedIn, Facebook, X, Threads, Pinterest,
 * Bluesky, Telegram & Discord — all from your terminal.
 *
 * Agent-friendly: pass --json (or pipe to a non-TTY) and every command emits
 * structured JSON so Claude, Cursor, OpenClaw etc. can parse results.
 *
 * Auth resolves from (1) POSTEVERYWHERE_API_KEY, else (2) the key saved by
 * `posteverywhere login` at ~/.posteverywhere/config.json (chmod 600).
 *
 * Zero runtime dependencies — pure Node (>=18) so `npx posteverywhere-cli`
 * is instant and adds no supply-chain surface.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';

const BASE = (process.env.POSTEVERYWHERE_API_URL || process.env.POSTEVERYWHERE_BASE_URL || 'https://app.posteverywhere.ai').replace(/\/$/, '');
const VERSION = '0.4.0'; // keep in sync with package.json — sent as User-Agent so the API can attribute CLI usage
const CONFIG_DIR = path.join(os.homedir(), '.posteverywhere');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const WANT_JSON = process.argv.includes('--json') || !process.stdout.isTTY;
const TTY = !!process.stdout.isTTY;

// ─── output ──────────────────────────────────────────────
const C = { reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m' };
const paint = (s: string, code: string) => (TTY ? `${code}${s}${C.reset}` : s);
function outJson(data: unknown) { process.stdout.write(JSON.stringify(data, null, 2) + '\n'); }
function say(msg = '') { process.stdout.write(msg + '\n'); }
function fail(message: string, code = 1): never {
  if (WANT_JSON) process.stderr.write(JSON.stringify({ error: message }) + '\n');
  else process.stderr.write(paint('✖ ' + message, C.red) + '\n');
  process.exit(code);
}

// ─── config / auth ───────────────────────────────────────
interface Config { api_key?: string; email?: string; organization_id?: string }
function loadConfig(): Config { try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return {}; } }
function saveConfig(cfg: Config) {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
    try { fs.chmodSync(CONFIG_PATH, 0o600); } catch { /* best effort on non-POSIX */ }
  } catch (e) { fail(`Could not save credentials to ${CONFIG_PATH}: ${e instanceof Error ? e.message : String(e)}`); }
}
function resolveKey(): string { return process.env.POSTEVERYWHERE_API_KEY || loadConfig().api_key || ''; }

// ─── http ────────────────────────────────────────────────
async function raw(method: string, p: string, body?: unknown, key?: string): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': `posteverywhere-cli/${VERSION}` };
  if (key) headers.Authorization = `Bearer ${key}`;
  if (body) headers['Content-Type'] = 'application/json';
  let resp: Response;
  try {
    resp = await fetch(`${BASE}${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch (e) {
    return fail(`Network error reaching ${BASE}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const json = await resp.json().catch(() => ({}));
  return { status: resp.status, json };
}

// Authenticated v1 call — unwraps {data,error}; fails cleanly on error.
async function api<T = any>(method: string, p: string, body?: unknown): Promise<T> {
  const key = resolveKey();
  if (!key || !key.startsWith('pe_live_')) {
    fail('Not logged in. Run `posteverywhere login` (or set POSTEVERYWHERE_API_KEY=pe_live_...).');
  }
  const { json } = await raw(method, `/api/v1${p}`, body, key);
  if (json?.error) fail(typeof json.error === 'string' ? json.error : json.error.message || 'API error');
  return json?.data as T;
}

// ─── small helpers ───────────────────────────────────────
const csv = (v: unknown): string[] => (typeof v === 'string' ? v.split(',').map(s => s.trim()).filter(Boolean) : []);
const num = (v: unknown): number[] => csv(v).map(Number).filter(n => !Number.isNaN(n));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') continue;
    if (a.startsWith('--') || a.startsWith('-')) {
      const key = a.replace(/^-+/, '');
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) { flags[key] = next; i++; } else flags[key] = true;
    } else positional.push(a);
  }
  return { positional, flags };
}

function openBrowser(url: string) {
  try {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch { /* best effort — the URL is always printed too */ }
}

function askLine(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

// Masked secret prompt (app passwords / bot tokens). Standard readline with a
// muted output stream so the secret is never echoed to the screen; backspace,
// Enter and Ctrl-C are handled natively by readline. No raw-mode parsing.
function askSecret(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl: any = readline.createInterface({ input: process.stdin, output: process.stdout });
    let muted = false;
    const origWrite = typeof rl._writeToOutput === 'function' ? rl._writeToOutput.bind(rl) : null;
    rl._writeToOutput = (str: string) => {
      if (!muted) { origWrite ? origWrite(str) : process.stdout.write(str); return; }
      // While muted, only let newlines through so Enter still drops the cursor.
      if (/[\r\n]/.test(str)) { origWrite ? origWrite('\n') : process.stdout.write('\n'); }
    };
    rl.question(question, (answer: string) => { rl.close(); resolve(answer.trim()); });
    muted = true; // everything typed after the prompt is shown is hidden
  });
}

// ─── login (device-grant flow) ───────────────────────────
async function login() {
  if (resolveKey() && !process.env.POSTEVERYWHERE_API_KEY) {
    const who = loadConfig().email;
    say(paint(`Already logged in${who ? ` as ${who}` : ''}. Run \`posteverywhere logout\` first to switch accounts.`, C.yellow));
    return;
  }

  const start = await raw('POST', '/api/v1/auth/device', { client_name: `CLI on ${os.hostname()}` });
  if (start.json?.error || !start.json?.data) {
    fail(typeof start.json?.error === 'string' ? start.json.error : start.json?.error?.message || 'Could not start login.');
  }
  const { device_code, user_code, verification_uri, verification_uri_complete, interval } = start.json.data;

  if (WANT_JSON) {
    outJson({ status: 'pending', user_code, verification_uri, verification_uri_complete, device_code });
  } else {
    say('');
    say(`  ${paint('Connect this CLI to PostEverywhere', C.bold)}`);
    say('');
    say(`  1. Open: ${paint(verification_uri, C.cyan)}`);
    say(`  2. Enter code: ${paint(user_code, C.bold)}`);
    say('');
    say(paint('  Opening your browser…', C.dim));
    openBrowser(verification_uri_complete);
    say(paint('  Waiting for you to approve…  (Ctrl-C to cancel)', C.dim));
  }

  const pollInterval = Math.max(2, Number(interval) || 5) * 1000;
  const deadline = Date.now() + 15 * 60 * 1000;
  let delay = pollInterval;

  while (Date.now() < deadline) {
    await sleep(delay);
    const { json } = await raw('POST', '/api/v1/auth/device/token', { device_code });
    if (json?.error) fail(typeof json.error === 'string' ? json.error : json.error.message || 'Login failed.');
    const data = json?.data || {};

    switch (data.status) {
      case 'pending': continue;
      case 'slow_down': delay += 2000; continue;
      case 'denied': fail('Login was denied in the browser.');
      case 'expired': fail('The login code expired. Run `posteverywhere login` again.');
      case 'authorized': {
        saveConfig({ api_key: data.api_key, email: data.user?.email, organization_id: data.organization_id });
        if (WANT_JSON) return outJson({ status: 'authorized', email: data.user?.email, organization_id: data.organization_id });
        say('');
        say(paint(`  ✓ Logged in as ${data.user?.email || 'your account'}`, C.green));
        say(paint(`  Credentials saved to ${CONFIG_PATH}`, C.dim));
        say('');
        say('  Next: `posteverywhere accounts` to see connected accounts, or');
        say('        `posteverywhere connect instagram` to connect one.');
        return;
      }
      default: continue;
    }
  }
  fail('Timed out waiting for approval. Run `posteverywhere login` again.');
}

function logout() {
  try { fs.rmSync(CONFIG_PATH, { force: true }); } catch {}
  if (WANT_JSON) return outJson({ ok: true });
  say(paint('✓ Logged out. Credentials removed.', C.green));
}

// ─── account connect / reconnect (browser bridge) ─────────
const HEADLESS_PLATFORMS = new Set(['bluesky', 'telegram', 'discord']);

async function connectHeadless(platform: string) {
  if (platform === 'bluesky') {
    say(paint('Connect Bluesky', C.bold));
    const handle = await askLine('  Handle (e.g. you.bsky.social): ');
    const appPassword = await askSecret('  App password (Settings → App Passwords): ');
    if (!handle || !appPassword) fail('Both handle and app password are required.');
    const data = await api('POST', '/auth/social-connect/bluesky', { handle, app_password: appPassword });
    if (WANT_JSON) return outJson(data);
    return say(paint(`✓ Connected Bluesky as ${(data as any)?.account?.account_name || handle}`, C.green));
  }
  if (platform === 'telegram') {
    say(paint('Connect Telegram', C.bold));
    const botToken = await askSecret('  Bot token (from @BotFather): ');
    if (!botToken) fail('A bot token is required.');
    const channel = await askLine('  Channel (e.g. @mychannel, or its numeric id): ');
    if (!channel) fail('A channel is required — add your bot to it as an admin first.');
    const data = await api('POST', '/auth/social-connect/telegram', { bot_token: botToken, channel });
    if (WANT_JSON) return outJson(data);
    return say(paint(`✓ Connected Telegram (${(data as any)?.account?.account_name || 'channel'})`, C.green));
  }
  if (platform === 'discord') {
    say(paint('Connect Discord', C.bold));
    say(paint('  Discord: Server Settings → Integrations → Webhooks → New Webhook → Copy URL', C.dim));
    const webhookUrl = await askSecret('  Webhook URL: ');
    if (!webhookUrl) fail('A Discord webhook URL is required.');
    const data = await api('POST', '/auth/social-connect/discord', { webhook_url: webhookUrl });
    if (WANT_JSON) return outJson(data);
    return say(paint(`✓ Connected Discord (${(data as any)?.account?.account_name || 'channel'})`, C.green));
  }
}

async function connectBrowser(platform: string, opts: { mode?: 'reconnect'; account_id?: number } = {}) {
  const body: any = { platform };
  if (opts.mode) body.mode = opts.mode;
  if (opts.account_id) body.account_id = opts.account_id;
  const { session_id, authorize_url, interval } = await api<any>('POST', '/auth/social-connect/start', body);

  if (WANT_JSON) { outJson({ status: 'pending', session_id, authorize_url }); }
  else {
    const verb = opts.mode === 'reconnect' ? 'Reconnect' : 'Connect';
    say('');
    say(`  ${paint(`${verb} ${platform}`, C.bold)}`);
    say(`  Open: ${paint(authorize_url, C.cyan)}`);
    say(paint('  Opening your browser…', C.dim));
    openBrowser(authorize_url);
    say(paint('  Waiting for you to finish in the browser…  (Ctrl-C to cancel)', C.dim));
  }

  const pollInterval = Math.max(2, Number(interval) || 3) * 1000;
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(pollInterval);
    const data = await api<any>('GET', `/auth/social-connect/poll/${session_id}`);
    if (data.status === 'pending') continue;
    if (data.status === 'expired') fail('The connection link expired. Try again.');
    if (data.status === 'cancelled') fail('Connection was cancelled.');
    if (data.status === 'completed') {
      if (WANT_JSON) return outJson(data);
      const a = data.account || {};
      say('');
      say(paint(`  ✓ ${opts.mode === 'reconnect' ? 'Reconnected' : 'Connected'} ${a.platform || platform}${a.account_name ? ` as ${a.account_name}` : ''}`, C.green));
      return;
    }
  }
  fail('Timed out. Try again.');
}

async function connect(platform: string) {
  if (!platform) fail('Usage: posteverywhere connect <platform>  (e.g. instagram, tiktok, bluesky, telegram)');
  const p = platform.toLowerCase();
  if (HEADLESS_PLATFORMS.has(p)) return connectHeadless(p);
  return connectBrowser(p);
}

async function reconnect(arg: string) {
  if (!arg) fail('Usage: posteverywhere reconnect <accountId>  (run `posteverywhere accounts` to find ids)');
  const accountId = Number(arg);
  if (Number.isNaN(accountId)) fail('Provide a numeric account id (from `posteverywhere accounts`).');
  const acct = await api<any>('GET', `/accounts/${accountId}`).catch(() => null);
  const platform = acct?.platform;
  if (!platform) fail(`Could not find account ${accountId}. Run \`posteverywhere accounts\`.`);
  if (HEADLESS_PLATFORMS.has(String(platform).toLowerCase())) return connectHeadless(String(platform).toLowerCase());
  return connectBrowser(String(platform).toLowerCase(), { mode: 'reconnect', account_id: accountId });
}

// ─── help ────────────────────────────────────────────────
const HELP = `${paint('posteverywhere', C.bold)} — post & schedule to every social platform from your terminal.

${paint('Getting started', C.bold)}
  posteverywhere login              Log in (opens your browser, saves a key locally)
  posteverywhere connect <platform> Connect an account (instagram, tiktok, youtube,
                                    linkedin, facebook, x, threads, pinterest,
                                    bluesky, telegram, discord)
  posteverywhere accounts           List connected accounts (+ ids & health)
  posteverywhere post -c "Hello" -a 123,456

${paint('Commands', C.bold)}
  login                          Device-flow login (browser approval)
  logout                         Remove saved credentials
  whoami                         Show the authed account, plan & quota
  accounts                       List connected social accounts
  queue [--preview N]            Show your posting queue slots & next openings
  platform-rules [platform]      Character limits, media constraints & features
                                 per platform (check before composing)
  connect <platform>             Connect a new account
  reconnect <accountId>          Re-authorize an account whose token expired
  account:health <id>            Detailed health for one account
  post -c <text> -a <ids> [-s <iso>] [-m <mediaIds>]
                                 Publish now (omit -s) or schedule (-s ISO time)
  posts [--status x] [--platform y] [--limit n]    List posts
  results <postId>               Per-platform publish results
  retry <postId>                 Retry failed destinations
  upload <url>                   Import an image or MP4 video by URL -> media_id
                                 (videos import async: poll until ready before posting)
  caption -t <topic> [--platform x] [--tone y]     AI captions
  analytics [--period week|month|all]              Analytics summary
  campaigns                      List campaigns

${paint('Flags', C.bold)}
  --json     Machine-readable JSON output (auto-on when piped). Great for agents.

Auth precedence: POSTEVERYWHERE_API_KEY env var, else the key from \`login\`.
Docs: https://posteverywhere.ai/docs`;

// ─── main ────────────────────────────────────────────────
async function main() {
  const [, , cmd, ...rest] = process.argv;
  const { positional, flags } = parseArgs(rest);
  const f = (k: string, alias?: string) => (flags[k] ?? (alias ? flags[alias] : undefined));

  switch (cmd) {
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      return say(HELP);

    case 'login': return login();
    case 'logout': return logout();
    case 'whoami': return outJson(await api('GET', '/me'));
    case 'accounts': return outJson(await api('GET', '/accounts'));
    // Server-authoritative limits, so agents never hardcode them (and never
    // learn them from a 400). One platform: `platform-rules x`.
    case 'platform-rules': {
      const rules = await api<{ platforms: Record<string, unknown> }>('GET', '/platform-rules');
      const only = positional[0]?.toLowerCase();
      if (!only) return outJson(rules);
      const one = rules.platforms?.[only];
      if (!one) fail(`Unknown platform "${only}". Known: ${Object.keys(rules.platforms || {}).join(', ')}`);
      return outJson({ platform: only, ...(one as object) });
    }
    case 'connect': return connect(positional[0]);
    case 'reconnect': return reconnect(positional[0]);

    case 'account:health': {
      if (!positional[0]) fail('Usage: posteverywhere account:health <accountId>');
      return outJson(await api('GET', `/accounts/${positional[0]}/health`));
    }

    case 'post': {
      const content = f('content', 'c');
      const accounts = num(f('accounts', 'a'));
      if (typeof content !== 'string' || !content) fail('Usage: post -c "text" -a 123,456 [-s 2026-07-01T09:00:00Z] [-m mediaId1,mediaId2]');
      if (!accounts.length) fail('At least one account id is required (-a 123,456). Run `posteverywhere accounts` to list ids.');
      const body: any = { content, account_ids: accounts };
      const sched = f('schedule', 's');
      const wantQueue = f('queue') === true || f('queue') === 'true';
      if (wantQueue && typeof sched === 'string') {
        fail('Choose one: --queue (the queue picks the time) or -s (you pick it). Not both.');
      }
      if (wantQueue) body.use_queue = true;
      if (typeof sched === 'string') { body.scheduled_for = sched; body.timezone = (f('timezone') as string) || 'UTC'; }
      const media = csv(f('media', 'm'));
      if (media.length) body.media_ids = media;
      const data = await api('POST', '/posts', body);
      if (!WANT_JSON) {
        const mode = body.use_queue ? `Queued (${data?.scheduled_for ?? 'next opening'})`
          : body.scheduled_for ? 'Scheduled' : 'Publishing';
        say(paint(`✓ ${mode} to ${accounts.length} account(s).`, C.green));
      }
      return outJson(data);
    }

    case 'queue': {
      // Preview the workspace posting queue: its recurring slots and the next
      // openings. The upcoming list is a forecast, not a reservation - a slot
      // is only taken when a post is created with --queue.
      const n = f('preview');
      const data = await api<any>('GET', `/queue${typeof n === 'string' ? `?preview=${encodeURIComponent(n)}` : ''}`);
      if (WANT_JSON) return outJson(data);
      if (!data?.queue) {
        return say(paint('No posting queue set up yet. Create one in the app under Settings, Posting Queue.', C.yellow));
      }
      say(paint(`Queue: ${data.queue.name} (${data.queue.timezone})`, C.bold));
      for (const u of data.upcoming ?? []) say(`  ${u.date}  ${u.time}`);
      if (data.exhausted) say(paint('  (no further openings in the window)', C.yellow));
      return;
    }

    case 'posts': {
      const q = new URLSearchParams();
      if (typeof f('status') === 'string') q.set('status', f('status') as string);
      if (typeof f('platform') === 'string') q.set('platform', f('platform') as string);
      q.set('limit', String(f('limit') || 20));
      return outJson(await api('GET', `/posts?${q.toString()}`));
    }

    case 'results':
      if (!positional[0]) fail('Usage: posteverywhere results <postId>');
      return outJson(await api('GET', `/posts/${positional[0]}/results`));

    case 'retry':
      if (!positional[0]) fail('Usage: posteverywhere retry <postId>');
      return outJson(await api('POST', `/posts/${positional[0]}/retry`));

    case 'upload': {
      const url = positional[0] || f('url');
      if (typeof url !== 'string') fail('Usage: posteverywhere upload <url>  (public image or MP4 video URL)');
      return outJson(await api('POST', '/media/upload-from-url', { url }));
    }

    case 'caption': {
      const topic = f('topic', 't');
      if (typeof topic !== 'string') fail('Usage: posteverywhere caption -t "topic" [--platform x] [--tone y]');
      const body: any = { topic };
      if (typeof f('platform') === 'string') body.platform = f('platform');
      if (typeof f('tone') === 'string') body.tone = f('tone');
      return outJson(await api('POST', '/ai/generate-caption', body));
    }

    case 'analytics':
      return outJson(await api('GET', `/analytics/summary?period=${encodeURIComponent((f('period') as string) || 'month')}`));

    case 'campaigns':
      return outJson(await api('GET', '/campaigns'));

    default:
      fail(`Unknown command: ${cmd}. Run \`posteverywhere help\`.`);
  }
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
