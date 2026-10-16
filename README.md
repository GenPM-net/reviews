# @core/reviews

[![genpm](https://api.genpm.net/v1/badge/@core/reviews.svg)](https://genpm.net/p/@core/reviews) ![license](https://img.shields.io/badge/license-MIT-blue)

> Product reviews on @core/comments: verified purchases, photos, labeled imported reviews, ratings and review requests

A [GenPM](https://genpm.net) module: **source code + AI rules + MCP config**, injected into your project instead of hidden in `node_modules`. The code lands in `src/lib/reviews`, pinned to a verified commit, and you own it.

## Install

```bash
genpm add @core/reviews
```

No genpm yet? `curl -fsSL https://genpm.net/install.sh | sh` (macOS/Linux), `irm https://genpm.net/install.ps1 | iex` (Windows), or one-off with `npx @genpm-net/cli add @core/reviews`.

Or let your AI agent do it: run `genpm mcp setup` once, then ask *"add @core/reviews with genpm"* in Claude Code, Cursor, VS Code, Windsurf, Codex or Gemini CLI. It shows you a dry-run plan before writing anything.

## What it does

Product reviews built on @core/comments (no duplicate comment system): a review is a comment on `product/<id>` with a
1–5 rating, plus `review_meta` (verified purchase, photos from @core/media, source) and `review_stats` per product.
"Verified" means the signed-in author has a paid and shipped order with that product (by user id or their account's
verified email); guest reviews are never verified, so the response never reveals whether an email bought. Imported reviews are always labeled with
their source and never verified. Asks customers for a review N days after delivery.

## Setup

After `genpm add`, follow these steps (your AI agent finds the same steps in `src/lib/reviews/AGENTS.md` and can do them for you):

1. Requires @core/comments (moderation, anti-spam) and @core/orders. Env: optional `REVIEW_REQUEST_DELAY_DAYS` (default 7, `-1` disables), `SITE_URL`, `EMAIL_FROM`.
2. Migrations as in `src/lib/db/AGENTS.md`; import this module at startup.
3. Product page: `productRating(id)` for stars and JSON-LD (`jsonLd.product({ rating })` from @core/seo), `listReviews(id, { page, rating, sort })`
   for the list; show a "Verified purchase" badge and, for imported ones, "Imported from <source>".
4. Review form → `postReview({ productId, rating, body, user | guest, photos }, { headers, fields })` with @core/antispam fields.
5. Moderate in the comments admin (filter `entityType=product`) and call `moderateReview` so stats update.
6. Verify: a buyer's review shows as verified after approval and the product rating changes.

## What's inside

Paths are relative to `src/lib/reviews`.

- `index.ts` — public API: `postReview`, `listReviews`, `productRating`, `moderateReview`, `importReviews`, `verifiedOrder`.
- `reviews.ts` — logic, stats and the `reviews.request` job (scheduled from the order `delivered` event on import).

## At a glance

- **GenPM dependencies** (installed with it): [@core/comments](https://genpm.net/p/@core/comments), [@core/catalog](https://genpm.net/p/@core/catalog), [@core/orders](https://genpm.net/p/@core/orders), [@core/email](https://genpm.net/p/@core/email), [@core/jobs](https://genpm.net/p/@core/jobs), [@core/db](https://genpm.net/p/@core/db), [@core/auth](https://genpm.net/p/@core/auth)
- **npm dependencies** (proposed, never installed without asking): `zod`
- **Environment variables** (added to `.env.example`): `REVIEW_REQUEST_DELAY_DAYS`
- **AI rules**: [`AGENTS.md`](AGENTS.md), loaded by your agent only when it works in `src/lib/reviews`

## Security

GenPM installs a 40-character commit SHA (never a branch), verifies an Ed25519-signed manifest, never runs install scripts and scans AI rules for prompt injection. Details: [genpm.net/docs/security](https://genpm.net/docs/security).

## License

MIT — see [LICENSE](LICENSE). Browse the full catalog at [genpm.net](https://genpm.net).
