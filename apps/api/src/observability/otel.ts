/**
 * S2.2 — OpenTelemetry initialization
 *
 * This module MUST be imported before any HTTP framework, DB driver, or
 * Redis client. The auto-instrumentation library hooks into Node's
 * require cache at SDK start time, so any module loaded earlier will
 * NOT be instrumented. server.ts therefore imports this file as its
 * very first import (before express, before knex, before ioredis).
 *
 * Behaviour:
 *
 *   - When OTEL_EXPORTER_OTLP_ENDPOINT is unset, the SDK is a no-op:
 *     no spans are created, no network traffic, ~0 overhead. This is
 *     the default in dev so the local loop is unchanged.
 *
 *   - When the env var is set (e.g. http://tempo:4318 in production),
 *     the SDK starts auto-instrumentation for HTTP, Express, ioredis,
 *     pg, and BullMQ. Spans are exported in OTLP/HTTP format to the
 *     configured collector.
 *
 *   - The service.name and service.version come from env vars too,
 *     so multiple deployments can be distinguished in the trace UI.
 *
 * Naming compliance:
 *   - Module exports camelCase
 *   - OTEL_* env var keys use uppercase + underscore (the OTel spec)
 *   - Span attribute keys use the OTel semantic conventions package
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import * as otelResources from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
// BUG-042 L5 absorption — canonical shutdown registry (static import
// per §9.6). Safe because gracefulShutdown only imports logger which
// in turn imports pino + @opentelemetry/api — no require-cycle.
import { registerShutdownHook } from '../shared/gracefulShutdown';

let sdk: NodeSDK | null = null;

/**
 * Initialise the OpenTelemetry SDK if configured. Called as a side
 * effect of importing this module — server.ts only needs to do
 * `import './observability/otel';` and the SDK will be running before
 * any instrumented library loads.
 */
function initOtel(): void {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    // Not configured — silent no-op so dev/test runs are unchanged.
    return;
  }

  const serviceName = process.env.OTEL_SERVICE_NAME ?? 'signacare-api';
  const serviceVersion = process.env.OTEL_SERVICE_VERSION ?? process.env.npm_package_version ?? '0.0.0';
  const env = process.env.NODE_ENV ?? 'development';

  // The trace exporter posts to <endpoint>/v1/traces by default.
  const traceExporter = new OTLPTraceExporter({
    url: endpoint.endsWith('/v1/traces') ? endpoint : `${endpoint.replace(/\/$/, '')}/v1/traces`,
  });

  const resourceAttributes = {
    [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
    [SemanticResourceAttributes.SERVICE_VERSION]: serviceVersion,
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: env,
  };

  const runtimeResource = (() => {
    const resourceFactory = otelResources as unknown as {
      resourceFromAttributes?: (attributes: Record<string, unknown>) => unknown;
      Resource?: new (attributes: Record<string, unknown>) => unknown;
    };

    if (typeof resourceFactory.resourceFromAttributes === 'function') {
      return resourceFactory.resourceFromAttributes(resourceAttributes);
    }

    if (typeof resourceFactory.Resource === 'function') {
      return new resourceFactory.Resource(resourceAttributes);
    }

    return undefined;
  })();

  type NodeSDKConfig = ConstructorParameters<typeof NodeSDK>[0];
  const sdkConfig: NodeSDKConfig = {
    traceExporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        // We do not instrument the filesystem — too noisy and not load-bearing
        '@opentelemetry/instrumentation-fs': { enabled: false },
        // DNS spans are also noise; the http instrumentation already covers
        // the bits we care about.
        '@opentelemetry/instrumentation-dns': { enabled: false },
      }),
    ],
  };

  if (runtimeResource) {
    sdkConfig.resource = runtimeResource as NonNullable<NodeSDKConfig>['resource'];
  }

  sdk = new NodeSDK(sdkConfig);

  try {
    sdk.start();
    // We deliberately do NOT use the application logger here — the
    // logger may not have been imported yet, and using it would defeat
    // the "imports first" rule.
    // eslint-disable-next-line no-console
    console.log(`[otel] tracing enabled, exporter=${endpoint}, service=${serviceName}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[otel] failed to start SDK:', err);
  }

  // BUG-042 L5 absorption — register into the canonical
  // graceful-shutdown registry instead of a parallel process.on SIGTERM
  // handler (which was a §9.6 `void shutdownOtel()` violation). Priority
  // 5 is LOWER than DB (20) / Redis (10) so OTEL spans outlive infra
  // teardown and the teardown itself is visible in the trace UI.
  // Only registers if the SDK actually initialised (otherwise there's
  // nothing to flush). Static import is safe because gracefulShutdown
  // only imports logger (which imports pino + @opentelemetry/api, not
  // this module — no require-cycle).
  if (sdk) {
    registerShutdownHook({
      name: 'otel-sdk',
      priority: 5,
      handler: shutdownOtel,
    });
  }
}

export async function shutdownOtel(): Promise<void> {
  if (!sdk) return;
  try {
    await sdk.shutdown();
    // eslint-disable-next-line no-console
    console.log('[otel] sdk shut down cleanly');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[otel] shutdown error:', err);
  }
}

initOtel();
