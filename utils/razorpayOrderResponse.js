/**
 * Normalized Razorpay Order fields for API JSON (amount is in paise per Razorpay).
 */
function publicRazorpayOrder(rz) {
  if (!rz || !rz.id) return null;
  return {
    id: rz.id,
    orderId: rz.id,
    amount: Number(rz.amount),
    currency: rz.currency ? String(rz.currency) : 'INR',
  };
}

module.exports = { publicRazorpayOrder };
