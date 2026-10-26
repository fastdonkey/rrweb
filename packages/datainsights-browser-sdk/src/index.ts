import { createClient } from './runtime/client';

export type {
  DataInsightsClient,
  DataInsightsOptions,
  DebugInfo,
  DeliveryStateSnapshot,
  ConsentEvidence,
  RecordingContext,
  SDKErrorCode,
  SDKResult,
  StartContext,
  StopReason,
  Transport,
} from './public/types';

export const DataInsights = createClient();

export function createDataInsights(): typeof DataInsights {
  return DataInsights;
}
