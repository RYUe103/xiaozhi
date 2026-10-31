import React from 'react';

type MessageErrorBoundaryProps = {
  children: React.ReactNode;
  resetKey?: string | null;
};

type MessageErrorBoundaryState = {
  error?: Error;
};

export default class MessageErrorBoundary extends React.Component<
  MessageErrorBoundaryProps,
  MessageErrorBoundaryState
> {
  constructor(props: MessageErrorBoundaryProps) {
    super(props);
    this.state = {};
  }

  static getDerivedStateFromError(error: Error): MessageErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Message rendering error:', error, errorInfo);
  }

  componentDidUpdate(prevProps: MessageErrorBoundaryProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: undefined });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="m-auto justify-center p-4 py-2 md:gap-6">
          <div className="mx-auto flex max-w-[55rem] gap-3">
            <div className="w-11/12 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-text-primary">
              <div className="font-medium">这条消息渲染失败</div>
              <div className="mt-1 text-text-secondary">
                已保护聊天页面不被整页中断。请重新生成该回复，或让模型不要输出复杂
                HTML、图表或预览内容。
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
