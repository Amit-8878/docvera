const express = require('express');

const router = express.Router();
const agentOnboardingController = require('../controllers/agentOnboardingController');

/** No auth — applicant requests OTP; admin sees OTP in server logs. */
router.post('/request-otp', agentOnboardingController.postRequestOtp);

/** Foundation agent session (id + mobile in query) — refresh dashboard state. */
router.get('/status', agentOnboardingController.getStatus);

/** Agent updates profile — mobile must match. */
router.post('/profile', agentOnboardingController.postProfile);

/** Demo subscription activation — mobile must match (no real payment). */
router.post('/subscribe', agentOnboardingController.postSubscribe);

module.exports = router;
