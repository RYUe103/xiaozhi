import React from 'react';

type FilePreviewErrorBoundaryProps = {
  children: React.ReactNode;
  resetKey?: string;
};

type FilePreviewErrorBoundaryState = {
  error?: Error;
};

export default class FilePreviewErrorBoundary extends React.Component<
  FilePreviewErrorBoundaryProps,
  FilePreviewErrorBoundaryState
> {
  constructor(props: FilePreviewErrorBoundaryProps) {
    super(props);
    this.state = {};
  }

  static getDerivedStateFromError(error: Error): FilePreviewErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('File preview rendering error:', error, errorInfo);
  }

  componentDidUpdate(prevProps: FilePreviewErrorBoundaryProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: undefined });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-text-primary">
          <div className="font-medium">文件预览暂时无法展示</div>
          <div className="mt-1 text-text-secondary">可以刷新页面，或直接下载文件查看。</div>
        </div>
      );
    }

    return this.props.children;
  }
}
