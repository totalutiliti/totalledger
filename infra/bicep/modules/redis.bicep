// ============================================================================
// Azure Cache for Redis
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

var redisName = 'redis-${projectName}-${environment}'
var skuFamily = 'C'
var skuCapacity = environment == 'dev' ? 0 : 1
var skuName = environment == 'dev' ? 'Basic' : 'Standard'

// ── Resources ───────────────────────────────────────────────────────────────

resource redis 'Microsoft.Cache/redis@2024-03-01' = {
  name: redisName
  location: location
  tags: tags
  properties: {
    sku: {
      name: skuName
      family: skuFamily
      capacity: skuCapacity
    }
    enableNonSslPort: false
    minimumTlsVersion: '1.2'
    redisConfiguration: {
      'maxmemory-policy': 'allkeys-lru'
    }
    publicNetworkAccess: 'Enabled'
  }
}

// ── Outputs ─────────────────────────────────────────────────────────────────

output hostName string = redis.properties.hostName
output port int = redis.properties.sslPort

@secure()
output primaryKey string = redis.listKeys().primaryKey
