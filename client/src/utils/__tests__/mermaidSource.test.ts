import {
  normalizeMermaidSource,
  repairMermaidSource,
  validateMermaidSource,
} from '../mermaidSource';

describe('Mermaid source recovery', () => {
  it('extracts nested transport fences without changing topology', () => {
    expect(normalizeMermaidSource('```mermaid\n```mermaid\ngraph TD\nA-->B\n```\n```')).toBe(
      'graph TD\nA-->B',
    );
  });
  it('quotes punctuation in bare labels without changing edges', () => {
    expect(repairMermaidSource('flowchart TD\nA[读取(PDF)] --> B[完成]')).toBe(
      'flowchart TD\nA["读取(PDF)"] --> B[完成]',
    );
  });
  it('does not fabricate missing nodes or closing syntax', () => {
    expect(repairMermaidSource('graph TD\nA[读取 -->')).toBe('graph TD\nA[读取 -->');
  });
  it('validates a repaired candidate once', async () => {
    const parse = jest
      .fn()
      .mockRejectedValueOnce(new Error('bare label'))
      .mockResolvedValueOnce(true);
    await expect(validateMermaidSource('graph TD\nA[读取(PDF)] --> B', parse)).resolves.toBe(
      'graph TD\nA["读取(PDF)"] --> B',
    );
    expect(parse).toHaveBeenCalledTimes(2);
  });
  it('surfaces unrecoverable errors instead of retrying the same input', async () => {
    const parse = jest.fn().mockRejectedValue(new Error('invalid'));
    await expect(validateMermaidSource('graph TD\nA[', parse)).rejects.toThrow('invalid');
    expect(parse).toHaveBeenCalledTimes(1);
  });
  it('preserves quoted labels, style directives and sequence syntax', () => {
    const source = 'sequenceDiagram\nA->>B: Hello (world)';
    expect(repairMermaidSource(source)).toBe(source);
    expect(normalizeMermaidSource('graph TD\nA["a(b)"]\nstyle A fill:red')).toContain(
      'style A fill:red',
    );
  });
});
