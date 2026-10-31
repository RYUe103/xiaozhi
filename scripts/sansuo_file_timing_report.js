#!/usr/bin/env node

const readline = require('readline');

const marker = '[SanSuoFileTiming]';
const rows = [];

const input = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

input.on('line', (line) => {
  const markerIndex = line.indexOf(marker);
  if (markerIndex < 0) {
    return;
  }
  const jsonStart = line.indexOf('{', markerIndex + marker.length);
  const jsonEnd = line.lastIndexOf('}');
  if (jsonStart < 0 || jsonEnd < jsonStart) {
    return;
  }
  try {
    rows.push(JSON.parse(line.slice(jsonStart, jsonEnd + 1)));
  } catch {
    // Ignore truncated or non-JSON log lines.
  }
});

input.on('close', () => {
  if (rows.length === 0) {
    console.error('没有找到 SanSuoFileTiming 日志。');
    process.exitCode = 1;
    return;
  }

  rows.sort((left, right) => String(left.timestamp).localeCompare(String(right.timestamp)));
  console.log(['timestamp', 'traceId', 'fileType', 'stage', 'status', 'elapsedMs'].join('\t'));
  for (const row of rows) {
    console.log(
      [
        row.timestamp || '',
        row.traceId || '',
        row.fileType || '',
        row.stage || '',
        row.status || '',
        Number.isFinite(Number(row.elapsedMs)) ? Number(row.elapsedMs) : '',
      ].join('\t'),
    );
  }

  const slowest = [...rows]
    .filter((row) => Number.isFinite(Number(row.elapsedMs)))
    .sort((left, right) => Number(right.elapsedMs) - Number(left.elapsedMs))
    .slice(0, 10);
  console.log('\n最慢的 10 个阶段：');
  for (const row of slowest) {
    console.log(
      `${Number(row.elapsedMs)}ms\t${row.fileType || 'document'}\t${row.stage || 'unknown'}\t${row.traceId || ''}`,
    );
  }
});
