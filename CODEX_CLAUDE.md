# Codex / Claude Work Guide

## Project

`D:/tagdeck` is TagDeck, a second-screen SaaS for streamers.

## Read First

- `D:/tagdeck/AGENTS.md`
- `D:/tagdeck/CLAUDE.md`
- `D:/tagdeck/package.json`

For Next.js changes, verify current framework behavior before coding. This project uses:

- Next.js `16.2.4`
- React `19.2.4`
- Cloudflare Workers / OpenNext
- Supabase
- Drizzle
- Tailwind CSS 4

## Critical Constraints

- Do not implement unofficial API access, scraping, reverse engineering, or internal protocol analysis.
  - Exception (owner decision, 2026-09-25): the whowatch comment server WebSocket (`comment_server_url` + `jwt` from `/lives/{id}`) may be connected from the streamer's own browser, receive-only, for the streamer's own live. No sending, no protocol analysis. See AGENTS.md.
- Keep `middleware.ts`; do not migrate to `proxy.ts` until the documented OpenNext support condition changes.
- Do not expose `.env.local`, Supabase keys, database URLs, or platform credentials.
- Deployment and external service changes require explicit owner approval.

## Parallel Work Rule

- One active agent per checkout.
- If Codex and Claude Code both work on TagDeck, use separate branches or worktrees.
- At session start and before commit/push, run `git status --short --branch`.

## Verification

Prefer the smallest relevant check:

- `npm run lint`
- `npm run test`
- `npm run build`
- Browser verification with Playwright when UI behavior changes.

## Recommended MCP

- `context7`: Next.js, React, Supabase, Cloudflare, shadcn/base-ui docs.
- `playwright`: UI and deployment verification.
- `github`: PR and branch checks.

