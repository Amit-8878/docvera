// @ts-nocheck — server package has no TypeScript toolchain; this file is a scaffold for ESM/TS adoption.
import express from 'express';
import multer from 'multer';
import { completeOrderWithDocument } from '../controllers/order.controller.js';

const router = express.Router();

/** TODO: replace with real `authMiddleware` / `adminOnly` from `server/middleware` */
const auth: express.RequestHandler = (_req, _res, next) => next();
const adminOnly: express.RequestHandler = (_req, _res, next) => next();

const upload = multer({ dest: 'uploads/documents' });

const updateOrderStatus: express.RequestHandler = (_req, res) => {
  res.status(501).json({ message: 'Stub: PATCH /:orderId/status — wire to server/modules/orders if needed' });
};

router.patch('/:orderId/status', auth, adminOnly, updateOrderStatus);
router.post(
  '/:orderId/complete',
  auth,
  adminOnly,
  upload.single('document'),
  completeOrderWithDocument
);

export default router;
