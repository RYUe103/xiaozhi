import { RecoilRoot } from 'recoil';
import { Tools } from 'librechat-data-provider';
import { render } from '@testing-library/react';
import type {
  TFile,
  TAttachment,
  TFilePreview,
  TAttachmentMetadata,
} from 'librechat-data-provider';

const mockUseFilePreview = jest.fn();
jest.mock('~/data-provider', () => ({
  useFilePreview: (...args: unknown[]) => mockUseFilePreview(...args),
}));
jest.mock('~/hooks/useLocalize', () => () => (key: string) => key);

import useAttachments from '~/hooks/Messages/useAttachments';
import useAttachmentPreviewSync from '../useAttachmentPreviewSync';

const messageId = 'msg-1';
const fileId = 'fid-1';
const dbAttachment = {
  user: 'user-1',
  object: 'file',
  bytes: 1256732,
  embedded: false,
  usage: 0,
  file_id: fileId,
  filename: 'react-185-regression.docx',
  filepath: '/uploads/react-185-regression.docx',
  type: Tools.execute_code,
  messageId,
  toolCallId: 'tc-1',
  text: undefined,
  textFormat: undefined,
  status: 'pending',
} as TFile & TAttachmentMetadata as TAttachment;
const dbAttachments: TAttachment[] = [dbAttachment];

let renderCount = 0;

function PreviewBridge({ attachment }: { attachment: TAttachment }) {
  renderCount += 1;
  useAttachmentPreviewSync(attachment);
  return null;
}

function Consumer() {
  const { attachments } = useAttachments({ messageId, attachments: dbAttachments });
  const attachment = attachments[0];
  return attachment ? <PreviewBridge attachment={attachment} /> : null;
}

describe('useAttachmentPreviewSync React #185 regression', () => {
  beforeEach(() => {
    renderCount = 0;
    mockUseFilePreview.mockReset();
  });

  it.each([
    {
      status: 'ready' as const,
      text: '<p>resolved</p>',
      textFormat: 'html' as const,
    },
    {
      status: 'failed' as const,
      previewError: 'render-timeout',
    },
  ])('settles after a pending preview becomes $status', (preview) => {
    mockUseFilePreview.mockReturnValue({
      data: { file_id: fileId, ...preview } as TFilePreview,
      isFetching: false,
    });

    expect(() =>
      render(
        <RecoilRoot>
          <Consumer />
        </RecoilRoot>,
      ),
    ).not.toThrow();
    expect(renderCount).toBeLessThan(10);
  });
});
