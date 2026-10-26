import { validateConfig } from './config/config';
import type {
  DataInsightsClient,
  DataInsightsOptions,
  SDKResult,
} from './public/types';

export type {
  DataInsightsClient,
  DataInsightsOptions,
  DeliveryStateSnapshot,
  SDKErrorCode,
  SDKResult,
  Transport,
} from './public/types';

let configuredOptions: Readonly<DataInsightsOptions> | undefined;

const dataInsightsFacade: DataInsightsClient = {
  init(options): SDKResult<DataInsightsClient> {
    const validation = validateConfig(options);
    if (!validation.ok) return validation;

    configuredOptions = validation.value;
    return { ok: true, value: dataInsightsFacade };
  },
};

export const DataInsights = Object.freeze(dataInsightsFacade);

export function createDataInsights(): typeof DataInsights {
  return DataInsights;
}

void configuredOptions;
