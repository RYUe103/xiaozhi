import React from 'react';

export const Streamdown = jest.fn(
  ({ children, mode }: { children: React.ReactNode; mode: string }) => (
    <div data-mode={mode} data-testid="streamdown">
      {children}
    </div>
  ),
);
