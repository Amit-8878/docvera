/**
 * Dev / bootstrap admin (bcrypt-hashed on save). Override with env if needed.
 */
module.exports = {
  TEMP_ADMIN_EMAIL: (process.env.TEMP_ADMIN_EMAIL || 'admin@gmail.com').toLowerCase().trim(),
  TEMP_ADMIN_PASSWORD: process.env.TEMP_ADMIN_PASSWORD || '123456',
};
