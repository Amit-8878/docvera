/* eslint-disable no-console */
const mongoose = require('mongoose');
const env = require('../config/env');

async function main() {
  console.log('Inspecting services indexes...');
  await mongoose.connect(env.mongoUri, {
    serverSelectionTimeoutMS: 10000,
    autoIndex: false,
  });

  const collection = mongoose.connection.collection('services');
  const indexes = await collection.indexes();
  console.log('Current services indexes:', indexes);

  const indexesToDrop = indexes
    .filter((idx) => idx.unique === true && idx.key && idx.key.name === 1)
    .map((idx) => idx.name);

  for (const indexName of indexesToDrop) {
    console.log(`Dropping unique services index: ${indexName}`);
    try {
      await collection.dropIndex(indexName);
    } catch (err) {
      console.log(`dropIndex(${indexName}) skipped:`, err?.message || err);
    }
  }

  const newIndexes = await collection.indexes();
  console.log('Updated services indexes:', newIndexes);

  await mongoose.disconnect();
  console.log('Done.');
}

main().catch((err) => {
  console.error('Failed to drop service name index:', err);
  process.exit(1);
});

