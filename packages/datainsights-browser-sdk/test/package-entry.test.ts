import { describe, expect, it, vi } from 'vitest';

describe('@datainsights/browser-sdk package entry', () => {
  it('is SSR-safe and exposes only the stable facade exports', async () => {
    const originalWindow = Object.getOwnPropertyDescriptor(
      globalThis,
      'window',
    );
    const originalDocument = Object.getOwnPropertyDescriptor(
      globalThis,
      'document',
    );
    const windowAccess = vi.fn(() => {
      throw new Error('window must not be accessed during module import');
    });
    const documentAccess = vi.fn(() => {
      throw new Error('document must not be accessed during module import');
    });

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      get: windowAccess,
    });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      get: documentAccess,
    });

    try {
      const sdk = await import('../src/index');

      expect(windowAccess).not.toHaveBeenCalled();
      expect(documentAccess).not.toHaveBeenCalled();
      expect(Object.keys(sdk).sort()).toEqual([
        'DataInsights',
        'createDataInsights',
      ]);
      expect(sdk.createDataInsights()).toBe(sdk.DataInsights);
    } finally {
      if (originalWindow) {
        Object.defineProperty(globalThis, 'window', originalWindow);
      } else {
        Reflect.deleteProperty(globalThis, 'window');
      }
      if (originalDocument) {
        Object.defineProperty(globalThis, 'document', originalDocument);
      } else {
        Reflect.deleteProperty(globalThis, 'document');
      }
      vi.resetModules();
    }
  });
});
