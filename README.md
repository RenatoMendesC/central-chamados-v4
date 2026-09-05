# Central de Chamados V4 — Multiusuário

Versão com **Node.js + Express + PostgreSQL**. Agora usuários, chamados, comentários, fotos e relatórios ficam em um banco central e podem ser usados por vários computadores pelo mesmo link.

## Recursos

- Login real com sessão em cookie HttpOnly.
- Senhas protegidas com bcrypt.
- Perfis: Administrador, Atendente e Solicitante.
- Cadastro público fica pendente para aprovação.
- Central de usuários exclusiva do administrador.
- Foto de perfil.
- Bloqueio, aprovação, alteração de perfil e redefinição de senha.
- Chamados compartilhados entre computadores.
- Comentários/histórico nos chamados.
- Atribuição de responsável.
- Relatórios administrativos.
- Registro de auditoria.
- Solicitante enxerga apenas os próprios chamados.
- Rotas administrativas protegidas no servidor.

## Estrutura

```
central-chamados-v4/
├── src/
│   ├── server.js
│   ├── db.js
│   ├── schema.js
│   └── auth.js
├── views/
│   ├── index.html
│   ├── criar-conta.html
│   ├── chamados.html
│   ├── relatorios.html
│   └── usuarios.html
├── public/
│   ├── style.css
│   └── app.js
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## Rodar no seu PC

### 1. Instale Node.js
Use Node.js 20 ou superior.

### 2. Instale PostgreSQL
Crie um banco chamado `central_chamados`.

### 3. Configure o `.env`
Copie `.env.example` para `.env` e altere principalmente:

```env
DATABASE_URL=postgresql://postgres:SUA_SENHA@localhost:5432/central_chamados
JWT_SECRET=coloque-aqui-uma-chave-grande-e-dificil
ADMIN_NAME=Renato Costa
ADMIN_USERNAME=renato
ADMIN_EMAIL=seu-email@exemplo.com
ADMIN_PASSWORD=uma-senha-forte-aqui
```

O administrador é criado automaticamente na primeira inicialização do banco.

### 4. Instale as dependências
No terminal, dentro da pasta do projeto:

```bash
npm install
```

### 5. Inicie

```bash
npm start
```

Abra:

`http://localhost:3000`

> Nesta V4 você **não usa Live Server** para executar o sistema. O próprio Node.js serve o site e a API.

## Publicar para vários computadores

O projeto está preparado para usar uma hospedagem Node.js e um PostgreSQL online. No provedor escolhido, configure estas variáveis:

- `DATABASE_URL`
- `JWT_SECRET`
- `NODE_ENV=production`
- `ADMIN_NAME`
- `ADMIN_USERNAME`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

Com isso, todos acessam o mesmo endereço e utilizam o mesmo banco.

## Segurança

- Nunca envie seu arquivo `.env` para GitHub.
- Use uma senha forte para o administrador.
- Use um `JWT_SECRET` longo e aleatório.
- Em produção, utilize HTTPS (a maioria das hospedagens modernas fornece automaticamente).
- A senha inicial do administrador deve ser trocada após o primeiro acesso.
