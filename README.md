# Central de Serviços — V7 SaaS Multiempresa

Evolução da V6 Enterprise para um SaaS **multi-tenant**. Várias empresas usam o mesmo servidor e PostgreSQL, mas os registros operacionais são separados por `organization_id` no backend.

## O que entrou na V7

- Organizações/empresas (tenants) com status `active`, `trial` ou `suspended`.
- Super Admin da plataforma para cadastrar e administrar clientes.
- Planos Start, Business e Pro com limite de usuários configurável.
- Isolamento por empresa para usuários, chamados, ativos, comentários, anexos, notificações, conhecimento, categorias, setores, configurações e auditoria.
- Branding/configurações independentes por empresa.
- Convites seguros por link com expiração e perfil definido pelo administrador.
- Cadastro público sem convite bloqueado.
- Super Admin pode entrar no contexto de uma empresa para suporte.
- Migração automática dos dados da V6 para a primeira organização, preservando o banco existente.

## Migração da V6

A primeira inicialização cria a tabela `organizations`, adiciona `organization_id` às estruturas existentes e associa os dados atuais à organização inicial. O usuário definido por `ADMIN_USERNAME` passa a ser o **Super Admin**.

Não crie outro PostgreSQL e não altere `DATABASE_URL`.

## Fluxo para vender para outra empresa

1. Entre em **Plataforma → Empresas** como Super Admin.
2. Clique em **Nova empresa**.
3. Defina nome, slug, plano, limite e o primeiro administrador.
4. O administrador da empresa entra normalmente e gerencia apenas seu tenant.
5. Em **Usuários → Convidar por link**, o administrador gera convites para funcionários.

## Segurança multiempresa

O `organization_id` é validado no servidor. Um administrador comum não escolhe livremente outro tenant. Apenas o Super Admin pode enviar `X-Organization-Id` para selecionar uma organização no painel da plataforma. Nunca confie apenas em filtros de frontend para isolamento.

Para comercialização real, mantenha banco e serviço em plano de produção, backups automáticos, HTTPS, política de privacidade/LGPD, monitoramento, logs e processo de recuperação de desastre.
