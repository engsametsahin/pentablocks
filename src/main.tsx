import React, { type ErrorInfo, type ReactNode } from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { setupGlobalErrorTracking } from './lib/errorTracking';
import { initializeAnalytics } from './lib/analytics';

setupGlobalErrorTracking();
initializeAnalytics();

const PRELOAD_RELOAD_GUARD_KEY = 'pb_preload_reload_once';

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  const hasReloaded = sessionStorage.getItem(PRELOAD_RELOAD_GUARD_KEY) === '1';
  if (hasReloaded) return;
  sessionStorage.setItem(PRELOAD_RELOAD_GUARD_KEY, '1');
  window.location.reload();
});

class AppErrorBoundary extends React.Component<{ children: ReactNode }, { error: Error | null; componentStack: string }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null, componentStack: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { error, componentStack: '' };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep this visible in production console so we can debug blank-screen reports quickly.
    console.error('fatal_react_render_error', error, info.componentStack);
    this.setState({ componentStack: info.componentStack || '' });
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div style={{
        minHeight: '100vh',
        background: '#0b0f17',
        color: '#e5e7eb',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
      >
        <div style={{
          maxWidth: '680px',
          width: '100%',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: '20px',
          padding: '20px',
        }}
        >
          <h1 style={{ margin: 0, marginBottom: 10, fontSize: 22, fontWeight: 800 }}>PentaBlocks hit an unexpected error</h1>
          <p style={{ margin: 0, marginBottom: 14, color: '#9ca3af' }}>
            The page crashed instead of showing a blank screen. Reload and try Arena again.
          </p>
          <pre style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            background: 'rgba(0,0,0,0.25)',
            borderRadius: '12px',
            padding: '12px',
            fontSize: '12px',
            margin: 0,
            marginBottom: '14px',
          }}
          >
            {this.state.error.message}
          </pre>
          {(this.state.error.stack || this.state.componentStack) && (
            <details style={{ marginBottom: '14px' }}>
              <summary style={{ cursor: 'pointer', color: '#9ca3af', marginBottom: '8px' }}>Technical details</summary>
              <pre style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                background: 'rgba(0,0,0,0.25)',
                borderRadius: '12px',
                padding: '12px',
                fontSize: '11px',
                margin: 0,
                color: '#cbd5e1',
              }}
              >
                {[this.state.error.stack, this.state.componentStack].filter(Boolean).join('\n\n')}
              </pre>
            </details>
          )}
          <button
            onClick={() => window.location.reload()}
            style={{
              border: 0,
              borderRadius: 12,
              background: '#10b981',
              color: '#06251a',
              fontWeight: 800,
              padding: '10px 14px',
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);
