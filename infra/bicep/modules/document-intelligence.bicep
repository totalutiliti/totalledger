// ============================================================================
// Azure AI Document Intelligence (Form Recognizer)
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

var accountName = 'di-${projectName}-${environment}'
var skuName = environment == 'dev' ? 'F0' : 'S0'

// ── Resources ───────────────────────────────────────────────────────────────

resource documentIntelligence 'Microsoft.CognitiveServices/accounts@2024-04-01-preview' = {
  name: accountName
  location: location
  tags: tags
  kind: 'FormRecognizer'
  sku: {
    name: skuName
  }
  properties: {
    customSubDomainName: accountName
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      defaultAction: 'Allow'
    }
  }
}

// ── Outputs ─────────────────────────────────────────────────────────────────

output endpoint string = documentIntelligence.properties.endpoint

@secure()
output key string = documentIntelligence.listKeys().key1
