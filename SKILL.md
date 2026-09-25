---
name: posteverywhere
description: Schedule and publish social media posts to Instagram, TikTok, YouTube, LinkedIn, Facebook, X, Threads, Pinterest, Bluesky, Telegram and Discord. Use when the user asks to post, schedule, draft, or analyze social media content, or to list their connected social accounts.
---

# PostEverywhere

Manage a user's social media through the PostEverywhere CLI. Every command prints JSON.

**If PostEverywhere MCP tools are available in this session, prefer them over the CLI** —
they need no local install and no key handling. The workflow and the rules below are the
same either way; `list_accounts` maps to `accounts`, `create_post` to `post`, and so on.
Fall back to the CLI when the tools are absent, or when the user wants it run in a terminal
or in CI.

## Setup (once)
Authenticate one of two ways:
- **Interactive:** `posteverywhere login` opens the browser; the user approves a short code and a scoped key is saved locally. Then `posteverywhere connect <platform>` to add accounts (instagram, tiktok, youtube, linkedin, facebook, x, threads, pinterest = browser OAuth; bluesky/telegram/discord = the CLI prompts for credentials).
- **Non-interactive (CI / headless agents):** `export POSTEVERYWHERE_API_KEY=pe_live_...` (from posteverywhere.ai → Settings → Developers).

Run commands with `npx @posteverywhere/cli <command>` (or `posteverywhere <command>` if installed).

## Always start here
1. `posteverywhere whoami` — confirms the key works and shows the plan/quota.
2. `posteverywhere accounts` — lists connected accounts. **You need the numeric account `id`s to post.** If empty, run `posteverywhere connect <platform>` (or tell the user to connect in the dashboard).

## Core workflow
**Publish now** to accounts 123 and 456:
```bash
posteverywhere post -c "Launch day! 🚀" -a 123,456
```
**Schedule** (ISO-8601 UTC; include -s):
```bash
posteverywhere post -c "Weekly tips thread" -a 123 -s 2026-07-01T09:00:00Z
```
**With an image or video** — import it first, then attach the returned `media_id`:
```bash
posteverywhere upload https://example.com/photo.jpg      # image → media_id, ready immediately
posteverywhere upload https://example.com/reel.mp4       # MP4 video (≤4GB) → media_id with status "uploading"
                                                         #   videos import async: check until ready before posting
posteverywhere post -c "New drop" -a 123 -m <media_id>
```

## Before you compose for an unfamiliar platform
`posteverywhere platform-rules` returns the character limit, image/video constraints and
supported features (threads, carousels, reels, alt text) for every platform. Add a platform
name for one: `posteverywhere platform-rules tiktok`.

Check it rather than guessing — the limits differ by two orders of magnitude (Bluesky 300
characters, Instagram 2,200, Facebook 63,206) and TikTok rejects images outside its pixel
ceiling server-side. These values are server-authoritative, so a newly supported platform
appears here with no update to this skill.

## Checking results
- `posteverywhere posts --status published --limit 10` — recent posts
- `posteverywhere results <postId>` — per-platform success/failure for one post
- `posteverywhere retry <postId>` — retry any failed platforms
- `posteverywhere account:health <id>` — why an account can't post (e.g. needs reconnect)

## Other
- `posteverywhere caption -t "summer sale" --platform instagram --tone playful` — AI captions
- `posteverywhere analytics --period month` — performance summary
- `posteverywhere campaigns` — list campaigns

## Rules
- **Always `accounts` before `post`** — never guess account ids.
- **Check `platform-rules` before composing for a platform you haven't posted to** — cheaper than a rejected publish.
- **Always confirm content + target accounts with the user before publishing.** Keep a human in the loop.
- Times are UTC ISO-8601. Omit `-s` to publish immediately.
- On error the CLI prints `{"error": "..."}` to stderr and exits non-zero — read it and relay the cause (often: account needs reconnect, out of quota, or media not ready).
