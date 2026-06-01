import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportError } from '../lib/errorTracker';

type Props = {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
  context?: string; // ej: "admin" o "candidato" — para logs
};

type State = {
  hasError: boolean;
  error: Error | null;
};

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.context ? `:${this.props.context}` : ''}]`, error, info);
    reportError(error, {
      route: typeof location !== 'undefined' ? location.hash : undefined,
      source: 'react_error_boundary',
      component_context: this.props.context,
      component_stack: info.componentStack ?? undefined,
    });
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset);
      }
      return <DefaultFallback error={this.state.error} reset={this.reset} />;
    }
    return this.props.children;
  }
}

function DefaultFallback({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="error-boundary">
      <div className="eb-card">
        <div className="eb-icon">⚠️</div>
        <h1>Algo se rompió</h1>
        <p className="eb-msg">
          Hubo un error en esta sección de la app. El resto sigue funcionando.
        </p>
        <details className="eb-details">
          <summary>Detalles técnicos</summary>
          <pre>{error.message}</pre>
          {error.stack && <pre className="eb-stack">{error.stack}</pre>}
        </details>
        <div className="eb-actions">
          <button className="btn-primary" onClick={reset}>
            Reintentar
          </button>
          <button className="cd-btn-ghost" onClick={() => window.location.hash = '#/'}>
            Volver al inicio
          </button>
        </div>
      </div>
    </div>
  );
}
