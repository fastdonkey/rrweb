import { createClient } from './runtime/client';

export type {
  DataInsightsClient,
  DataInsightsBootstrapOptions,
  DataInsightsOptions,
  DebugInfo,
  DeliveryStateSnapshot,
  PersistenceCapabilitySnapshot,
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

export { parseAppKeyRoute, resolveConfigOrigin } from './config/app-key';
export { resolveRemoteConfig } from './config/remote-config';
export { createHttpTransport } from './transport/http';

export const DataInsights = createClient();

export function createDataInsights(): typeof DataInsights {
  return DataInsights;
}
