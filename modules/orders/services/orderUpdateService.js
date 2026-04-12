/**
 * Order update domain orchestrator (re-exports stable API for `ordersService.js`).
 */
const orderStatusService = require('./update/orderStatusService');
const orderCompletionService = require('./update/orderCompletionService');
const orderDisputeService = require('./update/orderDisputeService');
const orderDocumentService = require('./update/orderDocumentService');
const orderAdminService = require('./update/orderAdminService');

module.exports = {
  maybeAutoRelease: orderCompletionService.maybeAutoRelease,
  updateOrderStatus: orderStatusService.updateOrderStatus,
  updateOrderAdminMeta: orderAdminService.updateOrderAdminMeta,
  uploadOrderDocuments: orderDocumentService.uploadOrderDocuments,
  uploadResultAndCompleteOrder: orderCompletionService.uploadResultAndCompleteOrder,
  confirmOrderCompletion: orderCompletionService.confirmOrderCompletion,
  raiseOrderIssue: orderDisputeService.raiseOrderIssue,
  adminForceRelease: orderAdminService.adminForceRelease,
  adminResolveDispute: orderAdminService.adminResolveDispute,
  submitOrderRating: orderCompletionService.submitOrderRating,
  getInvoicePdfForDownload: orderDocumentService.getInvoicePdfForDownload,
};
