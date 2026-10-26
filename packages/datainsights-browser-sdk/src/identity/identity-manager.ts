import type { SDKResult } from '../public/types';
import { generateUuid } from '../shared/uuid';

export interface ResolvedIdentity {
  type: 'host' | 'anonymous';
  id: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class IdentityManager {
  private readonly storageKey: string;
  private hostId: string | undefined;
  private anonymousId: string | undefined;

  constructor(
    appKey: string,
    private readonly getStorage: () => Pick<
      Storage,
      'getItem' | 'setItem' | 'removeItem'
    > = () => globalThis.localStorage,
  ) {
    this.storageKey = `di:v1:${appKey}:anonymous-id`;
  }

  identify(userId: string): SDKResult {
    const normalized = typeof userId === 'string' ? userId.trim() : '';
    if (
      normalized.length === 0 ||
      normalized.length > 256 ||
      /[\u0000-\u001f\u007f]/.test(normalized)
    ) {
      return {
        ok: false,
        error: {
          code: 'IDENTITY_INVALID',
          message: 'The host user identifier is invalid.',
        },
      };
    }
    this.hostId = normalized;
    return { ok: true, value: undefined };
  }

  resolve(preferredHostId?: string): SDKResult<ResolvedIdentity> {
    if (preferredHostId !== undefined) {
      const result = this.identify(preferredHostId);
      if (!result.ok) return result;
    }
    if (this.hostId) {
      return { ok: true, value: { type: 'host', id: this.hostId } };
    }
    if (!this.anonymousId) {
      try {
        const stored = this.getStorage().getItem(this.storageKey);
        if (stored && UUID_PATTERN.test(stored)) this.anonymousId = stored;
      } catch {
        // Storage is optional; retain a memory-only first-party identity.
      }
    }
    if (!this.anonymousId) {
      this.anonymousId = generateUuid();
      try {
        this.getStorage().setItem(this.storageKey, this.anonymousId);
      } catch {
        // Storage is optional; retain a memory-only first-party identity.
      }
    }
    return {
      ok: true,
      value: { type: 'anonymous', id: this.anonymousId },
    };
  }

  clear(): SDKResult {
    this.hostId = undefined;
    this.anonymousId = undefined;
    try {
      this.getStorage().removeItem(this.storageKey);
    } catch {
      // Clearing in-memory identity still succeeds when storage is unavailable.
    }
    return { ok: true, value: undefined };
  }
}
