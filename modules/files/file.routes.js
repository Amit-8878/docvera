const express = require('express');
const path = require('path');
const multer = require('multer');

const authMiddleware = require('../../middleware/authMiddleware');
const { requireFeatureEnabled } = require('../../middleware/systemFeatureMiddleware');
const { adminOnly } = require('../../middleware/adminMiddleware');
const { UPLOAD_ROOT } = require('./file.service');
const {
  uploadFile,
  getOrderFiles,
  getAllFilesAdmin,
  downloadFile,
  deleteFile,
} = require('./file.controller');

const router = express.Router();

const uploadDir = path.join(UPLOAD_ROOT, 'orders');
const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, uploadDir);
  },
  filename(_req, file, cb) {
    const safe = (file.originalname || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}_${safe}`);
  },
});

const ALLOWED_EXT = ['.pdf', '.jpg', '.jpeg', '.png'];
const upload = multer({
  storage,
  limits: { files: 8, fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      return cb(new Error('Only PDF and images (jpg, png) are allowed'));
    }
    return cb(null, true);
  },
});

try {
  require('fs').mkdirSync(uploadDir, { recursive: true });
} catch (_e) {
  // no-op
}

router.post('/upload', authMiddleware, requireFeatureEnabled('uploads_enabled'), upload.array('files', 8), uploadFile);
router.get('/order/:orderId', authMiddleware, getOrderFiles);
router.get('/admin/all', authMiddleware, adminOnly, getAllFilesAdmin);
router.get('/:id/download', authMiddleware, downloadFile);
router.delete('/:id', authMiddleware, adminOnly, deleteFile);

module.exports = router;
