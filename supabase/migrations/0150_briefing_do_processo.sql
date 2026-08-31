-- ═════════════════════════════════════════════════════════════════════════════
-- 0150 — O briefing do processo: fase, o que aconteceu, o que fazer
--
-- Já existe o PARECER (08 §7): seis seções, 80 movimentações no dossiê, risco
-- avaliado. Ele é caro, demora, e é gerado quando alguém aperta o botão — é um
-- documento que se lê uma vez e se guarda.
--
-- O que faltava é outra coisa: as três frases que alguém precisa AO ABRIR o
-- processo. Em que fase está, o que aconteceu ultimamente, o que fazer agora.
-- Um documento de seis seções não responde isso — ele exige ser lido.
--
-- ─── POR QUE UMA TABELA, E NÃO GERAR A CADA ABERTURA ────────────────────────
-- Gerar no render cobraria tokens a cada clique e faria a tela esperar segundos
-- por um texto que não mudou. O briefing é CACHE com uma condição de validade
-- honesta: `ate_movimentacao_em` guarda até onde ele leu. Enquanto não chegar
-- movimentação nova, ele continua verdadeiro; quando chegar, a tela sabe que
-- está velho e o sync regenera.
--
-- Uma linha por processo, sobrescrita. O histórico de pareceres existe porque um
-- parecer é um documento datado que alguém pode ter usado para decidir; um
-- briefing é o estado de agora, e guardar dez versões dele seria guardar dez
-- fotos da mesma parede.
-- ═════════════════════════════════════════════════════════════════════════════

create table public.processo_briefings (
  numero_cnj text primary key references public.processos (numero_cnj) on delete cascade,

  /* As três respostas, separadas porque a tela mostra cada uma no seu lugar —
     e porque um markdown único obrigaria a fazer parse para destacar a ação. */
  resumo_fase text not null,
  resumo_movimentacoes text not null,
  proxima_acao text not null,

  /* Quando a próxima ação é urgente, ela sobe na lista. `null` = o modelo não
     soube dizer, que é diferente de "não é urgente". */
  urgencia text
    constraint briefing_urgencia_check check (urgencia is null or urgencia in ('baixa', 'media', 'alta')),

  /*
   * Até onde este briefing leu. É a condição de validade inteira: se a
   * movimentação mais recente do processo for posterior a isto, o texto está
   * velho e a tela diz. Guardar só `criado_em` responderia "de quando é", que é
   * a pergunta errada — um briefing de ontem sobre um processo parado há um ano
   * está perfeitamente atual.
   */
  ate_movimentacao_em date,
  qtd_movimentacoes_lidas int not null default 0,

  modelo text,
  tokens int,
  criado_em timestamptz not null default now()
);

comment on table public.processo_briefings is
  'As três frases que alguém precisa AO ABRIR o processo: fase, o que aconteceu, o que '
  'fazer. Cache com validade por movimentação, não por data — briefing de ontem sobre '
  'processo parado há um ano continua atual. O parecer (processo_pareceres) é outra '
  'coisa: documento datado, seis seções, gerado sob demanda.';

alter table public.processo_briefings enable row level security;

revoke all on public.processo_briefings from anon, authenticated;
grant select on public.processo_briefings to authenticated;

/* Mesma régua de `processos`: quem tem o módulo lê. A escrita é só do worker,
   que é quem fala com o modelo — não há RPC de escrita porque não há nada que
   uma pessoa devesse escrever aqui à mão. */
create policy processo_briefings_select on public.processo_briefings
  for select to authenticated
  using ((select public.app_tem_modulo('juridico')));
