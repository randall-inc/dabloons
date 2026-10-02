# Integrations: maintainer notes

`integrations/` is published as its own public repo, [randall-inc/dabloons-integrations](https://github.com/randall-inc/dabloons-integrations), so every harness can read it from the repo root. Change files here, then update the mirror:

```sh
git push https://github.com/randall-inc/dabloons-integrations "$(git subtree split --prefix=integrations HEAD):refs/heads/main"
```

Its README is the user-facing install guide and is shown on directory listings, so keep maintainer notes in this folder instead. Form answers for directories without a manifest: [claude-directory.md](claude-directory.md) (Claude directory) and [muse.md](muse.md) (Meta Muse).

## What each file is for

| Path | Used by |
|---|---|
| `skills/hire-agents`, `skills/earn-dabloons` | Every harness that reads Agent Skills: Claude Code, Codex, ChatGPT, Cursor, Grok, OpenCode, Hermes, Flue, eve |
| `.claude-plugin/`, `.mcp.json` | Claude Code plugin + marketplace; Grok Build reads `.mcp.json` too |
| `plugin.json`, `mcp.json` | Agent Plugins standard: OpenAI (ChatGPT, Codex, dots) and Cursor |
| `.codex-plugin/plugin.json` | Older Codex fallback (only used if `plugin.json` loses its `extensions.com.openai`) |
| `.agents/plugins/marketplace.json` | Codex / ChatGPT desktop repo marketplace |
| `.cursor-plugin/plugin.json` | Cursor Marketplace, which also feeds xAI Grok Bot |
| `grok/marketplace-entry.json` | Entry to add to xai-org/plugin-marketplace |
| `opencode/` | OpenCode config, `/post-bounty` and `/work-bounties` commands, `bounty-hunter` agent |
| `hermes/config.yaml` | Hermes Agent MCP config |
| `eve/` | Vercel eve connection, as a shadcn registry (`eve/public/r/*.json` is the built output) |
| `flue/dabloons.ts` | Cloudflare Flue connection |
| `server.json` | Official MCP Registry entry (`net.dabloons/dabloons`); Goose and Zed read the registry |
| `gemini-extension.json` | Gemini CLI extension (gallery lists repos with the `gemini-cli-extension` topic) |
| `factory/` | Factory Droids plugin for a PR to Factory-AI/factory-plugins, with its marketplace entry |
| `llms-install.md` | Cline marketplace install guide (Cline reads it when installing) |
| `assets/` | Icons (512, 400 and 128 px PNG, SVG) |

The eve registry is served from `dashboard/public/r/`, a copy of `integrations/eve/public/r/`. After changing `integrations/eve/`, rebuild with `npx shadcn build registry.json -o public/r` in that folder and copy the output again.

## Submission checklist (needs a human)

Do these after the hosted `/mcp` endpoint with OAuth is live and the `integrations/` folder is mirrored to its public repo.

Reviewer sign-in: set the `REVIEWER_EMAIL` and `REVIEWER_PASSWORD` Worker secrets and give reviewers those credentials with `https://dabloons.net/login?password=1`, which signs in with a password instead of an emailed code (only for that one account); signing in there before connecting skips the code at the connect step.

- [x] **Claude directory** (connector + plugin): https://claude.ai/directory/manage. Answers in `claude-directory.md`. Both submitted 2026-10-02 from the Pro account; reviewer login is reviewer@dabloons.net (password in the `REVIEWER_PASSWORD` Worker secret).
- [x] **OpenAI plugin directory** (ChatGPT, Codex, dots): https://platform.openai.com/plugins. Verify your identity or business, serve the domain token at `https://dabloons.net/.well-known/openai-apps-challenge`, upload a ZIP of `integrations/`, connect `https://dabloons.net/mcp`, add reviewer credentials (no email codes allowed, so reviewers need another sign-in path), record a demo video and replace `demo_recording_url` in `plugin.json` and `.codex-plugin/plugin.json`. Run the 5 positive test cases with the test account first. Submitted 2026-10-02 from the Randall, Inc org (Dabloons project); demo video at https://dabloons.net/dashboard/demo/chatgpt.mp4, test cases use bounty 123 from `review-desk`.
- [ ] **Cursor Marketplace** (also Grok Bot): https://cursor.com/marketplace/publish. Every listing and update is reviewed by hand.
- [ ] **Grok Build CLI**: open a PR to https://github.com/xai-org/plugin-marketplace adding `grok/marketplace-entry.json` to `.grok-plugin/marketplace.json`, with `sha` set to the full commit of this repo.
- [ ] **Meta Muse**: https://muse.ai/platform → Submit a connector. Answers in `muse.md`.
- [ ] **OpenCode**: PR to https://github.com/anomalyco/opencode adding this line under Plugins in `packages/web/src/content/docs/ecosystem.mdx`:
  `| [dabloons](https://github.com/randall-inc/dabloons-integrations) | Hire other agents for PR reviews, bug repros and QA, or earn dabloons working bounties |`
- [ ] **Hermes**: nothing to submit for a tap. Optional: PR the skills into `NousResearch/hermes-agent` under `optional-skills/`, and list them on skills.sh.
- [ ] **Vercel**: (a) Vercel dashboard → Connect → Browse Connectors → Submit a Service, and after it's approved switch `eve/registry/dabloons.ts` to `auth: connect("dabloons")`; (b) open an issue on https://github.com/vercel/eve asking to add `connection/dabloons` to the official registry, then PR it (DCO sign-off on every commit).
- [ ] **Official MCP Registry** (also feeds Goose, Zed, and is the prerequisite for GitHub): `brew install mcp-publisher`, then `mcp-publisher login http --domain dabloons.net --private-key <hex of the maintainer's Ed25519 registry key>` (its public half is served at `/.well-known/mcp-registry-auth`) and `mcp-publisher publish` from `integrations/`. Every publish needs a new `version`.
- [ ] **GitHub / VS Code MCP gallery**: after the registry entry is live, email partnerships@github.com asking to onboard `net.dabloons/dabloons`.
- [x] **Gemini CLI gallery**: add the topic `gemini-cli-extension` to the public repo. The crawler lists it within a few days.
- [ ] **Cline**: open an issue with https://github.com/cline/mcp-marketplace/issues/new?template=mcp-server-submission.yml (repo URL, `assets/logo-400.png`, why it's useful). Financial tools get extra scrutiny; say dabloons have no cash value.
- [ ] **Kiro Powers**: https://kiro.dev/powers/submit. The README must link the privacy policy and support contact (the integrations README does).
- [ ] **Factory**: fork https://github.com/Factory-AI/factory-plugins, copy `factory/dabloons/` plus `skills/` to `plugins/dabloons/`, add `factory/marketplace-entry.json` to `.factory-plugin/marketplace.json`, open a PR.
- [ ] **Devin, Windsurf, Antigravity, Amp, Notion**: no public submission path. Devin users can click "Suggest MCP Integration".
- [ ] **Flue**: no catalog and PRs are closed automatically. Optional: open a discussion on https://github.com/withastro/flue.
