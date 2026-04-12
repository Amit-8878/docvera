const ServiceRequest = require('../models/ServiceRequest');
const User = require('../models/User');

const ALLOWED_CAT = new Set(['government', 'private', 'personal']);

/** POST /api/service-request — user asks for a missing service (optional auth). */
async function createServiceRequest(req, res, next) {
  try {
    const body = req.body || {};
    const category = typeof body.category === 'string' ? body.category.trim().toLowerCase() : '';
    const industry = typeof body.industry === 'string' ? body.industry.trim().toLowerCase() : '';
    const message = typeof body.message === 'string' ? body.message.trim().slice(0, 2000) : '';

    if (category && !ALLOWED_CAT.has(category)) {
      return res.status(400).json({ message: 'Bad request', details: 'Invalid category' });
    }

    const userId = req.user && req.user.userId ? req.user.userId : null;
    let email = '';
    if (userId) {
      const u = await User.findById(userId).select('email').lean();
      email = u && u.email ? String(u.email) : '';
    }

    const doc = await ServiceRequest.create({
      userId: userId || null,
      email,
      category: category || '',
      industry: industry || '',
      message,
      status: 'open',
    });

    return res.status(201).json({ ok: true, id: String(doc._id) });
  } catch (err) {
    return next(err);
  }
}

module.exports = { createServiceRequest };
