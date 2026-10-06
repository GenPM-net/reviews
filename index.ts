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
} from './reviews.js';
export { reviewMeta, reviewStats } from './schema.js';
