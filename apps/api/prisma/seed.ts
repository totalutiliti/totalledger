import { PrismaClient, Role, Plano } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const PEPPER = process.env.PEPPER_SECRET || 'dev-pepper-change-in-production';

async function hashPassword(password: string): Promise<string> {
  const pepperedPassword = `${password}${PEPPER}`;
  return argon2.hash(pepperedPassword, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });
}

async function main() {
  // 0. Platform Tenant: Total Ledger (SUPER_ADMIN)
  const platform = await prisma.tenant.upsert({
    where: { cnpj: '00000000000000' },
    update: {},
    create: {
      id: 'tenant-platform-001',
      nome: 'Total Ledger',
      cnpj: '00000000000000',
      plano: Plano.ENTERPRISE,
      ativo: true,
    },
  });

  const superAdminHash = await hashPassword('Super@123');
  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: platform.id, email: 'superadmin@totalledger.com.br' } },
    update: { passwordHash: superAdminHash },
    create: {
      id: 'user-superadmin-001',
      tenantId: platform.id,
      email: 'superadmin@totalledger.com.br',
      passwordHash: superAdminHash,
      nome: 'Super Admin',
      role: Role.SUPER_ADMIN,
      mustChangePassword: false,
    },
  });

  // 1. Tenant: Sercofi Contabilidade
  const tenant = await prisma.tenant.upsert({
    where: { cnpj: '12345678000190' },
    update: {},
    create: {
      id: 'tenant-sercofi-001',
      nome: 'Sercofi Contabilidade',
      cnpj: '12345678000190',
      plano: Plano.PROFESSIONAL,
      ativo: true,
    },
  });

  // 2. Users
  const adminPasswordHash = await hashPassword('Admin@123');
  const analistaPasswordHash = await hashPassword('Analista@123');

  const admin = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'admin@sercofi.com.br' } },
    update: { passwordHash: adminPasswordHash },
    create: {
      id: 'user-admin-001',
      tenantId: tenant.id,
      email: 'admin@sercofi.com.br',
      passwordHash: adminPasswordHash,
      nome: 'Administrador Sercofi',
      role: Role.ADMIN,
      mustChangePassword: false,
    },
  });

  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'analista@sercofi.com.br' } },
    update: { passwordHash: analistaPasswordHash },
    create: {
      id: 'user-analista-001',
      tenantId: tenant.id,
      email: 'analista@sercofi.com.br',
      passwordHash: analistaPasswordHash,
      nome: 'Ana Silva',
      role: Role.ANALISTA,
      mustChangePassword: false,
    },
  });

  // 3. Empresas-cliente
  const construlaje = await prisma.empresa.upsert({
    where: { tenantId_cnpj: { tenantId: tenant.id, cnpj: '46260666000180' } },
    update: {},
    create: {
      id: 'empresa-construlaje-001',
      tenantId: tenant.id,
      razaoSocial: 'Construlaje Materiais de Construção Ltda',
      cnpj: '46260666000180',
      nomeFantasia: 'Construlaje',
      contato: 'Carlos Souza',
      telefone: '(11) 99999-1234',
      email: 'rh@construlaje.com.br',
      jornadaSegSex: '07:00-16:00',
      intervaloAlmoco: '11:00-12:00',
      jornadaSabado: '07:00-11:00',
      createdBy: admin.id,
    },
  });

  const metalSol = await prisma.empresa.upsert({
    where: { tenantId_cnpj: { tenantId: tenant.id, cnpj: '55987321000145' } },
    update: {},
    create: {
      id: 'empresa-metalsol-001',
      tenantId: tenant.id,
      razaoSocial: 'MetalSol Indústria Metalúrgica S.A.',
      cnpj: '55987321000145',
      nomeFantasia: 'MetalSol',
      contato: 'Maria Ferreira',
      telefone: '(11) 98765-4321',
      email: 'rh@metalsol.com.br',
      jornadaSegSex: '08:00-17:00',
      intervaloAlmoco: '12:00-13:00',
      createdBy: admin.id,
    },
  });

  // 4. Funcionários
  const funcionarios = [
    {
      id: 'func-001',
      tenantId: tenant.id,
      empresaId: construlaje.id,
      nome: 'João Pedro Santos',
      cargo: 'Pedreiro',
      cpf: '11122233344',
      matricula: 'CLJ-001',
    },
    {
      id: 'func-002',
      tenantId: tenant.id,
      empresaId: construlaje.id,
      nome: 'Maria Aparecida Oliveira',
      cargo: 'Ajudante Geral',
      cpf: '22233344455',
      matricula: 'CLJ-002',
    },
    {
      id: 'func-003',
      tenantId: tenant.id,
      empresaId: construlaje.id,
      nome: 'Roberto Carlos Lima',
      cargo: 'Mestre de Obras',
      cpf: '33344455566',
      matricula: 'CLJ-003',
    },
    {
      id: 'func-004',
      tenantId: tenant.id,
      empresaId: metalSol.id,
      nome: 'Ana Beatriz Costa',
      cargo: 'Operadora de Máquinas',
      cpf: '44455566677',
      matricula: 'MTS-001',
    },
    {
      id: 'func-005',
      tenantId: tenant.id,
      empresaId: metalSol.id,
      nome: 'Fernando Alves Ribeiro',
      cargo: 'Soldador',
      cpf: '55566677788',
      matricula: 'MTS-002',
    },
  ];

  for (const func of funcionarios) {
    await prisma.funcionario.upsert({
      where: {
        tenantId_empresaId_cpf: {
          tenantId: func.tenantId,
          empresaId: func.empresaId,
          cpf: func.cpf,
        },
      },
      update: {},
      create: func,
    });
  }

  // 5. Feature Flags
  const features = [
    { tenantId: tenant.id, feature: 'rh', enabled: true },
    { tenantId: tenant.id, feature: 'fiscal', enabled: false },
    { tenantId: tenant.id, feature: 'societario', enabled: false },
    { tenantId: tenant.id, feature: 'controle', enabled: false },
  ];

  for (const flag of features) {
    await prisma.featureFlag.upsert({
      where: {
        tenantId_feature: {
          tenantId: flag.tenantId,
          feature: flag.feature,
        },
      },
      update: { enabled: flag.enabled },
      create: flag,
    });
  }

  // eslint-disable-next-line no-console
  console.log('Seed completed successfully');
  // eslint-disable-next-line no-console
  console.log(`  Platform: ${platform.nome} (Total Ledger)`);
  // eslint-disable-next-line no-console
  console.log(`  SUPER_ADMIN: superadmin@totalledger.com.br (Super@123)`);
  // eslint-disable-next-line no-console
  console.log(`  Tenant: ${tenant.nome}`);
  // eslint-disable-next-line no-console
  console.log(`  Users: admin@sercofi.com.br (Admin@123), analista@sercofi.com.br (Analista@123)`);
  // eslint-disable-next-line no-console
  console.log(`  Empresas: ${construlaje.nomeFantasia}, ${metalSol.nomeFantasia}`);
  // eslint-disable-next-line no-console
  console.log(`  Funcionários: ${funcionarios.length}`);
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
