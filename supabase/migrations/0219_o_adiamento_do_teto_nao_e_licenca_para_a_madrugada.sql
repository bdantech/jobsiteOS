-- ═════════════════════════════════════════════════════════════════════════════
-- 0219 — O adiamento do teto não é licença para a madrugada, e o cooldown
--        deixa de barrar quem escreve à mão
--
-- ─── §1 O RELATO ────────────────────────────────────────────────────────────
-- O SDR reportou mensagens saindo muito depois do pedido, algumas às 22h30. A
-- janela configurada é 9h–18h, de segunda a sexta, America/Sao_Paulo. O que o banco
-- mostra, para os envios fora dela:
--
--   pedida 15/09 10:15  →  agendada 15/09 22:15  →  enviada 22:26   (+12h00)
--   pedida 15/09 10:38  →  agendada 15/09 22:38  →  enviada 22:45   (+12h00)
--   pedida 16/09 14:13  →  agendada 17/09 02:13  →  enviada 02:15   (+12h00)
--
-- `agendada_para` = `criada_em` + exatamente doze horas, minuto a minuto. Não é
-- deriva de cron nem fila congestionada: é uma constante no código.
--
-- ─── §2 DOIS DEFEITOS QUE SÓ DOEM JUNTOS ────────────────────────────────────
--
-- (a) O ADIAMENTO ERRADO. A fila, ao barrar por teto diário (da conta, via warmup,
--     ou da thread), fazia `agora + 12h` sob um comentário que dizia "adia para a
--     próxima abertura". Doze horas não são a próxima abertura de nada: às 10h15 de
--     uma terça isso cai às 22h15 da MESMA terça — de noite, e ainda dentro do dia
--     cujo teto a mensagem tinha acabado de estourar.
--
--     Corrigido no core, com teste: `proximaAberturaAposVirada`. Teto diário zera na
--     virada do dia local; é para lá que a mensagem vai.
--
-- (b) `agendada_para` FAZIA DUAS COISAS. Ela guardava QUANDO retentar e, ao mesmo
--     tempo, era o sinal de que "esta mensagem pode furar a janela" — porque o
--     enfileiramento gravava `agendada_para = now()` quando a pessoa marcava
--     "forçar janela" no compositor, e a fila lia `forcarJanela: agendada_para is
--     not null`.
--
--     Então o adiamento do sistema herdava, sem querer, a licença que era da pessoa.
--     Às 22h15 a mensagem voltava à fila com a janela DESLIGADA e saía.
--
-- Sozinho, (a) atrasaria a mensagem até a abertura seguinte — chato, não grave.
-- Sozinho, (b) nunca dispararia, porque só a pessoa escrevia `agendada_para`.
-- Juntos, transformaram um teto de proteção em permissão para mandar WhatsApp para
-- fornecedor às 22h30. Em 15/09 foram 36 mensagens assim, de 82 pedidas no dia.
--
-- A coluna nova desfaz a sobrecarga: `agendada_para` volta a significar SÓ "quando",
-- e `forcar_janela` passa a dizer o que a PESSOA escolheu. Um booleano que só o
-- compositor escreve não pode ser produzido por engano por uma rotina.
--
-- Nasce `false` para as linhas existentes, e é o certo: o que está pendente na fila
-- hoje foi adiado pelo sistema, não liberado por alguém.
--
-- ─── §3 O COOLDOWN NÃO BARRA MAIS QUEM ESCREVE À MÃO ────────────────────────
-- Havia uma trava de 3 dias entre duas mensagens ao mesmo contato, e ela recusava o
-- envio no enfileiramento com "Falamos com este contato há menos de 3 dia(s)".
--
-- A régua nasceu para o robô, e aplicá-la a quem escreve à mão inverte o que ela
-- protege: quem está numa negociação responde no dia seguinte, e a trava dizia não.
-- Pior, dizia não DEPOIS de a pessoa escrever a mensagem — o trabalho já feito, e o
-- caminho restante sendo mandar pelo celular, fora do sistema, sem registro nenhum.
--
-- Sai do caminho humano (esta RPC, que só o compositor chama). CONTINUA valendo para
-- o caminho automático: o portão do worker ainda aplica `cooldown_dias` quando
-- `origem = 'outbox'`, que é a régua da cadência do robô. Ninguém pediu para soltar
-- o robô, e soltá-lo de carona seria decidir por outra pessoa.
-- ═════════════════════════════════════════════════════════════════════════════

alter table public.mensagens_outbox
  add column if not exists forcar_janela boolean not null default false;

comment on column public.mensagens_outbox.forcar_janela is
  'A PESSOA escolheu furar a janela de horário (0219). Só o compositor escreve. Antes '
  'isto era inferido de `agendada_para is not null`, e o adiamento por teto diário — '
  'feito pelo worker — herdava a licença sem querer: era assim que mensagem saía 22h30.';

update public.mensagens_outbox
   set forcar_janela = true
 where status in ('enviada', 'falhou')
   and origem = 'compositor'
   and agendada_para is not null
   and agendada_para <= criada_em + interval '1 minute';
-- Só o histórico já resolvido, e só o padrão inconfundível do "forçar" antigo
-- (`agendada_para = now()` no mesmo minuto da criação). O que está PENDENTE fica
-- `false` de propósito: na dúvida sobre uma mensagem que ainda vai sair, a janela vale.

create or replace function public.app_comunicacao_enfileirar(p jsonb)
returns public.mensagens_outbox
language plpgsql security definer set search_path = '' as $function$
declare
  v_ator uuid := auth.uid();
  v_canal text := p ->> 'canal';
  v_contato public.contatos;
  v_destino text;
  v_ident text;
  v_empresa public.empresas;
  v_msg public.mensagens_outbox;
  v_conversa uuid;
  v_vendedor uuid;
  v_forcar boolean := coalesce((p ->> 'forcar_janela')::boolean, false);
begin
  if not public.app_tem_modulo('comunicacao') then
    raise exception 'Sem acesso ao módulo Comunicação.' using errcode = '42501';
  end if;
  if v_canal not in ('whatsapp', 'email') then
    raise exception 'Canal inválido: %.', v_canal using errcode = '22023';
  end if;
  if nullif(p ->> 'corpo', '') is null then
    raise exception 'A mensagem está vazia.' using errcode = '23514';
  end if;

  select * into v_contato from public.contatos where id = (p ->> 'contato_id')::uuid;
  if v_contato.id is null then
    raise exception 'Contato não encontrado.' using errcode = 'no_data_found';
  end if;
  select * into v_empresa from public.empresas where id = v_contato.empresa_id;

  v_destino := case when v_canal = 'email' then v_contato.email
                    else coalesce(v_contato.whatsapp, v_contato.telefone) end;
  v_ident := public.app__identificador_canonico(v_canal, v_destino);
  if v_ident is null then
    raise exception 'Este contato não tem % cadastrado.', v_canal using errcode = '23514';
  end if;

  /*
   * SUPRESSÃO CONTINUA RECUSANDO, e passa a ser a única recusa desta função.
   *
   * Ela é a PESSOA pedindo para não receber — nenhuma escolha de quem escreve fura
   * isso, e as duas portas (o destinatário e o CNPJ da empresa) seguem valendo. O
   * cooldown, que ficava logo abaixo, saiu na 0219: era a régua do robô aplicada a
   * quem escreve à mão.
   */
  if exists (
    select 1 from public.supressao s
    where s.valor = v_ident
      and s.escopo = case when v_canal = 'email' then 'email' else 'whatsapp' end
      and (s.expira_em is null or s.expira_em >= current_date)
  ) or exists (
    select 1 from public.supressao s
    where s.escopo = 'empresa' and s.valor = v_empresa.cnpj
      and (s.expira_em is null or s.expira_em >= current_date)
  ) then
    raise exception 'Este destinatário está na lista de supressão.' using errcode = '42501';
  end if;

  -- A recusa por `v_contato.base_legal is null` ficava aqui. O campo continua gravado
  -- e continua decidindo o link de descadastro; ele só não é mais motivo de recusa,
  -- nem aqui, nem no portão do worker, nem no compositor.

  select vc.vendedor_id into v_vendedor
    from public.vendedor_carteira vc
    where vc.empresa_id = v_empresa.id and vc.ate is null
    order by case vc.papel when 'originacao' then 1 when 'sdr' then 2 else 3 end
    limit 1;
  v_vendedor := coalesce(
    (select v.id from public.vendedores v where v.usuario_id = v_ator limit 1),
    v_vendedor
  );

  v_conversa := public.app__conversa_para(v_canal, v_ident, v_empresa.id, v_contato.id, v_vendedor);

  insert into public.mensagens_outbox (
    canal, fornecedor_cnpj, fornecedor_nome, fornecedor_empresa_id,
    destinatario, destinatario_contato_id, destinatario_ponto_focal,
    whatsapp_conta_id, access_keys, assunto, corpo, status,
    conversa_id, empresa_id, vendedor_id, template_id, criada_por, origem,
    funil, funil_card_id, agendada_para, forcar_janela
  ) values (
    v_canal, v_empresa.cnpj, coalesce(v_empresa.razao_social, v_empresa.nome_fantasia), v_empresa.id,
    v_ident, v_contato.id, coalesce(v_contato.ponto_focal, false),
    nullif(p ->> 'whatsapp_conta_id', '')::uuid, '{}',
    nullif(p ->> 'assunto', ''), p ->> 'corpo',
    'aprovada',
    v_conversa, v_empresa.id, v_vendedor, nullif(p ->> 'template_id', '')::uuid, v_ator, 'compositor',
    nullif(p ->> 'funil', ''), nullif(p ->> 'funil_card_id', ''),
    -- `agendada_para` volta a significar SÓ "quando". Forçar a janela pede envio
    -- imediato, e é por isso que ela continua sendo `now()` nesse caso — mas quem
    -- AUTORIZA a furar agora é a coluna ao lado.
    case when v_forcar then now() else null end,
    v_forcar
  ) returning * into v_msg;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'comunicacao.enfileirada', 'mensagens_outbox', v_msg.id::text, p - 'corpo');

  return v_msg;
end $function$;
