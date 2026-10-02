import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  /** Rendered instead of the children after a render error. */
  fallback: (error: Error, reset: () => void) => ReactNode;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Catches render errors so one broken page never blanks the whole app. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('Piano Steps: a page failed to render', error, info.componentStack);
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) return this.props.fallback(this.state.error, this.reset);
    return this.props.children;
  }
}
