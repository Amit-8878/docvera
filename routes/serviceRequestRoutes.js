const express = require('express');
const optionalAuthMiddleware = require('../middleware/optionalAuthMiddleware');
const { createServiceRequest } = require('../controllers/serviceRequestController');

const router = express.Router();

router.post('/', optionalAuthMiddleware, createServiceRequest);

module.exports = router;
