const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const authMiddleware = require('../middleware/authMiddleware');
const requireEmailVerified = require('../middleware/requireEmailVerified');
const { requireFeatureEnabled } = require('../middleware/systemFeatureMiddleware');
const { postCheckoutSession } = require('../controllers/checkoutSessionController');
const { UPLOAD_ROOT } = require('../modules/files/file.service');

const router = express.Router();

const tmpDir = path.join(UPLOAD_ROOT, 'tmp', 'checkout-uploads');
try {
  fs.mkdirSync(tmpDir, { recursive: true });
} catch (_e) {
  // no-op
}

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, tmpDir);
  },
  filename(_req, file, cb) {
    const safe = (file.originalname || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}_${safe}`);
  },
});

const ALLOWED_EXT = ['.pdf', '.jpg', '.jpeg', '.png'];
const upload = multer({
  storage,
  limits: {
    files: 8,
    fileSize: 8 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      return cb(new Error('Unsupported file type'));
    }
    return cb(null, true);
  },
});

router.post(
  '/session',
  authMiddleware,
  requireEmailVerified,
  requireFeatureEnabled('orders_enabled'),
  requireFeatureEnabled('uploads_enabled'),
  upload.any(),
  postCheckoutSession
);

module.exports = router;
