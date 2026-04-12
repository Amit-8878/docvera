const Review = require('../models/Review');
const { generateReview } = require('../modules/aiReviews/reviewGenerator');

/**
 * Ensure at least 10 reviews exist (AI-generated) for carousel / UX.
 */
async function seedReviewsIfNeeded() {
  const count = await Review.countDocuments();
  if (count >= 10) return;
  const need = 10 - count;
  for (let i = 0; i < need; i++) {
    await generateReview();
  }
  // eslint-disable-next-line no-console
  console.log(`[reviews] Seeded ${need} AI review(s); total=${await Review.countDocuments()}`);
}

module.exports = { seedReviewsIfNeeded };
