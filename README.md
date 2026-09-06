# Central de Serviços V8 Clean

Versão reconstruída sobre a base multiempresa estável, com foco em produto SaaS comercial e operação B2B.

## Destaques

- Multiempresa com isolamento por `organization_id` em todas as entidades operacionais.
- Super Admin com Control Plane, modo suporte e retorno explícito à plataforma.
- Planos Start, Business e Pro, trial, limites de usuários e gestão comercial.
- Dashboard, chamados, SLA, ativos/CMDB, base de conhecimento, relatórios, auditoria e notificações.
- Página comercial pública em `/apresentacao`.
- Cache de JS/CSS desativado no servidor + versionamento de assets para evitar deploy antigo no navegador.
- Migrações idempotentes que preservam os dados existentes no PostgreSQL.

## Variáveis obrigatórias

```env
DATABASE_URL=postgresql://...
JWT_SECRET=uma-chave-forte-com-mais-de-20-caracteres
ADMIN_USERNAME=renato
ADMIN_PASSWORD=troque-esta-senha
ADMIN_NAME=Renato Costa
ADMIN_EMAIL=seu-email@dominio.com
DEFAULT_ORG_NAME=Minha Empresa
NODE_ENV=production
```

## Rodar

```bash
npm install
npm start
```

Health check: `/health`

## Deploy

Pronto para Render com Node 20+ e PostgreSQL. Não crie outro banco ao atualizar uma instalação existente: as migrações são executadas no startup.
