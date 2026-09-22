-- 0237 — Mover a oportunidade é a MESMA ação de sempre
--
-- §11 é explícito: não se cria estágio novo nem ação nova. Esta função não cria
-- nenhum dos dois — ela dá às duas fontes novas a ação que a NF já tem, com as
-- mesmas regras, os mesmos estágios e a mesma guarda.
--
-- ── POR QUE NÃO GENERALIZAR `app_mover_estagio_nf` ──────────────────────────
-- Ela devolve `returns notas_fiscais`. Mudar isso quebraria todo chamador, e o
-- funil de NFs não muda (§1). O que se compartilha é a REGRA, e ela está inteira
-- aqui embaixo, escrita igual:
--
--   os sete estágios, e nenhum a mais;
--   "perdida" exige motivo;
--   "em prospecção" NÃO é escolha de ninguém — é FATO, e significa que uma
--   mensagem saiu. Quem sabe disso é o ledger de comunicação, não o vendedor.
--   Deixar o botão faria o funil medir intenção em vez de contato.
create or replace function public.app_mover_oportunidade(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_tipo    text := p ->> 'tipo';
  v_id      text := p ->> 'id';
  v_destino text := p ->> 'estagio_funil';
  v_motivo  text := nullif(p ->> 'perda_motivo', '');
  v_ator    uuid := auth.uid();
  v_antes   text;
  v_empresa uuid;
  v_nome    text;
  v_valor   numeric;
  v_faixa   text;
begin
  if not public.app_tem_modulo('antecipacao') then
    raise exception 'Sem acesso ao módulo Antecipação.' using errcode = '42501';
  end if;

  -- A NF continua sendo movida pela função dela. Aceitar 'nf' aqui criaria um
  -- segundo caminho para a mesma coisa, e dois caminhos divergem.
  if v_tipo not in ('pre_autorizacao', 'titulo') then
    raise exception 'Tipo inválido para esta ação: %. Use app_mover_estagio_nf para notas.', v_tipo
      using errcode = '22023';
  end if;
  if v_destino not in ('a_prospectar', 'em_prospeccao', 'em_negociacao',
                       'antecipacao_andamento', 'convertida', 'perdida', 'expirada') then
    raise exception 'Estágio inválido: %.', v_destino using errcode = '22023';
  end if;
  if v_destino = 'perdida' and v_motivo is null then
    raise exception 'Informe o motivo da perda.' using errcode = '23514';
  end if;

  if v_tipo = 'pre_autorizacao' then
    select estagio_funil, fornecedor_empresa_id,
           coalesce(fornecedor_nome, fornecedor_cnpj), valor, faixa
      into v_antes, v_empresa, v_nome, v_valor, v_faixa
      from public.pre_autorizacoes where id_externo = v_id::int;
  else
    select estagio_funil, credor_empresa_id,
           coalesce(credor_nome, credor_cnpj, 'Credor PF'), valor, faixa
      into v_antes, v_empresa, v_nome, v_valor, v_faixa
      from public.sienge_titulos where id_externo = v_id::int;
  end if;

  if v_antes is null then
    raise exception 'Oportunidade não encontrada.' using errcode = 'no_data_found';
  end if;

  if v_antes = 'a_prospectar' and v_destino = 'em_prospeccao' then
    raise exception 'A oportunidade entra em prospecção sozinha, quando a primeira mensagem sair para o fornecedor.'
      using errcode = '42501';
  end if;

  if v_tipo = 'pre_autorizacao' then
    update public.pre_autorizacoes set
      estagio_funil = v_destino,
      estagio_alterado_em = now(),
      perda_motivo = case when v_destino = 'perdida' then v_motivo else perda_motivo end
    where id_externo = v_id::int;
  else
    update public.sienge_titulos set
      estagio_funil = v_destino,
      estagio_alterado_em = now(),
      perda_motivo = case when v_destino = 'perdida' then v_motivo else perda_motivo end
    where id_externo = v_id::int;
  end if;

  -- O evento vai para a timeline do FORNECEDOR (ou do credor). Sem empresa não há
  -- onde escrever, e isso é comum aqui: credor pessoa física nunca terá ficha.
  if v_empresa is not null then
    insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
    values (
      v_empresa,
      case v_tipo
        when 'pre_autorizacao' then 'preauth.status_alterado'
        else 'titulo.situacao_alterada'
      end,
      jsonb_build_object(
        'titulo', 'Oportunidade ' || v_id || ' — ' || v_destino,
        'resumo', v_nome || ': R$ ' || to_char(v_valor, 'FM999G999G990D00')
                  || ' moveu de ' || v_antes || ' para ' || v_destino
                  || coalesce('. Motivo: ' || v_motivo, '') || '.',
        'url', '/antecipacao?oportunidade=' || v_tipo || ':' || v_id,
        'oportunidade_tipo', v_tipo,
        'oportunidade_id', v_id,
        'de', v_antes,
        'para', v_destino,
        'perda_motivo', v_motivo,
        'faixa', v_faixa,
        'valor', v_valor
      ),
      v_ator
    );
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'funil.estagio_movido',
          case v_tipo when 'pre_autorizacao' then 'pre_autorizacoes' else 'sienge_titulos' end,
          v_id, p);

  return jsonb_build_object('tipo', v_tipo, 'id', v_id, 'de', v_antes, 'para', v_destino);
end; $$;

comment on function public.app_mover_oportunidade(jsonb) is
  'Move uma pré-autorização ou parcela do Sienge no funil, com as MESMAS regras da '
  'NF (04s §11: nenhum estágio novo, nenhuma ação nova). A NF continua sendo movida '
  'por app_mover_estagio_nf.';

grant execute on function public.app_mover_oportunidade(jsonb) to authenticated;
