const crypto = require('crypto');
const fingerprint = (value) => crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 20);
/** Request-owned, bounded telemetry. No raw query, document text, code or credentials in production events. */
class DocumentJitTrace {
  constructor({ sink, captureQueries = false, maxEvents = 256, traceId = crypto.randomUUID() } = {}) {
    this.traceId = traceId; this.events = []; this.sink = sink; this.captureQueries = captureQueries; this.maxEvents = maxEvents;
  }
  query(query) { return { query_hash: fingerprint(query), query_chars: String(query || '').length, ...(this.captureQueries ? { query } : {}) }; }
  emit(stage, data = {}) {
    if (this.events.length >= this.maxEvents) return;
    const event = { trace_id: this.traceId, stage, at: Date.now(), ...data };
    this.events.push(event);
    try { this.sink?.(event); } catch { /* Observability cannot fail a document read. */ }
    return event;
  }
}
function runtimeEvent(stage, scope, data = {}) {
  if (process.env.SANSUO_JIT_TRACE !== 'true') return;
  try { require('@librechat/data-schemas').logger.info('[JIT trace] ' + JSON.stringify({ stage, scope_hash: fingerprint(scope), ...data })); } catch { /* optional telemetry */ }
}
module.exports = { DocumentJitTrace, fingerprint, runtimeEvent };
