import { Component, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  fallback: (error: unknown, reset: () => void) => ReactNode;
  onError?: (error: unknown) => void;
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: unknown;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: unknown): void {
    this.props.onError?.(error);
  }

  private readonly reset = () => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    if (this.state.error !== null) return this.props.fallback(this.state.error, this.reset);
    return this.props.children;
  }
}
