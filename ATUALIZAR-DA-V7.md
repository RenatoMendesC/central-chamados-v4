# Atualizar V7 → V8 Comercial

A V8 usa o mesmo PostgreSQL e preserva empresas, usuários, chamados, ativos e artigos existentes.

## Principais novidades
- Painel comercial do Super Admin com plano, assinatura, trial e dados de cobrança.
- Botão visível **Voltar à Plataforma** ao acessar uma empresa como Super Admin.
- Trial configurável ao criar empresas.
- Identidade visual por empresa (logo e cor principal).
- Página pública de apresentação em `/apresentacao`.
- Correção definitiva da inicialização JavaScript que causava problema de cache/clique na V7.
- Health check atualizado para V8.

## Deploy
Substitua os arquivos da V7 pelos desta pasta mantendo `.git` e `.env`. Depois use `git add .`, commit e push no mesmo repositório. Não altere `DATABASE_URL`.
