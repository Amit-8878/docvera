const express = require('express');
const path = require('path');
const multer = require('multer');

const authMiddleware = require('../../middleware/authMiddleware');
const { adminOnly } = require('../../middleware/adminMiddleware');
const {
  createDispute,
  getUserDisputes,
  getAgentDisputes,
  getAllDisputes,
  updateDisputeStatus,
  addAdminResponse,
} = require('./dispute.controller');

const router = express.Router();

const uploadDir = path.join(__dirname, '..', '..', 'public', 'uploads', 'disputes');
const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, uploadDir);
  },
  filename(_req, file, cb) {
    const safe = (file.originalname || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}_${safe}`);
  },
});

const ALLOWED_EXT = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.doc', '.docx', '.txt'];
const upload = multer({
  storage,
  limits: { files: 8, fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      return cb(new Error('Unsupported file type'));
    }
    return cb(null, true);
  },
});

try {
  require('fs').mkdirSync(uploadDir, { recursive: true });
} catch (_e) {
  // no-op
}

router.post('/', authMiddleware, upload.any(), createDispute);
router.get('/user', authMiddleware, getUserDisputes);
router.get('/agent', authMiddleware, getAgentDisputes);
router.get('/admin', authMiddleware, adminOnly, getAllDisputes);
router.patch('/:id/status', authMiddleware, adminOnly, updateDisputeStatus);
router.patch('/:id/respond', authMiddleware, adminOnly, addAdminResponse);

module.exports = router;
