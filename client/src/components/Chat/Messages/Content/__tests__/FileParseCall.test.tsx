import React from 'react';
import { render, screen } from '@testing-library/react';
import FileParseCall from '../FileParseCall';

describe('FileParseCall', () => {
  it('shows the running state while parsing', () => {
    render(<FileParseCall progress={0.1} status="parsing" />);

    expect(screen.getAllByText('正在解析文件').length).toBeGreaterThan(0);
  });

  it('keeps the completed state visible', () => {
    render(<FileParseCall progress={1} status="completed" />);

    expect(screen.getAllByText('文件解析完成').length).toBeGreaterThan(0);
  });

  it('shows a stable failed state', () => {
    render(<FileParseCall progress={1} status="failed" />);

    expect(screen.getAllByText('文件解析失败').length).toBeGreaterThan(0);
  });
});
