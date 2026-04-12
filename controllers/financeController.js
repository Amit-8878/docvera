const {
  getFinanceOverview,
  getDailyRevenueChart,
  getFinanceTransactions,
} = require('../services/financeService');

async function overview(req, res, next) {
  try {
    if (!['admin', 'super_admin'].includes(req.user?.role)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    const data = await getFinanceOverview();
    return res.status(200).json(data);
  } catch (err) {
    return next(err);
  }
}

async function chart(req, res, next) {
  try {
    if (!['admin', 'super_admin'].includes(req.user?.role)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    const { from, to } = req.query || {};
    const range = {};
    if (from) {
      const d = new Date(String(from));
      if (!Number.isNaN(d.getTime())) range.from = d;
    }
    if (to) {
      const d = new Date(String(to));
      if (!Number.isNaN(d.getTime())) range.to = d;
    }
    const data = await getDailyRevenueChart(range);
    return res.status(200).json(data);
  } catch (err) {
    return next(err);
  }
}

async function transactions(req, res, next) {
  try {
    if (!['admin', 'super_admin'].includes(req.user?.role)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    const { from, to, userId, type, limit, skip } = req.query || {};
    const data = await getFinanceTransactions({
      from,
      to,
      userId,
      type: typeof type === 'string' ? type : 'all',
      limit: limit != null ? Number(limit) : undefined,
      skip: skip != null ? Number(skip) : undefined,
    });
    return res.status(200).json(data);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  overview,
  chart,
  transactions,
};
