import { useEffect, useRef } from 'react';

const SESSION_STORAGE_KEY = 'brs_canteen_bearer_token';
let inMemoryToken: string | null = null;

export function getClientSessionToken(): string | null {
  if (inMemoryToken) return inMemoryToken;
  try {
    const saved = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (saved) {
      inMemoryToken = saved;
      return saved;
    }
  } catch {
    // sessionStorage unavailable in restricted contexts
  }
  return null;
}

export function setClientSessionToken(token: string | null): void {
  inMemoryToken = token;
  try {
    if (token) {
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, token);
    } else {
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export class ApiError extends Error {
  public status: number;
  public data: any;

  constructor(message: string, status: number, data?: any) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export async function apiFetch<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const bearer = getClientSessionToken();
  if (bearer && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${bearer}`);
  }

  let res: Response;
  try {
    res = await fetch(endpoint, {
      ...options,
      headers,
      credentials: 'include',
    });
  } catch {
    throw new ApiError(
      'Cannot reach the canteen server. Please check your internet connection and try again.',
      0
    );
  }

  const rawText = await res.text();
  let data: any = rawText;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json') || rawText.trim().startsWith('{')) {
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch {
      data = rawText;
    }
  }

  if (!res.ok) {
    const serverMessage =
      data && typeof data === 'object' ? (data.error || data.message) : null;
    // Never surface a bare status code to the user: explain gateway/network failures in plain language.
    const fallback =
      res.status === 502 || res.status === 503 || res.status === 504
        ? 'The canteen server is temporarily unreachable. Please try signing in again in a moment.'
        : res.status >= 500
        ? 'The canteen server hit an unexpected problem. Please try again.'
        : res.status === 404
        ? 'That service endpoint was not found on the server.'
        : `Request failed with status ${res.status}`;
    throw new ApiError(serverMessage || fallback, res.status, data);
  }

  return data as T;
}

export async function uploadFoodImage(file: File): Promise<{ imageUrl: string }> {
  const formData = new FormData();
  formData.append('image', file);
  return apiFetch<{ imageUrl: string }>('/api/menu/upload-image', {
    method: 'POST',
    body: formData,
  });
}

export function useRealtimeUpdates(onEvent: (eventType: string, data: any) => void, enabled = true) {
  const callbackRef = useRef(onEvent);
  callbackRef.current = onEvent;

  useEffect(() => {
    if (!enabled) return;

    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let switchedToPolling = false;

    const startServerlessPolling = (intervalMs = 12000) => {
      if (switchedToPolling) return;
      switchedToPolling = true;
      es?.close();
      es = null;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      pollTimer = setInterval(() => {
        if (typeof document === 'undefined' || document.visibilityState === 'visible') {
          callbackRef.current('order.updated', { source: 'poll' });
        }
      }, intervalMs);
    };

    const connect = () => {
      if (switchedToPolling) return;
      const bearer = getClientSessionToken();
      const streamUrl = bearer
        ? `/api/events/stream?token=${encodeURIComponent(bearer)}`
        : '/api/events/stream';
      es = new EventSource(streamUrl, { withCredentials: true });
      const eventTypes = [
        'order.created',
        'order.updated',
        'order.collected',
        'menu.updated',
        'payment.updated',
        'settings.updated',
      ];

      es.addEventListener('serverless_mode', (evt: MessageEvent) => {
        let interval = 12000;
        try {
          const parsed = JSON.parse(evt.data);
          if (parsed?.pollingIntervalMs) interval = Number(parsed.pollingIntervalMs);
        } catch {
          // use default interval
        }
        startServerlessPolling(interval);
      });

      for (const evtName of eventTypes) {
        es.addEventListener(evtName, (evt: MessageEvent) => {
          try {
            const parsed = JSON.parse(evt.data);
            callbackRef.current(evtName, parsed);
          } catch {
            callbackRef.current(evtName, {});
          }
        });
      }

      es.onerror = () => {
        if (switchedToPolling) return;
        es?.close();
        reconnectTimer = setTimeout(connect, 5000);
      };
    };

    connect();

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pollTimer) clearInterval(pollTimer);
      es?.close();
    };
  }, [enabled]);
}
