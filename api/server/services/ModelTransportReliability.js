'use strict';

// Retry model HTTP only, never an Agent graph or a tool. A delivered stream is not replayable.
const { setTimeout: sleep } = require('node:timers/promises');
const NETWORK_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET']);

function classifyModelError(error) {
  const chain = [];
  for (let e = error; e && chain.length < 6 && !chain.includes(e); e = e.cause) chain.push(e);
  const status = chain.map(e => Number(e.status || e.statusCode || e.response?.status)).find(s => s >= 400 && s <= 599);
  const cause = chain.map(e => e.code).find(c => NETWORK_CODES.has(c));
  if (chain.some(e => e.name === 'TimeoutError' || e.code === 'MODEL_DEADLINE')) return { code: 'MODEL_TIMEOUT', retryable: false, status: status || null, cause: cause || null };
  if (chain.some(e => e.name === 'AbortError')) return { code: 'MODEL_CANCELLED', retryable: false, status: status || null, cause: cause || null };
  if (status) return { code: status === 429 ? 'MODEL_RATE_LIMIT' : status === 401 || status === 403 ? 'MODEL_AUTH_REJECTED' : 'MODEL_HTTP_ERROR', retryable: [408, 429, 500, 502, 503, 504].includes(status), status, cause: cause || null };
  if (cause) return { code: 'MODEL_NETWORK_ERROR', retryable: true, status: null, cause };
  return { code: 'MODEL_UNKNOWN_ERROR', retryable: false, status: null, cause: null };
}

function deadlineError() { return Object.assign(new Error('Model request deadline exceeded'), { name: 'TimeoutError', code: 'MODEL_DEADLINE' }); }

function createModelFetch({ fetchImpl = fetch, signal, deadline = Infinity, timeoutMs = 120000, maxAttempts = 3, emit = () => {}, backoffMs = 300 } = {}) {
  return async (url, init = {}) => {
    const started = Date.now();
    const end = Math.min(deadline, started + timeoutMs);
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const remaining = end - Date.now();
      if (remaining <= 0) throw deadlineError();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(deadlineError()), remaining);
      const signals = [signal, init.signal, controller.signal].filter(Boolean);
      const combined = AbortSignal.any(signals);
      const cleanup = () => clearTimeout(timer);
      let response;
      try {
        combined.throwIfAborted();
        response = await fetchImpl(url, { ...init, signal: combined });
        if (!response.ok) {
          const error = Object.assign(new Error('Model HTTP request failed'), { status: response.status });
          const details = classifyModelError(error);
          // Drain/cancel before retry so the connection and response body are released.
          if (details.retryable && attempt < maxAttempts) {
            const retryAfter = response.headers?.get?.('retry-after');
            error.retryAfterMs = retryAfter ? (Number.isFinite(Number(retryAfter)) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now()) : 0;
          }
          await response.body?.cancel?.().catch(() => {});
          throw error;
        }
        emit({ attempt, phase: 'headers', status: response.status, elapsed_ms: Date.now() - started });
        if (!response.body?.getReader) { cleanup(); return response; }
        const reader = response.body.getReader();
        let bytes = 0;
        const body = new ReadableStream({
          async pull(target) {
            try {
              combined.throwIfAborted();
              const next = await reader.read();
              if (next.done) {
                cleanup();
                emit({ attempt, phase: 'complete', bytes, elapsed_ms: Date.now() - started });
                target.close();
              } else { bytes += next.value.byteLength; target.enqueue(next.value); }
            } catch (error) {
              cleanup();
              const failure = combined.aborted ? combined.reason : error;
              emit({ attempt, phase: 'stream_failed', ...classifyModelError(failure), bytes, retry_suppressed: 'stream_started', elapsed_ms: Date.now() - started });
              await reader.cancel().catch(() => {});
              target.error(failure);
            }
          },
          async cancel(reason) { cleanup(); await reader.cancel(reason).catch(() => {}); },
        });
        return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
      } catch (error) {
        cleanup();
        const failure = combined.aborted ? combined.reason : error;
        const details = classifyModelError(failure);
        const delay = Math.max(backoffMs * 2 ** (attempt - 1), Math.max(0, error.retryAfterMs || 0));
        const retry = details.retryable && !combined.aborted && attempt < maxAttempts && Date.now() + delay < end;
        emit({ attempt, phase: 'failed', ...details, retry, delay_ms: retry ? delay : 0, elapsed_ms: Date.now() - started });
        if (!retry) throw failure;
        const parents = [signal, init.signal].filter(Boolean);
        await sleep(delay, undefined, parents.length ? { signal: AbortSignal.any(parents) } : {});
      }
    }
  };
}

function failureMessage(details) {
  const reason = { MODEL_TIMEOUT: '模型请求超时', MODEL_CANCELLED: '请求已取消', MODEL_RATE_LIMIT: '模型服务限流', MODEL_AUTH_REJECTED: '模型服务拒绝访问', MODEL_NETWORK_ERROR: '模型连接中断', MODEL_EMPTY_ANSWER: '模型未返回最终答案' }[details.code] || '模型服务请求失败';
  return `本次回答未完成：${reason}（${details.code}）。已取得的证据不能视为完成核对的答案；请稍后重试。`;
}

module.exports = { createModelFetch, classifyModelError, deadlineError, failureMessage };
