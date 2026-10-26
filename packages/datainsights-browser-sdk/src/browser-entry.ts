import { DataInsights as defaultClient } from './index';
import type { DataInsightsClient, Transport } from './public/types';
import { UNCONFIGURED_TRANSPORT } from './transport/unconfigured';
import {
  setBootstrapConfigOrigin,
  setBootstrapWorkerUrl,
} from './runtime/bootstrap';

declare global {
  interface Window {
    DataInsights?: DataInsightsClient;
    DataInsightsTransport?: Transport;
  }
}

function isFacade(value: unknown): value is DataInsightsClient {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<DataInsightsClient>;
  return (
    typeof candidate.init === 'function' &&
    typeof candidate.bootstrap === 'function' &&
    typeof candidate.start === 'function' &&
    typeof candidate.stop === 'function' &&
    typeof candidate.getDebugInfo === 'function'
  );
}

function currentScriptAppKey(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const script = document.currentScript;
  if (!(script instanceof HTMLScriptElement)) return undefined;
  const appKey = script.dataset.appKey?.trim();
  return appKey || undefined;
}

function currentScriptWorkerUrl(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const script = document.currentScript;
  if (!(script instanceof HTMLScriptElement)) return undefined;
  const configured = script.dataset.workerUrl?.trim();
  if (configured) return configured;
  if (!script.src) return undefined;
  try {
    return new URL('serialization.worker.js', script.src).toString();
  } catch (_error) {
    return undefined;
  }
}

function currentScriptPrivateOrigin(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const script = document.currentScript;
  if (!(script instanceof HTMLScriptElement) || !script.src) return undefined;
  try {
    const url = new URL(script.src);
    return /(^|\.)datainsights\.io$/i.test(url.hostname)
      ? undefined
      : url.origin;
  } catch (_error) {
    return undefined;
  }
}

const existing =
  typeof window === 'undefined' ? undefined : window.DataInsights;
const facade = isFacade(existing) ? existing : defaultClient;
const appKey = currentScriptAppKey();
setBootstrapWorkerUrl(currentScriptWorkerUrl());
setBootstrapConfigOrigin(currentScriptPrivateOrigin());

if (appKey && facade.getDebugInfo().state === 'uninitialized') {
  facade.init({
    appKey,
    workerUrl: currentScriptWorkerUrl(),
    transport:
      typeof window === 'undefined'
        ? UNCONFIGURED_TRANSPORT
        : window.DataInsightsTransport ?? UNCONFIGURED_TRANSPORT,
  });
}
if (typeof window !== 'undefined' && !isFacade(window.DataInsights)) {
  window.DataInsights = facade;
}

export { facade as DataInsights };
export { createDataInsights } from './index';
export type * from './public/types';
