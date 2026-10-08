-- ─────────────────────────────────────────────────────────────────────────────
-- 0292 — O áudio do WhatsApp vira texto
--
-- Até aqui um áudio era, para todo leitor de máquina, "(áudio · 17s)". Em 06/10/2026 os
-- 690 áudios recebidos tinham saído da triagem como "outro" — inclusive qualquer pedido de
-- descadastro dito em voz —, e 158 das 463 janelas analisadas pela Qualidade tinham áudio
-- que ninguém leu. São ~1.000 áudios e ~7 horas por mês.
--
-- O worker manda o arquivo (já guardado no bucket `comunicacao-midia` desde a 0164) para a
-- ElevenLabs e grava a fala AO LADO do corpo. `corpo` não muda: é o que chegou, e a bolha
-- continua tocando o áudio. Quem lê para decidir (triagem, agente, análise) junta os dois.
--
-- Só daqui para a frente: os áudios antigos não entram (decisão de 08/10/2026), e por isso
-- `transcricao_status` nulo quer dizer "não pedida", não "pendente".
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.comunicacoes
  add column if not exists transcricao text,
  add column if not exists transcricao_status text,
  add column if not exists transcricao_tentativas smallint not null default 0,
  -- Arrendamento: quem pega a linha empurra isto para a frente, e a varredura só pega o
  -- que venceu. É o que impede o disparo imediato e a varredura de pagarem duas vezes.
  add column if not exists transcricao_tentar_apos timestamptz,
  add column if not exists transcricao_em timestamptz,
  add column if not exists transcricao_modelo text,
  -- O que a ElevenLabs disse ter ouvido: é sobre isto que ela cobra.
  add column if not exists transcricao_segundos numeric,
  add column if not exists transcricao_custo_centavos numeric,
  add column if not exists transcricao_erro text;

alter table public.comunicacoes drop constraint if exists comunicacoes_transcricao_status_check;
alter table public.comunicacoes add constraint comunicacoes_transcricao_status_check
  check (transcricao_status is null or transcricao_status in ('pendente', 'feita', 'vazia', 'falhou', 'ignorada'));

create index if not exists comunicacoes_transcricao_pendente_idx
  on public.comunicacoes (transcricao_tentar_apos nulls first, criado_em)
  where transcricao_status = 'pendente';

comment on column public.comunicacoes.transcricao is
  'Fala do áudio, pela ElevenLabs (0292). O corpo continua sendo o rótulo "(áudio · Ns)"; quem lê para decidir usa textoDaMensagem.';

-- ─── A credencial ───────────────────────────────────────────────────────────
-- CHECK lido do banco vivo em 08/10/2026 (fireflies_api_key, fireflies_webhook_secret,
-- jev_api_key), acrescido de elevenlabs_api_key.

alter table public.qualidade_segredos drop constraint if exists qualidade_segredos_chave_check;
alter table public.qualidade_segredos add constraint qualidade_segredos_chave_check
  check (chave = any (array['fireflies_api_key', 'fireflies_webhook_secret', 'jev_api_key', 'elevenlabs_api_key']));

-- Corpo lido do banco vivo em 08/10/2026; muda só a lista de chaves aceitas.
create or replace function public.app_qualidade_salvar_segredo(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_chave text := p ->> 'chave';
  v_valor text := nullif(btrim(coalesce(p ->> 'valor', '')), '');
  v_atual public.qualidade_segredos;
  v_id uuid;
begin
  perform public.app__qualidade_exige_gestor();
  if v_chave not in ('fireflies_api_key', 'fireflies_webhook_secret', 'jev_api_key', 'elevenlabs_api_key') then
    raise exception 'Segredo desconhecido.' using errcode = '22023';
  end if;
  select * into v_atual from public.qualidade_segredos where chave = v_chave;

  if v_valor is null then
    if v_atual.chave is not null then
      delete from vault.secrets where id = v_atual.secret_id;
      delete from public.qualidade_segredos where chave = v_chave;
    end if;
  elsif v_atual.chave is not null then
    perform vault.update_secret(v_atual.secret_id, v_valor);
    update public.qualidade_segredos set definido_por = auth.uid(), definido_em = now() where chave = v_chave;
  else
    v_id := vault.create_secret(v_valor, 'qualidade_' || v_chave || '_' || extract(epoch from now())::bigint::text,
                                'Inteligência de Conversas (05C): ' || v_chave);
    insert into public.qualidade_segredos (chave, secret_id, definido_por) values (v_chave, v_id, auth.uid());
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (auth.uid(), case when v_valor is null then 'qualidade.segredo_removido' else 'qualidade.segredo_definido' end,
          'qualidade_segredos', v_chave, '{}'::jsonb);
  return jsonb_build_object('chave', v_chave, 'definido', v_valor is not null);
end $function$;

-- ─── A configuração ─────────────────────────────────────────────────────────
-- Corpo lido do banco vivo em 08/10/2026. Acrescenta a chave `transcricao` e, como a
-- captura, recusa ligar sem a credencial: ligada sem chave, cada áudio viraria três
-- tentativas falhas e um "não foi possível transcrever" na tela.

create or replace function public.app_qualidade_salvar_config(p jsonb)
returns public.qualidade_config language plpgsql security definer set search_path = '' as $function$
declare
  v_chave text := p ->> 'chave';
  v_valor jsonb := p -> 'valor';
  v_linha public.qualidade_config;
begin
  perform public.app__qualidade_exige_gestor();
  if v_chave not in ('captura', 'classificacao', 'calibracao', 'janela', 'retencao', 'vinculacao', 'precos', 'transcricao') then
    raise exception 'Chave de configuração desconhecida: %.', v_chave using errcode = '22023';
  end if;
  if v_valor is null or jsonb_typeof(v_valor) <> 'object' then
    raise exception 'Valor inválido.' using errcode = '22023';
  end if;
  if v_chave = 'captura' and coalesce((v_valor ->> 'ligada')::boolean, false)
     and (select count(*) from public.qualidade_segredos
           where chave in ('fireflies_api_key', 'fireflies_webhook_secret')) < 2 then
    raise exception 'Cadastre a chave da API e o segredo do webhook do Fireflies antes de ligar a captura.'
      using errcode = '22023';
  end if;
  if v_chave = 'transcricao' and coalesce((v_valor ->> 'ligada')::boolean, false)
     and not exists (select 1 from public.qualidade_segredos where chave = 'elevenlabs_api_key') then
    raise exception 'Cadastre a chave da API da ElevenLabs antes de ligar a transcrição.'
      using errcode = '22023';
  end if;

  insert into public.qualidade_config as c (chave, valor, atualizado_por, atualizado_em)
  values (v_chave, v_valor, auth.uid(), now())
  on conflict (chave) do update set valor = c.valor || excluded.valor,
    atualizado_por = excluded.atualizado_por, atualizado_em = now()
  returning * into v_linha;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (auth.uid(), 'qualidade.config_salva', 'qualidade_config', v_chave, v_valor);
  return v_linha;
end $function$;

-- ─── A thread mostra a fala ─────────────────────────────────────────────────
-- Corpo lido do banco vivo em 08/10/2026, com as duas colunas novas NO FIM (create or
-- replace não reordena). `security_invoker` reafirmado: sem ele a view ignora a RLS de
-- `comunicacoes` e entrega a conversa de todo mundo a qualquer logado.

create or replace view public.comunicacoes_thread with (security_invoker = true) as
 select c.id,
    c.conversa_id,
    c.empresa_id,
    c.contato_id,
    c.canal,
    c.direcao,
    c.por_ia,
    c.assunto,
    c.corpo,
    c.preview,
    c.anexos,
    c.provedor,
    c.conta_remetente,
    c.status_envio,
    c.erro,
    c.origem,
    c.funil,
    c.funil_card_id,
    c.triagem,
    c.criado_em,
    c.enviado_em,
    e.cnpj as empresa_cnpj,
    coalesce(e.razao_social, e.nome_fantasia) as empresa_nome,
    ct.nome as contato_nome,
    ct.cargo as contato_cargo,
    u.nome as usuario_nome,
    v.nome as vendedor_nome,
    v.is_ia as vendedor_is_ia,
    c.transcricao,
    c.transcricao_status
   from public.comunicacoes c
     left join public.empresas e on e.id = c.empresa_id
     left join public.contatos ct on ct.id = c.contato_id
     left join public.usuarios u on u.id = c.usuario_id
     left join public.vendedores v on v.id = c.vendedor_id;
