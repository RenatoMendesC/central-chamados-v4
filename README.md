# Central de Serviços — V6 Enterprise

Plataforma web multiusuário de Service Desk / Help Desk construída com **Node.js, Express e PostgreSQL**. Esta versão evolui a V5 para uma experiência mais corporativa, com gestão de chamados, SLA, ativos, conhecimento, usuários, auditoria e indicadores executivos.

## Novidades da V6

- Interface completamente redesenhada com aparência SaaS/corporativa.
- Dashboard executivo com backlog, SLA vencido, prioridade crítica, resolvidos do dia, tempo médio de resolução e primeira resposta.
- Indicador de saúde operacional e distribuição de carga por analista.
- **CMDB / Gestão de Ativos**: patrimônio, tipo, fabricante, modelo, serial, usuário, setor, local, status e histórico de chamados relacionados.
- Chamados agora podem ter **impacto**, local e ativo relacionado.
- **Base de Conhecimento** com artigos, categorias, publicação/rascunho, edição e contador de visualizações.
- Relatórios executivos com SLA, primeira resposta, aging do backlog, impacto, categorias e responsáveis.
- Central de usuários com cards-resumo, perfis, bloqueio, aprovação e auditoria.
- Configurações de marca: nome da plataforma, empresa, tagline e e-mail de suporte.
- Rate limit no login/cadastro para reduzir tentativas automatizadas.
- Layout responsivo para desktop, tablet e celular.

## Perfis

- **Administrador**: acesso total, usuários, relatórios, configurações, ativos e base de conhecimento.
- **Analista**: chamados, dashboard, ativos e base de conhecimento.
- **Solicitante**: dashboard, próprios chamados e base de conhecimento.

## Atualização segura da V5

A V6 foi preparada para usar **o mesmo PostgreSQL da V5**. Na inicialização, o sistema executa migrações com `CREATE TABLE IF NOT EXISTS` e `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, portanto os usuários, chamados, comentários, anexos e histórico existentes são preservados.

Novas estruturas criadas automaticamente:

- `assets`
- `knowledge_articles`
- novas colunas em `tickets`: `asset_id`, `impact`, `channel`, `location`, `first_response_at`
- novas configurações de identidade corporativa

## Executar localmente

Crie um `.env` baseado em `.env.example` e configure seu PostgreSQL. Depois:

```bash
npm install
npm start
```

Abra `http://localhost:3000`.

## Render

Use o mesmo Web Service e o mesmo banco da versão anterior. Após enviar a V6 ao mesmo repositório GitHub, o Render fará um novo deploy automaticamente. Não é necessário criar outro PostgreSQL nem alterar `DATABASE_URL`.

### Variáveis necessárias

- `DATABASE_URL`
- `JWT_SECRET`
- `NODE_ENV=production`
- `ADMIN_NAME`
- `ADMIN_USERNAME`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

A conta definida por `ADMIN_*` só é criada se o usuário ainda não existir.

## Segurança

As senhas são armazenadas com bcrypt. A autenticação usa JWT em cookie HttpOnly, `secure` em produção e `sameSite=lax`. O servidor utiliza Helmet e rate limit nas rotas de login/cadastro. Mantenha o `.env` fora do GitHub.

## Observação sobre anexos

Os anexos continuam armazenados no PostgreSQL em Data URL, com limite aproximado de 1 MB por arquivo. Isso é adequado para documentos pequenos e evidências. Para grande volume de arquivos, a evolução recomendada é integrar um storage de objetos como S3/R2.
