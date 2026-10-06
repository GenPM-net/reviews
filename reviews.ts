// Reseñas de producto = comentarios con valoración + compra verificada, fotos, origen y agregados.
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type Comment, comments, moderate, type ModerationAction, postComment, ratingSummary } from '../comments/index.js';
import { getProductById, products } from '../catalog/index.js';
import { type Executor, getDb } from '../db/index.js';
import { getEmailProvider } from '../email/index.js';
import { defineJob } from '../jobs/index.js';
import { onOrderEvent, orderLines, orders } from '../orders/index.js';
import { reviewMeta, reviewStats } from './schema.js';

export const ENTITY = 'product';

/** ¿Tiene esta persona un pedido pagado y enviado con el producto? Devuelve el id del pedido. */
export async function verifiedOrder(productId: string, who: { userId?: string | null; email?: string | null }, db: Executor = getDb()): Promise<string | null> {
  if (!who.userId && !who.email) return null;
  const owner = who.userId ? eq(orders.userId, who.userId) : eq(orders.email, who.email!.trim().toLowerCase());
  const [row] = await db
    .select({ id: orders.id })
    .from(orders)
    .innerJoin(orderLines, eq(orderLines.orderId, orders.id))
    .where(and(owner, eq(orderLines.productId, productId), inArray(orders.status, ['paid', 'partially_refunded']), inArray(orders.fulfillmentStatus, ['fulfilled', 'delivered'])))
    .limit(1);
  return row?.id ?? null;
}

/** Recalcula el agregado de un producto con las reseñas aprobadas. */
export async function recomputeStats(productId: string, db: Executor = getDb()): Promise<void> {
  const s = await ratingSummary(ENTITY, productId, db);
  const values = { count: s.count, average: Math.round(s.average * 100), histogram: s.histogram };
  await db.insert(reviewStats).values({ productId, ...values }).onConflictDoUpdate({ target: reviewStats.productId, set: values });
}

export type ProductRating = { count: number; average: number; histogram: [number, number, number, number, number] };

export async function productRating(productId: string, db: Executor = getDb()): Promise<ProductRating> {
  const [r] = await db.select().from(reviewStats).where(eq(reviewStats.productId, productId));
  return r ? { count: r.count, average: r.average / 100, histogram: r.histogram } : { count: 0, average: 0, histogram: [0, 0, 0, 0, 0] };
}

/**
 * Publica una reseña (pasa por moderación según @core/comments). La valoración es obligatoria. Marca compra
 * verificada si procede. `photos` son ids de @core/media ya confirmados.
 */
export async function postReview(
  input: {
    productId: string;
    rating: number;
    body: string;
    photos?: string[];
    user?: { id: string; name: string | null } | null;
    guest?: { name: string; email: string };
  },
  ctx: { headers: Headers; fields: FormData | Record<string, unknown>; skipAntispam?: boolean },
  db: Executor = getDb(),
): Promise<Comment & { verified: boolean }> {
  z.number().int().min(1).max(5).parse(input.rating);
  if (!(await getProductById(input.productId, db))) throw new Error('unknown product');
  const c = await postComment({ entityType: ENTITY, entityId: input.productId, body: input.body, rating: input.rating, user: input.user, ...(input.guest && { guest: input.guest }) }, ctx, db);
  const orderId = await verifiedOrder(input.productId, { userId: input.user?.id, email: input.guest?.email }, db);
  await db.insert(reviewMeta).values({ commentId: c.id, productId: input.productId, verified: !!orderId, orderId, photos: (input.photos ?? []).slice(0, 6) });
  await recomputeStats(input.productId, db);
  return { ...c, verified: !!orderId };
}

/** Moderar una reseña y actualizar el agregado del producto. */
export async function moderateReview(commentId: string, action: ModerationAction, db: Executor = getDb()): Promise<Comment> {
  const c = await moderate(commentId, action, db);
  await recomputeStats(c.entityId, db);
  return c;
}

const Imported = z.object({ author: z.string().min(1).max(80), rating: z.number().int().min(1).max(5), body: z.string().min(1).max(5000), date: z.coerce.date().optional() });

/**
 * Importa reseñas de otro sitio (p. ej. del proveedor). Se publican aprobadas, NUNCA como verificadas, y con su
 * origen visible (obligatorio informar de cómo se verifican: Directiva Ómnibus).
 */
export async function importReviews(productId: string, rows: Array<z.input<typeof Imported>>, source: string, db: Executor = getDb()): Promise<number> {
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(source) || source === 'site') throw new Error('invalid source');
  let n = 0;
  for (const raw of rows) {
    const r = Imported.parse(raw);
    const [c] = await db
      .insert(comments)
      .values({ entityType: ENTITY, entityId: productId, authorName: r.author, body: r.body, rating: r.rating, status: 'approved', ...(r.date && { createdAt: r.date }) })
      .returning();
    await db.insert(reviewMeta).values({ commentId: c!.id, productId, verified: false, source });
    n++;
  }
  await recomputeStats(productId, db);
  return n;
}

export type PublicReview = { id: string; authorName: string; rating: number; body: string; createdAt: Date; verified: boolean; source: string; photos: string[] };

/** Reseñas aprobadas de un producto, con filtro por estrellas. */
export async function listReviews(productId: string, opts: { page?: number; perPage?: number; rating?: number; sort?: 'newest' | 'highest' | 'lowest' } = {}, db: Executor = getDb()): Promise<{ reviews: PublicReview[]; total: number }> {
  const perPage = Math.min(Math.max(opts.perPage ?? 10, 1), 50);
  const where = and(eq(comments.entityType, ENTITY), eq(comments.entityId, productId), eq(comments.status, 'approved'), sql`${comments.rating} is not null`, opts.rating ? eq(comments.rating, opts.rating) : undefined);
  const order = opts.sort === 'highest' ? [desc(comments.rating), desc(comments.createdAt)] : opts.sort === 'lowest' ? [comments.rating, desc(comments.createdAt)] : [desc(comments.createdAt)];
  const [total] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(comments).where(where);
  const rows = await db
    .select({ c: comments, m: reviewMeta })
    .from(comments)
    .leftJoin(reviewMeta, eq(reviewMeta.commentId, comments.id))
    .where(where)
    .orderBy(...order, comments.id)
    .limit(perPage)
    .offset((Math.max(opts.page ?? 1, 1) - 1) * perPage);
  return {
    total: total?.n ?? 0,
    reviews: rows.map(({ c, m }) => ({ id: c.id, authorName: c.authorName, rating: c.rating!, body: c.body, createdAt: c.createdAt, verified: m?.verified ?? false, source: m?.source ?? 'site', photos: m?.photos ?? [] })),
  };
}

const delayDays = () => Number(process.env.REVIEW_REQUEST_DELAY_DAYS ?? 7);

/** Email pidiendo reseña N días después de la entrega (una por producto del pedido). */
export const reviewRequestJob = defineJob('reviews.request', z.object({ orderId: z.string() }), async ({ orderId }) => {
  const from = process.env.EMAIL_FROM;
  const site = process.env.SITE_URL;
  if (!from || !site) return;
  const [o] = await getDb().select().from(orders).where(eq(orders.id, orderId));
  if (!o || (o.status !== 'paid' && o.status !== 'partially_refunded')) return;
  const lines = await getDb().select({ productId: orderLines.productId, name: orderLines.name }).from(orderLines).where(eq(orderLines.orderId, orderId));
  const ids = [...new Set(lines.map((l) => l.productId).filter((x): x is string => !!x))];
  const prods = ids.length ? await getDb().select({ id: products.id, slug: products.slug, name: products.name }).from(products).where(inArray(products.id, ids)) : [];
  if (!prods.length) return;
  const links = prods.map((p) => [p.name, new URL(`/products/${p.slug}#reviews`, site).toString()] as const);
  const esc = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  await getEmailProvider().send({
    from,
    to: o.email,
    subject: 'How was your order?',
    text: `We hope you're enjoying your purchase. Would you leave a review?\n\n${links.map(([n, u]) => `${n}: ${u}`).join('\n')}`,
    html: `<p>We hope you're enjoying your purchase. Would you leave a review?</p><ul>${links.map(([n, u]) => `<li><a href="${esc(u)}">${esc(n)}</a></li>`).join('')}</ul>`,
  });
});

/** Programa la solicitud de reseña al entregarse un pedido. Se llama al importar el módulo. */
export function registerReviewRequests(): void {
  onOrderEvent('delivered', 'reviews.request', async (o) => {
    if (delayDays() < 0) return;
    await reviewRequestJob.enqueue({ orderId: o.id }, { runAt: new Date(Date.now() + delayDays() * 86_400_000), dedupeKey: `reviews.request:${o.id}` });
  });
}
registerReviewRequests();
