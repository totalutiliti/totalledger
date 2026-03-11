// ============================================================================
// Azure Storage Account with Blob Containers
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

var storageAccountName = replace('st${projectName}${environment}', '-', '')
var skuName = environment == 'dev' ? 'Standard_LRS' : 'Standard_ZRS'

// ── Resources ───────────────────────────────────────────────────────────────

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: {
    name: skuName
  }
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storageAccount
  name: 'default'
}

resource cartoesPontoContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'cartoes-ponto'
  properties: {
    publicAccess: 'None'
  }
}

resource exportsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'exports'
  properties: {
    publicAccess: 'None'
  }
}

// ── Outputs ─────────────────────────────────────────────────────────────────

@secure()
output connectionString string = 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};AccountKey=${storageAccount.listKeys().keys[0].value};EndpointSuffix=core.windows.net'

output accountName string = storageAccount.name
