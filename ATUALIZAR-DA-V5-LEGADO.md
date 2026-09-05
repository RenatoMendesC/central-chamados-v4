# Atualizar V5 → V6 Enterprise

1. Faça backup ou confirme que o PostgreSQL do Render está saudável.
2. Substitua os arquivos do projeto V5 pelos arquivos desta V6, mantendo a pasta `.git` da sua cópia conectada ao GitHub.
3. Confirme que `.env` continua no `.gitignore`.
4. No terminal:

```bash
git add .
git commit -m "Atualiza Central de Serviços para V6 Enterprise"
git push origin main
```

5. O Render fará o deploy automaticamente.
6. Aguarde o status **Live**.
7. Abra o mesmo link público e pressione `Ctrl + F5`.
8. Entre como administrador e teste: Dashboard → Chamados → Ativos → Base de conhecimento → Relatórios → Usuários → Configurações.

**Não crie outro banco e não altere `DATABASE_URL`.** As migrações da V6 usam o banco existente e preservam os dados anteriores.
