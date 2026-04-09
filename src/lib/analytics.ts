type AnalyticsProperties = Record<string, string | number | boolean | null>;

interface AnalyticsEvent {
  event: string;
  properties: AnalyticsProperties;
  timestamp: string;
}

const ANALYTICS_BUFFER_KEY = 'pentablocks-analytics-buffer-v1';
const ANALYTICS_BUFFER_LIMIT = 200;
const ANALYTICS_ENDPOINT = import.meta.env.VITE_ANALYTICS_ENDPOINT;
const ANALYTICS_DEBUG = import.meta.env.DEV || import.meta.env.VITE_ANALYTICS_DEBUG === 'true';

function readBufferedEvents(): AnalyticsEvent[] {
  try {
    const raw = localStorage.getItem(ANALYTICS_BUFFER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeBufferedEvents(events: AnalyticsEvent[]) {
  try {
    localStorage.setItem(ANALYTICS_BUFFER_KEY, JSON.stringify(events.slice(-ANALYTICS_BUFFER_LIMIT)));
  } catch {
    // Ignore storage write failures; analytics must never block gameplay.
  }
}

function bufferEvent(event: AnalyticsEvent) {
  const buffered = readBufferedEvents();
  buffered.push(event);
  writeBufferedEvents(buffered);
}

function sendToEndpoint(event: AnalyticsEvent) {
  if (!ANALYTICS_ENDPOINT) return;

  const payload = JSON.stringify(event);

  if (navigator.sendBeacon) {
    const blob = new Blob([payload], { type: 'application/json' });
    navigator.sendBeacon(ANALYTICS_ENDPOINT, blob);
    return;
  }

  void fetch(ANALYTICS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true,
  });
}

export function trackEvent(eventName: string, properties: AnalyticsProperties = {}) {
  const event: AnalyticsEvent = {
    event: eventName,
    properties,
    timestamp: new Date().toISOString(),
  };

  bufferEvent(event);
  sendToEndpoint(event);

  if (ANALYTICS_DEBUG) {
    // Helpful in development while wiring analytics.
    console.info('[analytics]', eventName, properties);
  }
}

