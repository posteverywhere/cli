# Changelog

All notable changes to `@posteverywhere/cli` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.0] - 2026-10-05

### Added

- **`best-times`.** `posteverywhere best-times -a 123,456` shows the best times to post for those accounts (one combined pick for several), or `--platform instagram` for platform-wide times. Each time says what it is based on: the account's own posts, PostEverywhere users on that platform, or general guidance. `--tz` sets the timezone; `--json` prints the raw `GET /v1/best-times` response.

## [0.6.0] - 2026-10-02

### Added

- **`connect` for coding agents.** `posteverywhere connect` (no platform) connects
  every coding agent on the machine to the hosted MCP server,
  `https://mcp.posteverywhere.ai`, in one go: Claude Code, Codex CLI and Gemini CLI
  through their own `mcp add` commands; Cursor, Windsurf, Cline and Zed by merging
  their config files; Claude Desktop with the Connectors step. The server signs you
  in with OAuth, so no API key is written.
  Flags: `--all`, `--client cursor,claude-code`, `--yes`, `--dry-run`, `--json`,
  `--remove`. Config files are merged (comments kept) and backed up to
  `<file>.bak-posteverywhere-<timestamp>` before the first change.
- `npm test` (node:test) covers the config merges.

## [0.5.0] — 2026-09-26

### Added

- **WordPress.** `connect wordpress` connects a self-hosted site with an
  Application Password. `post` publishes blog posts: `--title`, `--body-file`
  (Markdown-style or HTML), `--wp-status publish|draft|pending|private`,
  `--tags`, `--categories`, `--excerpt`, `--slug`, `--no-featured-image`.
  With `--body-file`, `-c` is optional.

## [0.4.0] — 2026-09-25

### Added

- **`queue` command.** Shows your posting queue slots and the next openings
  (`--preview N`). `post --queue` lets the queue pick the time instead of `-s`.

### Changed

- Videos up to 4 GB (was 500 MB) for `upload`.
- Docs links point at posteverywhere.ai/docs.

## [0.3.1] — 2026-08-19

### Changed

- `upload` imports videos by URL as well as images; help text and the skill say so.

## [0.3.0] — 2026-08-17

### Added

- **`platform-rules [platform]` command.** Returns the character limit, image and video
  constraints, and supported features (threads, carousels, reels, alt text, link cards) for
  every platform — or one, with `platform-rules tiktok`. The values come from the server, so
  a newly supported platform appears without a CLI update. Checking beats guessing: the
  limits span 300 characters (Bluesky) to 63,206 (Facebook), and TikTok enforces a pixel
  ceiling server-side.
- **Published as an Agent Skill.** `npx skills add posteverywhere/cli` installs the bundled
  `SKILL.md` into Claude Code, Cursor, Codex and other agents. Claude Code users can also
  run `claude plugin marketplace add posteverywhere/cli` for auto-updates.
- `SKILL.md` now tells agents to check `platform-rules` before composing for a platform they
  haven't posted to.

### Changed

- Package metadata now declares its `repository`, so the npm page links to the source.

## [0.2.1] — 2026-06-21

Patch release.

## [0.2.0] — 2026-06-21

Added device-flow `login`, `connect` for all eleven platforms, `reconnect`,
`account:health`, `caption`, `analytics` and `campaigns`.

## [0.1.0] — 2026-06-13

Initial release: `whoami`, `accounts`, `post`, `posts`, `results`, `retry`, `upload`, and
`--json` output for agents.
