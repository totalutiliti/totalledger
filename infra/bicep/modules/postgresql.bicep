// ============================================================================
// Azure Database for PostgreSQL Flexible Server
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

@secure()
@description('Administrator login password')
param administratorPassword string

// ── Variables ───────────────────────────────────────────────────────────────

var serverName = 'psql-${projectName}-${environment}'
var skuName = environment == 'dev' ? 'Standard_B1ms' : 'Standard_D2s_v3'
var skuTier = environment == 'dev' ? 'Burstable' : 'GeneralPurpose'
var storageSizeGB = environment == 'dev' ? 32 : 128
var administratorLogin = '${projectName}admin'
var databaseName = 'sercofi_rh'

// ── Resources ───────────────────────────────────────────────────────────────

resource postgresServer 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: serverName
  location: location
  tags: tags
  sku: {
    name: skuName
    tier: skuTier
  }
  properties: {
    version: '16'
    administratorLogin: administratorLogin
    administratorLoginPassword: administratorPassword
    storage: {
      storageSizeGB: storageSizeGB
    }
    backup: {
      backupRetentionDays: environment == 'dev' ? 7 : 35
      geoRedundantBackup: environment == 'dev' ? 'Disabled' : 'Enabled'
    }
    highAvailability: {
      mode: environment == 'dev' ? 'Disabled' : 'ZoneRedundant'
    }
  }
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: postgresServer
  name: databaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

resource firewallAllowAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: postgresServer
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

// ── Outputs ─────────────────────────────────────────────────────────────────

output fqdn string = postgresServer.properties.fullyQualifiedDomainName

@secure()
output connectionString string = 'postgresql://${administratorLogin}:${administratorPassword}@${postgresServer.properties.fullyQualifiedDomainName}:5432/${databaseName}?sslmode=require'
