const mongoose = require('mongoose');
const env = require('./env');

let dbConnected = false;

// Keep a single connection across the app lifecycle.
async function connectDB({ retries = 5, retryDelayMs = 3000 } = {}) {
  mongoose.set('strictQuery', true);

  // If already connected, avoid creating another connection.
  if (mongoose.connection.readyState === 1) {
    // eslint-disable-next-line no-console
    console.log('✅ MongoDB Connected Successfully (already connected)');
    // eslint-disable-next-line no-console
    console.log('MONGO_URI:', env.mongoUri);
    dbConnected = true;
    return true;
  }

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const poolSize = Math.min(50, Math.max(2, Number(process.env.MONGO_MAX_POOL_SIZE) || 10));

      const options = {
        autoIndex: env.nodeEnv !== 'production',
        serverSelectionTimeoutMS: 10000,
        maxPoolSize: poolSize,
      };

      // Allow optional explicit dbName without breaking when env doesn't provide it.
      if (env.mongoDbName) options.dbName = env.mongoDbName;

      await mongoose.connect(env.mongoUri, options);

      // eslint-disable-next-line no-console
      console.log('✅ MongoDB Connected Successfully');
      // eslint-disable-next-line no-console
      console.log('MONGO_URI:', env.mongoUri);
      dbConnected = true;
      return true;
    } catch (err) {
      dbConnected = false;
      // eslint-disable-next-line no-console
      console.error(`❌ MongoDB Connection Error (attempt ${attempt}/${retries}):`, err?.message || err);
      if (attempt < retries) {
        // eslint-disable-next-line no-console
        console.log(`Retrying DB connection in ${retryDelayMs}ms...`);
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }

  return false;
}

function isDBConnected() {
  return dbConnected || mongoose.connection.readyState === 1;
}

function startDBRetryInBackground() {
  const run = async () => {
    const ok = await connectDB({ retries: 1 });
    if (!ok) {
      setTimeout(run, 5000);
    }
  };
  run().catch(() => {
    setTimeout(run, 5000);
  });
}

mongoose.connection.on('connected', () => {
  dbConnected = true;
});
mongoose.connection.on('disconnected', () => {
  dbConnected = false;
});

module.exports = { connectDB, isDBConnected, startDBRetryInBackground };
