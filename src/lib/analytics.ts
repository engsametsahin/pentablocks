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
const GA4_MEASUREMENT_ID = import.meta.env.VITE_GA4_MEASUREMENT_ID?.trim();
const GA4_SCRIPT_ID = 'pentablocks-ga4-script';

type GtagCommand = [command: string, ...args: unknown[]];

declare global {
  interface Window {
    dataLayer?: GtagCommand[];
    gtag?: (...args: unknown[]) => void;
  }
}

let gaInitialized = false;

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

function ensureGoogleAnalyticsInitialized() {
  if (!GA4_MEASUREMENT_ID || gaInitialized) return;

  window.dataLayer = window.dataLayer ?? [];
  if (!window.gtag) {
    window.gtag = (...args: unknown[]) => {
      window.dataLayer!.push(args as GtagCommand);
    };
  }

  window.gtag('js', new Date());
  window.gtag('config', GA4_MEASUREMENT_ID, {
    anonymize_ip: true,
    send_page_view: true,
  });

  if (!document.getElementById(GA4_SCRIPT_ID)) {
    const script = document.createElement('script');
    script.id = GA4_SCRIPT_ID;
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA4_MEASUREMENT_ID)}`;
    document.head.appendChild(script);
  }

  gaInitialized = true;
}

function sendToGoogleAnalytics(event: AnalyticsEvent) {
  if (!GA4_MEASUREMENT_ID) return;
  ensureGoogleAnalyticsInitialized();
  if (!window.gtag) return;

  const sanitizedEntries = Object.entries(event.properties).filter(([, value]) => value !== null);
  const properties = Object.fromEntries(sanitizedEntries);
  window.gtag('event', event.event, properties);
}

export function initializeAnalytics() {
  ensureGoogleAnalyticsInitialized();
}

export function trackEvent(eventName: string, properties: AnalyticsProperties = {}) {
  const event: AnalyticsEvent = {
    event: eventName,
    properties,
    timestamp: new Date().toISOString(),
  };

  bufferEvent(event);
  sendToEndpoint(event);
  sendToGoogleAnalytics(event);

  if (ANALYTICS_DEBUG) {
    // Helpful in development while wiring analytics.
    console.info('[analytics]', eventName, properties);
  }
}
