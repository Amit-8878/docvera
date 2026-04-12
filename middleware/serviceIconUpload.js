const path = require('path');
const multer = require('multer');
const { UPLOAD_ROOT } = require('../modules/files/file.service');

const serviceIconDir = path.join(UPLOAD_ROOT, 'services', 'icons');

const iconStorage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, serviceIconDir);
  },
  filename(_req, file, cb) {
    const safe = (file.originalname || 'icon').replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}_${safe}`);
  },
});

const serviceIconUpload = multer({
  storage: iconStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)) {
      return cb(new Error('Icon must be an image (jpg, png, webp, gif)'));
    }
    return cb(null, true);
  },
});

function optionalServiceIconUpload(req, res, next) {
  const ct = String(req.headers['content-type'] || '');
  if (ct.toLowerCase().includes('multipart/form-data')) {
    return serviceIconUpload.single('icon')(req, res, (err) => {
      if (err) {
        return res.status(400).json({
          message: 'Bad request',
          details: err.message || 'Icon upload failed',
        });
      }
      return next();
    });
  }
  return next();
}

try {
  require('fs').mkdirSync(serviceIconDir, { recursive: true });
} catch (_e) {
  /* no-op */
}

module.exports = {
  optionalServiceIconUpload,
};
