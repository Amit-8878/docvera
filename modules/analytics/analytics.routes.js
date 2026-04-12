const express = require('express');
const authMiddleware = require('../../middleware/authMiddleware');
const { adminOnly } = require('../../middleware/adminMiddleware');
const { getDashboardStats } = require('./analytics.controller');

const router = express.Router();

router.get('/dashboard', authMiddleware, adminOnly, getDashboardStats);

module.exports = router;
