/** Request-owned context ledger. Model input callbacks refresh it after pruning.
 * Uses the deployed Agent tokenizer with calibration and margin, NOT a claim of
 * exact provider tokens. No caller-supplied token budget is trusted. */
class DocumentReadBudget {
  constructor({ maxContextTokens, count, reserveTokens = 8192, maxToolResultChars, calibrationRatio = 1 }) {
    this.limit = Number(maxContextTokens) || 0;
    this.count = count;
    this.ratio = Math.max(1, Number(calibrationRatio) || 1) * 1.15;
    this.reserve = Math.max(reserveTokens, Math.ceil(this.limit * 0.15));
    // ToolNode/provider adapters may apply a smaller cap than the nominal context window.
    // Keep a conservative model-facing ceiling so read_full fails closed instead of
    // being silently head+tail truncated downstream.
    this.maxChars = Math.min(maxToolResultChars || 24000, Math.floor(this.limit * 0.3) * 4, 24000);
    this.used = 0;
    this.ready = false;
  }
  tokens(text) { return Math.ceil(this.count(String(text)) * this.ratio); }
  observe(messages) {
    this.used = messages.reduce((n, m) => n + this.tokens(JSON.stringify(m)), 0);
    this.ready = this.limit > 0;
  }
  observeRequest(payload) {
    if (!Array.isArray(payload?.messages)) { this.ready = false; return; }
    const output = Number(payload.max_completion_tokens ?? payload.max_tokens);
    if (Number.isFinite(output) && output > 0) this.reserve = Math.max(this.reserve, output + 2048);
    this.observe(payload.messages);
    this.used += this.tokens(JSON.stringify(payload.tools || []));
  }
  snapshot() { return { available: this.ready, max_context_tokens: this.limit,
    remaining_tokens: Math.max(0, this.limit - this.reserve - this.used), reserved_tokens: this.reserve,
    max_tool_result_chars: this.maxChars, counting: 'deployed_agent_tokenizer_with_safety_margin' }; }
  fits(serialized) { return this.ready && serialized.length <= this.maxChars && this.tokens(serialized) <= this.snapshot().remaining_tokens; }
  consume(serialized) { this.used += this.tokens(serialized); }
}
module.exports = { DocumentReadBudget };
