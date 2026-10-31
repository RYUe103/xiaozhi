import React from 'react';
import { render, screen } from '@testing-library/react';
import Reasoning from '../Reasoning';

let mockIsSubmitting = false;

jest.mock('jotai', () => ({
  useAtomValue: (atom: string) => (atom === 'show-thinking' ? false : 'text-base'),
}));

jest.mock('~/store/showThinking', () => ({
  showThinkingAtom: 'show-thinking',
}));

jest.mock('~/store/fontSize', () => ({
  fontSizeAtom: 'font-size',
}));

jest.mock('~/Providers', () => ({
  useMessageContext: () => ({
    isSubmitting: mockIsSubmitting,
    isLatestMessage: true,
    nextType: undefined,
  }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => {
    const labels: Record<string, string> = {
      com_ui_thinking: '思考中...',
      com_ui_thinking_finished: '已思考',
      com_ui_copied_to_clipboard: '已复制',
      com_ui_copy_thoughts_to_clipboard: '复制思考内容',
      com_ui_collapse_thoughts: '收起思考内容',
      com_ui_expand_thoughts: '展开思考内容',
    };
    return labels[key] ?? key;
  },
  useExpandCollapse: () => ({
    style: {},
    ref: { current: null },
  }),
}));

jest.mock('@librechat/client', () => ({
  Clipboard: () => <span data-testid="clipboard" />,
  CheckMark: () => <span data-testid="check-mark" />,
  TooltipAnchor: ({ render }: { render: React.ReactNode }) => <>{render}</>,
}));

describe('Reasoning native status row', () => {
  beforeEach(() => {
    mockIsSubmitting = false;
  });

  it('uses the shared process-step typography and lightbulb', () => {
    const { container } = render(<Reasoning reasoning="分析附件内容" isLast />);

    const button = screen.getByRole('button', { name: '已思考' });
    expect(button).not.toHaveClass('text-base');
    expect(button).toHaveClass('process-step-toggle');
    expect(container.querySelector('.lucide-lightbulb')).not.toBeNull();
    expect(screen.queryByText('完成分析')).not.toBeInTheDocument();
  });

  it('shows the native active label while the latest reasoning part is streaming', () => {
    mockIsSubmitting = true;
    render(<Reasoning reasoning="正在读取附件" isLast />);

    expect(screen.getByRole('button', { name: '思考中...' })).toBeInTheDocument();
  });
});
