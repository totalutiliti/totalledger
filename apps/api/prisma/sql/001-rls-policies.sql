-- ============================================
-- SercofiRH — Row Level Security (RLS)
-- ============================================
-- Execute AFTER Prisma migrations.
-- app_user role uses SET app.current_tenant before each transaction.
-- SUPER_ADMIN bypasses RLS via a separate PostgreSQL role.

-- ============================================
-- 1. Enable RLS on all tenant-scoped tables
-- ============================================

ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "empresas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "funcionarios" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "uploads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cartoes_ponto" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "batidas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "revisoes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 2. Create app_user role (used by the API)
-- ============================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;
END
$$;

-- Grant necessary permissions to app_user
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- Default privileges for future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;

-- ============================================
-- 3. Create super_admin role (bypasses RLS)
-- ============================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'super_admin') THEN
    CREATE ROLE super_admin NOLOGIN BYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO super_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO super_admin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO super_admin;

-- ============================================
-- 4. RLS Policies — tenant isolation
-- ============================================

-- Tenants: own tenant only
DROP POLICY IF EXISTS tenant_isolation_tenants ON "tenants";
CREATE POLICY tenant_isolation_tenants ON "tenants"
  USING ("id" = current_setting('app.current_tenant', true)::text);

-- Users: same tenant
DROP POLICY IF EXISTS tenant_isolation_users ON "users";
CREATE POLICY tenant_isolation_users ON "users"
  USING ("tenantId" = current_setting('app.current_tenant', true)::text);

-- Empresas: same tenant
DROP POLICY IF EXISTS tenant_isolation_empresas ON "empresas";
CREATE POLICY tenant_isolation_empresas ON "empresas"
  USING ("tenantId" = current_setting('app.current_tenant', true)::text);

-- Funcionarios: same tenant
DROP POLICY IF EXISTS tenant_isolation_funcionarios ON "funcionarios";
CREATE POLICY tenant_isolation_funcionarios ON "funcionarios"
  USING ("tenantId" = current_setting('app.current_tenant', true)::text);

-- Uploads: same tenant
DROP POLICY IF EXISTS tenant_isolation_uploads ON "uploads";
CREATE POLICY tenant_isolation_uploads ON "uploads"
  USING ("tenantId" = current_setting('app.current_tenant', true)::text);

-- CartoesPonto: same tenant
DROP POLICY IF EXISTS tenant_isolation_cartoes_ponto ON "cartoes_ponto";
CREATE POLICY tenant_isolation_cartoes_ponto ON "cartoes_ponto"
  USING ("tenantId" = current_setting('app.current_tenant', true)::text);

-- Batidas: same tenant
DROP POLICY IF EXISTS tenant_isolation_batidas ON "batidas";
CREATE POLICY tenant_isolation_batidas ON "batidas"
  USING ("tenantId" = current_setting('app.current_tenant', true)::text);

-- Revisoes: same tenant
DROP POLICY IF EXISTS tenant_isolation_revisoes ON "revisoes";
CREATE POLICY tenant_isolation_revisoes ON "revisoes"
  USING ("tenantId" = current_setting('app.current_tenant', true)::text);

-- AuditLogs: same tenant
DROP POLICY IF EXISTS tenant_isolation_audit_logs ON "audit_logs";
CREATE POLICY tenant_isolation_audit_logs ON "audit_logs"
  USING ("tenantId" = current_setting('app.current_tenant', true)::text);

-- ============================================
-- 5. Force RLS for table owners too
-- ============================================

ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
ALTER TABLE "empresas" FORCE ROW LEVEL SECURITY;
ALTER TABLE "funcionarios" FORCE ROW LEVEL SECURITY;
ALTER TABLE "uploads" FORCE ROW LEVEL SECURITY;
ALTER TABLE "cartoes_ponto" FORCE ROW LEVEL SECURITY;
ALTER TABLE "batidas" FORCE ROW LEVEL SECURITY;
ALTER TABLE "revisoes" FORCE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;
