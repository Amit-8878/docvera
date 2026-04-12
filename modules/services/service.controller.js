const mongoose = require('mongoose');
const Service = require('./service.model');
const { publicUrlForServiceIconFile } = require('../files/file.service');
const { getIo } = require('../../socket/ioSingleton');
const {
  getCachedServicesListWithRedis,
  setCachedServicesListWithRedis,
  getCachedSearch,
  setCachedSearch,
  invalidateServiceCaches,
} = require('../../cache/apiCache');

function isStaffAdmin(role) {
  return role === 'admin' || role === 'super_admin';
}

function emitServiceUpdated() {
  try {
    const io = getIo();
    if (io) io.emit('service_updated');
  } catch {
    /* ignore */
  }
}

function normalizeNumber(val) {
  if (val === undefined || val === null) return null;
  const num = typeof val === 'string' ? Number(val) : val;
  if (typeof num !== 'number' || Number.isNaN(num)) return null;
  return num;
}

function numOr0(val) {
  const n = normalizeNumber(val);
  return n == null ? 0 : Math.max(0, n);
}

function normalizeStringArray(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((x) => normalizeString(x)).filter(Boolean);
}

function normalizeString(val) {
  if (typeof val !== 'string') return '';
  return val.trim();
}

function normalizeI18n(val) {
  const source = val && typeof val === 'object' ? val : {};
  return {
    en: normalizeString(source.en),
    hi: normalizeString(source.hi),
    hinglish: normalizeString(source.hinglish),
  };
}

/** Maps UI buckets (government / private / personal) to stored category values (incl. legacy rows). */
const CATEGORY_FILTER_GROUPS = {
  government: ['Government', 'Education'],
  private: ['Private', 'Banking', 'Business'],
  personal: ['Personal'],
};

const ALLOWED_CATEGORIES = ['Government', 'Private', 'Personal', 'Banking', 'Business', 'Education'];

function normalizeServiceInput(input) {
  if (!input || typeof input !== 'object') return null;

  const name = normalizeString(input.name) || normalizeString(input.title);
  if (!name) return null;

  const nameI18nRaw = normalizeI18n(input.nameI18n);
  const nameI18n = { ...nameI18nRaw, en: nameI18nRaw.en || name };
  const description = normalizeString(input.description);
  const descriptionI18n = normalizeI18n(input.descriptionI18n);
  const normalizedCategory = normalizeString(input.category);
  const category = ALLOWED_CATEGORIES.includes(normalizedCategory) ? normalizedCategory : 'Personal';
  const subCategory = normalizeString(input.subCategory);
  const basePriceNum = normalizeNumber(input.basePrice ?? input.price);
  const basePrice = basePriceNum == null ? 0 : basePriceNum;

  const processingTime = normalizeString(input.processingTime);
  const requiredDocumentsRaw = Array.isArray(input.requiredDocuments) ? input.requiredDocuments : [];
  const requiredDocuments = requiredDocumentsRaw.map((d) => normalizeString(d)).filter(Boolean);

  let isActive = true;
  if (typeof input.isActive === 'boolean') isActive = input.isActive;
  if (typeof input.active === 'boolean') isActive = input.active;

  let discountPercent = 0;
  if (input.discountPercent != null && input.discountPercent !== '') {
    const d = Number(input.discountPercent);
    if (!Number.isNaN(d)) discountPercent = Math.min(100, Math.max(0, d));
  }

  const pricingType =
    input.pricingType === 'fixed' || input.pricingType === 'per_page' || input.pricingType === 'custom'
      ? input.pricingType
      : 'fixed';

  let optionsRaw = Array.isArray(input.options) ? input.options : [];
  if (
    optionsRaw.length === 0 &&
    input.pricing &&
    typeof input.pricing === 'object' &&
    Array.isArray(input.pricing.options)
  ) {
    optionsRaw = input.pricing.options;
  }
  const options = optionsRaw
    .map((o) => ({
      name: normalizeString(o?.name),
      price: normalizeNumber(o?.price),
      type: o?.type,
      enabled: typeof o?.enabled === 'boolean' ? o.enabled : true,
    }))
    .filter((o) => o.name && o.price != null && o.price >= 0 && (o.type === 'checkbox' || o.type === 'radio'));

  const priceRulesRaw = Array.isArray(input.priceRules) ? input.priceRules : [];
  const priceRules = priceRulesRaw
    .map((r) => ({
      label: normalizeString(r?.label),
      price: normalizeNumber(r?.price),
    }))
    .filter((r) => r.label && r.price != null && r.price >= 0);

  const deliveryOptionsRaw = Array.isArray(input.deliveryOptions) ? input.deliveryOptions : [];
  const deliveryOptions = deliveryOptionsRaw
    .map((d) => ({
      type: d?.type,
      price: normalizeNumber(d?.price),
    }))
    .filter((d) => ['soft_copy', 'hard_copy', 'courier'].includes(d.type) && d.price != null && d.price >= 0);

  const requiredFieldsRaw = Array.isArray(input.requiredFields) ? input.requiredFields : [];
  const requiredFields = requiredFieldsRaw
    .map((f) => ({
      label: normalizeString(f?.label),
      labelI18n: normalizeI18n(f?.labelI18n),
      type: f?.type,
    }))
    .filter((f) => f.label && (f.type === 'file' || f.type === 'text' || f.type === 'number' || f.type === 'date'));

  const conditionalFieldsRaw = Array.isArray(input.conditionalFields) ? input.conditionalFields : [];
  const conditionalFields = conditionalFieldsRaw
    .map((c) => ({
      dependsOn: normalizeString(c?.dependsOn),
      fields: Array.isArray(c?.fields)
        ? c.fields
            .map((f) => ({
              label: normalizeString(f?.label),
              labelI18n: normalizeI18n(f?.labelI18n),
              type: f?.type,
            }))
            .filter(
              (f) =>
                f.label &&
                (f.type === 'file' || f.type === 'text' || f.type === 'number' || f.type === 'date')
            )
        : [],
    }))
    .filter((c) => c.dependsOn && c.fields.length > 0);

  const documentTypesRaw = Array.isArray(input.documentTypes) ? input.documentTypes : [];
  const documentTypes = documentTypesRaw.map((d) => normalizeString(d)).filter((d) => d);

  const searchKeywordsRaw = Array.isArray(input.searchKeywords) ? input.searchKeywords : [];
  const searchKeywords = searchKeywordsRaw.map((k) => normalizeString(k)).filter(Boolean);

  const turnaroundTime = normalizeString(input.turnaroundTime);

  function legacyCategoryToCatalog(catVal) {
    const x = normalizeString(catVal);
    if (['Government', 'Education'].includes(x)) return 'government';
    if (['Private', 'Banking', 'Business'].includes(x)) return 'private';
    return 'personal';
  }

  const bucketInput = normalizeString(input.catalogCategory).toLowerCase() || normalizeString(input.category).toLowerCase();
  const catalogCategory = ['government', 'private', 'personal'].includes(bucketInput)
    ? bucketInput
    : legacyCategoryToCatalog(category);

  const BUCKET_TO_LEGACY = { government: 'Government', private: 'Private', personal: 'Personal' };
  let categoryOut = category;
  if (
    ['government', 'private', 'personal'].includes(catalogCategory) &&
    !ALLOWED_CATEGORIES.includes(normalizedCategory)
  ) {
    categoryOut = BUCKET_TO_LEGACY[catalogCategory];
  }

  const rawIndustry = normalizeString(input.industry);
  const industry = rawIndustry ? rawIndustry.toLowerCase().replace(/\s+/g, '-') : '';

  const title = normalizeString(input.title);
  const imageUrl = normalizeString(input.imageUrl);
  const icon = normalizeString(input.icon);
  const priceBasic = numOr0(input.priceBasic);
  const priceStandard = numOr0(input.priceStandard);
  const pricePremium = numOr0(input.pricePremium);
  const featuresBasic = normalizeStringArray(input.featuresBasic);
  const featuresStandard = normalizeStringArray(input.featuresStandard);
  const featuresPremium = normalizeStringArray(input.featuresPremium);
  const deliveryTimeBasic = normalizeString(input.deliveryTimeBasic);
  const deliveryTimeStandard = normalizeString(input.deliveryTimeStandard);
  const deliveryTimePremium = normalizeString(input.deliveryTimePremium);
  const deliveryTime = normalizeString(input.deliveryTime);

  if (pricingType === 'per_page' && priceRules.length === 0) {
    return { __error: 'priceRules is required for per_page pricingType' };
  }
  const deliveryOptionsFinal =
    deliveryOptions.length > 0 ? deliveryOptions : [{ type: 'soft_copy', price: 0 }];

  const courierEnabled = typeof input.courierEnabled === 'boolean' ? input.courierEnabled : false;
  const courierFeeNum = normalizeNumber(input.courierFee);
  const courierFee = courierFeeNum == null ? 0 : Math.max(0, courierFeeNum);

  return {
    name,
    nameI18n,
    catalogCategory,
    industry,
    category: categoryOut,
    subCategory,
    description,
    descriptionI18n,
    basePrice,
    pricingType,
    options,
    priceRules,
    deliveryOptions: deliveryOptionsFinal,
    documentTypes,
    searchKeywords,
    turnaroundTime,
    requiredFields,
    conditionalFields,
    processingTime,
    requiredDocuments,
    isActive,
    active: isActive,
    title,
    imageUrl,
    icon,
    priceBasic,
    priceStandard,
    pricePremium,
    featuresBasic,
    featuresStandard,
    featuresPremium,
    deliveryTimeBasic,
    deliveryTimeStandard,
    deliveryTimePremium,
    deliveryTime,
    discountPercent,
    courierEnabled,
    courierFee,
  };
}

function mapServiceForClient(doc) {
  const s = typeof doc?.toObject === 'function' ? doc.toObject() : doc;
  const out = { ...s };

  if ((out.basePrice == null || out.basePrice === 0) && out.price != null) out.basePrice = Number(out.price);
  if (!out.pricingType) out.pricingType = 'fixed';
  if (!out.nameI18n || typeof out.nameI18n !== 'object') out.nameI18n = { en: out.name || '', hi: '', hinglish: '' };
  if (!out.descriptionI18n || typeof out.descriptionI18n !== 'object') {
    out.descriptionI18n = { en: out.description || '', hi: '', hinglish: '' };
  }
  if (!out.name && out.nameI18n?.en) out.name = out.nameI18n.en;
  if (!out.description && out.descriptionI18n?.en) out.description = out.descriptionI18n.en;
  if (!out.category || typeof out.category !== 'string') out.category = 'Personal';
  if (!out.subCategory || typeof out.subCategory !== 'string') out.subCategory = '';

  function legacyCategoryToCatalogFromDoc(catVal) {
    const x = normalizeString(catVal);
    if (['Government', 'Education'].includes(x)) return 'government';
    if (['Private', 'Banking', 'Business'].includes(x)) return 'private';
    return 'personal';
  }
  if (!out.catalogCategory || !['government', 'private', 'personal'].includes(out.catalogCategory)) {
    out.catalogCategory = legacyCategoryToCatalogFromDoc(out.category);
  }
  if (typeof out.industry !== 'string') out.industry = '';

  if (!Array.isArray(out.priceRules)) out.priceRules = [];
  if (!Array.isArray(out.deliveryOptions) || out.deliveryOptions.length === 0) {
    out.deliveryOptions = [{ type: 'soft_copy', price: 0 }];
  }
  if (!Array.isArray(out.requiredFields)) out.requiredFields = [];
  out.requiredFields = out.requiredFields.map((field) => ({
    ...field,
    labelI18n:
      field && typeof field.labelI18n === 'object'
        ? {
            en: normalizeString(field.labelI18n.en),
            hi: normalizeString(field.labelI18n.hi),
            hinglish: normalizeString(field.labelI18n.hinglish),
          }
        : { en: normalizeString(field?.label), hi: '', hinglish: '' },
  }));
  if (!Array.isArray(out.conditionalFields)) out.conditionalFields = [];
  out.conditionalFields = out.conditionalFields.map((rule) => ({
    ...rule,
    fields: Array.isArray(rule.fields)
      ? rule.fields.map((field) => ({
          ...field,
          labelI18n:
            field && typeof field.labelI18n === 'object'
              ? {
                  en: normalizeString(field.labelI18n.en),
                  hi: normalizeString(field.labelI18n.hi),
                  hinglish: normalizeString(field.labelI18n.hinglish),
                }
              : { en: normalizeString(field?.label), hi: '', hinglish: '' },
        }))
      : [],
  }));
  if (!Array.isArray(out.documentTypes)) out.documentTypes = [];
  if (!Array.isArray(out.searchKeywords)) out.searchKeywords = [];
  if (out.discountPercent == null || Number.isNaN(Number(out.discountPercent))) out.discountPercent = 0;
  else out.discountPercent = Math.min(100, Math.max(0, Number(out.discountPercent)));

  if (typeof out.courierEnabled !== 'boolean') out.courierEnabled = false;
  if (out.courierFee == null || Number.isNaN(Number(out.courierFee))) out.courierFee = 0;
  else out.courierFee = Math.max(0, Number(out.courierFee));

  if (!Array.isArray(out.options)) out.options = [];
  out.options = out.options.map((o) => ({
    ...o,
    enabled: o.enabled !== false,
  }));
  out.pricing = {
    basePrice: Number(out.basePrice || 0),
    options: out.options
      .filter((o) => o.enabled !== false)
      .map((o) => ({
        name: o.name,
        price: Number(o.price || 0),
        type: o.type === 'radio' ? 'radio' : 'checkbox',
      })),
  };

  if (out.pricingType === 'per_page' && out.priceRules.length === 0) {
    out.priceRules = [{ label: 'Default', price: 0 }];
  }

  if (typeof out.isActive !== 'boolean') out.isActive = true;
  if (typeof out.active !== 'boolean') out.active = true;
  if (!out.processingTime && out.turnaroundTime) out.processingTime = out.turnaroundTime;
  if (!Array.isArray(out.requiredDocuments)) out.requiredDocuments = [];

  if (!out.title || typeof out.title !== 'string') {
    out.title = typeof out.name === 'string' ? out.name : out.nameI18n?.en || '';
  }
  if (typeof out.icon !== 'string') out.icon = '';
  if (!Array.isArray(out.featuresBasic)) out.featuresBasic = [];
  if (!Array.isArray(out.featuresStandard)) out.featuresStandard = [];
  if (!Array.isArray(out.featuresPremium)) out.featuresPremium = [];
  if (out.priceBasic == null) out.priceBasic = 0;
  if (out.priceStandard == null) out.priceStandard = 0;
  if (out.pricePremium == null) out.pricePremium = 0;

  const tierPrices = [out.priceBasic, out.priceStandard, out.pricePremium]
    .map((x) => Number(x || 0))
    .filter((x) => x > 0);
  const minTier = tierPrices.length ? Math.min(...tierPrices) : null;
  if (minTier != null && (!out.basePrice || Number(out.basePrice) === 0)) {
    out.basePrice = minTier;
  }
  out.startingPrice = minTier != null ? minTier : Number(out.basePrice || 0);
  const alive = out.isActive !== false && out.active !== false;
  out.active = alive;
  out.isActive = alive;
  if (!out.deliveryTime || typeof out.deliveryTime !== 'string') {
    out.deliveryTime = out.turnaroundTime || out.processingTime || '';
  }

  const fallbackDt = out.turnaroundTime || out.deliveryTime || '';
  out.plans = [
    {
      tier: 'basic',
      label: 'Basic',
      price: Number(out.priceBasic || 0),
      features: out.featuresBasic,
      deliveryTime: out.deliveryTimeBasic || fallbackDt,
    },
    {
      tier: 'standard',
      label: 'Standard',
      price: Number(out.priceStandard || 0),
      features: out.featuresStandard,
      deliveryTime: out.deliveryTimeStandard || fallbackDt,
    },
    {
      tier: 'premium',
      label: 'Premium',
      price: Number(out.pricePremium || 0),
      features: out.featuresPremium,
      deliveryTime: out.deliveryTimePremium || fallbackDt,
    },
  ];

  delete out.price;

  return out;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildBucketClause(bucketKey) {
  const legacyCats = CATEGORY_FILTER_GROUPS[bucketKey];
  if (!legacyCats) return null;
  return {
    $or: [
      { catalogCategory: bucketKey },
      {
        $and: [
          {
            $or: [{ catalogCategory: { $exists: false } }, { catalogCategory: null }, { catalogCategory: '' }],
          },
          { category: { $in: legacyCats } },
        ],
      },
    ],
  };
}

/** Map new browse slugs to legacy industry values stored in the catalog. */
const INDUSTRY_SLUG_ALIASES = {
  documents: ['id-services', 'certificates'],
};

/** Industry slug from query (e.g. banking, id-services). Omits filter when slug is empty or `general`. */
function buildIndustryClause(rawIndustry) {
  if (rawIndustry == null || typeof rawIndustry !== 'string') return null;
  const slug = rawIndustry.trim().toLowerCase().replace(/\s+/g, '-');
  if (!slug || slug === 'general') return null;

  const extra = INDUSTRY_SLUG_ALIASES[slug] || [];
  const variants = [slug, ...extra];
  const ors = [];
  for (const v of variants) {
    const esc = escapeRegex(v);
    const relaxed = v.replace(/-/g, '[\\s-]');
    ors.push(
      { industry: new RegExp(`^${esc}$`, 'i') },
      { industry: v },
      { subCategory: new RegExp(relaxed, 'i') }
    );
  }
  return { $or: ors };
}

function buildListFilter(query) {
  const parts = [];
  const rawCatExact = query.cat;
  if (rawCatExact != null && typeof rawCatExact === 'string' && rawCatExact.trim()) {
    const exact = ALLOWED_CATEGORIES.find((c) => c.toLowerCase() === rawCatExact.trim().toLowerCase());
    if (exact) parts.push({ category: exact });
  } else {
    const raw = query.category;
    if (raw != null && typeof raw === 'string' && raw.trim()) {
      const key = raw.trim().toLowerCase();
      const group = CATEGORY_FILTER_GROUPS[key];
      if (group) {
        const bucket = buildBucketClause(key);
        if (bucket) parts.push(bucket);
      } else {
        const match = ALLOWED_CATEGORIES.find((c) => c.toLowerCase() === key);
        if (match) parts.push({ category: match });
      }
    }
  }

  const rawInd = query.industry;
  if (rawInd != null && typeof rawInd === 'string' && rawInd.trim()) {
    const indClause = buildIndustryClause(rawInd);
    if (indClause) parts.push(indClause);
  }

  /** Hide internal placeholder services from browse. */
  const notExcluded = { excludeFromBrowse: { $ne: true } };
  /** Public catalog includes inactive services (client shows blurred / unavailable). */
  if (parts.length === 0) return notExcluded;
  return { $and: [...parts, notExcluded] };
}

/** Related-term expansion for suggestion strip (e.g. PAN → Aadhaar / correction). */
function buildSuggestionConditions(queryText) {
  const q = queryText.trim();
  if (!q) return [];
  const sugOr = [];
  if (/\bpan\b/i.test(q)) {
    const r = /aadhaar|aadhar|correction|update|passport|driving/i;
    sugOr.push({ name: r }, { description: r }, { documentTypes: r }, { searchKeywords: r });
  }
  if (/\baadhaar\b|\baadhar\b/i.test(q)) {
    const r = /pan|correction|update|passport/i;
    sugOr.push({ name: r }, { description: r }, { documentTypes: r }, { searchKeywords: r });
  }
  if (/\bpassport\b/i.test(q)) {
    const r = /visa|pan|aadhaar|aadhar/i;
    sugOr.push({ name: r }, { description: r }, { searchKeywords: r });
  }
  if (/\bvisa\b/i.test(q)) {
    const r = /passport|pan/i;
    sugOr.push({ name: r }, { description: r });
  }
  return sugOr;
}

// GET /api/services/search?q=
async function searchServices(req, res, next) {
  try {
    const q = (req.query.q || '').trim();
    const cached = q ? getCachedSearch(req) : null;
    if (cached) {
      return res.status(200).json(cached);
    }
    if (!q) {
      return res.status(200).json({ services: [], suggestions: [] });
    }

    const rx = new RegExp(escapeRegex(q), 'i');
    const textOr = [
      { name: rx },
      { 'nameI18n.en': rx },
      { 'nameI18n.hi': rx },
      { 'nameI18n.hinglish': rx },
      { description: rx },
      { 'descriptionI18n.en': rx },
      { 'descriptionI18n.hi': rx },
      { 'descriptionI18n.hinglish': rx },
      { category: rx },
      { subCategory: rx },
      { documentTypes: rx },
      { searchKeywords: rx },
    ];

    const scopeFilter = buildListFilter(req.query);
    const textClause = { $or: textOr };
    const mainFilter =
      Object.keys(scopeFilter).length === 0 ? textClause : { $and: [scopeFilter, textClause] };
    const primary = await Service.find(mainFilter).sort({ name: 1 }).limit(50).lean();
    const primaryIds = primary.map((p) => p._id);

    const sugOr = buildSuggestionConditions(q);
    let suggestions = [];
    if (sugOr.length > 0) {
      const sugParts = [];
      if (Object.keys(scopeFilter).length) sugParts.push(scopeFilter);
      if (primaryIds.length) sugParts.push({ _id: { $nin: primaryIds } });
      sugParts.push({ $or: sugOr });
      const sugFilter = sugParts.length > 1 ? { $and: sugParts } : sugParts[0];
      suggestions = await Service.find(sugFilter).sort({ name: 1 }).limit(8).lean();
    }

    const payload = {
      services: primary.map((s) => mapServiceForClient(s)),
      suggestions: suggestions.map((s) => mapServiceForClient(s)),
    };
    if (q) setCachedSearch(req, payload);
    return res.status(200).json(payload);
  } catch (err) {
    return next(err);
  }
}

// GET /api/services
async function getAllServices(req, res, next) {
  try {
    const hit = await getCachedServicesListWithRedis(req);
    if (hit) {
      return res.status(200).json(hit);
    }
    const filter = buildListFilter(req.query);
    const services = await Service.find(filter).sort({ name: 1 }).lean();
    const payload = { services: services.map((s) => mapServiceForClient(s)) };
    await setCachedServicesListWithRedis(req, payload);
    return res.status(200).json(payload);
  } catch (err) {
    return next(err);
  }
}

// GET /api/services/:id
async function getSingleService(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Bad request', details: 'Invalid service id' });
    }
    const service = await Service.findById(id);
    if (!service) {
      return res.status(404).json({ message: 'Service not found' });
    }
    return res.status(200).json({ service: mapServiceForClient(service) });
  } catch (err) {
    return next(err);
  }
}

/** POST /api/admin/service — create or update when same name + catalog + industry exists. */
async function adminUpsertService(req, res, next) {
  try {
    if (!isStaffAdmin(req.user?.role)) {
      return res.status(403).json({ message: 'Forbidden', details: 'Admin only' });
    }

    const input = normalizeServiceInput(req.body);
    if (!input) {
      return res.status(400).json({ message: 'Invalid input' });
    }
    if (input.__error) {
      return res.status(400).json({ message: 'Invalid input', details: input.__error });
    }

    if (req.file) {
      input.icon = publicUrlForServiceIconFile(req.file);
    }

    const industryKey = input.industry || '';
    const existing = await Service.findOne({
      catalogCategory: input.catalogCategory,
      name: new RegExp(`^${escapeRegex(input.name)}$`, 'i'),
      $expr: { $eq: [{ $ifNull: ['$industry', ''] }, industryKey] },
    });

    if (existing) {
      const updated = await Service.findByIdAndUpdate(existing._id, input, { new: true, runValidators: true });
      if (!updated) return res.status(404).json({ message: 'Service not found' });
      invalidateServiceCaches();
      emitServiceUpdated();
      return res.status(200).json({ service: mapServiceForClient(updated), upserted: 'updated' });
    }

    const service = await Service.create(input);
    invalidateServiceCaches();
    emitServiceUpdated();
    return res.status(201).json({ service: mapServiceForClient(service), upserted: 'created' });
  } catch (err) {
    return next(err);
  }
}

// POST /api/services (admin)
async function createService(req, res, next) {
  try {
    if (!isStaffAdmin(req.user?.role)) {
      return res.status(403).json({ message: 'Forbidden', details: 'Admin only' });
    }

    const input = normalizeServiceInput(req.body);
    if (!input) {
      return res.status(400).json({ message: 'Invalid input' });
    }
    if (input.__error) {
      return res.status(400).json({ message: 'Invalid input', details: input.__error });
    }

    if (req.file) {
      input.icon = publicUrlForServiceIconFile(req.file);
    }

    const service = await Service.create(input);
    invalidateServiceCaches();
    emitServiceUpdated();
    return res.status(201).json({ service: mapServiceForClient(service) });
  } catch (err) {
    return next(err);
  }
}

// PUT /api/services/:id (admin) — also PUT /api/admin/service/:id
async function updateService(req, res, next) {
  try {
    if (!isStaffAdmin(req.user?.role)) {
      return res.status(403).json({ message: 'Forbidden', details: 'Admin only' });
    }

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Bad request', details: 'Invalid service id' });
    }

    const input = normalizeServiceInput(req.body);
    if (!input) return res.status(400).json({ message: 'Invalid input' });
    if (input.__error) return res.status(400).json({ message: 'Invalid input', details: input.__error });

    const updated = await Service.findByIdAndUpdate(id, input, { new: true, runValidators: true });
    if (!updated) return res.status(404).json({ message: 'Service not found' });

    invalidateServiceCaches();
    emitServiceUpdated();
    return res.status(200).json({ service: mapServiceForClient(updated) });
  } catch (err) {
    return next(err);
  }
}

// PATCH /api/services/toggle/:id (admin) — also PATCH /api/admin/service/toggle/:id
async function toggleService(req, res, next) {
  try {
    if (!isStaffAdmin(req.user?.role)) {
      return res.status(403).json({ message: 'Forbidden', details: 'Admin only' });
    }

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Bad request', details: 'Invalid service id' });
    }

    const existing = await Service.findById(id);
    if (!existing) return res.status(404).json({ message: 'Service not found' });

    const wasOff = existing.isActive === false || existing.active === false;
    const nextActive = wasOff;
    const updated = await Service.findByIdAndUpdate(
      id,
      { $set: { isActive: nextActive, active: nextActive } },
      { new: true }
    );
    invalidateServiceCaches();
    emitServiceUpdated();
    return res.status(200).json({ service: mapServiceForClient(updated) });
  } catch (err) {
    return next(err);
  }
}

// DELETE /api/services/:id (admin)
async function deleteService(req, res, next) {
  try {
    if (!isStaffAdmin(req.user?.role)) {
      return res.status(403).json({ message: 'Forbidden', details: 'Admin only' });
    }

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Bad request', details: 'Invalid service id' });
    }

    const deleted = await Service.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ message: 'Service not found' });

    invalidateServiceCaches();
    emitServiceUpdated();
    return res.status(200).json({ success: true });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getAllServices,
  searchServices,
  getSingleService,
  getServiceById: getSingleService,
  adminUpsertService,
  createService,
  updateService,
  toggleService,
  deleteService,
};
