const fs = require('fs');
const ph = require('../modules/orders/parts/orderPureHelpers');
const ordersService = require('../modules/orders/services/ordersService');
const { emitNewOrder, emitOrderUpdate, getIo } = require('../socket/orderEvents');
const { sendPaymentRequired } = require('../utils/orderPaymentGate');

const {
  formatOrder,
  notifyHighValueOrderAlert,
  createOrder,
  getMyOrders,
  trackOrder,
  getOrderById,
  getAllOrders,
  updateOrderStatus,
  updateOrderAdminMeta,
  assignOrderToAgent,
  uploadOrderDocuments,
  getAgentOrders,
  updateAgentOrderStatus,
  uploadResultAndCompleteOrder,
  confirmOrderCompletion,
  raiseOrderIssue,
  adminForceRelease,
  adminResolveDispute,
  submitOrderRating,
  getInvoicePdfForDownload,
  createCustomOrder,
  runTriggerAutoAssign,
  autoAssignAgent,
  maybeAutoRelease,
  maybeReassignIfAcceptTimeout,
} = ordersService;

/**
 * Maps service result → HTTP. Preserves legacy JSON shapes and side effects (socket, PDF stream).
 */
function finishOrderResponse(req, res, out) {
  if (out && out.paymentRequired) {
    return sendPaymentRequired(res);
  }
  if (!out || !out.ok) {
    return res.status(out.status).json(out.body);
  }
  const io = getIo(req);
  if (io && out.socketNewOrder) emitNewOrder(io, out.socketNewOrder);
  if (io && out.socketOrderUpdate) emitOrderUpdate(io, out.socketOrderUpdate);
  return res.status(out.status).json(out.body);
}

async function triggerAutoAssignOrder(req, res, next) {
  try {
    const out = await runTriggerAutoAssign(req);
    if (out && out.paymentRequired) return sendPaymentRequired(res);
    return finishOrderResponse(req, res, out);
  } catch (err) {
    return next(err);
  }
}

async function handleCreateOrder(req, res, next) {
  try {
    const out = await createOrder(req);
    return finishOrderResponse(req, res, out);
  } catch (err) {
    return next(err);
  }
}

async function handleGetMyOrders(req, res, next) {
  try {
    return finishOrderResponse(req, res, await getMyOrders(req));
  } catch (err) {
    return next(err);
  }
}

async function handleTrackOrder(req, res, next) {
  try {
    return finishOrderResponse(req, res, await trackOrder(req));
  } catch (err) {
    return next(err);
  }
}

async function handleGetOrderById(req, res, next) {
  try {
    return finishOrderResponse(req, res, await getOrderById(req));
  } catch (err) {
    return next(err);
  }
}

async function handleGetAllOrders(req, res, next) {
  try {
    return finishOrderResponse(req, res, await getAllOrders(req));
  } catch (err) {
    return next(err);
  }
}

async function handleUpdateOrderStatus(req, res, next) {
  try {
    return finishOrderResponse(req, res, await updateOrderStatus(req));
  } catch (err) {
    return next(err);
  }
}

async function handleUpdateOrderAdminMeta(req, res, next) {
  try {
    return finishOrderResponse(req, res, await updateOrderAdminMeta(req));
  } catch (err) {
    return next(err);
  }
}

async function handleAssignOrderToAgent(req, res, next) {
  try {
    return finishOrderResponse(req, res, await assignOrderToAgent(req));
  } catch (err) {
    return next(err);
  }
}

async function handleUploadOrderDocuments(req, res, next) {
  try {
    return finishOrderResponse(req, res, await uploadOrderDocuments(req));
  } catch (err) {
    return next(err);
  }
}

async function handleGetAgentOrders(req, res, next) {
  try {
    return finishOrderResponse(req, res, await getAgentOrders(req));
  } catch (err) {
    return next(err);
  }
}

async function handleUpdateAgentOrderStatus(req, res, next) {
  try {
    return finishOrderResponse(req, res, await updateAgentOrderStatus(req));
  } catch (err) {
    return next(err);
  }
}

async function handleUploadResultAndCompleteOrder(req, res, next) {
  try {
    return finishOrderResponse(req, res, await uploadResultAndCompleteOrder(req));
  } catch (err) {
    return next(err);
  }
}

async function handleConfirmOrderCompletion(req, res, next) {
  try {
    return finishOrderResponse(req, res, await confirmOrderCompletion(req));
  } catch (err) {
    return next(err);
  }
}

async function handleRaiseOrderIssue(req, res, next) {
  try {
    return finishOrderResponse(req, res, await raiseOrderIssue(req));
  } catch (err) {
    return next(err);
  }
}

async function handleAdminForceRelease(req, res, next) {
  try {
    return finishOrderResponse(req, res, await adminForceRelease(req));
  } catch (err) {
    return next(err);
  }
}

async function handleAdminResolveDispute(req, res, next) {
  try {
    return finishOrderResponse(req, res, await adminResolveDispute(req));
  } catch (err) {
    return next(err);
  }
}

async function handleSubmitOrderRating(req, res, next) {
  try {
    return finishOrderResponse(req, res, await submitOrderRating(req));
  } catch (err) {
    return next(err);
  }
}

async function handleGetInvoicePdf(req, res, next) {
  try {
    const out = await getInvoicePdfForDownload(req);
    if (out.ok && out.pdfBuffer) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${out.downloadName}"`);
      return res.send(Buffer.from(out.pdfBuffer));
    }
    if (out.ok && out.invoiceStream) {
      const { absolutePath, downloadName } = out.invoiceStream;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
      return fs.createReadStream(absolutePath).pipe(res);
    }
    return res.status(out.status).json(out.body);
  } catch (err) {
    return next(err);
  }
}

async function handleCreateCustomOrder(req, res, next) {
  try {
    return finishOrderResponse(req, res, await createCustomOrder(req));
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  formatOrder,
  buildOrderFlags: ph.buildOrderFlags,
  notifyHighValueOrderAlert,
  parseCustomerLocation: ph.parseCustomerLocation,
  parsePreferredAgentId: ph.parsePreferredAgentId,
  parseAssignedToFromBody: ph.parseAssignedToFromBody,
  createOrder: handleCreateOrder,
  getMyOrders: handleGetMyOrders,
  trackOrder: handleTrackOrder,
  getOrderById: handleGetOrderById,
  getAllOrders: handleGetAllOrders,
  createCustomOrder: handleCreateCustomOrder,
  getInvoicePdf: handleGetInvoicePdf,
  updateOrderStatus: handleUpdateOrderStatus,
  assignOrderToAgent: handleAssignOrderToAgent,
  autoAssignAgent,
  maybeAutoRelease,
  maybeReassignIfAcceptTimeout,
  triggerAutoAssignOrder,
  uploadOrderDocuments: handleUploadOrderDocuments,
  getAgentOrders: handleGetAgentOrders,
  updateAgentOrderStatus: handleUpdateAgentOrderStatus,
  confirmOrderCompletion: handleConfirmOrderCompletion,
  raiseOrderIssue: handleRaiseOrderIssue,
  adminForceRelease: handleAdminForceRelease,
  adminResolveDispute: handleAdminResolveDispute,
  submitOrderRating: handleSubmitOrderRating,
  uploadResultAndCompleteOrder: handleUploadResultAndCompleteOrder,
  updateOrderAdminMeta: handleUpdateOrderAdminMeta,
};
