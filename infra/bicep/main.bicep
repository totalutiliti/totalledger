// ============================================================================
// SercofiRH — Main Bicep Orchestrator
// Deploys all Azure resources for the SercofiRH SaaS platform
// ============================================================================

targetScope = 'subscription'

// ── Parameters ──────────────────────────────────────────────────────────────

@allowed(['dev', 'prod'])
@description('Deployment environment')
param environment string

@description('Azure region for all resources')
param location string = 'brazilsouth'

@description('Project name used for resource naming')
param projectName string = 'sercofi'

@secure()
@description('PostgreSQL administrator password')
param postgresAdminPassword string

// ── Variables ───────────────────────────────────────────────────────────────

var resourceGroupName = 'rg-${projectName}-${environment}'
var tags = {
  project: projectName
  environment: environment
}

// ── Resource Group ──────────────────────────────────────────────────────────

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
  tags: tags
}

// ── Modules ─────────────────────────────────────────────────────────────────

module containerRegistry 'modules/container-registry.bicep' = {
  name: 'deploy-container-registry'
  scope: rg
  params: {
    location: location
    projectName: projectName
    environment: environment
    tags: tags
  }
}

module postgresql 'modules/postgresql.bicep' = {
  name: 'deploy-postgresql'
  scope: rg
  params: {
    location: location
    projectName: projectName
    environment: environment
    tags: tags
    administratorPassword: postgresAdminPassword
  }
}

module redis 'modules/redis.bicep' = {
  name: 'deploy-redis'
  scope: rg
  params: {
    location: location
    projectName: projectName
    environment: environment
    tags: tags
  }
}

module blobStorage 'modules/blob-storage.bicep' = {
  name: 'deploy-blob-storage'
  scope: rg
  params: {
    location: location
    projectName: projectName
    environment: environment
    tags: tags
  }
}

module documentIntelligence 'modules/document-intelligence.bicep' = {
  name: 'deploy-document-intelligence'
  scope: rg
  params: {
    location: location
    projectName: projectName
    environment: environment
    tags: tags
  }
}

module openai 'modules/openai.bicep' = {
  name: 'deploy-openai'
  scope: rg
  params: {
    location: location
    projectName: projectName
    environment: environment
    tags: tags
  }
}

module appInsights 'modules/app-insights.bicep' = {
  name: 'deploy-app-insights'
  scope: rg
  params: {
    location: location
    projectName: projectName
    environment: environment
    tags: tags
  }
}

module keyVault 'modules/key-vault.bicep' = {
  name: 'deploy-key-vault'
  scope: rg
  params: {
    location: location
    projectName: projectName
    environment: environment
    tags: tags
  }
}

module containerApp 'modules/container-app.bicep' = {
  name: 'deploy-container-apps'
  scope: rg
  params: {
    location: location
    projectName: projectName
    environment: environment
    tags: tags
    containerRegistryLoginServer: containerRegistry.outputs.loginServer
    containerRegistryName: containerRegistry.outputs.name
    logAnalyticsWorkspaceId: appInsights.outputs.logAnalyticsWorkspaceId
    appInsightsConnectionString: appInsights.outputs.connectionString
    keyVaultName: keyVault.outputs.name
  }
}

// ── Outputs ─────────────────────────────────────────────────────────────────

output resourceGroupName string = rg.name
output containerRegistryLoginServer string = containerRegistry.outputs.loginServer
output postgresqlFqdn string = postgresql.outputs.fqdn
output redisHostName string = redis.outputs.hostName
output storageAccountName string = blobStorage.outputs.accountName
output documentIntelligenceEndpoint string = documentIntelligence.outputs.endpoint
output openaiEndpoint string = openai.outputs.endpoint
output keyVaultUri string = keyVault.outputs.vaultUri
output appInsightsConnectionString string = appInsights.outputs.connectionString
