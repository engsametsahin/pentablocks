import { trackEvent } from './analytics';

const ERROR_ENDPOINT = import.meta.env.VITE_ERROR_REPORT_ENDPOINT;
const FATAL_OVERLAY_ID = 'pb-fatal-overlay';

function renderFatalOverlay(message: string) {
  if (typeof document === 'undefined') return;
  if (document.getElementById(FATAL_OVERLAY_ID)) return;

  const root = document.createElement('div');
  root.id = FATAL_OVERLAY_ID;
  root.style.position = 'fixed';
  root.style.inset = '0';
  root.style.zIndex = '99999';
  root.style.background = '#0b0f17';
  root.style.color = '#e5e7eb';
  root.style.display = 'flex';
  root.style.alignItems = 'center';
  root.style.justifyContent = 'center';
  root.style.padding = '24px';
  root.innerHTML = `
    <div style="max-width:680px;width:100%;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.12);border-radius:20px;padding:20px;font-family:Inter,system-ui,sans-serif;">
      <h1 style="margin:0 0 10px 0;font-size:22px;font-weight:800;">PentaBlocks runtime error</h1>
      <p style="margin:0 0 12px 0;color:#9ca3af;">A client-side error occurred. Reload and try again.</p>
      <pre style="white-space:pre-wrap;word-break:break-word;background:rgba(0,0,0,0.25);border-radius:12px;padding:12px;font-size:12px;margin:0 0 14px 0;">${message.replace(/</g, '&lt;')}</pre>
      <button id="pb-fatal-reload-btn" style="border:0;border-radius:12px;background:#10b981;color:#06251a;font-weight:800;padding:10px 14px;cursor:pointer;">Reload</button>
    </div>
  `;
  document.body.appendChild(root);
  const btn = document.getElementById('pb-fatal-reload-btn');
  if (btn) btn.addEventListener('click', () => window.location.reload());
}

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
    renderFatalOverlay(event.message || 'Unknown runtime error');
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
    renderFatalOverlay(safeErrorMessage(event.reason));
    postError(payload);
  });
}
