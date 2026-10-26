import type { DataInsightsOptions } from '../public/types';

const MANDATORY_BLOCK_SELECTORS = ['input[type="hidden"]', '[data-di-block]'];

function joinSelectors(
  mandatory: readonly string[],
  customerSelector?: string,
): string {
  return [...mandatory, ...(customerSelector ? [customerSelector] : [])].join(
    ', ',
  );
}

export function buildPrivacyPolicy(
  privacy: DataInsightsOptions['privacy'] = {},
) {
  return Object.freeze({
    blockClass: 'rr-sensitive',
    blockSelector: joinSelectors(
      MANDATORY_BLOCK_SELECTORS,
      privacy.blockSelector,
    ),
    maskTextSelector: privacy.maskTextSelector,
    ignoreSelector: privacy.ignoreSelector,
    maskAllInputs: false,
    maskInputOptions: Object.freeze({ password: true }),
  });
}
