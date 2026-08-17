# Contributing to the PostEverywhere Node.js SDK

Thanks for your interest in contributing to the [PostEverywhere SDK](https://www.npmjs.com/package/@posteverywhere/sdk)! This guide covers reporting issues, proposing features, and submitting code.

## TL;DR

- **🐛 Bug reports** → [open an issue](https://github.com/posteverywhere/sdk/issues/new) with a minimal reproduction
- **💡 Feature requests** → [open an issue](https://github.com/posteverywhere/sdk/issues/new) describing the use case
- **🔧 Pull requests** → fork, branch, change, test, PR
- **📧 Private/security** → [support@posteverywhere.ai](mailto:support@posteverywhere.ai) (see [SECURITY.md](SECURITY.md))

## Reporting bugs

The [issue tracker on GitHub](https://github.com/posteverywhere/sdk/issues) is the best place. A good report includes:

1. SDK version (`npm ls posteverywhere`)
2. Node.js version (`node --version`)
3. A minimal reproduction (~10 lines is ideal)
4. The full error message + stack trace
5. What you expected vs. what happened

If the bug is platform-specific (e.g. Instagram-side rejection), include the platform's response if you can — the SDK surfaces these via `error.details`.

## Proposing changes

For anything beyond a typo or obvious bug fix, please open an issue first to discuss. This avoids you spending time on a change we'd reject for design reasons.

## Local development

```bash
# Clone
git clone https://github.com/posteverywhere/sdk.git
cd sdk

# Install
npm install

# Build (uses tsup — outputs CJS + ESM + d.ts)
npm run build

# Smoke test against your own API key
export POSTEVERYWHERE_API_KEY=pe_live_...
node -e "import('./dist/index.mjs').then(m => new m.default({apiKey: process.env.POSTEVERYWHERE_API_KEY}).accounts.list().then(console.log))"
```

You'll need a PostEverywhere account to test against the live API. [Sign up free](https://app.posteverywhere.ai/signup) — 7-day trial, no credit card required for the trial period.

## Pull request checklist

- [ ] Code builds cleanly (`npm run build` succeeds)
- [ ] No new TypeScript errors
- [ ] If adding a new resource/method, update the README's API examples
- [ ] If changing public types, mention it in the PR description so we can flag for major version
- [ ] Tested against a real API key (we don't currently have a sandbox)

## Code style

- Match the existing style — TypeScript, no semicolons in some files (we're flexible), 2-space indent
- Keep changes focused — one logical change per PR
- Don't bump the package version yourself — we'll do it on merge

## Project layout

```
packages/sdk/
├─ src/
│  ├─ client.ts        # HTTP client with retry/auth
│  ├─ errors.ts        # Typed error classes
│  ├─ types.ts         # Public types
│  ├─ index.ts         # Main export
│  ├─ cli.ts           # CLI entrypoint (`npx posteverywhere`)
│  └─ resources/       # accounts.ts, posts.ts, media.ts, ai.ts
├─ dist/               # Built artifacts (gitignored)
├─ package.json
└─ README.md
```

## Releases

Releases are tagged on GitHub and published to npm by the maintainers. Versioning follows [Semantic Versioning](https://semver.org). See [CHANGELOG.md](CHANGELOG.md) for history.

## License

By contributing, you agree your contributions are licensed under the [MIT License](LICENSE).

## Resources

- 📖 [API Documentation](https://developers.posteverywhere.ai)
- 🤖 [Companion MCP Server](https://github.com/posteverywhere/mcp)
- 🌐 [PostEverywhere homepage](https://posteverywhere.ai)
- 📚 [Help Center](https://posteverywhere.ai/support)
