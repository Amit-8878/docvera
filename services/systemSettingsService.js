const SystemSetting = require('../models/SystemSetting');

const DEFAULTS = {
  chat_enabled: true,
  payment_enabled: true,
  orders_enabled: true,
  uploads_enabled: true,
  maintenance_mode: false,
  /** Browse / list catalog services (GET /api/services). */
  services_enabled: true,
  /** Agent / referral signup bonuses and related flows (see auth register + referrals). */
  agent_system_enabled: true,
  /** Referral wallet bonus when orders release. */
  referral_enabled: true,
  /** Percent of order total (INR) credited to referrer, e.g. 5 = 5%. */
  referral_commission_percent: 5,
  /** Minimum order total (INR) for referral commission. */
  referral_min_order_inr: 100,
  /** `first_order` = commission only on referred user's first paid order; `all_orders` = every qualifying order. */
  referral_commission_type: 'all_orders',
  /** INR added to user `promoBalance` once on first login (see auth login + `firstLoginBonus` util). */
  first_login_promo_inr: 200,
};

let allCache = null;
let allCacheAt = 0;
const CACHE_MS = 5000;

function invalidateCache() {
  allCache = null;
  allCacheAt = 0;
}

async function ensureDefaults() {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    await SystemSetting.updateOne({ key }, { $setOnInsert: { value } }, { upsert: true });
  }
}

/**
 * @param {string} key
 * @param {unknown} defaultValue
 */
async function getSetting(key, defaultValue = null) {
  await ensureDefaults();
  const now = Date.now();
  if (!allCache || now - allCacheAt > CACHE_MS) {
    const rows = await SystemSetting.find({}).lean();
    allCache = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    allCacheAt = now;
  }
  if (allCache && Object.prototype.hasOwnProperty.call(allCache, key)) {
    return allCache[key];
  }
  return defaultValue;
}

async function getBooleanSetting(key, defaultValue = false) {
  const v = await getSetting(key, defaultValue);
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === true) return true;
  if (v === 'false' || v === false) return false;
  return defaultValue;
}

async function getNumberSetting(key, defaultValue = 0) {
  const v = await getSetting(key, defaultValue);
  const n = Number(v);
  return Number.isFinite(n) ? n : defaultValue;
}

/** @param {string} key */
async function getStringSetting(key, defaultValue = '') {
  const v = await getSetting(key, defaultValue);
  if (v == null || v === undefined) return defaultValue;
  return String(v);
}

async function setSetting(key, value) {
  await ensureDefaults();
  await SystemSetting.findOneAndUpdate({ key }, { $set: { value } }, { upsert: true, new: true });
  invalidateCache();
}

async function getAllSettingsMap() {
  await ensureDefaults();
  const rows = await SystemSetting.find({}).lean();
  const out = { ...DEFAULTS };
  for (const r of rows) {
    if (r.key) out[r.key] = r.value;
  }
  return out;
}

module.exports = {
  ensureDefaults,
  getSetting,
  getBooleanSetting,
  getNumberSetting,
  getStringSetting,
  setSetting,
  getAllSettingsMap,
  invalidateCache,
  DEFAULTS,
};
