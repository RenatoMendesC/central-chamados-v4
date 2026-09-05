# Central de Chamados V5

Versão multiusuário para uso em vários computadores, com Node.js, Express e PostgreSQL.

## Novidades da V5

- Dashboard operacional com KPIs.
- SLA automático por prioridade e destaque de chamados atrasados.
- Notificações internas para novos chamados, atribuições, atualizações e comentários.
- Anexos pequenos nos chamados (aprox. 1 MB por arquivo), armazenados no PostgreSQL.
- Histórico de eventos de cada chamado.
- Categorias administráveis.
- Setores administráveis.
- Configuração do nome do sistema e dos prazos de SLA.
- Filtro por categoria e apenas chamados atrasados.
- Relatórios com tempo médio de resolução e percentual de SLA cumprido.
- Central de usuários, perfis, fotos, bloqueio e aprovação.
- Auditoria administrativa.

## Compatibilidade com a V4

A V5 foi feita para utilizar o mesmo banco PostgreSQL da V4. Ao iniciar, ela cria automaticamente novas tabelas e colunas com `CREATE TABLE IF NOT EXISTS` e `ALTER TABLE ... IF NOT EXISTS`. Não é necessário apagar o banco.

## Desenvolvimento local

Use o mesmo `.env` da V4:

```env
PORT=3000
NODE_ENV=development
DATABASE_URL=postgresql://postgres:SUA_SENHA@localhost:5432/central_chamados
JWT_SECRET=uma-chave-com-pelo-menos-20-caracteres
ADMIN_NAME=Renato Costa
ADMIN_USERNAME=renato
ADMIN_EMAIL=seu-email
ADMIN_PASSWORD=sua-senha
```

Depois:

```bash
npm install
npm start
```

Acesse `http://localhost:3000`.

## Atualizar o sistema que já está no Render

Você não precisa criar outro Web Service nem outro PostgreSQL.

1. Faça backup da pasta V4 no computador.
2. Substitua os arquivos do projeto pelos arquivos desta V5, mantendo o seu `.env` local.
3. No terminal, rode:

```bash
git add .
git commit -m "Atualização V5 - Dashboard SLA e melhorias"
git push origin main
```

4. O Render normalmente detecta o `push` e faz um novo deploy automaticamente.
5. Acompanhe os logs do deploy. Ao iniciar, deve aparecer `Central de Chamados V5`.
6. Abra o mesmo link `.onrender.com`. O banco e as contas existentes permanecem.

## Observação sobre anexos

Nesta V5, anexos pequenos são guardados no próprio PostgreSQL para evitar depender do disco temporário do Render. Para uma futura versão com arquivos grandes, o recomendado é usar armazenamento de objetos, como Cloudinary, S3 ou equivalente.

## Segurança

- Senhas são armazenadas com bcrypt.
- Sessões usam JWT em cookie HttpOnly.
- Rotas administrativas exigem perfil de administrador.
- Solicitantes visualizam apenas os próprios chamados.
- Segredos ficam nas variáveis de ambiente e não devem ser enviados ao GitHub.
