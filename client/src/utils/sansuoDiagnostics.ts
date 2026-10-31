export type SanSuoDiagnosticEntry = {
  timestamp: string;
  event: string;
  details?: Record<string, unknown>;
};

const MAX_ENTRIES = 100;
const entries: SanSuoDiagnosticEntry[] = [];

export function recordSanSuoDiagnostic(event: string, details?: Record<string, unknown>): void {
  entries.push({
    timestamp: new Date().toISOString(),
    event,
    ...(details ? { details } : {}),
  });
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
}

export function getSanSuoDiagnostics(): SanSuoDiagnosticEntry[] {
  return entries.map((entry) => ({
    ...entry,
    details: entry.details ? { ...entry.details } : undefined,
  }));
}
