/**
 * Promote a user to admin by email.
 * Run from server/: npm run make-admin -- you@example.com
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const User = require('../models/User');

const emailArg = process.argv[2] || 'amit@test.com';
const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/docvera';

async function main() {
  await mongoose.connect(uri);
  const email = emailArg.toLowerCase().trim();
  const result = await User.updateOne({ email }, { $set: { role: 'admin' } });

  if (result.matchedCount === 0) {
    // eslint-disable-next-line no-console
    console.error('No user found with email:', email);
    process.exitCode = 1;
  } else {
    // eslint-disable-next-line no-console
    console.log('User converted to ADMIN:', email);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
