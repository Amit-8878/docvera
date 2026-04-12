/**
 * Order domain orchestrator: re-exports the same public API as before the split.
 */
const orderQueryService = require('./orderQueryService');
const orderNotificationService = require('./orderNotificationService');
const orderAssignmentService = require('./orderAssignmentService');
const orderCreationService = require('./orderCreationService');
const orderUpdateService = require('./orderUpdateService');

module.exports = {
  formatOrder: orderQueryService.formatOrder,
  pickServiceName: orderQueryService.pickServiceName,
  notifyHighValueOrderAlert: orderNotificationService.notifyHighValueOrderAlert,
  createOrder: orderCreationService.createOrder,
  getMyOrders: orderQueryService.getMyOrders,
  trackOrder: orderQueryService.trackOrder,
  getOrderById: orderQueryService.getOrderById,
  getAllOrders: orderQueryService.getAllOrders,
  updateOrderStatus: orderUpdateService.updateOrderStatus,
  updateOrderAdminMeta: orderUpdateService.updateOrderAdminMeta,
  assignOrderToAgent: orderAssignmentService.assignOrderToAgent,
  uploadOrderDocuments: orderUpdateService.uploadOrderDocuments,
  getAgentOrders: orderQueryService.getAgentOrders,
  updateAgentOrderStatus: orderAssignmentService.updateAgentOrderStatus,
  uploadResultAndCompleteOrder: orderUpdateService.uploadResultAndCompleteOrder,
  confirmOrderCompletion: orderUpdateService.confirmOrderCompletion,
  raiseOrderIssue: orderUpdateService.raiseOrderIssue,
  adminForceRelease: orderUpdateService.adminForceRelease,
  adminResolveDispute: orderUpdateService.adminResolveDispute,
  submitOrderRating: orderUpdateService.submitOrderRating,
  getInvoicePdfForDownload: orderUpdateService.getInvoicePdfForDownload,
  createCustomOrder: orderCreationService.createCustomOrder,
  runTriggerAutoAssign: orderAssignmentService.runTriggerAutoAssign,
  autoAssignAgent: orderAssignmentService.autoAssignAgent,
  maybeReassignIfAcceptTimeout: orderAssignmentService.maybeReassignIfAcceptTimeout,
  maybeAutoRelease: orderUpdateService.maybeAutoRelease,
};
