const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { adminOnly } = require('../middleware/adminMiddleware');
const Template = require('../models/Template');
const { LAYOUT_KEYS } = require('../utils/invoiceTemplate');

const router = express.Router();

const LAYOUT_SET = new Set(LAYOUT_KEYS);

const UPSERT_FIELDS = [
  'companyName',
  'logoUrl',
  'address',
  'email',
  'phone',
  'website',
  'gstin',
  'terms',
  'signatureUrl',
  'stampUrl',
  'footerNote',
  'layout',
];

function emptyTemplateForType(type) {
  return {
    type,
    companyName: '',
    logoUrl: '',
    address: '',
    email: '',
    phone: '',
    website: '',
    gstin: '',
    terms: [],
    signatureUrl: '',
    stampUrl: '',
    footerNote: '',
    layout: [...LAYOUT_KEYS],
  };
}

function pickTemplateBody(body) {
  const out = {};
  if (!body || typeof body !== 'object') return out;
  for (const key of UPSERT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      if (key === 'terms') {
        out.terms = Array.isArray(body.terms)
          ? body.terms.map((t) => String(t ?? '').trim()).filter(Boolean)
          : [];
      } else if (key === 'layout') {
        if (Array.isArray(body.layout)) {
          const seen = new Set();
          out.layout = [];
          for (const item of body.layout) {
            const k = String(item ?? '').trim();
            if (LAYOUT_SET.has(k) && !seen.has(k)) {
              out.layout.push(k);
              seen.add(k);
            }
          }
        }
      } else {
        out[key] = body[key] == null ? '' : String(body[key]).trim();
      }
    }
  }
  return out;
}

router.get('/template/:type', authMiddleware, adminOnly, async (req, res) => {
  const type = String(req.params.type || '').trim();
  if (!type) {
    return res.status(400).json({ message: 'Bad request', details: 'type is required' });
  }
  const doc = await Template.findOne({ type }).lean();
  if (!doc) {
    return res.status(200).json(emptyTemplateForType(type));
  }
  return res.status(200).json(doc);
});

router.post('/template/:type', authMiddleware, adminOnly, async (req, res) => {
  const type = String(req.params.type || '').trim();
  if (!type) {
    return res.status(400).json({ message: 'Bad request', details: 'type is required' });
  }
  const payload = pickTemplateBody(req.body);
  const doc = await Template.findOneAndUpdate(
    { type },
    { $set: { type, ...payload } },
    { upsert: true, new: true, runValidators: true }
  ).lean();
  return res.status(200).json(doc);
});

module.exports = router;
