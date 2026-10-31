/** Remove transport wrappers only; never remove nodes, branches or styling statements. */
export function normalizeMermaidSource(source: string): string {
  let value = source
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .trim();
  for (let count = 0; count < 3; count++) {
    const wrapped = value.match(/^(`{3,}|~{3,})(?:mermaid)?[ \t]*\n([\s\S]*?)\n\1$/i);
    if (!wrapped) break;
    value = wrapped[2].trim();
  }
  return value.replace(/^mermaid[ \t]*\n/i, '').trim();
}

/** Quote bare flowchart labels containing parser punctuation, preserving their text. */
export function repairMermaidSource(source: string): string {
  if (!/^\s*(?:flowchart|graph)\s+(?:TD|TB|BT|LR|RL)\b/.test(source)) return source;
  // Keep the explicit bracket escapes for older Chromium regex parsers.
  // eslint-disable-next-line no-useless-escape
  return source.replace(/\b([A-Za-z_]\w*)\[([^\[\]"\n]+)\]/g, (full, id: string, label: string) => {
    if (!/[():{}]/.test(label) || /[<>\\]/.test(label)) return full;
    return `${id}["${label}"]`;
  });
}

export async function validateMermaidSource(
  source: string,
  parse: (code: string) => Promise<unknown>,
): Promise<string> {
  const normalized = normalizeMermaidSource(source);
  try {
    await parse(normalized);
    return normalized;
  } catch (error) {
    const repaired = repairMermaidSource(normalized);
    if (repaired === normalized) throw error;
    await parse(repaired);
    return repaired;
  }
}
