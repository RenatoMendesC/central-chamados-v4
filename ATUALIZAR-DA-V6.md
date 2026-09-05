# Atualizar V6 → V7 SaaS Multiempresa

1. Confirme que a V6 atual está funcionando e, para produção, faça backup do PostgreSQL.
2. Substitua os arquivos da V6 pelos desta V7, mantendo a pasta `.git` do projeto que já está conectado ao GitHub.
3. Confirme que `.env` continua ignorado pelo Git.
4. Rode `git status`, depois `git add .`.
5. Faça `git commit -m "Atualiza Central de Serviços para V7 SaaS Multiempresa"`.
6. Rode `git push origin main`.
7. Aguarde o Render ficar **Live**.
8. Entre com a conta principal e abra **Plataforma → Empresas**.

A migração usa o mesmo banco. Os dados atuais são vinculados à organização inicial e a conta `ADMIN_USERNAME` vira Super Admin.

## Teste recomendado

Crie uma segunda empresa fictícia, entre com o administrador dela, crie um chamado e um ativo e confirme que esses dados não aparecem quando você entra no contexto da primeira empresa.
