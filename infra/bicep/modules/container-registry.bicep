// ============================================================================
// Azure Container Registry
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

var acrName = replace('acr-${projectName}-${environment}', '-', '')
var skuName = environment == 'dev' ? 'Basic' : 'Standard'
var adminUserEnabled = environment == 'dev'

// ── Resources ───────────────────────────────────────────────────────────────

resource acr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: acrName
  location: location
  tags: tags
  sku: {
    name: skuName
  }
  properties: {
    adminUserEnabled: adminUserEnabled
    publicNetworkAccess: 'Enabled'
  }
}

// ── Outputs ─────────────────────────────────────────────────────────────────

output loginServer string = acr.properties.loginServer
output name string = acr.name
