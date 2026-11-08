import { useEffect, useRef } from 'react';

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

  const res = await fetch(endpoint, {
    ...options,
    headers,
    credentials: 'include',
  });

  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : await res.text();

  if (!res.ok) {
    const errMsg =
      (data && typeof data === 'object' && (data.error || data.message)) ||
      `Request failed with status ${res.status}`;
    throw new ApiError(errMsg, res.status, data);
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
      es = new EventSource('/api/events/stream', { withCredentials: true });
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
