const store = require('./reviewStore');

function maskPhoneInput(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length >= 10) {
    const last4 = digits.slice(-4);
    return '+91****' + last4;
  }
  if (String(raw || '').trim().startsWith('+91')) {
    return String(raw).trim();
  }
  const last4 = Math.floor(1000 + Math.random() * 9000);
  return '+91****' + last4;
}

function randomMaskedPhone() {
  return '+91****' + Math.floor(1000 + Math.random() * 9000);
}

async function getReviews(req, res) {
  try {
    const reviews = await store.getAllReviews();
    res.json({ reviews });
  } catch (e) {
    res.status(500).json({ message: 'Failed to load reviews' });
  }
}

async function postReview(req, res) {
  try {
    const body = req.body || {};
    const v = store.validateReviewInput(body.text, body.rating);
    if (!v.ok) {
      const msg =
        v.reason === 'invalid_text'
          ? 'Review must be more than 10 characters.'
          : v.reason === 'invalid_rating'
            ? 'Rating must be between 1 and 5.'
            : 'Review contains disallowed content.';
      return res.status(400).json({ message: msg, code: v.reason });
    }
    const phoneMasked = body.phoneMasked ? String(body.phoneMasked).trim() : maskPhoneInput(body.phone);
    const row = await store.addReview({
      name: body.name,
      location: body.location,
      phoneMasked,
      text: body.text,
      rating: body.rating,
      type: body.type,
      source: 'admin',
      status: 'approved',
    });
    if (!row) {
      return res.status(400).json({ message: 'Review text is required' });
    }
    res.status(201).json({ review: row });
  } catch (e) {
    res.status(500).json({ message: 'Failed to add review' });
  }
}

async function patchReviewStatus(req, res) {
  try {
    const body = req.body || {};
    const status = body.status;
    if (status !== 'approved' && status !== 'rejected' && status !== 'pending') {
      return res.status(400).json({ message: 'Invalid status' });
    }
    const ok = await store.updateReviewStatus(req.params.id, status);
    if (!ok) {
      return res.status(404).json({ message: 'Not found' });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: 'Failed to update' });
  }
}

/** PATCH /api/reviews/:id — partial field update and/or status */
async function updateReview(req, res) {
  try {
    const body = req.body || {};
    const keys = Object.keys(body).filter((k) => body[k] !== undefined);
    if (keys.length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }
    if (keys.length === 1 && keys[0] === 'status') {
      const status = body.status;
      if (status !== 'approved' && status !== 'rejected' && status !== 'pending') {
        return res.status(400).json({ message: 'Invalid status' });
      }
      const ok = await store.updateReviewStatus(req.params.id, status);
      if (!ok) {
        return res.status(404).json({ message: 'Not found' });
      }
      return res.json({ ok: true });
    }
    const patch = { ...body };
    if (patch.rating !== undefined) patch.rating = Number(patch.rating);
    const row = await store.updateReviewFields(req.params.id, patch);
    if (!row) {
      return res.status(404).json({ message: 'Not found' });
    }
    res.json({ review: row });
  } catch (e) {
    res.status(500).json({ message: 'Failed to update review' });
  }
}

async function approveReview(req, res) {
  try {
    const ok = await store.updateReviewStatus(req.params.id, 'approved');
    if (!ok) {
      return res.status(404).json({ message: 'Not found' });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: 'Failed to approve' });
  }
}

async function deleteReview(req, res) {
  try {
    const ok = await store.deleteReview(req.params.id);
    if (!ok) {
      return res.status(404).json({ message: 'Not found' });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: 'Failed to delete' });
  }
}

async function getCarouselReviews(req, res) {
  try {
    const pool = await store.buildCarouselPool(8);
    res.json({ reviews: pool });
  } catch (e) {
    res.status(500).json({ message: 'Failed to build carousel' });
  }
}

async function getNextCarouselReview(req, res) {
  try {
    const raw = String(req.query.avoid || '');
    const avoid = raw
      ? raw
          .split(',')
          .map((s) => decodeURIComponent(s.trim()))
          .filter(Boolean)
      : [];
    const idRaw = String(req.query.excludeIds || '');
    const excludeIds = idRaw
      ? idRaw
          .split(',')
          .map((s) => decodeURIComponent(s.trim()))
          .filter(Boolean)
      : [];
    const review = await store.pickNextCarouselReview(avoid, excludeIds);
    res.json({ review });
  } catch (e) {
    res.status(500).json({ message: 'Failed to get next review' });
  }
}

async function postUserReview(req, res) {
  try {
    const body = req.body || {};
    const text = String(body.text || '').trim();

    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '')
      .split(',')[0]
      .trim() || 'unknown';
    const submitterId = String(body.submitterId || '').trim() || 'anon';
    const compositeKey = `${submitterId}|${ip}`;

    const phoneMasked = body.phoneMasked ? String(body.phoneMasked).trim() : randomMaskedPhone();
    const location = String(body.location || '').trim() || 'India';

    const result = await store.addUserReview({
      name: body.name,
      text,
      rating: body.rating,
      location,
      phoneMasked,
      submitterKey: compositeKey,
    });

    if (result.error === 'invalid_text') {
      return res.status(400).json({
        message: 'Please write a bit more (more than 10 characters).',
        code: 'invalid_text',
      });
    }
    if (result.error === 'invalid_rating') {
      return res.status(400).json({
        message: 'Rating must be between 1 and 5.',
        code: 'invalid_rating',
      });
    }
    if (result.error === 'spam') {
      return res.status(400).json({
        message: 'Review could not be submitted.',
        code: 'spam',
      });
    }
    if (result.error === 'daily_limit') {
      return res.status(429).json({
        message: 'You can submit at most 2 reviews per day from this device.',
        code: 'daily_limit',
      });
    }
    if (result.error === 'duplicate') {
      return res.status(409).json({
        message: 'A very similar review already exists.',
        code: 'duplicate',
      });
    }

    res.status(201).json({ review: result.review, pending: true });
  } catch (e) {
    res.status(500).json({ message: 'Failed to submit review' });
  }
}

module.exports = {
  getReviews,
  postReview,
  patchReviewStatus,
  updateReview,
  approveReview,
  deleteReview,
  getCarouselReviews,
  getNextCarouselReview,
  postUserReview,
};
