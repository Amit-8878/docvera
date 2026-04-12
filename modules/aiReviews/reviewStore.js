const Review = require('../../models/Review');

/** Daily submission counts: key = `${identity}|${dayISO}` (identity = phone mask or session+IP) */
const submitterDaily = new Map();

const MAX_TOTAL_REVIEWS = 75;

const SPAM_SUBSTRINGS = [
  'click here',
  'viagra',
  'http://',
  'https://',
  'bit.ly',
  'casino',
  'bitcoin',
  'crypto airdrop',
  'whatsapp me',
];

/** +91****dddd — treat as session/device identity, not a stable user phone. */
function isAutoStyleMaskedPhone(p) {
  return /^\+91\*\*\*\*\d{4}$/.test(String(p || '').trim());
}

function dailyIdentity(submitterKey, phoneMasked) {
  const p = String(phoneMasked || '').trim();
  if (p.length > 8 && !isAutoStyleMaskedPhone(p)) {
    return `p:${p}`;
  }
  return `s:${String(submitterKey || '').trim() || 'anon'}`;
}

/**
 * User review validation (admin posts validated separately in adminReviews).
 */
function validateReviewInput(text, rating) {
  const t = String(text || '').trim();
  if (t.length <= 10) {
    return { ok: false, reason: 'invalid_text' };
  }
  const r = Number(rating);
  if (!Number.isFinite(r) || r < 1 || r > 5) {
    return { ok: false, reason: 'invalid_rating' };
  }
  const low = t.toLowerCase();
  for (const w of SPAM_SUBSTRINGS) {
    if (low.includes(w)) {
      return { ok: false, reason: 'spam' };
    }
  }
  return { ok: true };
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randomEl(arr) {
  if (!arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function normalizeText(t) {
  return String(t || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSource(r) {
  const s = r.source;
  if (s === 'generated') return 'ai';
  return s || 'ai';
}

function normalizeStatus(r) {
  if (r.status) return r.status;
  if (normalizeSource(r) === 'user') return 'pending';
  return 'approved';
}

function toDTO(doc) {
  if (!doc) return null;
  const o = doc.toObject ? doc.toObject() : doc;
  const id = o._id ? String(o._id) : String(o.id);
  return {
    id,
    name: o.name,
    location: o.location || '—',
    phoneMasked: o.phoneMasked || '+91****0000',
    text: o.text,
    rating: o.rating,
    type: o.type || 'positive',
    source: normalizeSource(o),
    status: o.status || 'approved',
    createdAt: o.createdAt instanceof Date ? o.createdAt.toISOString() : o.createdAt,
  };
}

function dayISO() {
  return new Date().toISOString().slice(0, 10);
}

async function isDuplicateText(text) {
  const n = normalizeText(text);
  if (n.length < 11) return false;
  const found = await Review.findOne({ textNorm: n }).lean();
  return !!found;
}

/**
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
async function canSubmitUserReview(submitterKey, text, phoneMasked) {
  const day = dayISO();
  const idKey = dailyIdentity(submitterKey, phoneMasked);
  const k = `${idKey}|${day}`;
  const count = submitterDaily.get(k) || 0;
  if (count >= 2) {
    return { ok: false, reason: 'daily_limit' };
  }
  if (await isDuplicateText(text)) {
    return { ok: false, reason: 'duplicate' };
  }
  return { ok: true };
}

function recordUserSubmission(submitterKey, phoneMasked) {
  const k = `${dailyIdentity(submitterKey, phoneMasked)}|${dayISO()}`;
  submitterDaily.set(k, (submitterDaily.get(k) || 0) + 1);
}

async function trimStoreToMax(max = MAX_TOTAL_REVIEWS) {
  let total = await Review.countDocuments();
  while (total > max) {
    let doc = await Review.findOne({ source: 'ai', status: 'approved' })
      .sort({ createdAt: 1 })
      .select('_id')
      .lean();
    if (!doc) {
      doc = await Review.findOne({ source: 'ai' })
        .sort({ createdAt: 1 })
        .select('_id')
        .lean();
    }
    if (!doc) {
      doc = await Review.findOne({ status: { $ne: 'pending' } })
        .sort({ createdAt: 1 })
        .select('_id')
        .lean();
    }
    if (!doc) break;
    await Review.findByIdAndDelete(doc._id);
    total = await Review.countDocuments();
  }
}

async function addReview(review) {
  const text = String(review.text || '').trim();
  if (!text) return null;

  let source = review.source || 'ai';
  if (source === 'generated') source = 'ai';
  if (!['admin', 'user', 'ai'].includes(source)) source = 'ai';

  let name = String(review.name || '').trim();
  if (!name) name = source === 'user' ? 'Anonymous' : '—';

  let status = review.status;
  if (!status) {
    if (source === 'user') status = 'pending';
    else status = 'approved';
  }

  const doc = await Review.create({
    name,
    location: String(review.location || '').trim() || '—',
    phoneMasked: String(review.phoneMasked || '').trim() || '+91****0000',
    text,
    textNorm: normalizeText(text),
    rating: Math.min(5, Math.max(1, Number(review.rating) || 5)),
    type: review.type === 'negative' ? 'negative' : 'positive',
    source,
    status,
    createdAt: review.createdAt ? new Date(review.createdAt) : new Date(),
  });

  await trimStoreToMax(MAX_TOTAL_REVIEWS);
  return toDTO(doc);
}

async function addUserReview({ name, text, rating, location, phoneMasked, submitterKey }) {
  const v = validateReviewInput(text, rating);
  if (!v.ok) return { error: v.reason };

  const check = await canSubmitUserReview(submitterKey, text, phoneMasked);
  if (!check.ok) return { error: check.reason };

  const row = await addReview({
    name: name || 'Anonymous',
    text,
    rating,
    location,
    phoneMasked,
    source: 'user',
    status: 'pending',
    type: Number(rating) <= 2 ? 'negative' : 'positive',
  });
  if (row) recordUserSubmission(submitterKey, phoneMasked);
  return { review: row };
}

async function updateReviewStatus(id, status) {
  if (status !== 'approved' && status !== 'rejected' && status !== 'pending') return false;
  const doc = await Review.findByIdAndUpdate(
    id,
    { status },
    { new: true, runValidators: true }
  );
  return !!doc;
}

async function updateReviewFields(id, patch) {
  const allowed = ['name', 'location', 'phoneMasked', 'text', 'rating', 'type', 'status'];
  const upd = {};
  for (const k of allowed) {
    if (patch[k] !== undefined) upd[k] = patch[k];
  }
  if (upd.text !== undefined) {
    upd.textNorm = normalizeText(String(upd.text));
  }
  if (Object.keys(upd).length === 0) return null;
  const doc = await Review.findByIdAndUpdate(id, { $set: upd }, { new: true, runValidators: true });
  return doc ? toDTO(doc) : null;
}

async function getAllReviews() {
  const rows = await Review.find().sort({ createdAt: -1 }).lean();
  return rows.map((r) => toDTO({ ...r, _id: r._id }));
}

async function deleteReview(id) {
  const res = await Review.findByIdAndDelete(id);
  return !!res;
}

async function approvedList() {
  const rows = await Review.find({ status: 'approved' }).lean();
  return rows.map((r) => toDTO({ ...r, _id: r._id }));
}

/**
 * ~70% AI / ~30% admin in 8 slots when both exist; only approved; includes approved user when available.
 */
async function buildCarouselPool(size = 8) {
  const genMod = require('./reviewGenerator');

  let guard = 0;
  while (guard < 40) {
    const n = await Review.countDocuments({ source: 'ai', status: 'approved' });
    if (n >= size + 2) break;
    await genMod.generateReview();
    guard++;
  }

  const approved = await approvedList();
  const admin = shuffle(approved.filter((r) => r.source === 'admin'));
  const user = shuffle(approved.filter((r) => r.source === 'user'));
  const ai = shuffle(approved.filter((r) => normalizeSource(r) === 'ai'));

  const targetAdmin = Math.min(3, admin.length);
  let pool = [...admin.slice(0, targetAdmin)];

  const needUser = Math.min(2, user.length, Math.max(0, size - pool.length));
  pool = pool.concat(user.slice(0, needUser));

  const needAi = size - pool.length;
  pool = pool.concat(ai.slice(0, Math.min(needAi, ai.length)));

  const seen = new Set(pool.map((r) => r.id));
  let fill = 0;
  while (pool.length < size && fill < 50) {
    const last = await genMod.generateReview();
    if (last && normalizeStatus(last) === 'approved' && normalizeSource(last) === 'ai' && !seen.has(last.id)) {
      seen.add(last.id);
      pool.push(last);
    }
    fill++;
  }

  return shuffle(pool).slice(0, size);
}

/**
 * Prefer admin > user > AI; only approved rows (or freshly generated AI = approved).
 */
async function pickNextCarouselReview(avoidTexts = [], excludeIds = []) {
  const genMod = require('./reviewGenerator');
  const avoid = new Set(avoidTexts.filter(Boolean));
  const exclude = new Set(excludeIds.map(String).filter(Boolean));

  const pickPool = (arr) =>
    arr.filter((r) => !exclude.has(String(r.id)) && !avoid.has(r.text));

  const approved = await approvedList();
  let admins = pickPool(approved.filter((r) => r.source === 'admin'));
  let users = pickPool(approved.filter((r) => r.source === 'user'));
  let ais = pickPool(approved.filter((r) => normalizeSource(r) === 'ai'));

  const roll = Math.random();
  if (roll < 0.45 && admins.length) {
    return { ...randomEl(admins) };
  }
  if (roll < 0.75 && users.length) {
    return { ...randomEl(users) };
  }
  if (ais.length) {
    return { ...randomEl(ais) };
  }

  admins = approved.filter((r) => r.source === 'admin').filter((a) => !avoid.has(a.text));
  users = approved.filter((r) => r.source === 'user').filter((a) => !avoid.has(a.text));
  ais = approved.filter((r) => normalizeSource(r) === 'ai').filter((a) => !avoid.has(a.text));

  if (admins.length) {
    return { ...randomEl(admins) };
  }
  if (users.length) {
    return { ...randomEl(users) };
  }
  if (ais.length) {
    return { ...randomEl(ais) };
  }

  let tries = 0;
  let r = await genMod.generateReview();
  while ((avoid.has(r.text) || exclude.has(String(r.id))) && tries < 18) {
    r = await genMod.generateReview();
    tries++;
  }
  return r;
}

module.exports = {
  getAllReviews,
  addReview,
  addUserReview,
  updateReviewStatus,
  updateReviewFields,
  deleteReview,
  buildCarouselPool,
  pickNextCarouselReview,
  validateReviewInput,
  MAX_TOTAL_REVIEWS,
};
