// ============================================================================
// Azure OpenAI Service
// ============================================================================

@description('Azure region')
param location string

@description('Project name')
param projectName string

@allowed(['dev', 'prod'])
@description('Deployment environment')
param environment string

@description('Resource tags')
param tags object

// ── Variables ───────────────────────────────────────────────────────────────

var accountName = 'oai-${projectName}-${environment}'

// ── Resources ───────────────────────────────────────────────────────────────

resource openai 'Microsoft.CognitiveServices/accounts@2024-04-01-preview' = {
  name: accountName
  location: location
  tags: tags
  kind: 'OpenAI'
  sku: {
    name: 'S0'
  }
  properties: {
    customSubDomainName: accountName
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      defaultAction: 'Allow'
    }
  }
}

resource gpt4oMiniDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-04-01-preview' = {
  parent: openai
  name: 'gpt-4o-mini'
  sku: {
    name: 'Standard'
    capacity: environment == 'dev' ? 10 : 30
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'gpt-4o-mini'
      version: '2024-07-18'
    }
  }
}

// ── Outputs ─────────────────────────────────────────────────────────────────

output endpoint string = openai.properties.endpoint

@secure()
output key string = openai.listKeys().key1
