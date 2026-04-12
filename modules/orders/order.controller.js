const base = require('../../controllers/orderController');
const { createMinimalOrder, getOrderDetails } = require('./controller');

/** Orders engine: same handlers as controllers/orderController.js, plus stable aliases for the module API. */
module.exports = {
  ...base,
  getUserOrders: base.getMyOrders,
  assignAgent: base.assignOrderToAgent,
  uploadDocuments: base.uploadOrderDocuments,
  /** POST /api/orders/create — JSON `{ serviceId }` only (see `controller.js`). */
  createMinimalOrder,
  /** GET /api/orders/:id — module-level detail handler. */
  getOrderDetails,
};
