/**
 * User domain boundary — referral and related helpers live alongside auth in existing controllers.
 * Extend here when extracting pure user services.
 */

module.exports = {
  get referralController() {
    return require('../../controllers/referralController');
  },
};
