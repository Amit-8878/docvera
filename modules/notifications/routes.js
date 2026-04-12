const express = require('express');

const notificationsPublicList = require('../../middleware/notificationsPublicList');
const notificationRoutes = require('../../routes/notificationRoutes');

const router = express.Router();

router.use(notificationsPublicList);
router.use(notificationRoutes);

module.exports = router;
