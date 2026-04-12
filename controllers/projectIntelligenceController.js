const NodeCache = require('node-cache');
const { scanProject } = require('../utils/projectScanner');
const { detectModules, getInactiveComponentHints } = require('../utils/moduleDetector');
const { findDuplicates } = require('../utils/duplicateDetector');
const { detectMissing } = require('../utils/missingDetector');
const { getErrors } = require('../utils/errorLogger');
const { analyzeProject, computePriority } = require('../utils/aiAnalyzer');
const { buildProjectPatches } = require('../utils/patchGenerator');
const { isDBConnected } = require('../config/db');
const { getRedis } = require('../config/redis');
const ErrorLog = require('../models/ErrorLog');
const {
  buildRoadmap,
  buildMissionSuggestions,
  getMissionStats,
  normalizeStats,
  buildMissionAlerts,
  buildMilestones,
  getAgentOnboardingActions,
  getAgentData,
  buildGrowthTriggers,
} = require('../utils/missionControl');
const { getAgentFoundationSummary } = require('../utils/agentFoundationStore');

const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });
const CACHE_KEY = 'admin_project_overview_v2';

/**
 * @param {{ gaps: Array<{ severity: string; label: string }>; missing: string[]; duplicates: Array<{ name: string; count: number }> }} p
 */
function buildSmartWarnings(p) {
  const { gaps, missing, duplicates } = p;
  const warnings = [];

  gaps.forEach((g) => {
    warnings.push({ severity: g.severity, code: 'hint', label: g.label });
  });

  missing.forEach((label) => {
    warnings.push({ severity: 'warn', code: 'missing_module', label });
  });

  if (duplicates.length > 0) {
    const sample = duplicates
      .slice(0, 5)
      .map((d) => `${d.name} (×${d.count})`)
      .join(', ');
    warnings.push({
      severity: 'info',
      code: 'duplicate_filenames',
      label: `${duplicates.length} duplicate filename(s) across the tree — ${sample}${duplicates.length > 5 ? '…' : ''}`,
    });
  }

  return warnings;
}

/**
 * GET /api/admin/project/overview
 * Cached: tree scan, modules, duplicates, missing (cheap derivations).
 * Always fresh: status, DB pending count, in-memory runtime errors, gaps, warnings.
 * Query: refresh=1 to rescan filesystem.
 */
async function getOverview(req, res, next) {
  try {
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    let scan = cache.get(CACHE_KEY);

    if (!scan || refresh) {
      const { tree, truncated, nodeCount } = scanProject();
      const modules = detectModules(tree);
      const duplicates = findDuplicates(tree);
      const missing = detectMissing(modules);
      scan = {
        tree,
        truncated,
        nodeCount,
        modules,
        duplicates,
        missing,
        cachedAt: new Date().toISOString(),
      };
      cache.set(CACHE_KEY, scan);
    }

    const redisClient = getRedis();
    const status = {
      api: 'running',
      database: isDBConnected() ? 'connected' : 'disconnected',
      redis: redisClient ? 'connected' : 'not_connected',
    };

    let pendingErrors = 0;
    try {
      if (isDBConnected()) {
        pendingErrors = await ErrorLog.countDocuments({ status: 'pending' });
      }
    } catch {
      pendingErrors = 0;
    }

    const errors = {
      pending: pendingErrors,
      source: 'error_log',
      runtime: getErrors(),
    };

    const gaps = getInactiveComponentHints(scan.modules, status, pendingErrors);

    const warnings = buildSmartWarnings({
      gaps,
      missing: scan.missing,
      duplicates: scan.duplicates,
    });

    const insights = analyzeProject({
      modules: scan.modules,
      errors,
      duplicates: scan.duplicates,
      missing: scan.missing,
    });

    const priority = computePriority({
      errors,
      missing: scan.missing,
    });

    const patches = buildProjectPatches({
      runtime: errors.runtime,
      duplicates: scan.duplicates,
      pendingDb: pendingErrors,
    });

    const [statsRaw, agentData] = await Promise.all([getMissionStats(), getAgentData()]);
    const stats = normalizeStats(statsRaw);
    const agentFoundation = getAgentFoundationSummary();
    const roadmap = buildRoadmap(scan.modules, stats, agentData, agentFoundation.approved);
    const suggestions = buildMissionSuggestions(scan.modules, scan.missing);
    const growthTriggers = buildGrowthTriggers(stats, agentData, scan.modules);
    const alerts = buildMissionAlerts(stats);
    const milestones = buildMilestones(stats, agentFoundation.approved);
    const agentActions = getAgentOnboardingActions();

    const payload = {
      ...scan,
      status,
      errors,
      gaps,
      warnings,
      insights,
      priority,
      patches,
      roadmap,
      stats,
      suggestions,
      agentData,
      agentFoundation,
      growthTriggers,
      alerts,
      milestones,
      agentActions,
      missionTracking: {
        statsRefreshedAt: new Date().toISOString(),
        treeCachedAt: scan.cachedAt,
      },
    };

    return res.status(200).json(payload);
  } catch (err) {
    return next(err);
  }
}

module.exports = { getOverview };
