const DEFAULT_TTL_MS = 60 * 60 * 1000;

function normalizeClientRequestId(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(normalized)) {
    return null;
  }
  return normalized;
}

function createRequestStartRegistry({ ttlMs = DEFAULT_TTL_MS } = {}) {
  const entries = new Map();

  const removeEntry = (key, entry) => {
    if (entries.get(key) === entry) {
      entries.delete(key);
    }
  };

  const claim = (key) => {
    if (!key) {
      return {
        isOwner: true,
        promise: null,
        resolve: () => {},
        reject: () => {},
      };
    }

    const existing = entries.get(key);
    if (existing) {
      return {
        isOwner: false,
        promise: existing.promise,
        resolve: () => {},
        reject: () => {},
      };
    }

    let resolvePromise;
    let rejectPromise;
    const promise = new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    // The owner may fail without a duplicate waiter. Keep that rejection handled.
    promise.catch(() => {});

    const entry = { promise, timer: null };
    entries.set(key, entry);

    return {
      isOwner: true,
      promise,
      resolve: (value) => {
        resolvePromise(value);
        entry.timer = setTimeout(() => removeEntry(key, entry), ttlMs);
        entry.timer.unref?.();
      },
      reject: (error) => {
        removeEntry(key, entry);
        rejectPromise(error);
      },
    };
  };

  const clear = () => {
    for (const entry of entries.values()) {
      if (entry.timer) {
        clearTimeout(entry.timer);
      }
    }
    entries.clear();
  };

  return { claim, clear };
}

module.exports = {
  createRequestStartRegistry,
  normalizeClientRequestId,
};
