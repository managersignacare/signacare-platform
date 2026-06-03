// deploy/azure/modules/monitoring.bicep
//
// Application Insights + Log Analytics workspace for the Signacare API
// and Web tiers. The API emits OpenTelemetry traces and Prometheus
// metrics; App Insights is configured to accept OTLP + the standard
// AI ingestion path, so we can use either depending on the next
// tooling decision.
//
// Retention is set to 90 days on the workspace — enough for incident
// forensics and short-term trend analysis. Long-term audit retention
// lives in the audit_log partitioned table in Postgres, not here.

targetScope = 'resourceGroup'

param namePrefix string
param environment string
param location string
param tags object

var workspaceName = '${namePrefix}-law-${environment}'
var appInsightsName = '${namePrefix}-ai-${environment}'

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: workspaceName
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 90
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  tags: tags
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: workspace.id
    IngestionMode: 'LogAnalytics'
    // Disable profile sending — PHI redaction is done at the SDK layer
    // (Sentry beforeSend + Pino pinoRedactConfig) and we rely on that,
    // not on App Insights-level scrubbing.
    DisableIpMasking: false
    DisableLocalAuth: false
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

output appInsightsName string = appInsights.name
output appInsightsInstrumentationKey string = appInsights.properties.InstrumentationKey
output appInsightsConnectionString string = appInsights.properties.ConnectionString
output workspaceId string = workspace.id
