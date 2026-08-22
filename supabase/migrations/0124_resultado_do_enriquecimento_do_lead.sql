-- 0124 — O enriquecimento do lead deixa de ser invisível.
--
-- Em 22/08/2026 um lead chegou, o job rodou, `processada_em` foi marcado — e nada foi
-- enriquecido. Descobrir por quê exigiu cruzar `empresas`, `enriquecimentos`,
-- `mercado_universo` e `cnpj_lookup_fila`, e ainda assim o erro da etapa que falhou só
-- existia no log do container.
--
-- Um job que registra "terminei" sem registrar O QUE FEZ obriga alguém a fazer
-- arqueologia toda vez que o resultado decepciona. A coluna guarda, por etapa, o que
-- aconteceu e por que não aconteceu.

alter table public.formulario_submissoes
  add column if not exists enriquecimento_resultado jsonb;

comment on column public.formulario_submissoes.enriquecimento_resultado is
  'Por etapa (cadastral, dominio, funcionarios, contatos, faturamento, score): o que '
  'rodou, o que pulou e por quê. `processada_em` diz que o job passou; esta coluna diz o '
  'que ele conseguiu — e as duas respostas são diferentes.';
