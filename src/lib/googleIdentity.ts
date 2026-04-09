interface GoogleCredentialResponse {
  credential?: string;
}

interface GoogleIdentityApi {
  accounts: {
    id: {
      initialize: (options: {
        client_id: string;
        callback: (response: GoogleCredentialResponse) => void;
      }) => void;
      renderButton: (
        element: HTMLElement,
        options: {
          theme?: 'outline' | 'filled_black' | 'filled_blue';
          size?: 'small' | 'medium' | 'large';
          text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
          shape?: 'rectangular' | 'pill' | 'circle' | 'square';
          width?: number;
        },
      ) => void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentityApi;
  }
}

let scriptPromise: Promise<GoogleIdentityApi> | null = null;

export function loadGoogleIdentityScript() {
  if (window.google?.accounts?.id) {
    return Promise.resolve(window.google);
  }

  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<GoogleIdentityApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;

    script.onload = () => {
      if (window.google?.accounts?.id) resolve(window.google);
      else reject(new Error('google_identity_unavailable'));
    };
    script.onerror = () => reject(new Error('google_identity_load_failed'));

    document.head.appendChild(script);
  });

  return scriptPromise;
}

export async function mountGoogleLoginButton(
  host: HTMLElement,
  clientId: string,
  onCredential: (idToken: string) => void,
) {
  const google = await loadGoogleIdentityScript();
  host.innerHTML = '';
  google.accounts.id.initialize({
    client_id: clientId,
    callback: (response) => {
      const token = response?.credential;
      if (token) onCredential(token);
    },
  });
  google.accounts.id.renderButton(host, {
    theme: 'outline',
    size: 'large',
    shape: 'pill',
    text: 'continue_with',
    width: 260,
  });
}
