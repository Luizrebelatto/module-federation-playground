import { Component, type ErrorInfo, type ReactNode } from 'react';
import { LogBox } from 'react-native';

type Props = {
  fallback: (error: unknown) => ReactNode;
  onError: (error: unknown, info: ErrorInfo) => void;
  children: ReactNode;
};

type State = { error: unknown; hasError: boolean };

export class RemoteErrorBoundary extends Component<Props, State> {
  state: State = { error: null, hasError: false };

  static getDerivedStateFromError(error: unknown): State {
    // Em dev, o RN abre o LogBox para todo erro capturado por boundary (onCaughtError).
    // Aqui o erro já vira fallback + telemetria, então silenciamos essa mensagem antes
    // do LogBox processá-la (ele filtra de forma assíncrona, depois do commit).
    if (__DEV__ && error instanceof Error && error.message) LogBox.ignoreLogs([error.message]);
    return { error, hasError: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    this.props.onError(error, info);
  }

  render() {
    return this.state.hasError ? this.props.fallback(this.state.error) : this.props.children;
  }
}
