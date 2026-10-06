// @core/reviews — API pública. Sobre @core/comments; al importarlo programa las solicitudes de reseña tras la entrega.
export {
  ENTITY,
  importReviews,
  listReviews,
  moderateReview,
  type ProductRating,
  type PublicReview,
  postReview,
  productRating,
  recomputeStats,
  registerReviewRequests,
  reviewRequestJob,
  verifiedOrder,
} from './reviews.ts';
export { reviewMeta, reviewStats } from './schema.ts';
