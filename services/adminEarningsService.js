const AdminEarnings = require('../models/AdminEarnings');

/** One increment per order that reaches held/paid; platform fee added when &gt; 0. */
async function recordPlatformFeeRevenue(platformFeeInr) {
  const fee = Number(platformFeeInr || 0);
  const inc = { totalPaidOrders: 1 };
  if (fee > 0) inc.totalRevenue = fee;
  await AdminEarnings.findOneAndUpdate(
    { key: 'global' },
    { $inc: inc, $set: { updatedAt: new Date() } },
    { upsert: true }
  );
}

/** Gross order amount (INR) toward admin totalRevenue; one increment per successful payment. */
async function recordGrossOrderRevenue(orderAmountInr) {
  const n = Number(orderAmountInr || 0);
  if (n <= 0) return;
  await AdminEarnings.findOneAndUpdate(
    { key: 'global' },
    { $inc: { totalRevenue: n, totalPaidOrders: 1 }, $set: { updatedAt: new Date() } },
    { upsert: true }
  );
}

async function recordSignupBonusPaid(amountInr) {
  const n = Number(amountInr || 0);
  if (n <= 0) return;
  await AdminEarnings.findOneAndUpdate(
    { key: 'global' },
    { $inc: { totalCommissionPaid: n, totalSignupBonusesPaid: n }, $set: { updatedAt: new Date() } },
    { upsert: true }
  );
}

async function recordReferralCommissionPaid(amountInr) {
  const n = Number(amountInr || 0);
  if (n <= 0) return;
  await AdminEarnings.findOneAndUpdate(
    { key: 'global' },
    { $inc: { totalCommissionPaid: n }, $set: { updatedAt: new Date() } },
    { upsert: true }
  );
}

async function getSnapshot() {
  const doc =
    (await AdminEarnings.findOne({ key: 'global' }).lean()) ||
    ({
      totalRevenue: 0,
      totalCommissionPaid: 0,
      totalPaidOrders: 0,
      totalSignupBonusesPaid: 0,
      updatedAt: new Date(),
    });
  const tr = Number(doc.totalRevenue || 0);
  const tcp = Number(doc.totalCommissionPaid || 0);
  const tpo = Number(doc.totalPaidOrders || 0);
  const tsb = Number(doc.totalSignupBonusesPaid || 0);
  return {
    totalRevenue: tr,
    totalCommissionPaid: tcp,
    totalPaidOrders: tpo,
    totalSignupBonusesPaid: tsb,
    netProfit: Number((tr - tcp).toFixed(2)),
    updatedAt: doc.updatedAt,
  };
}

module.exports = {
  recordPlatformFeeRevenue,
  recordGrossOrderRevenue,
  recordReferralCommissionPaid,
  recordSignupBonusPaid,
  getSnapshot,
};
