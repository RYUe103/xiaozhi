import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import MessageProcessGroup from '../MessageProcessGroup';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string | number, string>) => {
    if (key === 'com_ui_process_complete') {
      return `已处理，耗时 ${values?.[0]}`;
    }
    if (key === 'com_ui_process_complete_no_time') {
      return '已处理';
    }
    if (key === 'com_ui_process_running') {
      return `正在处理 ${values?.[0]}`;
    }
    if (key === 'com_ui_process_failed') {
      return `处理未完成，耗时 ${values?.[0]}`;
    }
    if (key === 'com_ui_process_failed_no_time') {
      return '处理未完成';
    }
    if (key === 'com_ui_duration_seconds') {
      return `${values?.[0]}秒`;
    }
    if (key === 'com_ui_duration_minutes') {
      return `${values?.[0]}分`;
    }
    if (key === 'com_ui_duration_minutes_seconds') {
      return `${values?.[0]}分${values?.[1]}秒`;
    }
    if (key === 'com_ui_duration_hours') {
      return `${values?.[0]}小时`;
    }
    if (key === 'com_ui_duration_hours_minutes') {
      return `${values?.[0]}小时${values?.[1]}分`;
    }
    return key;
  },
}));

jest.mock('lucide-react', () => ({
  ChevronDown: () => <span aria-hidden="true">{'chevron'}</span>,
  Check: () => <span aria-hidden="true">{'check'}</span>,
  CircleStop: () => <span aria-hidden="true">{'stopped'}</span>,
  LoaderCircle: () => <span aria-hidden="true">{'loading'}</span>,
  TriangleAlert: () => <span aria-hidden="true">{'failed'}</span>,
}));

jest.mock('~/utils', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' '),
}));

describe('MessageProcessGroup', () => {
  it('restores elapsed time from the request start after remounting', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-29T00:00:12Z'));
    const first = render(
      <MessageProcessGroup isActive isComplete={false} startedAt="2026-10-29T00:00:00Z">
        <div>{'process detail'}</div>
      </MessageProcessGroup>,
    );
    first.unmount();
    jest.setSystemTime(new Date('2026-10-29T00:00:35Z'));
    render(
      <MessageProcessGroup isActive isComplete={false} startedAt="2026-10-29T00:00:00Z">
        <div>{'process detail'}</div>
      </MessageProcessGroup>,
    );
    expect(screen.getByRole('button', { name: /正在处理 35秒/ })).toBeInTheDocument();
    jest.useRealTimers();
  });

  it('does not invent a completed duration from an old start without an end', () => {
    render(
      <MessageProcessGroup isActive={false} isComplete startedAt="2020-01-01T00:00:00Z">
        <div>{'process detail'}</div>
      </MessageProcessGroup>,
    );
    expect(screen.getByRole('button', { name: /^已处理/ })).not.toHaveTextContent('耗时');
  });
  it('keeps running details collapsed until the user opens them', () => {
    render(
      <MessageProcessGroup isActive isComplete={false} elapsedMs={12000}>
        <div>{'process detail'}</div>
      </MessageProcessGroup>,
    );

    expect(screen.getByRole('button', { name: /正在处理 12秒/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('updates the running duration once per second', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-29T00:00:12.000Z'));
    render(
      <MessageProcessGroup isActive isComplete={false} startedAt="2026-10-29T00:00:00.000Z">
        <div>{'process detail'}</div>
      </MessageProcessGroup>,
    );
    expect(screen.getByRole('button', { name: /正在处理 12秒/ })).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(screen.getByRole('button', { name: /正在处理 13秒/ })).toBeInTheDocument();
    jest.useRealTimers();
  });

  it('collapses automatically when answer text starts', () => {
    const { rerender } = render(
      <MessageProcessGroup isActive isComplete={false} elapsedMs={12000}>
        <div>{'process detail'}</div>
      </MessageProcessGroup>,
    );

    rerender(
      <MessageProcessGroup isActive={false} isComplete elapsedMs={35000}>
        <div>{'process detail'}</div>
      </MessageProcessGroup>,
    );

    expect(screen.getByRole('button', { name: /已处理，耗时 35秒/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('keeps a manual expansion during later streaming updates', () => {
    const { rerender } = render(
      <MessageProcessGroup isActive={false} isComplete elapsedMs={35000}>
        <div>{'process detail'}</div>
      </MessageProcessGroup>,
    );
    const toggle = screen.getByRole('button', { name: /已处理，耗时 35秒/ });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    rerender(
      <MessageProcessGroup isActive={false} isComplete elapsedMs={36000}>
        <div>{'updated process detail'}</div>
      </MessageProcessGroup>,
    );

    expect(screen.getByRole('button', { name: /已处理，耗时 36秒/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('expands failed processing by default', () => {
    render(
      <MessageProcessGroup isActive={false} isComplete hasFailure elapsedMs={35000}>
        <div>{'failure detail'}</div>
      </MessageProcessGroup>,
    );

    expect(screen.getByRole('button', { name: /处理未完成，耗时 35秒/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('shows the real failure summary when one is available', () => {
    render(
      <MessageProcessGroup
        isActive={false}
        isComplete
        hasFailure
        failureReason="timeout"
        elapsedMs={35000}
      >
        <div>{'failure detail'}</div>
      </MessageProcessGroup>,
    );

    expect(screen.getByRole('button', { name: '执行失败 · timeout' })).toBeInTheDocument();
  });

  it('shows an interrupted terminal state instead of leaving the activity running', () => {
    render(
      <MessageProcessGroup isActive={false} isComplete={false} hasInterruption elapsedMs={18000}>
        <div>{'interrupted detail'}</div>
      </MessageProcessGroup>,
    );

    expect(screen.getByRole('button', { name: /处理已中断，耗时 18秒/ })).toBeInTheDocument();
    expect(screen.getByText('stopped')).toBeInTheDocument();
  });

  it('formats durations longer than one minute', () => {
    render(
      <MessageProcessGroup isActive={false} isComplete elapsedMs={72000}>
        <div>{'process detail'}</div>
      </MessageProcessGroup>,
    );
    expect(screen.getByRole('button', { name: /已处理，耗时 1分12秒/ })).toBeInTheDocument();
  });

  it('keeps historical messages without timing metadata compatible', () => {
    render(
      <MessageProcessGroup isActive={false} isComplete>
        <div>{'process detail'}</div>
      </MessageProcessGroup>,
    );
    expect(screen.getByRole('button', { name: /^已处理/ })).toBeInTheDocument();
  });
});
