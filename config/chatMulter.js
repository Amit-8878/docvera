const path = require('path');
const fs = require('fs');
const multer = require('multer');

const uploadDir = path.join(__dirname, '..', 'uploads', 'chat');
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
    cb(null, `${Date.now()}-${safe}`);
  },
});

const ALLOWED = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.webm', '.ogg', '.mp3', '.m4a', '.wav'];

const upload = multer({
  storage,
  limits: { fileSize: 12 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!ALLOWED.includes(ext)) {
      return cb(new Error('Only PDF, images, and audio are allowed'));
    }
    return cb(null, true);
  },
});

module.exports = { upload, uploadDir };
