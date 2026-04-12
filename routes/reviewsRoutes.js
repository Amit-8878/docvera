const express = require('express');
const adminReviews = require('../modules/aiReviews/adminReviews');
const { requireAdminReviewKey } = require('../middleware/adminReviewKeyMiddleware');

const router = express.Router();

router.use(requireAdminReviewKey);

router.get('/', adminReviews.getReviews);
router.post('/', adminReviews.postReview);
router.delete('/:id', adminReviews.deleteReview);
router.patch('/:id', adminReviews.updateReview);
router.post('/:id/approve', adminReviews.approveReview);

module.exports = router;
