const ErrorLog = require('../models/ErrorLog');
const User = require('../models/User');
const { isDBConnected } = require('../config/db');
const { createNotification } = require('./notificationService');
const { invalidateServiceCaches, invalidateNearbyCaches } = require('../cache/apiCache');

function parseStackHint(stack) {
  if (!stack || typeof stack !== 'string') return { fileHint: '', lineHint: null };
  const lines = stack.split('\n').slice(0, 8).join('\n');
  const m = lines.match(/([^()\s]+\.(?:js|ts|tsx)):(\d+)/);
  if (m) {
    return { fileHint: m[1].split(/[/\\]/).pop() || m[1], lineHint: Number(m[2]) || null };
  }
  return { fileHint: '', lineHint: null };
}

/**
 * Persist 5xx errors and run AI analysis in the background.
 */
async function recordAndAnalyzeError({ err, req, statusCode }) {
  try {
    const stack = err && err.stack ? String(err.stack) : '';
    const { fileHint, lineHint } = parseStackHint(stack);
    const doc = await ErrorLog.create({
      message: String(err?.message || 'Server error').slice(0, 2000),
      stack: stack.slice(0, 20000),
      route: req?.originalUrl || req?.url || '',
      method: req?.method || '',
      httpStatus: Number(statusCode) || 500,
      status: 'pending',
      fileHint,
      lineHint,
      requestId: req?.requestId || '',
    });
    setImmediate(() => {
      analyzeErrorLogById(doc._id).catch(() => {});
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    if (process.env.NODE_ENV !== 'production') console.error('aiDebugger.record', e && e.message ? e.message : e);
  }
}

async function callAiForError(doc) {
  const apiKey = process.env.OPENAI_API_KEY;
  const ollamaBase = (process.env.OLLAMA_URL || '').replace(/\/$/, '');
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  const userContent = `You are a DevOps assistant for an Indian admin. Reply with VALID JSON ONLY, no markdown:
{"explanationHi":"2-4 short sentences in SIMPLE Hindi (Devanagari) explaining what went wrong for a non-developer.",
 "fixSuggestion":"3-6 short lines in simple English or Hinglish: safe steps (restart service from dashboard, check env vars, retry request). NEVER suggest editing source code or database by hand."}

Error message: ${doc.message}
HTTP: ${doc.httpStatus} ${doc.method} ${doc.route}
File hint: ${doc.fileHint || 'unknown'}
Stack (truncated):
${String(doc.stack || '').slice(0, 3500)}`;

  if (apiKey) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.25,
        max_tokens: 600,
        messages: [
          { role: 'system', content: 'Output JSON only. Keys: explanationHi, fixSuggestion.' },
          { role: 'user', content: userContent },
        ],
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`OpenAI ${res.status}: ${t.slice(0, 200)}`);
    }
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content || '';
    return parseAiJson(raw);
  }

  if (ollamaBase) {
    const res = await fetch(`${ollamaBase}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OLLAMA_MODEL || 'llama3.2',
        stream: false,
        messages: [
          { role: 'system', content: 'Reply with JSON only: {"explanationHi":"...","fixSuggestion":"..."}' },
          { role: 'user', content: userContent },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}`);
    const data = await res.json();
    const raw = data?.message?.content || '';
    return parseAiJson(raw);
  }

  return {
    explanationHi:
      'AI विश्लेषण उपलब्ध नहीं है। सर्वर पर OPENAI_API_KEY या OLLAMA_URL सेट करें।',
    fixSuggestion:
      'Set OPENAI_API_KEY (OpenAI) or OLLAMA_URL (local Ollama) in environment. Then new errors will get Hindi explanation and fix hints.',
  };
}

function parseAiJson(raw) {
  const text = String(raw || '').trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const jsonStr = jsonMatch ? jsonMatch[0] : text;
  try {
    const o = JSON.parse(jsonStr);
    return {
      explanationHi: String(o.explanationHi || o.explanation_hi || '').slice(0, 4000),
      fixSuggestion: String(o.fixSuggestion || o.fix_suggestion || '').slice(0, 4000),
    };
  } catch {
    return {
      explanationHi: 'विश्लेषण पार्स नहीं हो सका।',
      fixSuggestion: text.slice(0, 2000),
    };
  }
}

async function analyzeErrorLogById(id) {
  const doc = await ErrorLog.findById(id);
  if (!doc) return;
  if (doc.aiAnalyzedAt && doc.aiExplanationHi) return;

  try {
    const { explanationHi, fixSuggestion } = await callAiForError(doc);
    await ErrorLog.findByIdAndUpdate(id, {
      $set: {
        aiExplanationHi: explanationHi,
        aiFixSuggestion: fixSuggestion,
        aiAnalyzedAt: new Date(),
      },
    });

    const admins = await User.find({ role: { $in: ['admin', 'super_admin'] } })
      .select('_id role')
      .limit(25)
      .lean();
    const title = 'AI Monitor: नया सर्वर एरर';
    const msg = `${doc.message.slice(0, 120)} — ${doc.method} ${doc.route}`;
    await Promise.all(
      admins.map((u) =>
        createNotification({
          userId: u._id,
          role: 'admin',
          title,
          message: msg,
          type: 'system',
          event: 'system_message',
          data: { errorLogId: String(id), kind: 'ai_error' },
          dedupeKey: `ai_err_${String(id)}`,
        }).catch(() => {})
      )
    );
  } catch (e) {
    await ErrorLog.findByIdAndUpdate(id, {
      $set: {
        aiExplanationHi: `AI कॉल विफल: ${String(e && e.message ? e.message : e).slice(0, 500)}`,
        aiFixSuggestion: 'Check API keys and retry analysis from admin panel later.',
        aiAnalyzedAt: new Date(),
      },
    });
  }
}

const SAFE_ACTIONS = new Set([
  'mark_fixed',
  'dismiss',
  'clear_service_cache',
  'clear_nearby_cache',
  'clear_all_api_cache',
  /** Read-only: reports DB connectivity (safe diagnostic). */
  'verify_health',
  /** Logs intent only — actual restart must be done in Render/Railway dashboard. */
  'hosting_restart_hint',
]);

async function applySafeAction(errorLogId, action, actorId) {
  if (!SAFE_ACTIONS.has(action)) {
    return { ok: false, message: 'Unknown or unsafe action' };
  }
  const log = await ErrorLog.findById(errorLogId);
  if (!log) return { ok: false, message: 'Error log not found' };

  if (action === 'mark_fixed') {
    await ErrorLog.findByIdAndUpdate(errorLogId, {
      $set: { status: 'fixed', lastSafeAction: `marked_fixed_by_${String(actorId).slice(-6)}` },
    });
    return { ok: true, message: 'Marked as fixed' };
  }
  if (action === 'dismiss') {
    await ErrorLog.findByIdAndUpdate(errorLogId, {
      $set: { status: 'dismissed', lastSafeAction: 'dismissed' },
    });
    return { ok: true, message: 'Dismissed' };
  }
  if (action === 'clear_service_cache') {
    invalidateServiceCaches();
    await ErrorLog.findByIdAndUpdate(errorLogId, {
      $set: { lastSafeAction: 'service_cache_cleared' },
    });
    return { ok: true, message: 'Service catalog cache cleared' };
  }
  if (action === 'clear_nearby_cache') {
    invalidateNearbyCaches();
    await ErrorLog.findByIdAndUpdate(errorLogId, {
      $set: { lastSafeAction: 'nearby_cache_cleared' },
    });
    return { ok: true, message: 'Nearby agents cache cleared' };
  }
  if (action === 'clear_all_api_cache') {
    invalidateServiceCaches();
    invalidateNearbyCaches();
    await ErrorLog.findByIdAndUpdate(errorLogId, {
      $set: { lastSafeAction: 'all_api_cache_cleared' },
    });
    return { ok: true, message: 'All API caches cleared' };
  }
  if (action === 'verify_health') {
    const dbOk = isDBConnected();
    await ErrorLog.findByIdAndUpdate(errorLogId, {
      $set: { lastSafeAction: `verify_health_db_${dbOk ? 'ok' : 'down'}` },
    });
    return {
      ok: true,
      message: `Health: database ${dbOk ? 'connected' : 'disconnected'}`,
      details: { dbConnected: dbOk },
    };
  }
  if (action === 'hosting_restart_hint') {
    await ErrorLog.findByIdAndUpdate(errorLogId, {
      $set: { lastSafeAction: 'hosting_restart_hint' },
    });
    return {
      ok: true,
      message:
        'Server restart is not triggered from the app. Use your host dashboard (Render → Manual Deploy → Restart, or Railway → Restart).',
      details: { restart: 'hosting_only' },
    };
  }
  return { ok: false, message: 'Unhandled' };
}

module.exports = {
  recordAndAnalyzeError,
  analyzeErrorLogById,
  applySafeAction,
  parseStackHint,
};
