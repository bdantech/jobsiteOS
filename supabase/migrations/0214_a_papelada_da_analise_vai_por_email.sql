-- ═════════════════════════════════════════════════════════════════════════════
-- 0214 — A papelada da análise vai por e-mail
--
-- ─── O QUE MUDOU LÁ FORA ────────────────────────────────────────────────────
-- Os documentos da análise iam à Atradius pela API, por `covers/{id}/documents`.
-- Essa rota entrou no código com a ressalva escrita de NUNCA ter sido confirmada:
-- o handbook que temos cobre cover, buyer e policy, e não documenta anexo. Ela
-- estava lá porque a alternativa era não mandar nada.
--
-- Em 17/09/2026 a Atradius respondeu: a API não recebe documento. A papelada deve
-- ir por E-MAIL, junto do pedido de cobertura. A rota saiu do código — um método
-- que sempre falha é pior que método nenhum, porque convida a próxima pessoa a
-- "consertar a chamada" contra um endpoint que não existe.
--
-- ─── O QUE ESTA MIGRAÇÃO FAZ ────────────────────────────────────────────────
-- Cria a linha `documentos_email` em `credito_config`. Só isso: não há coluna
-- nova, porque `analise_docs` já tem onde gravar o resultado por documento
-- (`enviado_seguradora_em`, `envio_seguradora_erro`) e o significado dessas duas
-- colunas não mudou — "foi à seguradora" continua sendo "foi à seguradora",
-- independentemente do cano.
--
-- ─── POR QUE LINHA PRÓPRIA, E NÃO UM CAMPO EM `atradius` ────────────────────
-- `credito_config.atradius` é a IDENTIFICAÇÃO na seguradora (organização, uid
-- type, ambiente): lida em toda chamada HTTP, com cache de um minuto no worker.
-- A lista de destinatários é decisão de negócio — muda quando o analista da conta
-- muda — e é lida uma vez por análise enviada. Juntar as duas na mesma linha faria
-- o cache da primeira decidir por quanto tempo a segunda fica errada, e trocar um
-- e-mail exigiria reescrever o bloco de credenciais de identificação.
--
-- ─── POR QUE A LISTA NASCE VAZIA ────────────────────────────────────────────
-- Um destinatário padrão embutido aqui mandaria documento de cliente para um
-- endereço que ninguém escolheu — e e-mail não se desenvia. Vazia, o envio marca
-- cada documento com o motivo ("nenhum destinatário configurado"), a tela da
-- análise mostra, e o caminho de volta é a página de configurações. O pedido de
-- cobertura continua saindo normalmente: só a papelada fica retida.
--
-- NÃO SÃO SEGREDO, e por isso podem morar numa tabela que a tela lê: um endereço
-- de e-mail identifica, não autentica. Chave do Resend e credenciais da Atradius
-- seguem em variável do worker, como manda a 0125.
--
-- `on conflict do nothing` porque a tela pode ter salvado a lista antes de esta
-- migração rodar — e a lista de quem recebe documento do cliente não é coisa que
-- uma migração sobrescreve.
-- ═════════════════════════════════════════════════════════════════════════════

insert into public.credito_config (chave, valor) values (
  'documentos_email',
  jsonb_build_object(
    -- [{ "email": "...", "nome": "..." }]. `nome` é cosmético: entra no "Nome <e-mail>".
    'destinatarios', '[]'::jsonb,
    -- Para onde a seguradora responde. O remetente é subdomínio de automação, e
    -- resposta que cai nele ninguém lê. `null` mantém o padrão do Resend.
    'responder_para', null,
    -- `null` usa o padrão do core (`ASSUNTO_PADRAO`), que começa pelo CNPJ: é por
    -- ele que a Atradius indexa o buyer, e um assunto que começa pelo nome faz a
    -- busca na caixa de entrada depender de como alguém digitou "Engenharia LTDA".
    'assunto_template', null
  )
)
on conflict (chave) do nothing;

comment on table public.credito_config is
  'Settings do módulo Crédito, uma linha por assunto (0073). Inclui `documentos_email` '
  '(0214): para quem a papelada da análise vai, agora que ela vai por e-mail — a API da '
  'Atradius não recebe anexo. Nada aqui é segredo: credenciais moram em variável do worker.';
