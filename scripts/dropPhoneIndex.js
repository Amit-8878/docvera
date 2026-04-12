/* eslint-disable no-console */
const mongoose = require('mongoose');
const env = require('../config/env');
const User = require('../models/User');

async function main() {
  console.log('Dropping phone index (phone_1) if present...');

  await mongoose.connect(env.mongoUri, {
    serverSelectionTimeoutMS: 10000,
    autoIndex: false,
  });

  // Mongoose model name "User" maps to collection "users"
  const collection = mongoose.connection.collection('users');

  try {
    await collection.dropIndex('phone_1');
    console.log('Dropped index: phone_1');
  } catch (err) {
    // If index does not exist, MongoDB throws; we treat it as non-fatal.
    console.log('dropIndex(phone_1) skipped:', err?.message || err);
  }

  try {
    // Show remaining indexes (useful for debugging).
    const indexes = await collection.indexes();
    console.log('Current users indexes:', indexes);
  } catch (err) {
    console.log('Could not list indexes:', err?.message || err);
  }

  // Prevent "connected but model unused" warnings by referencing the model.
  // (This also ensures the schema file is exercised.)
  void User;

  await mongoose.disconnect();
  console.log('Done.');
}

main().catch((err) => {
  console.error('Index drop failed:', err);
  process.exit(1);
});

