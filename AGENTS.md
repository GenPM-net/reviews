# @core/reviews — rules for AI agents

## Purpose
Product reviews built on @core/comments (no duplicate comment system): a review is a comment on `product/<id>` with a
1–5 rating, plus `review_meta` (verified purchase, photos from @core/media, source) and `review_stats` per product.
"Verified" means the signed-in author has a paid and shipped order with that product (by user id or their account's
verified email); guest reviews are never verified, so the response never reveals whether an email bought. Imported reviews are always labeled with
their source and never verified. Asks customers for a review N days after delivery.

## Map
- `index.ts` — public API: `postReview`, `listReviews`, `productRating`, `moderateReview`, `importReviews`, `verifiedOrder`.
- `reviews.ts` — logic, stats and the `reviews.request` job (scheduled from the order `delivered` event on import).

## Integration
1. Requires @core/comments (moderation, anti-spam) and @core/orders. Env: optional `REVIEW_REQUEST_DELAY_DAYS` (default 7, `-1` disables), `SITE_URL`, `EMAIL_FROM`.
2. Migrations as in `src/lib/db/AGENTS.md`; import this module at startup.
3. Product page: `productRating(id)` for stars and JSON-LD (`jsonLd.product({ rating })` from @core/seo), `listReviews(id, { page, rating, sort })`
   for the list; show a "Verified purchase" badge and, for imported ones, "Imported from <source>".
4. Review form → `postReview({ productId, rating, body, user | guest, photos }, { headers, fields })` with @core/antispam fields.
5. Moderate in the comments admin (filter `entityType=product`) and call `moderateReview` so stats update.
6. Verify: a buyer's review shows as verified after approval and the product rating changes.

## Conventions
- Explain on the page how reviews are checked (EU Omnibus Directive): verified = confirmed order.
- Show all approved reviews, including negative ones; sort options must not hide them by default.

## Don't
- Don't write, generate or buy fake reviews, and don't mark imported reviews as verified.
- Don't put `aggregateRating` in JSON-LD when there are no approved reviews.
- Don't offer rewards conditioned on a positive review.
