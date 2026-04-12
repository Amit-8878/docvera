const express = require('express');
const legalController = require('../controllers/legalController');

const router = express.Router();

router.get('/content', legalController.getLegalContent);

module.exports = router;
