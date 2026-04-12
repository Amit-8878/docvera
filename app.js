/**
 * LEGACY / SANDBOX — not used by production bootstrap.
 * Real API entrypoint is `server.js` (`npm start` → `node server.js`).
 * Kept for local experiments only; do not mount here for production.
 */
const express = require("express");
const { notFoundHandler, errorHandler } = require("./middleware/errorHandler");
// const walletRoutes = require("./routes/walletRoutes");

const app = express();

// Common middleware should be mounted before route modules.
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Wallet routes must be mounted before error handlers.
// app.use("/api/wallet", walletRoutes);

// Error handlers must remain last.
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
