using '../main.bicep'

param environment = 'prod'
param location = 'brazilsouth'
param projectName = 'sercofi'
param postgresAdminPassword = readEnvironmentVariable('POSTGRES_ADMIN_PASSWORD', '')
