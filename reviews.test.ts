import { beforeEach, describe, expect, it } from 'vitest';
import { formTimingToken } from '../antispam/index.ts';
import * as antispamSchema from '../antispam/schema.ts';
import { upsertOAuthUser } from '../auth/index.ts';
import * as authSchema from '../auth/schema.ts';
import { createProduct, getProduct } from '../catalog/index.ts';
import * as catalogSchema from '../catalog/schema.ts';
import * as commentsSchema from '../comments/schema.ts';
import { testDb } from '../db/__fixtures__/pglite.ts';
import { type EmailMessage, setEmailProvider } from '../email/index.ts';
import { jobs, runDue } from '../jobs/index.ts';
import * as jobsSchema from '../jobs/schema.ts';
import { addFulfillment, createOrder, markDelivered } from '../orders/index.ts';
import * as ordersSchema from '../orders/schema.ts';
import { getDb } from '../db/index.ts';
import * as schema from './schema.ts';
import { importReviews, listReviews, moderateReview, postReview, productRating } from './index.ts';

let productId: string;
let variantId: string;
const sent: EmailMessage[] = [];
const ctx = async () => ({ headers: new Headers({ 'x-forwarded-for': `203.0.113.${Math.floor(Math.random() * 250)}` }), fields: { _ts: await formTimingToken(Date.now() - 5000) } });

beforeEach(async () => {
  await testDb(authSchema, antispamSchema, catalogSchema, commentsSchema, ordersSchema, jobsSchema, schema);
  Object.assign(process.env, { ANTISPAM_SECRET: 'a'.repeat(40), AUTH_SECRET: 'x'.repeat(40), STORE_CURRENCY: 'EUR', ORDER_LINK_SECRET: 'o'.repeat(40), SITE_URL: 'https://shop.test', EMAIL_FROM: 's@shop.test', REVIEW_REQUEST_DELAY_DAYS: '7' });
  delete process.env.COMMENTS_NOTIFY_TO;
  sent.length = 0;
  setEmailProvider({ name: 't', send: async (m) => (sent.push(m), { id: null }) });
  await createProduct({ slug: 'mug', name: 'Mug', status: 'active', variants: [{ price: 1500, stock: 10 }] });
  const p = (await getProduct('mug'))!;
  productId = p.id;
  variantId = p.variants[0]!.id;
});

async function deliveredOrder(email: string, userId: string | null = null) {
  const o = await createOrder({
    email,
    userId,
    currency: 'EUR',
    lines: [{ variantId, productId, sku: null, name: 'Mug', title: '', kind: 'physical', quantity: 1, unitPrice: 1500, discount: 0 }],
    payment: { provider: 'manual', ref: 'x', status: 'paid' },
  });
  const f = await addFulfillment(o.id, {});
  await markDelivered(f.id);
  return o;
}

describe('reviews', () => {
  it('marks verified purchases (by user or guest email) and keeps others unverified', async () => {
    const u = await upsertOAuthUser('github', { id: '1', email: null, emailVerified: false, name: 'Ana', avatarUrl: null });
    await deliveredOrder('ana@x.test', u.id);
    await deliveredOrder('bob@x.test');
    const a = await postReview({ productId, rating: 5, body: 'Lovely mug', user: { id: u.id, name: 'Ana' } }, await ctx());
    const b = await postReview({ productId, rating: 4, body: 'Nice', guest: { name: 'Bob', email: 'BOB@x.test' } }, await ctx());
    const c = await postReview({ productId, rating: 1, body: 'Never bought it', guest: { name: 'Eve', email: 'eve@x.test' } }, await ctx());
    expect([a.verified, b.verified, c.verified]).toEqual([true, true, false]);
    expect((await productRating(productId)).count).toBe(0); // pendientes de moderación
    for (const r of [a, b, c]) await moderateReview(r.id, 'approve');
    expect(await productRating(productId)).toEqual({ count: 3, average: 3.33, histogram: [1, 0, 0, 1, 1] });
    const list = await listReviews(productId, { sort: 'highest' });
    expect(list.reviews.map((r) => [r.authorName, r.rating, r.verified])).toEqual([['Ana', 5, true], ['Bob', 4, true], ['Eve', 1, false]]);
    expect((await listReviews(productId, { rating: 1 })).reviews.map((r) => r.authorName)).toEqual(['Eve']);
    await moderateReview(c.id, 'delete');
    expect((await productRating(productId)).average).toBe(4.5);
  });

  it('a pending (unpaid or unshipped) order does not verify', async () => {
    await createOrder({ email: 'p@x.test', currency: 'EUR', lines: [{ variantId, productId, sku: null, name: 'Mug', title: '', kind: 'physical', quantity: 1, unitPrice: 1500, discount: 0 }], payment: { provider: 'manual', ref: 'x', status: 'paid' } });
    const r = await postReview({ productId, rating: 5, body: 'Arrived yet?', guest: { name: 'P', email: 'p@x.test' } }, await ctx());
    expect(r.verified).toBe(false);
    await expect(postReview({ productId, rating: 6, body: 'Too good', guest: { name: 'P', email: 'p@x.test' } }, await ctx())).rejects.toThrow();
    await expect(postReview({ productId: 'prd_nope', rating: 5, body: 'Hello', guest: { name: 'P', email: 'p@x.test' } }, await ctx())).rejects.toThrow(/unknown product/);
  });

  it('imported reviews are approved, never verified, and show their source', async () => {
    expect(await importReviews(productId, [{ author: 'Li', rating: 5, body: 'Good', date: '2026-01-01' }, { author: 'Mo', rating: 3, body: 'Ok' }], 'aliexpress')).toBe(2);
    const list = await listReviews(productId);
    expect(list.reviews.every((r) => r.source === 'aliexpress' && !r.verified)).toBe(true);
    expect((await productRating(productId)).count).toBe(2);
    await expect(importReviews(productId, [], 'site')).rejects.toThrow(/invalid source/);
  });

  it('asks for a review some days after delivery', async () => {
    await deliveredOrder('ana@x.test');
    await runDue(); // eventos del pedido: confirmación, enviado y programación de la solicitud
    const pending = (await getDb().select().from(jobs)).filter((j) => j.type === 'reviews.request');
    expect(pending).toHaveLength(1);
    expect(pending[0]!.runAt.getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    await runDue({ now: new Date(Date.now() + 8 * 86_400_000) });
    const ask = sent.find((m) => m.subject === 'How was your order?');
    expect(ask?.text).toContain('https://shop.test/products/mug#reviews');
  });
});
