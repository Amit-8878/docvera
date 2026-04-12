const path = require('path');
const fs = require('fs');
const multer = require('multer');

const uploadDir = path.join(__dirname, '..', 'uploads', 'simple-orders');
try {
  fs.mkdirSync(uploadDir, { recursive: true });
} catch (_e) {
  // no-op
}

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, uploadDir);
  },
  filename(_req, file, cb) {
    const safe = (file.originalname || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}_${safe}`);
  },
});

const ALLOWED = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp'];

const upload = multer({
  storage,
  limits: { files: 8, fileSize: 8 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!ALLOWED.includes(ext)) {
      return cb(new Error('Unsupported file type'));
    }
    return cb(null, true);
  },
});

module.exports = { upload };
