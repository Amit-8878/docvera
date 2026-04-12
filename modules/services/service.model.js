/**
 * Single Mongoose model for services (shared collection with orders).
 * Schema: ../../models/Service.js (name, category, description, pricing, requiredDocuments,
 * processingTime, isActive, timestamps → createdAt, plus legacy dynamic fields).
 */
module.exports = require('../../models/Service');
