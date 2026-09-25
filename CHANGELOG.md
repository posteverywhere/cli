# Changelog

All notable changes to `@posteverywhere/cli` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
