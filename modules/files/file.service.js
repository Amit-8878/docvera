const path = require('path');
const fs = require('fs');
const File = require('./file.model');
const Order = require('../../models/Order');

/** All blobs live here; cloud migration = swap base path / adapter only. */
const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads', 'local');

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (_e) {
    // no-op
  }
}

function extToMime(ext) {
  const e = String(ext || '').toLowerCase();
  if (e === '.pdf') return 'application/pdf';
  if (e === '.jpg' || e === '.jpeg') return 'image/jpeg';
  if (e === '.png') return 'image/png';
  return 'application/octet-stream';
}

function storageUrlFor(orderId, filename) {
  return path.join('local', 'orders', String(orderId), filename).replace(/\\/g, '/');
}

function absolutePathFromStorageUrl(storageUrl) {
  return path.join(UPLOAD_ROOT, ...String(storageUrl).split('/'));
}

function moveIntoOrderFolder(multerFile, orderId) {
  const orderDir = path.join(UPLOAD_ROOT, 'orders', String(orderId));
  ensureDir(orderDir);
  const base = path.basename(multerFile.path);
  const dest = path.join(orderDir, base);
  if (multerFile.path !== dest) {
    try {
      fs.renameSync(multerFile.path, dest);
    } catch (_e) {
      // no-op
    }
  }
  return base;
}

async function createFileRecord({ orderId, userId, uploadedBy, originalName, diskFileName, fileType }) {
  const rel = storageUrlFor(orderId, diskFileName);
  return File.create({
    userId,
    orderId,
    fileName: originalName || diskFileName,
    fileUrl: rel,
    fileType: fileType || '',
    uploadedBy,
  });
}

async function registerUserDocuments(orderId, ownerUserId, multerFiles) {
  const out = [];
  for (const f of multerFiles) {
    const base = moveIntoOrderFolder(f, orderId);
    const ext = path.extname(f.originalname || '').toLowerCase();
    const doc = await createFileRecord({
      orderId,
      userId: ownerUserId,
      uploadedBy: 'user',
      originalName: f.originalname || base,
      diskFileName: base,
      fileType: extToMime(ext),
    });
    out.push({
      fileId: doc._id,
      fileUrl: doc.fileUrl,
      fileName: doc.fileName,
      uploadedAt: new Date(),
    });
  }
  return out;
}

async function registerAgentProofFiles(orderId, agentUserId, ownerUserId, multerFiles) {
  const proofFiles = [];
  for (const f of multerFiles) {
    const base = moveIntoOrderFolder(f, orderId);
    const ext = path.extname(f.originalname || '').toLowerCase();
    const doc = await createFileRecord({
      orderId,
      userId: ownerUserId,
      uploadedBy: 'agent',
      originalName: f.originalname || base,
      diskFileName: base,
      fileType: extToMime(ext),
    });
    proofFiles.push({
      fileId: doc._id,
      fileUrl: doc.fileUrl,
      fileName: f.originalname || base,
    });
  }
  return proofFiles;
}

/**
 * Final result files for the customer (admin or assigned agent). Reuses same storage as other order files.
 * @param {'admin' | 'agent'} uploadedBy
 */
async function registerOrderResultFiles(orderId, ownerUserId, multerFiles, uploadedBy) {
  const role = uploadedBy === 'agent' ? 'agent' : 'admin';
  const out = [];
  for (const f of multerFiles) {
    const base = moveIntoOrderFolder(f, orderId);
    const ext = path.extname(f.originalname || '').toLowerCase();
    const doc = await createFileRecord({
      orderId,
      userId: ownerUserId,
      uploadedBy: role,
      originalName: f.originalname || base,
      diskFileName: base,
      fileType: extToMime(ext),
    });
    out.push({
      fileId: doc._id,
      fileUrl: doc.fileUrl,
      fileName: f.originalname || base,
    });
  }
  return out;
}

async function assertCanAccessFile(reqUser, fileDoc) {
  const uid = reqUser.userId || reqUser.id;
  const role = reqUser.role;
  if (role === 'admin') return true;
  if (!fileDoc) return false;

  const order = await Order.findById(fileDoc.orderId).select('user agent').lean();
  if (!order) return false;
  if (String(order.user) === String(uid)) return true;
  if (order.agent && String(order.agent) === String(uid)) return true;
  return false;
}

function getFileStreamForDownload(fileDoc) {
  const abs = absolutePathFromStorageUrl(fileDoc.fileUrl);
  if (!fs.existsSync(abs)) {
    const err = new Error('File missing on disk');
    err.code = 'ENOENT';
    throw err;
  }
  return fs.createReadStream(abs);
}

async function deleteFileById(fileId) {
  const doc = await File.findById(fileId);
  if (!doc) return { deleted: false };
  const abs = absolutePathFromStorageUrl(doc.fileUrl);
  try {
    fs.unlinkSync(abs);
  } catch (_e) {
    // ignore
  }
  await File.deleteOne({ _id: fileId });

  await Order.updateOne({ _id: doc.orderId }, { $pull: { documents: { fileId: doc._id } } }, { runValidators: false });
  await Order.updateOne({ _id: doc.orderId }, { $pull: { proofFiles: { fileId: doc._id } } }, { runValidators: false });
  await Order.updateOne({ _id: doc.orderId }, { $pull: { resultFiles: { fileId: doc._id } } }, { runValidators: false });

  return { deleted: true };
}

/**
 * Match embedded file fields to multer files by original filename (stable for typical forms).
 */
async function attachEmbeddedFilesAfterOrderCreate(orderId, ownerUserId, multerFiles, filledFields) {
  if (!filledFields || typeof filledFields !== 'object') return;

  const orderFiles = multerFiles.filter(
    (f) =>
      typeof f.fieldname === 'string' &&
      (f.fieldname.startsWith('requiredField_') || f.fieldname.startsWith('conditionalField_'))
  );
  const used = new Set();

  for (const k of Object.keys(filledFields)) {
    const v = filledFields[k];
    if (!v || v.type !== 'file' || !v.fileName) continue;
    const mf = orderFiles.find((f) => f.originalname === v.fileName && !used.has(f.path));
    if (!mf) continue;
    used.add(mf.path);
    const base = moveIntoOrderFolder(mf, orderId);
    const ext = path.extname(v.fileName || '').toLowerCase();
    const doc = await createFileRecord({
      orderId,
      userId: ownerUserId,
      uploadedBy: 'user',
      originalName: v.fileName || mf.originalname,
      diskFileName: base,
      fileType: extToMime(ext),
    });
    v.fileId = doc._id;
    v.fileUrl = doc.fileUrl;
  }
}

/** Public URL for a service icon saved under uploads/local/services/icons/ (see service.routes multer). */
function publicUrlForServiceIconFile(multerFile) {
  if (!multerFile || !multerFile.filename) return '';
  const rel = path.join('local', 'services', 'icons', multerFile.filename).replace(/\\/g, '/');
  return `/uploads/${rel}`;
}

module.exports = {
  UPLOAD_ROOT,
  storageUrlFor,
  absolutePathFromStorageUrl,
  registerUserDocuments,
  registerAgentProofFiles,
  registerOrderResultFiles,
  assertCanAccessFile,
  getFileStreamForDownload,
  deleteFileById,
  attachEmbeddedFilesAfterOrderCreate,
  extToMime,
  publicUrlForServiceIconFile,
};
