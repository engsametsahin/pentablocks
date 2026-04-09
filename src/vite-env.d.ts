/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SITE_URL?: string;
  readonly VITE_ANALYTICS_ENDPOINT?: string;
  readonly VITE_ERROR_REPORT_ENDPOINT?: string;
  readonly VITE_ANALYTICS_DEBUG?: string;
  readonly VITE_GA4_MEASUREMENT_ID?: string;
  readonly VITE_ADSENSE_CLIENT_ID?: string;
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
