// Tablas de @core/reviews. Las reseñas son comentarios (@core/comments) con valoración; aquí solo sus datos extra.
import { boolean, integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import { comments } from '../comments/index.js';
import { timestamps } from '../db/index.js';

export const reviewMeta = pgTable('review_meta', {
  commentId: text('comment_id')
    .primaryKey()
    .references(() => comments.id, { onDelete: 'cascade' }),
  productId: text('product_id').notNull(),
  /** Compra comprobada: el autor tiene un pedido pagado y enviado con este producto. */
  verified: boolean('verified').notNull().default(false),
  orderId: text('order_id'),
  /** `site` o el origen de una reseña importada (`aliexpress`, `trustpilot`…), que se muestra siempre. */
  source: text('source').notNull().default('site'),
  photos: jsonb('photos').$type<string[]>().notNull().default([]),
  ...timestamps,
});

/** Agregado por producto (se recalcula al publicar o moderar). `average` × 100. */
export const reviewStats = pgTable('review_stats', {
  productId: text('product_id').primaryKey(),
  count: integer('count').notNull().default(0),
  average: integer('average').notNull().default(0),
  histogram: jsonb('histogram').$type<[number, number, number, number, number]>().notNull().default([0, 0, 0, 0, 0]),
  ...timestamps,
});
