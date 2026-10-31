import { Tools } from 'librechat-data-provider';
import {
  canPreviewWorkspaceSource,
  getWorkspaceFileKind,
  getWorkspaceOutputs,
  normalizeSanSuoFileSources,
} from '../fileWorkspace';

describe('fileWorkspace', () => {
  it('normalizes and deduplicates only safe persisted source fields', () => {
    expect(
      normalizeSanSuoFileSources([
        {
          file_id: 'file-1',
          filename: '规范.pdf',
          type: 'application/pdf',
          filepath: '/internal/path',
          metadata: { secret: true },
        },
        { file_id: 'file-1', filename: '重复.pdf' },
        { filename: 'missing-id.pdf' },
      ]),
    ).toEqual([
      {
        file_id: 'file-1',
        filename: '规范.pdf',
        type: 'application/pdf',
        source: undefined,
        bytes: undefined,
        status: 'ready',
        kind: 'file',
      },
    ]);
  });

  it('keeps real outputs and hides search, memory, and internal artifacts', () => {
    const outputs = getWorkspaceOutputs([
      { file_id: 'out-1', filename: '结果.xlsx', filepath: '/download/1' } as never,
      { type: Tools.web_search, filename: 'search' } as never,
      { type: Tools.memory, filename: 'memory' } as never,
      { file_id: 'internal', filename: 'chunks.jsonl', metadata: { visibility: 'tool' } } as never,
      { file_id: 'out-1', filename: '结果.xlsx' } as never,
    ]);
    expect(outputs).toHaveLength(1);
    expect(outputs[0].filename).toBe('结果.xlsx');
  });

  it('maps office, image, and text file kinds without emoji fallbacks', () => {
    expect(getWorkspaceFileKind('报告.docx')).toBe('word');
    expect(getWorkspaceFileKind('数据.xlsx')).toBe('excel');
    expect(getWorkspaceFileKind('说明', 'application/pdf')).toBe('pdf');
    expect(getWorkspaceFileKind('截图.png')).toBe('image');
    expect(canPreviewWorkspaceSource('依据.md')).toBe(true);
    expect(canPreviewWorkspaceSource('方案.pptx')).toBe(false);
  });

  it('recognizes audio, video and code while preserving text source preview behavior', () => {
    expect(getWorkspaceFileKind('recording.mp3')).toBe('audio');
    expect(getWorkspaceFileKind('clip.webm')).toBe('video');
    expect(getWorkspaceFileKind('script.py', 'text/plain')).toBe('code');
    expect(canPreviewWorkspaceSource('script.py', 'text/plain')).toBe(true);
    expect(canPreviewWorkspaceSource('script.py')).toBe(false);
    expect(getWorkspaceFileKind('unknown.bin')).toBe('file');
  });
});
