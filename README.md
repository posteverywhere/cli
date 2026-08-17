# PostEverywhere — Official CLI & Agent Skill

[![npm version](https://img.shields.io/npm/v/%40posteverywhere%2Fcli.svg?style=flat-square)](https://www.npmjs.com/package/@posteverywhere/cli)
[![npm downloads](https://img.shields.io/npm/dw/%40posteverywhere%2Fcli.svg?style=flat-square)](https://www.npmjs.com/package/@posteverywhere/cli)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg?style=flat-square)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/posteverywhere/cli?style=flat-square)](https://github.com/posteverywhere/cli)

Post and schedule to **Instagram, TikTok, YouTube, LinkedIn, Facebook, X, Threads, Pinterest, Bluesky, Telegram and Discord** from your terminal — or hand the whole thing to an AI agent.

This repo is two things at once: a CLI you can drive by hand, and an **Agent Skill** that teaches Claude Code, Cursor, Codex and other agents how to use it. Every command emits JSON, so an agent can read the result of what it just did.

## Install as an agent skill

```bash
npx skills add posteverywhere/cli
```

That's it. Your agent now knows the whole command surface — connecting accounts, checking per-platform limits, scheduling, and reading back per-destination results. Then just ask:

> *"schedule a post to all my accounts for tomorrow at 9am"*

Claude Code users can alternatively add it as a plugin, which brings auto-updates:

```bash
claude plugin marketplace add posteverywhere/cli
```

## Install as a CLI

```bash
npm install -g @posteverywhere/cli
# …or run without installing:
npx @posteverywhere/cli <command>
```

## 90-second setup

```bash
posteverywhere login                 # opens your browser, saves a key to ~/.posteverywhere
posteverywhere connect instagram     # OAuth flow; auto-detects the connected account
posteverywhere accounts              # list connected accounts (+ ids & health)
posteverywhere post -c "Hello 🚀" -a 123,456
```

For CI or a headless agent, skip `login` and set a key from **Settings → Developers**:

```bash
export POSTEVERYWHERE_API_KEY=pe_live_...
```

## Commands

| Command | What it does |
|---|---|
| `login` / `logout` | Device-flow login (browser approval); remove saved credentials |
| `whoami` | The authed account, plan and remaining quota |
| `accounts` | Connected social accounts, with ids and health |
| `platform-rules [platform]` | Character limits, media constraints and supported features |
| `connect <platform>` | Connect a new account |
| `reconnect <accountId>` | Re-authorize an account whose token expired |
| `account:health <id>` | Why one account can't post |
| `post -c <text> -a <ids> [-s <iso>] [-m <mediaIds>]` | Publish now, or schedule with `-s` |
| `posts` | List posts, filterable by status and platform |
| `results <postId>` | Per-platform success/failure for one post |
| `retry <postId>` | Retry the failed destinations |
| `upload <imageUrl>` | Import an image by URL → `media_id` |
| `caption -t <topic>` | AI captions, tuned per platform |
| `analytics [--period]` | Performance summary |
| `campaigns` | List campaigns |

Add `--json` for machine-readable output. It turns on automatically when piped, so agents get JSON without asking.

### Check the limits before you compose

`platform-rules` returns what each platform will actually accept, straight from the server:

```bash
$ posteverywhere platform-rules bluesky --json
{ "platform": "bluesky", "characterLimit": 300,
  "features": ["threads", "quotes", "link_cards"], ... }
```

The limits differ by two orders of magnitude — Bluesky caps at 300 characters, Facebook at 63,206 — and TikTok rejects images outside its pixel ceiling server-side. Checking costs one call; guessing costs a failed publish. Because the values are server-authoritative, a newly supported platform shows up here with no update on your side.

## 🔗 Quick Links

| Resource | URL |
|---|---|
| 🌐 **Homepage** | [posteverywhere.ai](https://posteverywhere.ai) |
| 🛠️ **Developers landing page** | [posteverywhere.ai/developers](https://posteverywhere.ai/developers) |
| 📖 **API Documentation** | [developers.posteverywhere.ai](https://developers.posteverywhere.ai) |
| 📦 **This CLI on npm** | [npmjs.com/package/@posteverywhere/cli](https://www.npmjs.com/package/@posteverywhere/cli) |
| 🤖 **MCP server (npm)** | [npmjs.com/package/@posteverywhere/mcp](https://www.npmjs.com/package/@posteverywhere/mcp) |
| 🤖 **MCP server (GitHub)** | [github.com/posteverywhere/mcp](https://github.com/posteverywhere/mcp) |
| 📚 **Node.js SDK** | [github.com/posteverywhere/sdk](https://github.com/posteverywhere/sdk) |
| 🔌 **Connect Claude** | [posteverywhere.ai/integrations/claude](https://posteverywhere.ai/integrations/claude) |

## CLI, MCP or SDK?

| You want | Use |
|---|---|
| An agent that can run shell commands (Claude Code, Codex, Cursor) | **This CLI** + `npx skills add posteverywhere/cli` |
| An agent that speaks MCP (Claude Desktop, ChatGPT, hosted agents) | [`@posteverywhere/mcp`](https://github.com/posteverywhere/mcp) |
| To write your own application code | [`@posteverywhere/sdk`](https://github.com/posteverywhere/sdk) |

All three hit the same v1 API, so an account connected once works everywhere.

## Design notes

**Zero runtime dependencies.** Pure Node (≥18), one source file. `npx` is instant and there's no supply-chain surface to audit.

**Credentials stay local.** `login` writes a scoped key to `~/.posteverywhere/config.json` at mode `600`. `POSTEVERYWHERE_API_KEY` takes precedence when set, so CI never touches the file.

**Errors are readable by machines.** On failure the CLI prints `{"error": "..."}` to stderr and exits non-zero, so an agent can tell "account needs reconnect" from "out of quota" and act on it.

## License

MIT — see [LICENSE](LICENSE).
