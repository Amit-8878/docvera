const cloudinary = require('cloudinary').v2;
const env = require('../config/env');

let configured = false;

function ensureConfigured() {
  if (configured) return true;
  const { cloudinaryCloudName, cloudinaryApiKey, cloudinaryApiSecret } = env;
  if (cloudinaryCloudName && cloudinaryApiKey && cloudinaryApiSecret) {
    cloudinary.config({
      cloud_name: cloudinaryCloudName,
      api_key: cloudinaryApiKey,
      api_secret: cloudinaryApiSecret,
    });
    configured = true;
    return true;
  }
  return false;
}

function isCloudinaryConfigured() {
  return ensureConfigured();
}

/**
 * Upload a local file (e.g. from multer disk) to Cloudinary; returns secure HTTPS URL or null if not configured / failed.
 */
async function uploadLocalFileToCloudinary(localPath) {
  if (!ensureConfigured()) return null;
  const result = await cloudinary.uploader.upload(localPath, {
    folder: 'docvera/chat',
    resource_type: 'auto',
  });
  return result.secure_url || null;
}

module.exports = {
  isCloudinaryConfigured,
  uploadLocalFileToCloudinary,
};
