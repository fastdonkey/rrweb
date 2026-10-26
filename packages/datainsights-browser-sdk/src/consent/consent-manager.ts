import type { ConsentEvidence, SDKResult } from '../public/types';

export class ConsentManager {
  private evidence: Readonly<ConsentEvidence> | undefined;

  get granted(): boolean {
    return this.evidence !== undefined;
  }

  grant(evidence: ConsentEvidence): SDKResult {
    if (
      !evidence ||
      evidence.action !== 'start-insurance' ||
      typeof evidence.noticeVersion !== 'string' ||
      evidence.noticeVersion.trim().length === 0 ||
      (evidence.grantedAt !== undefined &&
        Number.isNaN(Date.parse(evidence.grantedAt)))
    ) {
      return {
        ok: false,
        error: {
          code: 'INVALID_STATE',
          message: 'Valid consent evidence is required.',
        },
      };
    }

    this.evidence = Object.freeze({ ...evidence });
    return { ok: true, value: undefined };
  }

  revoke(): void {
    this.evidence = undefined;
  }
}
