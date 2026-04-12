/**
 * Core bootstrap helpers — incremental extraction from `server.js`.
 * Use `createBaseApp()` when splitting the monolith entrypoint.
 */
const express = require('express');

function createBaseApp() {
  const app = express();
  app.set('trust proxy', 1);
  return app;
}

module.exports = {
  createBaseApp,
};
