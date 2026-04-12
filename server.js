process.on('uncaughtException', (err) => {
  console.error('🔥 UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('🔥 UNHANDLED REJECTION:', err);
});

const path = require("path");
require("dotenv").config({
  path: require("path").resolve(__dirname, ".env")
});

const { assertProductionSafe } = require('./config/validateEnv');
assertProductionSafe();

const { logError } = require('./utils/errorLogger');
process.on('uncaughtException', (err) => {
  logError(err, 'uncaught');
});
process.on('unhandledRejection', (reason) => {
  logError(reason instanceof Error ? reason : new Error(String(reason)), 'promise');
});

const http = require('http');
const express = require('express');
require('express-async-errors');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const { Server } = require('socket.io');

const env = require('./config/env');
const { corsOrigin, socketCorsOrigin } = require('./config/corsConfig');
const { connectDB, isDBConnected, startDBRetryInBackground } = require('./config/db');
const { globalApiLimiter } = require('./middleware/apiRateLimiter');
const requestLogger = require('./middleware/requestLogger');
const { safeRouter } = require('./middlewares/errorBoundary');

/**
 * Modular API boundaries — each router loads from `modules/<name>/routes.js`.
 * Legacy route files remain on disk and are required indirectly (no deletes).
 */
const authRoutes = safeRouter('users', () => require('./modules/users/routes'));
const orderRoutes = safeRouter('orders', () => require('./modules/orders/routes'));
const paymentRoutes = safeRouter('payments', () => require('./modules/payments/routes'));
/** Modular wallet: `/agent`, balance/history, etc. — mounted after `walletRoutes` (GET /me + legacy 308s). */
const modularWalletRoutes = safeRouter('wallet', () => require('./modules/wallet/routes'));
const notificationStack = safeRouter('notifications', () => require('./modules/notifications/routes'));

const simpleOrderRoutes = require('./routes/simpleOrderRoutes');
const serviceRoutes = require('./routes/serviceRoutes');
const adminRoutes = require('./routes/adminRoutes');
const adminPlatformRoutes = require('./routes/adminPlatformRoutes');
const chatRoutes = require('./routes/chatRoutes');
const fileRoutes = require('./routes/fileRoutes');
const disputeRoutes = require('./modules/disputes/dispute.routes');
const analyticsRoutes = require('./modules/analytics/analytics.routes');
const legalRoutes = require('./routes/legalRoutes');
const agentOnboardingPublicRoutes = require('./routes/agentOnboardingPublicRoutes');
const serviceRequestRoutes = require('./routes/serviceRequestRoutes');
const checkoutRoutes = require('./routes/checkoutRoutes');
const paymentWebhookController = require('./modules/payments/controller');
const { startNotificationCleanupJob } = require('./services/notificationService');
const { startMessageExpiryJob } = require('./services/messageExpiryJob');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { requireEnvFeature } = require('./middleware/envFeatureMiddleware');
const optionalAuthMiddleware = require('./middleware/optionalAuthMiddleware');
const maintenanceMiddleware = require('./middleware/maintenanceMiddleware');
const { getSystemStatus } = require('./controllers/publicStatusController');
const { attachChatSocket } = require('./socket/chatSocket');
const { setupRedisAdapter } = require('./socket/redisAdapter');
const { initWebPushAtStartup } = require('./services/chatPushService');
const { initRedis } = require('./config/redis');
const { optionalResponseCache } = require('./middleware/optionalResponseCache');
const { attachApiResponseHelpers } = require('./utils/response');
const {
  loginRouteLimiter,
  paymentRouteLimiter,
  orderWriteLimiter,
} = require('./middleware/strategicRateLimits');
const {
  redirectOrderToOrders,
  redirectPaymentsToPayment,
  redirectAdminSettingsToAdmin,
} = require('./middleware/legacyApiRedirects');
const mongoose = require('mongoose');
const { ensureTempAdminUser } = require('./services/ensureTempAdminUser');

initWebPushAtStartup();

async function start() {
  /** Redis optional — non-blocking; no await (init runs in background). */
  void initRedis().catch(() => {});

  const app = express();

  /** One hop (load balancer / reverse proxy) — correct `req.ip` + rate-limit keys behind proxy. */
  app.set('trust proxy', 1);

  // Common production-friendly middleware.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      hsts:
        env.nodeEnv === 'production'
          ? { maxAge: 15552000, includeSubDomains: true, preload: true }
          : false,
    })
  );
  /** CORS: allow `CLIENT_URL` (comma-separated); see config/corsConfig.js */
  app.use(
    cors({
      origin: corsOrigin,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Id', 'X-Razorpay-Signature'],
    })
  );

  /**
   * Razorpay webhooks: raw body for HMAC — MUST be before express.json() so signature matches Razorpay bytes.
   */
  const paymentWebhookRaw = express.raw({ type: 'application/json', limit: '2mb' });
  app.post('/api/payment/webhook', paymentWebhookRaw, paymentWebhookController.webhook);
  app.post('/api/payments/webhook', paymentWebhookRaw, paymentWebhookController.webhook);

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use((req, res, next) => {
    if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
      Object.keys(req.body).forEach((key) => {
        if (key.startsWith('$') || key.includes('.')) {
          delete req.body[key];
        }
      });
    }
    next();
  });
  app.use(requestLogger);
  /** Baseline rate limit per IP; /api/chat excluded (see apiRateLimiter.js). */
  app.use('/api', globalApiLimiter);
  /** Standard `res.apiSuccess` / `res.apiError` helpers (existing `res.json` unchanged). */
  app.use(attachApiResponseHelpers);
  app.use(ensureTempAdminUser);
  if (env.nodeEnv === 'production') {
    app.use(morgan('combined'));
  } else {
    app.use(morgan('dev'));
  }

  // Serve static demo pages (does not affect API routes).
  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

  // Base routes.
  app.get('/', (req, res) => res.status(200).send('DOCVERA API running'));
  app.get('/api', (req, res) => res.status(200).send('API working'));
  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });
  app.get('/api/health', async (req, res) => {
    const { getRedisHealthSummary } = require('./config/redis');
    const redis = getRedisHealthSummary();
    let dbStatus = 'disconnected';
    if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
      try {
        await Promise.race([
          mongoose.connection.db.admin().command({ ping: 1 }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2500)),
        ]);
        dbStatus = 'connected';
      } catch {
        dbStatus = 'degraded';
      }
    } else if (isDBConnected()) {
      dbStatus = 'connecting';
    }
    res.status(200).json({
      status: 'OK',
      server: 'running',
      db: dbStatus,
      redis,
      success: true,
      data: { server: 'running', db: dbStatus, redis },
    });
  });

  app.get('/api/public/system-status', optionalResponseCache(30), getSystemStatus);

  const adminReviewsPublic = require('./modules/aiReviews/adminReviews');
  app.get(
    '/api/public/reviews/carousel',
    optionalResponseCache(30),
    adminReviewsPublic.getCarouselReviews
  );
  app.get('/api/public/reviews/next', adminReviewsPublic.getNextCarouselReview);
  app.post('/api/public/reviews/submit', adminReviewsPublic.postUserReview);

  const publicRoutes = require('./routes/publicRoutes');
  app.use('/api/public', publicRoutes);
  app.get('/api/push/vapid-public-key', publicRoutes.vapidPublicKeyHandler);

  app.use('/api/services', serviceRoutes);

  app.use('/api', optionalAuthMiddleware);
  app.use('/api', maintenanceMiddleware);

  /** Env kill-switches (FEATURE_* in server/.env) — run before feature routers. */
  app.use('/api/payment', requireEnvFeature('payment'));
  app.use('/api/wallet', requireEnvFeature('payment'));
  app.use('/api/chat', requireEnvFeature('chat'));
  app.use('/api/files', requireEnvFeature('upload'));

  /**
   * DISABLED — duplicate legacy mounts (source files kept under server/routes and middleware).
   * Active registration uses module routers: modules/users|orders|payments|wallet|notifications/routes.js
   */
  if (false) {
    const _legacyAuth = require('./routes/authRoutes');
    const _legacyOrders = require('./modules/orders/order.routes');
    const _legacyPayment = require('./modules/payments/payment.routes');
    const _legacyWallet = require('./modules/payments/wallet.routes');
    const _legacyNotifPublic = require('./middleware/notificationsPublicList');
    const _legacyNotif = require('./routes/notificationRoutes');
    app.use('/api/auth', _legacyAuth);
    app.use('/api/orders', _legacyOrders);
    app.use('/api/order', _legacyOrders);
    app.use('/api/payment', _legacyPayment);
    app.use('/api/payments', _legacyPayment);
    app.use('/api/wallet', _legacyWallet);
    app.use('/api/notifications', _legacyNotifPublic);
    app.use('/api/notifications', _legacyNotif);
    app.use('/api/agents', require('./routes/agentRoutes'));
  }

  // API routes.
  app.use('/api/auth', loginRouteLimiter, authRoutes);
  app.use('/api/orders', orderWriteLimiter, orderRoutes);
  /** Legacy singular prefix → 308 /api/orders… */
  app.use('/api/order', orderWriteLimiter, redirectOrderToOrders);
  /** Basic order requests (SimpleOrder) — does not replace full /api/orders flow */
  app.use('/api/simple-orders', orderWriteLimiter, simpleOrderRoutes);
  app.use('/api/service-request', serviceRequestRoutes);
  app.use('/api/checkout', requireEnvFeature('upload'), paymentRouteLimiter, checkoutRoutes);
  /** Admin APIs; unified settings routes live in `routes/adminSettingsRoutes.js` (mounted inside `adminRoutes`). */
  app.use('/api/admin', adminRoutes);
  /** Platform: feature toggles, system status, log preview (`/api/admin/platform`, `/api/admin/platform/logs`). */
  app.use('/api/admin', adminPlatformRoutes);
  /** Legacy `/api/admin-settings/*` → 308 `/api/admin/*` (handlers only on `/api/admin`). */
  app.use('/api/admin-settings', redirectAdminSettingsToAdmin);
  app.use('/api/admin', require('./routes/admin.template'));
  app.use('/api/invoice', require('./routes/invoice'));
  /** Foundation agent onboarding (public request-otp; status/profile/subscribe with id+mobile). */
  app.use('/api/agent-onboarding', agentOnboardingPublicRoutes);
  app.use('/api/chat', chatRoutes);
  app.use('/api/files', fileRoutes);
  app.use('/api/payment', paymentRouteLimiter, paymentRoutes);
  /** Legacy plural prefix → 308 /api/payment… (webhook stays duplicate POST above). */
  app.use('/api/payments', paymentRouteLimiter, redirectPaymentsToPayment);
  /**
   * Wallet API — user summary only at GET /api/wallet/me; legacy paths 308 → /me.
   * Routers: `routes/walletRoutes.js` then modular wallet (agent, balance, …).
   */
  const qsWallet = (req) => {
    const i = req.originalUrl.indexOf('?');
    return i >= 0 ? req.originalUrl.slice(i) : '';
  };
  app.get('/api/wallet/dashboard', (req, res) => res.redirect(308, `/api/wallet/me${qsWallet(req)}`));
  app.get('/api/wallet/customer', (req, res) => res.redirect(308, `/api/wallet/me${qsWallet(req)}`));
  app.get(/^\/api\/wallet\/?$/, (req, res) => res.redirect(308, `/api/wallet/me${qsWallet(req)}`));
  app.use('/api/wallet', require('./routes/walletRoutes'));
  app.use('/api/wallet', modularWalletRoutes);
  /** Agents: ESM application router (if loadable) + legacy router — see `modules/agents/routes.js`. */
  try {
    const { mountAgents } = require('./modules/agents/routes');
    await mountAgents(app);
  } catch (agentsErr) {
    // eslint-disable-next-line no-console
    console.error('[server] agents module mount failed — legacy routes only', agentsErr);
    app.use(
      '/api/agents',
      safeRouter('agents', () => require('./routes/agentRoutes'))
    );
  }
  app.use('/api/notifications', notificationStack);
  app.use('/api/disputes', disputeRoutes);
  app.use('/api/analytics', analyticsRoutes);
  app.use('/api/legal', legalRoutes);
  app.use('/api/push', require('./routes/pushRoutes'));
  app.use('/api/reviews', require('./routes/reviewsRoutes'));

  // Error handling (must be last).
  app.use(notFoundHandler);
  app.use(errorHandler);

  const server = http.createServer(app);
  /** Socket.IO — single server instance; chat uses same io (do not replace with cors: *). */
  const io = new Server(server, {
    cors: {
      origin: socketCorsOrigin(),
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });
  app.set('io', io);
  require('./socket/ioSingleton').setIo(io);

  await setupRedisAdapter(io);
  attachChatSocket(io);

  /** Render / Fly / Railway set `PORT`; local default 5000 (matches config/env.js). */
  const PORT = Number(process.env.PORT) || 5000;
  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      // eslint-disable-next-line no-console
      console.error(
        `[server] Port ${PORT} is already in use (EADDRINUSE). Stop the other process using this port (e.g. another API instance) or change PORT in server/.env. Exiting.`
      );
      process.exit(1);
      return;
    }
    // eslint-disable-next-line no-console
    console.error('[server] HTTP server failed to start:', err);
    process.exit(1);
  });
  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`🚀 Server running on port ${PORT}`);
    // eslint-disable-next-line no-console
    console.log(`DOCVERA API listening on port ${PORT}`);
  });
  startNotificationCleanupJob();
  startMessageExpiryJob();

  // MongoDB: `mongoose.connect` is wrapped in try/catch inside `config/db.js` (`connectDB`), not at top-level here.
  const connected = await connectDB();
  if (!connected) {
    // eslint-disable-next-line no-console
    console.warn('⚠️ Starting API without DB; retrying MongoDB connection in background.');
    startDBRetryInBackground();
  } else {
    try {
      const { getBullConnection } = require('./config/bullConnection');
      const { startOrderJobsWorkerInApi } = require('./modules/jobs/jobQueue');
      const bullConn = getBullConnection();
      if (bullConn) {
        const orderWorker = startOrderJobsWorkerInApi(bullConn);
        if (orderWorker) {
          // eslint-disable-next-line no-console
          console.log('[order jobs] worker running in API process (ORDER_JOBS_RUN_WORKER_IN_API=1)');
        }
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[order jobs] API worker skipped:', e && e.message ? e.message : e);
    }
    try {
      const { seedReviewsIfNeeded } = require('./services/seedReviews');
      await seedReviewsIfNeeded();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('seedReviewsIfNeeded skipped:', e && e.message ? e.message : e);
    }
    try {
      const Notification = require('./models/Notification');
      const User = require('./models/User');
      const count = await Notification.countDocuments();
      if (count === 0 && env.nodeEnv !== 'production') {
        const u = await User.findOne().lean();
        if (u) {
          const role = ['user', 'agent', 'admin'].includes(u.role) ? u.role : 'user';
          await Notification.create([
            {
              userId: u._id,
              role,
              title: 'Welcome',
              message: 'System started successfully',
              type: 'system',
              channel: 'inApp',
              status: 'sent',
              read: false,
            },
            {
              userId: u._id,
              role,
              title: 'Order Update',
              message: 'Your order is processing',
              type: 'order',
              channel: 'inApp',
              status: 'sent',
              read: false,
            },
          ]);
        }
      }
    } catch (e) {
      if (env.nodeEnv !== 'production') {
        // eslint-disable-next-line no-console
        console.warn('Sample notifications seed skipped:', e && e.message ? e.message : e);
      }
    }
  }

}

start().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start server (non-fatal):', err);
});
