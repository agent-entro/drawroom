/**
 * ErrorBoundary — catches render errors in child components and shows a
 * friendly fallback instead of a blank screen.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  /** Called with the error for logging / analytics */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary] Caught:', error, info);
    this.props.onError?.(error, info);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    if (this.props.fallback) return this.props.fallback;

    return (
      <div
        role="alert"
        className="flex flex-col items-center justify-center h-full min-h-[200px] gap-4 p-8 text-center"
      >
        <div className="text-4xl" aria-hidden="true">⚠️</div>
        <div>
          <p className="font-semibold text-gray-800 dark:text-gray-200">
            Something went wrong
          </p>
          {this.state.error && (
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 font-mono max-w-sm truncate">
              {this.state.error.message}
            </p>
          )}
        </div>
        <button
          onClick={this.handleReset}
          className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
        >
          Try again
        </button>
      </div>
    );
  }
}
