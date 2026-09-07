# Central de Serviços V9

V9 com nova área de Assinatura e Histórico de Atividades/Auditoria.

## Principais novidades
- Página `/assinatura` acessível a todos os usuários autenticados.
- Plano atual, trial, validade, próxima cobrança, usuários utilizados e detalhes da assinatura.
- Página `/historico` para Administradores e Analistas.
- Auditoria de chamados, ativos, usuários, conhecimento, configurações e cobrança.
- Configurações voltam a ser exclusivas de Administradores.
- Modal de trial aponta diretamente para `/assinatura`.

## Atualização
Substitua os arquivos da instalação atual pelos arquivos da V9, mantenha seu `.env` e execute `npm install` / `npm start`. O `schema.js` adiciona as colunas de cobrança ausentes usando `ADD COLUMN IF NOT EXISTS`.

## Mercado Pago
As variáveis atuais são preservadas: `MP_MODE`, `MP_TEST_ACCESS_TOKEN`, `MP_TEST_PAYER_EMAIL`, `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `APP_URL`.
