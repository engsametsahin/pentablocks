import { trackEvent } from './analytics';

const ERROR_ENDPOINT = import.meta.env.VITE_ERROR_REPORT_ENDPOINT;

function postError(payload: Record<string, unknown>) {
  if (!ERROR_ENDPOINT) return;

  const body = JSON.stringify(payload);

  if (navigator.sendBeacon) {
    const blob = new Blob([body], { type: 'application/json' });
    navigator.sendBeacon(ERROR_ENDPOINT, blob);
    return;
  }

  void fetch(ERROR_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  });
}

function safeErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}

function safeErrorStack(error: unknown) {
  if (error instanceof Error && error.stack) return error.stack;
  return null;
}

export function setupGlobalErrorTracking() {
  window.addEventListener('error', (event) => {
    const payload = {
      type: 'window.error',
      message: event.message,
      source: event.filename,
      line: event.lineno,
      column: event.colno,
      stack: safeErrorStack(event.error),
      userAgent: navigator.userAgent,
      href: window.location.href,
      timestamp: new Date().toISOString(),
    };

    trackEvent('client_error', {
      type: 'window.error',
      message: event.message || 'Unknown runtime error',
    });
    postError(payload);
  });

  window.addEventListener('unhandledrejection', (event) => {
    const payload = {
      type: 'unhandledrejection',
      message: safeErrorMessage(event.reason),
      stack: safeErrorStack(event.reason),
      userAgent: navigator.userAgent,
      href: window.location.href,
      timestamp: new Date().toISOString(),
    };

    trackEvent('client_error', {
      type: 'unhandledrejection',
      message: safeErrorMessage(event.reason),
    });
    postError(payload);
  });
}

