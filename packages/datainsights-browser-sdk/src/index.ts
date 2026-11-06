import { createClient } from './runtime/client';

export type {
  DataInsightsClient,
  DataInsightsBootstrapOptions,
  DataInsightsOptions,
  DebugInfo,
  DeliveryStateSnapshot,
  PersistenceCapabilitySnapshot,
  EncodedRecordingBatch,
  RecordingPayloadCodec,
  RemoteConfigResolverOptions,
  ResolvedApplicationConfig,
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
