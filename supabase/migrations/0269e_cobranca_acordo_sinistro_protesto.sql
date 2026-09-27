-- ============================================================================
-- 0269e — Cobrança: acordo, sinistro e protesto
--
-- ── O QUE É CALCULADO FORA DAQUI ────────────────────────────────────────────
-- A atualização da dívida, o parcelamento (Price/SAC) e a perda segurada (§7.3)
-- são TypeScript no core, com testes. As RPCs abaixo GRAVAM o resultado com a
-- memória de cálculo junto — nunca uma referência à configuração vigente: a
-- taxa da casa muda, e a minuta de março continua sendo a de março.
--
-- ── O QUE O WORKER ESCREVE ──────────────────────────────────────────────────
-- PDFs (minuta, notificação, dossiê) e os itens "auto" do checklist do sinistro
-- são gravados pelo service role, que não passa por estas RPCs.
-- ============================================================================

-- ─── §9 Acordo ──────────────────────────────────────────────────────────────

create or replace function public.app_cobranca_salvar_acordo(p jsonb)
returns public.acordos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_c public.cobrancas;
  v_row public.acordos;
begin
  perform public.app_cobranca_exige_modulo();

  select * into v_c from public.cobrancas where id = (p ->> 'cobranca_id')::uuid;
  if v_c.id is null then
    raise exception 'Cobrança não encontrada.' using errcode = 'P0002';
  end if;
  if v_c.estagio in ('rascunho', 'quitada', 'encerrada_perda', 'cancelada') then
    raise exception 'Acordo só com a cobrança em andamento (depois da notificação).' using errcode = '22023';
  end if;
  if jsonb_typeof(p -> 'parcelas') <> 'array' or jsonb_array_length(p -> 'parcelas') = 0 then
    raise exception 'O cronograma de parcelas está vazio.' using errcode = '22023';
  end if;

  insert into public.acordos (
    cobranca_id, valor_atualizado, memoria_calculo, entrada, qtd_parcelas, periodicidade,
    juros_parcelamento_mes, sistema, primeira_parcela, valor_total_projetado, parcelas,
    modelo_minuta_id, dados_minuta, criado_por)
  values (
    v_c.id, (p ->> 'valor_atualizado')::numeric, p -> 'memoria_calculo',
    coalesce((p ->> 'entrada')::numeric, 0), (p ->> 'qtd_parcelas')::int,
    coalesce(nullif(p ->> 'periodicidade', ''), 'mensal'),
    coalesce((p ->> 'juros_parcelamento_mes')::numeric, 0),
    coalesce(nullif(p ->> 'sistema', ''), 'price'),
    nullif(p ->> 'primeira_parcela', '')::date,
    nullif(p ->> 'valor_total_projetado', '')::numeric,
    p -> 'parcelas',
    nullif(p ->> 'modelo_minuta_id', '')::uuid,
    coalesce(p -> 'dados_minuta', '{}'::jsonb),
    v_ator)
  returning * into v_row;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (v_c.sacado_empresa_id, 'cobranca.acordo_simulado', jsonb_build_object(
    'titulo', 'Acordo simulado',
    'resumo', v_row.qtd_parcelas || 'x (' || v_row.sistema || '), total projetado R$ ' ||
              to_char(coalesce(v_row.valor_total_projetado, v_row.valor_atualizado), 'FM999G999G999G990D00') || '.',
    'url', '/cobranca/cobrancas/' || v_c.id,
    'cobranca_id', v_c.id, 'codigo', v_c.codigo, 'acordo_id', v_row.id), v_ator);

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'cobranca.acordo_simulado', 'acordos', v_row.id::text,
          jsonb_build_object('cobranca_id', v_c.id, 'valor_atualizado', v_row.valor_atualizado));

  return v_row;
end;
$$;

-- Os blocos da minuta (avalistas, bem, foro, testemunhas) mudam até a assinatura.
create or replace function public.app_cobranca_dados_minuta(p jsonb)
returns public.acordos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.acordos;
begin
  perform public.app_cobranca_exige_modulo();

  update public.acordos set
    dados_minuta = coalesce(p -> 'dados_minuta', dados_minuta),
    modelo_minuta_id = coalesce(nullif(p ->> 'modelo_minuta_id', '')::uuid, modelo_minuta_id),
    -- mudou o conteúdo: a minuta gerada deixa de valer
    minuta_path = null, minuta_hash = null,
    status = case when status = 'minuta_gerada' then 'simulado' else status end
  where id = (p ->> 'acordo_id')::uuid and status in ('simulado', 'minuta_gerada')
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Acordo não encontrado ou já assinado.' using errcode = 'P0002';
  end if;
  return v_row;
end;
$$;

/*
 * §9.3: o upload do documento assinado é o que move o acordo para `assinado` e a
 * cobrança para `acordo_firmado`. Assinatura eletrônica fica fora de escopo; o
 * que prova o acordo é o arquivo.
 */
create or replace function public.app_cobranca_anexar_acordo_assinado(p jsonb)
returns public.acordos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_row public.acordos;
  v_c public.cobrancas;
  v_path text := nullif(btrim(p ->> 'documento_assinado_path'), '');
begin
  perform public.app_cobranca_exige_modulo();

  select * into v_row from public.acordos where id = (p ->> 'acordo_id')::uuid for update;
  if v_row.id is null then
    raise exception 'Acordo não encontrado.' using errcode = 'P0002';
  end if;
  if v_row.status in ('assinado', 'cancelado') then
    raise exception 'O acordo já está %.', v_row.status using errcode = '22023';
  end if;
  if v_path is null or v_path !~ ('^' || v_row.cobranca_id::text || '/') then
    raise exception 'Anexe o documento assinado na pasta desta cobrança.' using errcode = '42501';
  end if;

  update public.acordos set documento_assinado_path = v_path, status = 'assinado'
  where id = v_row.id returning * into v_row;

  -- os outros cenários simulados deixam de valer
  update public.acordos set status = 'cancelado'
  where cobranca_id = v_row.cobranca_id and id <> v_row.id and status in ('simulado', 'minuta_gerada');

  update public.cobranca_titulos set situacao = 'acordado'
  where cobranca_id = v_row.cobranca_id and situacao in ('em_cobranca', 'protestado');

  -- Judicializada continua judicializada: o acordo nos autos não tira o processo do lugar.
  update public.cobrancas set estagio = 'acordo_firmado'
  where id = v_row.cobranca_id and estagio in ('notificada', 'em_negociacao')
  returning * into v_c;
  if v_c.id is null then
    select * into v_c from public.cobrancas where id = v_row.cobranca_id;
  end if;

  perform public.app__cobranca_talvez_bloquear(v_c.id, v_ator);

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (v_c.sacado_empresa_id, 'cobranca.acordo_assinado', jsonb_build_object(
    'titulo', 'Acordo assinado — ' || v_c.codigo,
    'resumo', v_row.qtd_parcelas || ' parcela(s), total R$ ' ||
              to_char(coalesce(v_row.valor_total_projetado, v_row.valor_atualizado), 'FM999G999G999G990D00') || '.',
    'url', '/cobranca/cobrancas/' || v_c.id,
    'cobranca_id', v_c.id, 'codigo', v_c.codigo, 'acordo_id', v_row.id,
    'destinatarios', case when v_c.responsavel_id is null then '[]'::jsonb else jsonb_build_array(v_c.responsavel_id) end),
    v_ator);

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'cobranca.acordo_assinado', 'acordos', v_row.id::text, p);

  return v_row;
end;
$$;

create or replace function public.app_cobranca_cancelar_acordo(p jsonb)
returns public.acordos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_row public.acordos;
begin
  perform public.app_cobranca_exige_modulo();

  update public.acordos set status = 'cancelado'
  where id = (p ->> 'acordo_id')::uuid and status in ('simulado', 'minuta_gerada')
  returning * into v_row;
  if v_row.id is null then
    raise exception 'Só um acordo não assinado pode ser descartado.' using errcode = '22023';
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'cobranca.acordo_cancelado', 'acordos', v_row.id::text, p);
  return v_row;
end;
$$;

-- ─── §7 Sinistro ────────────────────────────────────────────────────────────

/*
 * O checklist da cl. 22208.00, literal. `obrigatorio = false` para o que é
 * condicional: (e)/(f) só existem se houver título de câmbio ou garantia de
 * terceiro; (h) só na insolvência; (j) só se houver confissão assinada; (p) só
 * quando o cedente foi notificado. Obrigatório sem arquivo precisa de
 * justificativa — e ela entra no corpo do envio.
 */
create or replace function public.app__sinistro_semear_documentos(p_sinistro_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.sinistros;
  v_escopo text;
begin
  select * into v_s from public.sinistros where id = p_sinistro_id;
  select escopo_notificacao into v_escopo from public.cobrancas where id = v_s.cobranca_id;

  insert into public.sinistro_documentos (sinistro_id, item, descricao, obrigatorio, origem)
  values
    (v_s.id, 'a', 'Pedidos/Contratos', true, 'upload'),
    (v_s.id, 'b', 'Termos e condições da venda', true, 'upload'),
    (v_s.id, 'c', 'Faturas (XML/DANFE das NFs)', true, 'sistema'),
    (v_s.id, 'd', 'Comprovante de entrega', true, 'upload'),
    (v_s.id, 'e', 'Letras de câmbio e outros títulos', false, 'upload'),
    (v_s.id, 'f', 'Cópia de garantia de terceiros', false, 'upload'),
    (v_s.id, 'g', 'Correspondência de cobrança, inclusive protesto e SERASA/PFIN', true, 'sistema'),
    (v_s.id, 'h', 'Notificação formal de insolvência', v_s.causa = 'insolvencia', 'sistema'),
    (v_s.id, 'i', 'Registro de dívida', true, 'sistema'),
    (v_s.id, 'j', 'Confirmação de dívida (confissão assinada)', false, 'sistema'),
    (v_s.id, 'k', 'Lista de faturas em aberto', true, 'sistema'),
    (v_s.id, 'l', 'Extrato completo da conta dos 12 meses anteriores ao vencimento', true, 'sistema'),
    (v_s.id, 'm', 'Procuração com cláusula ad judicia', true, 'upload'),
    (v_s.id, 'n', 'Contrato e aditivos de cessão de direitos creditórios registrados em cartório', true, 'upload'),
    (v_s.id, 'o', 'Notificações ao sacado sobre a titularidade do crédito e o não pagamento', true, 'sistema'),
    (v_s.id, 'p', 'Notificação ao cedente pela inadimplência', coalesce(v_escopo = 'sacado_e_cedente', false), 'sistema')
  on conflict (sinistro_id, item) do nothing;
end;
$$;

revoke all on function public.app__sinistro_semear_documentos(uuid) from public, anon, authenticated;
grant execute on function public.app__sinistro_semear_documentos(uuid) to service_role;

create or replace function public.app_sinistro_criar(p jsonb)
returns public.sinistros
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_ids uuid[];
  v_matriz text;
  v_grupos int;
  v_c public.cobrancas;
  v_apolice uuid;
  v_causa text;
  v_perda date;
  v_limite date;
  v_row public.sinistros;
  v_bad text;
begin
  perform public.app_cobranca_exige_modulo();

  if nullif(p ->> 'cobranca_id', '') is not null then
    select * into v_c from public.cobrancas where id = (p ->> 'cobranca_id')::uuid;
    if v_c.id is null then
      raise exception 'Cobrança não encontrada.' using errcode = 'P0002';
    end if;
  end if;

  select array_agg(distinct x::uuid) into v_ids from jsonb_array_elements_text(p -> 'titulo_ids') x;
  if v_ids is null and v_c.id is not null then
    select array_agg(titulo_id) into v_ids from public.cobranca_titulos
    where cobranca_id = v_c.id and situacao in ('em_cobranca', 'acordado', 'protestado');
  end if;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception 'Selecione os títulos do sinistro.' using errcode = '22023';
  end if;

  -- A franquia é POR COMPRADOR (§7.3): um sinistro é de um grupo, consolidado.
  select count(distinct sacado_matriz_cnpj), min(sacado_matriz_cnpj) into v_grupos, v_matriz
  from public.titulos where id = any (v_ids);
  if v_grupos <> 1 then
    raise exception 'Um sinistro é de um único comprador (grupo do sacado).' using errcode = '22023';
  end if;

  select coalesce(t.numero, t.externo_id) into v_bad
  from public.sinistro_titulos st join public.sinistros s on s.id = st.sinistro_id
  join public.titulos t on t.id = st.titulo_id
  where st.titulo_id = any (v_ids) and s.estagio not in ('recusado', 'encerrado')
  limit 1;
  if v_bad is not null then
    raise exception 'O título % já está em outro sinistro.', v_bad using errcode = '23505';
  end if;

  -- Apólice, causa e datas vêm do relógio; na falta, da apólice ativa.
  select ap.apolice_id,
         case when bool_or(ap.causa = 'insolvencia') then 'insolvencia' else 'mora_prolongada' end,
         min(ap.data_perda), min(ap.data_limite_sinistro)
    into v_apolice, v_causa, v_perda, v_limite
  from public.apolice_prazos ap
  where ap.titulo_id = any (v_ids)
  group by ap.apolice_id
  order by count(*) desc
  limit 1;

  if v_apolice is null then
    select id into v_apolice from public.apolices where ativa order by vigencia_inicio desc limit 1;
  end if;
  if v_apolice is null then
    raise exception 'Nenhuma apólice ativa cadastrada.' using errcode = '22023';
  end if;

  insert into public.sinistros (
    codigo, apolice_id, cobranca_id, sacado_matriz_cnpj, sacado_empresa_id, causa, data_perda,
    data_limite_envio, valor_total_face, responsavel_id, criado_por)
  values (
    public.app__cobranca_codigo('SIN'), v_apolice, v_c.id, v_matriz,
    coalesce(v_c.sacado_empresa_id, (select e.id from public.empresas e where e.cnpj = v_matriz)),
    coalesce(nullif(p ->> 'causa', ''), v_causa, 'mora_prolongada'),
    coalesce(nullif(p ->> 'data_perda', '')::date, v_perda, current_date),
    v_limite,
    (select sum(valor_face) from public.titulos where id = any (v_ids)),
    coalesce(nullif(p ->> 'responsavel_id', '')::uuid, v_c.responsavel_id, v_ator),
    v_ator)
  returning * into v_row;

  insert into public.sinistro_titulos (sinistro_id, titulo_id, valor_face, valor_cedido)
  select v_row.id, t.id, t.valor_face, t.valor_cedido from public.titulos t where t.id = any (v_ids);

  update public.apolice_prazos set sinistro_id = v_row.id where titulo_id = any (v_ids) and apolice_id = v_apolice;

  update public.cobranca_titulos set situacao = 'sinistrado'
  where titulo_id = any (v_ids) and situacao in ('em_cobranca', 'acordado', 'protestado');

  perform public.app__sinistro_semear_documentos(v_row.id);

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (v_row.sacado_empresa_id, 'sinistro.criado', jsonb_build_object(
    'titulo', 'Sinistro ' || v_row.codigo || ' aberto',
    'resumo', array_length(v_ids, 1) || ' título(s), R$ ' || to_char(v_row.valor_total_face, 'FM999G999G999G990D00') ||
              '. Data da Perda ' || to_char(v_row.data_perda, 'DD/MM/YYYY') ||
              coalesce('; envio até ' || to_char(v_row.data_limite_envio, 'DD/MM/YYYY'), '') || '.',
    'url', '/cobranca/sinistros/' || v_row.id,
    'sinistro_id', v_row.id, 'codigo', v_row.codigo, 'cobranca_id', v_c.id), v_ator);

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'sinistro.criado', 'sinistros', v_row.id::text, jsonb_build_object('titulos', to_jsonb(v_ids)));

  return v_row;
end;
$$;

create or replace function public.app_sinistro_documento(p jsonb)
returns public.sinistro_documentos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_row public.sinistro_documentos;
  v_acao text := p ->> 'acao';
  v_path text := nullif(btrim(p ->> 'arquivo_path'), '');
begin
  perform public.app_cobranca_exige_modulo();

  select * into v_row from public.sinistro_documentos
  where sinistro_id = (p ->> 'sinistro_id')::uuid and item = p ->> 'item' for update;
  if v_row.id is null then
    raise exception 'Item do checklist não encontrado.' using errcode = 'P0002';
  end if;

  if v_acao = 'anexar' then
    if v_path is null or v_path !~ ('^sinistros/' || v_row.sinistro_id::text || '/') then
      raise exception 'Anexe o arquivo na pasta deste sinistro.' using errcode = '42501';
    end if;
    update public.sinistro_documentos set
      origem = 'upload', arquivo_path = v_path, arquivo_hash = nullif(p ->> 'arquivo_hash', ''),
      justificativa_ausencia = null, status = 'ok', anexado_por = v_ator, anexado_em = now()
    where id = v_row.id returning * into v_row;
  elsif v_acao = 'nao_aplicavel' then
    if v_row.obrigatorio and length(btrim(coalesce(p ->> 'justificativa', ''))) < 5 then
      raise exception 'Item obrigatório só fica de fora com justificativa.' using errcode = '22023';
    end if;
    update public.sinistro_documentos set
      origem = 'nao_aplicavel', justificativa_ausencia = nullif(btrim(p ->> 'justificativa'), ''),
      status = 'nao_aplicavel', anexado_por = v_ator, anexado_em = now()
    where id = v_row.id returning * into v_row;
  elsif v_acao = 'reabrir' then
    update public.sinistro_documentos set
      status = 'pendente', justificativa_ausencia = null,
      origem = case when origem = 'nao_aplicavel' then 'upload' else origem end
    where id = v_row.id returning * into v_row;
  else
    raise exception 'Ação inválida.' using errcode = '22023';
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'sinistro.documento_' || v_acao, 'sinistro_documentos', v_row.id::text, p);

  return v_row;
end;
$$;

create or replace function public.app_sinistro_estimativa(p jsonb)
returns public.sinistros
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.sinistros;
begin
  perform public.app_cobranca_exige_modulo();

  update public.sinistros set
    perda_segurada_estimada = (p ->> 'perda_segurada_estimada')::numeric,
    indenizacao_estimada = (p ->> 'indenizacao_estimada')::numeric,
    valor_recebido_parcial = coalesce((p ->> 'valor_recebido_parcial')::numeric, valor_recebido_parcial),
    memoria_perda = p -> 'memoria_perda'
  where id = (p ->> 'sinistro_id')::uuid
  returning * into v_row;
  if v_row.id is null then
    raise exception 'Sinistro não encontrado.' using errcode = 'P0002';
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (auth.uid(), 'sinistro.estimativa', 'sinistros', v_row.id::text, p - 'memoria_perda');
  return v_row;
end;
$$;

/*
 * O andamento do sinistro. Duas regras que o botão não pode pular:
 *   • `enviado` exige o checklist fechado (obrigatório com arquivo ou justificado)
 *     e a prova de entrega de cada notificação enviada — ou a justificativa da
 *     ausência, que vai no corpo do envio (§4).
 *   • `notificado` grava o D+90 cumprido em todos os prazos dos títulos.
 * O modo `api` muda o transporte, nunca o prazo: esta RPC é o mesmo caminho
 * para os dois, e o protocolo colado à mão vale tanto quanto o da API.
 */
create or replace function public.app_sinistro_mover(p jsonb)
returns public.sinistros
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_s public.sinistros;
  v_para text := p ->> 'estagio';
  v_data date := coalesce(nullif(p ->> 'data', '')::date, current_date);
  v_pendentes text;
  v_sem_prova int;
  v_tipo_evento text;
begin
  perform public.app_cobranca_exige_modulo();

  select * into v_s from public.sinistros where id = (p ->> 'sinistro_id')::uuid for update;
  if v_s.id is null then
    raise exception 'Sinistro não encontrado.' using errcode = 'P0002';
  end if;
  if v_s.estagio in ('indenizado', 'encerrado') then
    raise exception 'O sinistro está encerrado.' using errcode = '22023';
  end if;

  if v_para = 'enviado' then
    select string_agg(item || ') ' || descricao, '; ' order by item) into v_pendentes
    from public.sinistro_documentos
    where sinistro_id = v_s.id and obrigatorio and status = 'pendente';
    if v_pendentes is not null then
      raise exception 'Checklist incompleto: %.', v_pendentes using errcode = '22023';
    end if;

    select count(*) into v_sem_prova
    from public.cobranca_notificacoes n
    where n.cobranca_id = v_s.cobranca_id
      and n.status in ('enviada', 'entregue', 'respondida')
      and not exists (select 1 from public.cobranca_notificacao_entregas e
                      where e.notificacao_id = n.id and e.status = 'entregue');
    if v_sem_prova > 0 and length(btrim(coalesce(p ->> 'justificativa_prova_entrega', v_s.justificativa_prova_entrega, ''))) < 10 then
      raise exception '% notificação(ões) sem prova de entrega. Registre o AR/certidão ou justifique a ausência.', v_sem_prova
        using errcode = '22023';
    end if;
  end if;

  if v_para = 'recusado' and nullif(btrim(p ->> 'motivo_recusa'), '') is null then
    raise exception 'Informe o motivo da recusa.' using errcode = '22023';
  end if;
  if v_para = 'indenizado' and nullif(p ->> 'indenizacao_recebida', '') is null then
    raise exception 'Informe o valor da indenização recebida.' using errcode = '22023';
  end if;
  if v_para not in ('notificado', 'enviado', 'em_analise', 'docs_pendentes', 'aceito', 'recusado', 'indenizado', 'encerrado') then
    raise exception 'Estágio inválido.' using errcode = '22023';
  end if;

  update public.sinistros set
    estagio = v_para,
    notificado_em = case when v_para = 'notificado' then v_data else notificado_em end,
    enviado_em = case when v_para = 'enviado' then v_data else enviado_em end,
    resposta_prevista_em = case when v_para = 'enviado' then v_data + 120 else resposta_prevista_em end,
    respondido_em = case when v_para in ('aceito', 'recusado') then v_data else respondido_em end,
    motivo_recusa = case when v_para = 'recusado' then btrim(p ->> 'motivo_recusa') else motivo_recusa end,
    indenizacao_recebida = case when v_para = 'indenizado' then (p ->> 'indenizacao_recebida')::numeric else indenizacao_recebida end,
    protocolo_externo = coalesce(nullif(btrim(p ->> 'protocolo_externo'), ''), protocolo_externo),
    modo_envio = coalesce(nullif(p ->> 'modo_envio', ''), modo_envio),
    justificativa_prova_entrega = coalesce(nullif(btrim(p ->> 'justificativa_prova_entrega'), ''), justificativa_prova_entrega)
  where id = v_s.id
  returning * into v_s;

  if v_para = 'notificado' then
    update public.apolice_prazos set notificado_seguradora_em = v_data where sinistro_id = v_s.id;
  elsif v_para = 'enviado' then
    update public.apolice_prazos set notificado_seguradora_em = coalesce(notificado_seguradora_em, v_data)
    where sinistro_id = v_s.id;
  elsif v_para in ('indenizado', 'encerrado') then
    update public.apolice_prazos set status = 'cumprido' where sinistro_id = v_s.id and status = 'ativo';
  end if;

  v_tipo_evento := case v_para
    when 'notificado' then 'sinistro.notificado' when 'enviado' then 'sinistro.enviado'
    when 'aceito' then 'sinistro.aceito' when 'recusado' then 'sinistro.recusado'
    when 'indenizado' then 'sinistro.indenizado' else 'sinistro.estagio_alterado' end;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (v_s.sacado_empresa_id, v_tipo_evento, jsonb_build_object(
    'titulo', 'Sinistro ' || v_s.codigo || ' — ' || replace(v_para, '_', ' '),
    'resumo', case v_para
      when 'notificado' then 'Seguradora notificada do inadimplemento em ' || to_char(v_data, 'DD/MM/YYYY') || '.'
      when 'enviado' then 'Sinistro enviado em ' || to_char(v_data, 'DD/MM/YYYY') || '; resposta prevista até ' ||
                          to_char(v_s.resposta_prevista_em, 'DD/MM/YYYY') || '.'
      when 'recusado' then 'Recusado: ' || v_s.motivo_recusa
      when 'indenizado' then 'Indenização de R$ ' || to_char(v_s.indenizacao_recebida, 'FM999G999G999G990D00') || ' recebida.'
      else 'Estágio: ' || replace(v_para, '_', ' ') || '.' end,
    'url', '/cobranca/sinistros/' || v_s.id,
    'sinistro_id', v_s.id, 'codigo', v_s.codigo,
    'destinatarios', case when v_s.responsavel_id is null then '[]'::jsonb else jsonb_build_array(v_s.responsavel_id) end),
    v_ator);

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'sinistro.' || v_para, 'sinistros', v_s.id::text, p);

  return v_s;
end;
$$;

create or replace function public.app_sinistro_solicitacao(p jsonb)
returns public.sinistro_solicitacoes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_row public.sinistro_solicitacoes;
  v_s public.sinistros;
  v_dias int;
begin
  perform public.app_cobranca_exige_modulo();

  if nullif(p ->> 'id', '') is not null then
    update public.sinistro_solicitacoes set
      respondida_em = coalesce(nullif(p ->> 'respondida_em', '')::date, current_date), status = 'respondida'
    where id = (p ->> 'id')::uuid and status <> 'respondida'
    returning * into v_row;
    if v_row.id is null then
      raise exception 'Solicitação não encontrada ou já respondida.' using errcode = 'P0002';
    end if;
    -- respondidas todas, o sinistro volta para análise
    update public.sinistros set estagio = 'em_analise'
    where id = v_row.sinistro_id and estagio = 'docs_pendentes'
      and not exists (select 1 from public.sinistro_solicitacoes where sinistro_id = v_row.sinistro_id and status = 'aberta');
    return v_row;
  end if;

  select * into v_s from public.sinistros where id = (p ->> 'sinistro_id')::uuid;
  if v_s.id is null then
    raise exception 'Sinistro não encontrado.' using errcode = 'P0002';
  end if;
  select prazo_documentos_complementares_dias into v_dias from public.apolices where id = v_s.apolice_id;

  insert into public.sinistro_solicitacoes (sinistro_id, descricao, solicitada_em, prazo_em)
  values (v_s.id, btrim(p ->> 'descricao'),
          coalesce(nullif(p ->> 'solicitada_em', '')::date, current_date),
          coalesce(nullif(p ->> 'solicitada_em', '')::date, current_date) + coalesce(v_dias, 30))
  returning * into v_row;

  update public.sinistros set estagio = 'docs_pendentes' where id = v_s.id and estagio in ('enviado', 'em_analise');

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (v_s.sacado_empresa_id, 'sinistro.doc_solicitado', jsonb_build_object(
    'titulo', 'Seguradora pediu documento — ' || v_s.codigo,
    'resumo', left(v_row.descricao, 200) || ' Prazo: ' || to_char(v_row.prazo_em, 'DD/MM/YYYY') || '.',
    'url', '/cobranca/sinistros/' || v_s.id,
    'sinistro_id', v_s.id, 'codigo', v_s.codigo,
    'destinatarios', case when v_s.responsavel_id is null then '[]'::jsonb else jsonb_build_array(v_s.responsavel_id) end),
    v_ator);

  return v_row;
end;
$$;

create or replace function public.app_sinistro_custo(p jsonb)
returns public.sinistro_custos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_row public.sinistro_custos;
  v_path text := nullif(btrim(p ->> 'comprovante_path'), '');
begin
  perform public.app_cobranca_exige_modulo();

  if v_path is not null and v_path !~ '^(sinistros/)?[0-9a-f-]{36}/' then
    raise exception 'Comprovante fora das pastas da cobrança.' using errcode = '42501';
  end if;
  if (p ->> 'aprovado_pela_seguradora')::boolean and nullif(btrim(p ->> 'aprovacao_referencia'), '') is null then
    raise exception 'Informe a referência da aprovação prévia (e-mail ou protocolo).' using errcode = '22023';
  end if;

  insert into public.sinistro_custos (
    sinistro_id, cobranca_id, descricao, valor, data, aprovado_pela_seguradora, aprovacao_referencia,
    comprovante_path, criado_por)
  values (
    nullif(p ->> 'sinistro_id', '')::uuid, nullif(p ->> 'cobranca_id', '')::uuid,
    btrim(p ->> 'descricao'), (p ->> 'valor')::numeric, coalesce(nullif(p ->> 'data', '')::date, current_date),
    coalesce((p ->> 'aprovado_pela_seguradora')::boolean, false),
    nullif(btrim(p ->> 'aprovacao_referencia'), ''), v_path, v_ator)
  returning * into v_row;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'sinistro.custo_registrado', 'sinistro_custos', v_row.id::text, p);
  return v_row;
end;
$$;

-- ─── §8 Protesto ────────────────────────────────────────────────────────────

create or replace function public.app_protesto_criar_remessa(p jsonb)
returns public.protesto_remessas
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_c public.cobrancas;
  v_ids uuid[];
  v_row public.protesto_remessas;
  v_bad int;
begin
  perform public.app_cobranca_exige_modulo();

  select * into v_c from public.cobrancas where id = (p ->> 'cobranca_id')::uuid;
  if v_c.id is null then
    raise exception 'Cobrança não encontrada.' using errcode = 'P0002';
  end if;
  if v_c.estagio in ('rascunho', 'quitada', 'encerrada_perda', 'cancelada') then
    raise exception 'Protesto só depois da notificação e com a cobrança em andamento.' using errcode = '22023';
  end if;

  select array_agg(distinct x::uuid) into v_ids from jsonb_array_elements_text(p -> 'cobranca_titulo_ids') x;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception 'Selecione os títulos a protestar.' using errcode = '22023';
  end if;

  select count(*) into v_bad from public.cobranca_titulos
  where id = any (v_ids) and (cobranca_id <> v_c.id or situacao not in ('em_cobranca', 'acordado', 'sinistrado'));
  if v_bad > 0 then
    raise exception 'Há título fora da cobrança, quitado ou já em protesto.' using errcode = '22023';
  end if;

  insert into public.protesto_remessas (cobranca_id, tipo, uf, cra, modo, criado_por)
  values (v_c.id, 'apresentacao', upper(btrim(p ->> 'uf')), btrim(p ->> 'cra'),
          coalesce(nullif(p ->> 'modo', ''), 'portal_manual'), v_ator)
  returning * into v_row;

  insert into public.protesto_titulos (remessa_id, cobranca_titulo_id)
  select v_row.id, unnest(v_ids);

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'protesto.remessa_criada', 'protesto_remessas', v_row.id::text, p);

  return v_row;
end;
$$;

create or replace function public.app_protesto_anexar_arquivo(p jsonb)
returns public.protesto_remessas
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.protesto_remessas;
  v_path text := nullif(btrim(p ->> 'arquivo_path'), '');
  v_retorno text := nullif(btrim(p ->> 'retorno_path'), '');
begin
  perform public.app_cobranca_exige_modulo();

  select * into v_row from public.protesto_remessas where id = (p ->> 'remessa_id')::uuid for update;
  if v_row.id is null then
    raise exception 'Remessa não encontrada.' using errcode = 'P0002';
  end if;
  if coalesce(v_path, v_retorno) !~ ('^' || v_row.cobranca_id::text || '/protestos/') then
    raise exception 'Arquivo fora da pasta de protestos desta cobrança.' using errcode = '42501';
  end if;

  update public.protesto_remessas set
    arquivo_path = coalesce(v_path, arquivo_path),
    retorno_path = coalesce(v_retorno, retorno_path)
  where id = v_row.id returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.app_protesto_marcar_enviada(p jsonb)
returns public.protesto_remessas
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_row public.protesto_remessas;
  v_c public.cobrancas;
begin
  perform public.app_cobranca_exige_modulo();

  update public.protesto_remessas set
    status = 'enviada',
    protocolo = coalesce(nullif(btrim(p ->> 'protocolo'), ''), protocolo),
    enviada_em = coalesce(nullif(p ->> 'enviada_em', '')::timestamptz, now())
  where id = (p ->> 'remessa_id')::uuid and status = 'rascunho'
  returning * into v_row;
  if v_row.id is null then
    raise exception 'Remessa não encontrada ou já enviada.' using errcode = 'P0002';
  end if;

  select * into v_c from public.cobrancas where id = v_row.cobranca_id;

  if v_row.tipo = 'apresentacao' then
    update public.cobranca_titulos set situacao = 'protestado'
    where id in (select cobranca_titulo_id from public.protesto_titulos where remessa_id = v_row.id)
      and situacao in ('em_cobranca', 'acordado');
  else
    -- desistência/cancelamento: a instrução ENVIADA é o que a regularização exige
    update public.protesto_titulos pt set instrucao_cancelamento_em = v_row.enviada_em, atualizado_em = now()
    from public.protesto_remessas r
    where r.id = pt.remessa_id and r.tipo = 'apresentacao' and r.cobranca_id = v_row.cobranca_id
      and pt.cobranca_titulo_id in (select cobranca_titulo_id from public.protesto_titulos where remessa_id = v_row.id)
      and pt.instrucao_cancelamento_em is null;
  end if;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (v_c.sacado_empresa_id,
          case when v_row.tipo = 'apresentacao' then 'protesto.remessa_enviada' else 'protesto.instrucao_cancelamento' end,
          jsonb_build_object(
            'titulo', case when v_row.tipo = 'apresentacao' then 'Remessa de protesto enviada'
                           else 'Instrução de ' || v_row.tipo || ' de protesto enviada' end,
            'resumo', v_row.cra || ' (' || v_row.uf || ')' || coalesce(', protocolo ' || v_row.protocolo, '') || '.',
            'url', '/cobranca/cobrancas/' || v_c.id,
            'cobranca_id', v_c.id, 'codigo', v_c.codigo, 'remessa_id', v_row.id), v_ator);

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'protesto.remessa_enviada', 'protesto_remessas', v_row.id::text, p);

  return v_row;
end;
$$;

create or replace function public.app__protesto_atualizar_titulo(p jsonb, p_ator uuid)
returns public.protesto_titulos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.protesto_titulos;
  v_antes text;
  v_c public.cobrancas;
  v_cert text := nullif(btrim(p ->> 'certidao_path'), '');
begin
  select * into v_row from public.protesto_titulos where id = (p ->> 'protesto_titulo_id')::uuid for update;
  if v_row.id is null then
    raise exception 'Título de protesto não encontrado.' using errcode = 'P0002';
  end if;
  v_antes := v_row.situacao;

  select c.* into v_c from public.protesto_remessas r join public.cobrancas c on c.id = r.cobranca_id
  where r.id = v_row.remessa_id;

  if v_cert is not null and v_cert !~ ('^' || v_c.id::text || '/') then
    raise exception 'Certidão fora da pasta desta cobrança.' using errcode = '42501';
  end if;

  update public.protesto_titulos set
    situacao = coalesce(nullif(p ->> 'situacao', ''), situacao),
    cartorio = coalesce(nullif(btrim(p ->> 'cartorio'), ''), cartorio),
    protocolo_cartorio = coalesce(nullif(btrim(p ->> 'protocolo_cartorio'), ''), protocolo_cartorio),
    data_protesto = coalesce(nullif(p ->> 'data_protesto', '')::date, data_protesto),
    certidao_path = coalesce(v_cert, certidao_path),
    custas = coalesce(nullif(p ->> 'custas', '')::numeric, custas),
    motivo_rejeicao = coalesce(nullif(btrim(p ->> 'motivo_rejeicao'), ''), motivo_rejeicao),
    atualizado_em = now()
  where id = v_row.id returning * into v_row;

  if v_row.situacao <> v_antes and v_row.situacao in ('apontado', 'protestado', 'retirado', 'pago_em_cartorio') then
    insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
    values (v_c.sacado_empresa_id,
            case v_row.situacao when 'apontado' then 'protesto.apontado' when 'protestado' then 'protesto.protestado'
                                else 'protesto.retirado' end,
            jsonb_build_object(
              'titulo', 'Protesto ' || replace(v_row.situacao, '_', ' '),
              'resumo', coalesce(v_row.cartorio, 'Cartório') || coalesce(' — protocolo ' || v_row.protocolo_cartorio, '') ||
                        coalesce(', em ' || to_char(v_row.data_protesto, 'DD/MM/YYYY'), '') || '.',
              'url', '/cobranca/cobrancas/' || v_c.id,
              'cobranca_id', v_c.id, 'codigo', v_c.codigo, 'protesto_titulo_id', v_row.id,
              'destinatarios', case when v_c.responsavel_id is null then '[]'::jsonb else jsonb_build_array(v_c.responsavel_id) end),
            p_ator);
  end if;

  -- pago em cartório é quitação
  if v_row.situacao = 'pago_em_cartorio' and v_antes <> 'pago_em_cartorio' then
    update public.cobranca_titulos set situacao = 'quitado', quitado_em = coalesce(v_row.data_protesto, current_date),
      quitado_origem = 'manual', valor_recebido = coalesce(valor_recebido, valor_face_snapshot)
    where id = v_row.cobranca_titulo_id and situacao not in ('quitado', 'retirado');
    update public.protesto_titulos set instrucao_nao_aplicavel_motivo = 'Pago em cartório: o próprio cartório baixa o protesto.'
    where id = v_row.id;
  end if;

  return v_row;
end;
$$;

revoke all on function public.app__protesto_atualizar_titulo(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.app__protesto_atualizar_titulo(jsonb, uuid) to service_role;

create or replace function public.app_protesto_atualizar_titulo(p jsonb)
returns public.protesto_titulos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.protesto_titulos;
begin
  perform public.app_cobranca_exige_modulo();
  v_row := public.app__protesto_atualizar_titulo(p, auth.uid());
  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (auth.uid(), 'protesto.titulo_atualizado', 'protesto_titulos', v_row.id::text, p);
  return v_row;
end;
$$;

-- O retorno do CRA, já lido pelo parser do core: aplica linha a linha na mesma transação.
create or replace function public.app_protesto_processar_retorno(p jsonb)
returns public.protesto_remessas
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_row public.protesto_remessas;
  v_l jsonb;
  v_rejeitadas int;
begin
  perform public.app_cobranca_exige_modulo();

  select * into v_row from public.protesto_remessas where id = (p ->> 'remessa_id')::uuid for update;
  if v_row.id is null then
    raise exception 'Remessa não encontrada.' using errcode = 'P0002';
  end if;

  for v_l in select * from jsonb_array_elements(p -> 'linhas') loop
    if not exists (select 1 from public.protesto_titulos
                   where id = (v_l ->> 'protesto_titulo_id')::uuid and remessa_id = v_row.id) then
      raise exception 'Linha do retorno aponta para título de outra remessa.' using errcode = '22023';
    end if;
    perform public.app__protesto_atualizar_titulo(v_l, v_ator);
  end loop;

  select count(*) into v_rejeitadas from public.protesto_titulos where remessa_id = v_row.id and situacao = 'rejeitado';

  update public.protesto_remessas set
    retorno_path = coalesce(nullif(btrim(p ->> 'retorno_path'), ''), retorno_path),
    retorno_processado_em = now(),
    status = case when v_rejeitadas > 0
                   and v_rejeitadas = (select count(*) from public.protesto_titulos where remessa_id = v_row.id)
                  then 'rejeitada' else 'confirmada' end
  where id = v_row.id returning * into v_row;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'protesto.retorno_processado', 'protesto_remessas', v_row.id::text,
          jsonb_build_object('linhas', jsonb_array_length(p -> 'linhas')));

  return v_row;
end;
$$;

/*
 * §8/§11: a retirada é obrigatória depois da quitação. Duas saídas: uma remessa de
 * cancelamento (rascunho, a pessoa envia pelo portal e marca enviada) ou "não se
 * aplica" com motivo (ex.: o título foi rejeitado pelo cartório e nunca protestou).
 */
create or replace function public.app_protesto_instrucao_cancelamento(p jsonb)
returns public.protesto_remessas
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_c public.cobrancas;
  v_ids uuid[];
  v_motivo text := nullif(btrim(p ->> 'nao_aplicavel_motivo'), '');
  v_row public.protesto_remessas;
  v_uf text;
  v_cra text;
begin
  perform public.app_cobranca_exige_modulo();

  select * into v_c from public.cobrancas where id = (p ->> 'cobranca_id')::uuid;
  select array_agg(distinct x::uuid) into v_ids from jsonb_array_elements_text(p -> 'protesto_titulo_ids') x;
  if v_c.id is null or coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception 'Informe a cobrança e os protestos.' using errcode = '22023';
  end if;
  if exists (select 1 from public.protesto_titulos pt join public.protesto_remessas r on r.id = pt.remessa_id
             where pt.id = any (v_ids) and (r.cobranca_id <> v_c.id or r.tipo <> 'apresentacao')) then
    raise exception 'Protesto de outra cobrança.' using errcode = '22023';
  end if;

  if v_motivo is not null then
    update public.protesto_titulos set instrucao_nao_aplicavel_motivo = v_motivo, atualizado_em = now()
    where id = any (v_ids);
    insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
    values (v_ator, 'protesto.retirada_nao_aplicavel', 'cobrancas', v_c.id::text, p);
    return null;
  end if;

  select r.uf, r.cra into v_uf, v_cra
  from public.protesto_titulos pt join public.protesto_remessas r on r.id = pt.remessa_id
  where pt.id = v_ids[1];

  insert into public.protesto_remessas (cobranca_id, tipo, uf, cra, modo, criado_por)
  values (v_c.id, coalesce(nullif(p ->> 'tipo', ''), 'cancelamento'), v_uf, v_cra, 'portal_manual', v_ator)
  returning * into v_row;

  insert into public.protesto_titulos (remessa_id, cobranca_titulo_id, cartorio, protocolo_cartorio, situacao)
  select v_row.id, pt.cobranca_titulo_id, pt.cartorio, pt.protocolo_cartorio, pt.situacao
  from public.protesto_titulos pt where pt.id = any (v_ids);

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'protesto.instrucao_cancelamento_criada', 'protesto_remessas', v_row.id::text, p);

  return v_row;
end;
$$;

-- ─── Grants ─────────────────────────────────────────────────────────────────

do $$
declare
  f text;
begin
  foreach f in array array[
    'app_cobranca_salvar_acordo(jsonb)', 'app_cobranca_dados_minuta(jsonb)',
    'app_cobranca_anexar_acordo_assinado(jsonb)', 'app_cobranca_cancelar_acordo(jsonb)',
    'app_sinistro_criar(jsonb)', 'app_sinistro_documento(jsonb)', 'app_sinistro_estimativa(jsonb)',
    'app_sinistro_mover(jsonb)', 'app_sinistro_solicitacao(jsonb)', 'app_sinistro_custo(jsonb)',
    'app_protesto_criar_remessa(jsonb)', 'app_protesto_anexar_arquivo(jsonb)', 'app_protesto_marcar_enviada(jsonb)',
    'app_protesto_atualizar_titulo(jsonb)', 'app_protesto_processar_retorno(jsonb)',
    'app_protesto_instrucao_cancelamento(jsonb)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;
