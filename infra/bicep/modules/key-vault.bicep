// ============================================================================
// Azure Key Vault
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

var vaultName = 'kv-${projectName}-${environment}'

// ── Resources ───────────────────────────────────────────────────────────────

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: vaultName
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enabledForDeployment: true
    enabledForTemplateDeployment: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: environment == 'prod' ? true : null
    enableRbacAuthorization: true
    publicNetworkAccess: 'Enabled'
  }
}

// ── Outputs ─────────────────────────────────────────────────────────────────

output vaultUri string = keyVault.properties.vaultUri
output name string = keyVault.name
output resourceId string = keyVault.id
