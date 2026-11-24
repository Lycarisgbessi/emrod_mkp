import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches unexpected render errors so a single broken page never blanks the whole SPA.
 * Key it by route path to reset the boundary on navigation.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  override render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div className="max-w-xl mx-auto px-4 py-20 text-center space-y-5">
          <AlertTriangle className="w-10 h-10 mx-auto text-[var(--color-gold-deep)]" strokeWidth={1.5} />
          <h1 className="font-display text-2xl text-[var(--color-ink)]">
            Une erreur inattendue est survenue
          </h1>
          <p className="text-sm text-[var(--color-wood)]">
            {this.state.error.message || 'Veuillez réessayer dans un instant.'}
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="px-5 py-2.5 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm font-semibold text-[var(--color-ink)] hover:bg-[var(--color-cream)] transition-colors"
            >
              Réessayer
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white text-sm font-semibold hover:bg-[var(--color-wood)] transition-colors"
            >
              Recharger la page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
