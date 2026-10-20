import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = {
  fallback: (error: unknown) => ReactNode;
  onError: (error: unknown, info: ErrorInfo) => void;
  children: ReactNode;
};

type State = { error: unknown; hasError: boolean };

export class RemoteErrorBoundary extends Component<Props, State> {
  state: State = { error: null, hasError: false };

  static getDerivedStateFromError(error: unknown): State {
    return { error, hasError: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    this.props.onError(error, info);
  }

  render() {
    return this.state.hasError ? this.props.fallback(this.state.error) : this.props.children;
  }
}
