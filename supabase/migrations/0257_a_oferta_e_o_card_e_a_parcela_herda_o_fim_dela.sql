/*
 * A oferta é o card, e a parcela herda o fim dela.
 *
 * ── A INVERSÃO, E POR QUE ELA NÃO É A MESMA NOS DOIS PARES ──────────────────
 * Até aqui, quando uma parcela do Sienge já tinha pré-autorização, o card que
 * ficava era a PARCELA e a oferta sumia com um selo "já tem pré-autorização".
 * Agora é o contrário: a OFERTA fica, e a parcela sai.
 *
 * Contra a NF nada muda — a nota continua ganhando da oferta. A diferença entre os
 * dois pares é de CARDINALIDADE, e foi ela que a regra anterior não distinguiu:
 *
 *   pré-auth ↔ título ... 1:1. A oferta aponta `billId` + `installmentId`, então é a
 *                         MESMA unidade que a parcela. Medido em 23/09/2026: 123
 *                         parcelas com oferta, nenhuma com duas.
 *   pré-auth ↔ NF ....... 1:N. Uma nota em três parcelas gera até três ofertas, e
 *                         esconder a nota atrás de uma delas diria que só ela existe.
 *
 * E contra o título a oferta descreve melhor o mesmo recebível: tem relógio
 * (`expira_em`), status e valor autorizado, e o card da parcela não tem onde mostrar
 * isso — a view do título fixa `relogio = NULL`. Medido: dos 87 títulos que
 * escondiam uma oferta ABERTA, todos os 87 tinham `situation = 'offer_created'` e
 * NENHUM tinha `guard_reason`. O card na tela dizia "uma oferta foi criada" e
 * escondia exatamente essa oferta — com 9 prazos já vencidos sem ninguém ver.
 *
 * ── OFERTA ENCERRADA ENCERRA A PARCELA ──────────────────────────────────────
 * Decisão de negócio, tomada em 23/09/2026: oferta recusada ou expirada NÃO devolve
 * a parcela para a coluna aberta — a parcela é marcada com o mesmo estágio da oferta.
 * Oferta recusada não é parcela a retrabalhar, e sem isso o funil pediria de novo,
 * no dia seguinte, o trabalho que a construtora já respondeu.
 *
 * Por isso a dedup passou a escrever `sienge_titulos.estagio_funil` — o único campo
 * de estágio que ela toca, e só quando a oferta correspondente está encerrada.
 *
 * ── O QUE ESTA MIGRAÇÃO FAZ, E O QUE ELA DELIBERADAMENTE NÃO FAZ ────────────
 * Faz UMA coisa: libera o motivo `oferta_criada` no CHECK. Isso é obrigatório e
 * precisa valer ANTES do worker novo subir — sem ele o primeiro `insert` da dedup
 * viola a constraint, a transação inteira faz rollback e a corrida termina com zero
 * ocultações, que é exatamente o modo de falha que a 0247 registrou.
 *
 * NÃO refaz os pares à mão. A dedup recompõe `funil_ocultacoes`,
 * `funil_selos_preauth` e `origem_exibida` do zero a cada corrida — reescrever aqui
 * o casamento por `billId`/`installmentId`, o desempate e a resolução de cadeia
 * seria uma segunda implementação da regra, sem teste, para durar uma hora. Depois
 * do deploy, `POST /jobs/funil/deduplicar` aplica tudo na hora.
 *
 * `sienge_titulos_original_tipo_check` já aceitava `'pre_autorizacao'` desde a 0233:
 * o schema previu esta inversão antes de a regra existir, e não precisa mudar.
 *
 * A lista abaixo foi LIDA do banco antes de ser reescrita (`tem_original`,
 * `duplicado_canal`), e não copiada da migração que criou a constraint.
 */

alter table public.funil_ocultacoes
  drop constraint if exists funil_ocultacoes_motivo_check;

alter table public.funil_ocultacoes
  add constraint funil_ocultacoes_motivo_check
  check (motivo = any (array['tem_original', 'duplicado_canal', 'oferta_criada']));

comment on column public.funil_ocultacoes.motivo is
  'Por que este card não aparece. `tem_original`: o derivado sai e o documento fica '
  '(pré-auth atrás da NF). `duplicado_canal`: o mesmo recebível chegou por dois '
  'canais e a config escolheu um (NF vs título). `oferta_criada`: a parcela virou '
  'pré-autorização, e a OFERTA é o card — o par é 1:1 e a oferta tem relógio, que a '
  'parcela não tem onde mostrar.';
