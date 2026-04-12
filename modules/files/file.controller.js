const path = require('path');
const mongoose = require('mongoose');
const File = require('./file.model');
const Order = require('../../models/Order');
const {
  registerUserDocuments,
  registerAgentProofFiles,
  assertCanAccessFile,
  getFileStreamForDownload,
  deleteFileById,
  extToMime,
} = require('./file.service');

function formatFile(doc) {
  if (!doc) return null;
  const o = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  const id = o._id;
  if (o._id) delete o._id;
  if (o.__v !== undefined) delete o.__v;
  return {
    id: id ? String(id) : null,
    orderId: o.orderId ? String(o.orderId) : null,
    userId: o.userId ? String(o.userId) : null,
    fileName: o.fileName,
    fileUrl: o.fileUrl,
    fileType: o.fileType || '',
    uploadedBy: o.uploadedBy,
    createdAt: o.createdAt,
    downloadUrl: id ? `/api/files/${String(id)}/download` : null,
  };
}

/**
 * POST /api/files/upload
 * multipart: orderId, kind=document|proof, file field "file"
 */
async function uploadFile(req, res, next) {
  try {
    const userId = req.user && req.user.userId;
    const role = req.user && req.user.role;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const orderIdRaw = req.body && req.body.orderId != null ? String(req.body.orderId).trim() : '';
    const kind = req.body && req.body.kind ? String(req.body.kind).trim() : 'document';
    if (!orderIdRaw || !mongoose.Types.ObjectId.isValid(orderIdRaw)) {
      return res.status(400).json({ message: 'Bad request', details: 'orderId is required' });
    }
    if (!['document', 'proof'].includes(kind)) {
      return res.status(400).json({ message: 'Bad request', details: 'kind must be document or proof' });
    }

    const files = Array.isArray(req.files) ? req.files : [];
    const fileList = files.length ? files : req.file ? [req.file] : [];
    if (!fileList.length) {
      return res.status(400).json({ message: 'Bad request', details: 'file is required' });
    }

    const order = await Order.findById(orderIdRaw).lean();
    if (!order) return res.status(404).json({ message: 'Not found' });

    if (kind === 'document') {
      if (role !== 'user' || String(order.user) !== String(userId)) {
        return res.status(403).json({ message: 'Forbidden' });
      }
      const newDocs = await registerUserDocuments(orderIdRaw, userId, fileList);
      await Order.findByIdAndUpdate(
        orderIdRaw,
        { $push: { documents: { $each: newDocs } } },
        { runValidators: false }
      );
      const ids = newDocs.map((d) => d.fileId).filter(Boolean);
      const created = ids.length ? await File.find({ _id: { $in: ids } }).lean() : [];
      return res.status(201).json({ files: created.map((c) => formatFile(c)), orderId: orderIdRaw });
    }

    if (kind === 'proof') {
      if (role !== 'agent' || !order.agent || String(order.agent) !== String(userId)) {
        return res.status(403).json({ message: 'Forbidden', details: 'Agent assigned to order only' });
      }
      const ownerUserId = order.user;
      const newProof = await registerAgentProofFiles(orderIdRaw, userId, ownerUserId, fileList);
      await Order.findByIdAndUpdate(
        orderIdRaw,
        { $push: { proofFiles: { $each: newProof } } },
        { runValidators: false }
      );
      const ids = newProof.map((p) => p.fileId).filter(Boolean);
      const created = ids.length ? await File.find({ _id: { $in: ids } }).lean() : [];
      return res.status(201).json({ files: created.map((c) => formatFile(c)), orderId: orderIdRaw });
    }

    return res.status(400).json({ message: 'Bad request' });
  } catch (err) {
    return next(err);
  }
}

async function getOrderFiles(req, res, next) {
  try {
    const userId = req.user && req.user.userId;
    const role = req.user && req.user.role;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const { orderId } = req.params;
    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ message: 'Bad request', details: 'Invalid order id' });
    }

    const order = await Order.findById(orderId).select('user agent').lean();
    if (!order) return res.status(404).json({ message: 'Not found' });
    if (role !== 'admin' && String(order.user) !== String(userId) && String(order.agent || '') !== String(userId)) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const rows = await File.find({ orderId }).sort({ createdAt: -1 }).lean();
    return res.status(200).json({ files: rows.map((r) => formatFile(r)) });
  } catch (err) {
    return next(err);
  }
}

async function getAllFilesAdmin(req, res, next) {
  try {
    const q = {};
    if (req.query.orderId && mongoose.Types.ObjectId.isValid(String(req.query.orderId))) {
      q.orderId = req.query.orderId;
    }
    const rows = await File.find(q).sort({ createdAt: -1 }).limit(500).lean();
    return res.status(200).json({ files: rows.map((r) => formatFile(r)) });
  } catch (err) {
    return next(err);
  }
}

async function downloadFile(req, res, next) {
  try {
    const userId = req.user && req.user.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Bad request', details: 'Invalid file id' });
    }

    const fileDoc = await File.findById(id).lean();
    if (!fileDoc) return res.status(404).json({ message: 'Not found' });

    const ok = await assertCanAccessFile(req.user, fileDoc);
    if (!ok) return res.status(403).json({ message: 'Forbidden' });

    const stream = getFileStreamForDownload(fileDoc);
    const ext = path.extname(fileDoc.fileName || '').toLowerCase();
    res.setHeader('Content-Type', fileDoc.fileType || extToMime(ext));
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileDoc.fileName || 'file')}"`);
    stream.on('error', () => res.status(500).end());
    stream.pipe(res);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return res.status(404).json({ message: 'Not found', details: 'File missing' });
    }
    return next(err);
  }
}

async function deleteFile(req, res, next) {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Bad request', details: 'Invalid file id' });
    }
    const out = await deleteFileById(id);
    if (!out.deleted) return res.status(404).json({ message: 'Not found' });
    return res.status(200).json({ success: true });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  uploadFile,
  getOrderFiles,
  getAllFilesAdmin,
  downloadFile,
  deleteFile,
  formatFile,
};
