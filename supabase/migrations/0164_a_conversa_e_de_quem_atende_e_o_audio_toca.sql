-- ============================================================================
-- 0164 — A conversa é de quem atende o número, e o áudio passa a tocar.
--
-- ── §1 CONVERSA SEM EMPRESA NÃO É CONVERSA SEM DONO ────────────────────────
-- A 0162 deixou toda thread sem `responsavel_vendedor_id` visível para o time
-- inteiro, com o argumento de que ninguém é dono do que ainda não foi
-- identificado. O argumento estava errado, e a base mostra por quê: as duas
-- contas de WhatsApp chamam-se "Rodrigo Alves" e "Fabio Pagliarani". São os
-- celulares de duas pessoas. Quem recebeu a mensagem do fornecedor não é
-- "ninguém" — é o dono do número por onde ela entrou.
--
-- A posse passa a ser derivada de TRÊS fontes, e a empresa é só uma delas:
--
--   1. o responsável da carteira, quando a conversa já está vinculada;
--   2. quem ESCREVEU na thread, ainda que a carteira seja de outro (o closer que
--      responde numa conversa aberta pelo SDR não pode perder a própria frase);
--   3. o `usuario_responsavel` do NÚMERO por onde a mensagem passou.
--
-- A exceção que sobra é estreita e encolhe sozinha: thread sem responsável, sem
-- autor e sem número identificável continua visível a todos. São as 158 mensagens
-- que entraram antes desta migração, quando o webhook gravava o `sessionId` do
-- provedor no lugar do número da conta — 48 dígitos que não casam com conta
-- nenhuma. Cada uma se resolve na próxima mensagem que a thread receber.
--
-- ── §2 O ÁUDIO CHEGA CIFRADO ────────────────────────────────────────────────
-- A mídia do WhatsApp é AES-256-CBC num CDN que expira. Guardar a URL faria a
-- thread perder os áudios em semanas; servi-la como veio produz um player mudo.
-- O worker baixa, decifra e grava AQUI — e a policy de leitura do bucket é a
-- mesma da conversa, porque um áudio legível por quem não pode ler a thread seria
-- a permissão do §1 contornada por um link.
-- ============================================================================

-- =============================================================================
-- §1 — De quem é a conversa
-- =============================================================================

/*
 * Todos os donos possíveis de uma thread, sem repetição.
 *
 * `setof uuid` e não um booleano por pessoa: o "ninguém é dono" do §1 precisa ser
 * respondível — e a diferença entre "não é minha" e "não é de ninguém" é o que
 * separa esconder uma negociação de parar a fila de identificação.
 */
create or replace function public.app__donos_da_conversa(p_conversa uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  -- 1. O responsável da carteira.
  select v.usuario_id
    from public.conversas cv
    join public.vendedores v on v.id = cv.responsavel_vendedor_id
   where cv.id = p_conversa and v.usuario_id is not null
  union
  -- 2. Quem escreveu na thread — pelo usuário...
  select m.usuario_id
    from public.comunicacoes m
   where m.conversa_id = p_conversa and m.usuario_id is not null
  union
  --    ...e pelo vendedor, que é como o webhook atribui o que entra.
  select v.usuario_id
    from public.comunicacoes m
    join public.vendedores v on v.id = m.vendedor_id
   where m.conversa_id = p_conversa and v.usuario_id is not null
  union
  -- 3. O dono do NÚMERO por onde a conversa passou. É esta linha que resolve a
  --    conversa não vinculada: o fornecedor escreveu para o celular de alguém.
  select wc.usuario_responsavel
    from public.comunicacoes m
    join public.whatsapp_contas wc on wc.numero = m.conta_remetente
   where m.conversa_id = p_conversa and wc.usuario_responsavel is not null;
$$;

revoke execute on function public.app__donos_da_conversa(uuid) from public, anon;
grant execute on function public.app__donos_da_conversa(uuid) to authenticated, service_role;

/*
 * `bool_or` sobre conjunto vazio devolve NULL, e é justamente esse NULL que
 * carrega a regra: sem nenhum dono, `coalesce` abre para todos. Escrever isso com
 * dois `exists` chamaria a função duas vezes por linha listada — e o inbox lista
 * até duzentas.
 */
create or replace function public.app__conversa_minha(p_conversa uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_conversa is not null and coalesce(
    (select bool_or(d = auth.uid()) from public.app__donos_da_conversa(p_conversa) d),
    true
  );
$$;

-- O join do §1.3 procura a conta pelo número gravado na mensagem.
create index if not exists comunicacoes_conta_conversa_idx
  on public.comunicacoes (conta_remetente, conversa_id) where conta_remetente is not null;
create index if not exists whatsapp_contas_numero_idx on public.whatsapp_contas (numero);

/*
 * O dono do número, quando ele é óbvio.
 *
 * As contas foram cadastradas com o NOME da pessoa no apelido, e ficaram sem
 * `usuario_responsavel` porque a tela nunca ofereceu o campo. Só preenche quando
 * há exatamente UM usuário ativo com aquele nome — duas Marias deixariam a coluna
 * nula, que é o certo: um palpite aqui dá a conversa de um vendedor para outro.
 */
update public.whatsapp_contas wc set usuario_responsavel = (
  select u.id from public.usuarios u
   where u.ativo and lower(btrim(u.nome)) = lower(btrim(wc.apelido))
)
where wc.usuario_responsavel is null
  and (select count(*) from public.usuarios u
        where u.ativo and lower(btrim(u.nome)) = lower(btrim(wc.apelido))) = 1;

-- =============================================================================
-- §2 — A mídia decifrada
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comunicacao-midia', 'comunicacao-midia', false, 26214400, null)
on conflict (id) do nothing;

/*
 * Converter sem estourar. O primeiro segmento do caminho é o id da conversa, mas
 * um objeto com nome fora do padrão faria o `::uuid` derrubar a consulta INTEIRA
 * — e uma policy que às vezes lança exceção é uma policy que às vezes nega tudo.
 */
create or replace function public.app__uuid_ou_nulo(p text)
returns uuid language plpgsql immutable set search_path = '' as $$
begin
  return p::uuid;
exception when others then
  return null;
end $$;

revoke execute on function public.app__uuid_ou_nulo(text) from public, anon;
grant execute on function public.app__uuid_ou_nulo(text) to authenticated, service_role;

/*
 * A MESMA regra da conversa, aplicada ao arquivo.
 *
 * O caminho é `<conversa_id>/<comunicacao_id>.<ext>`, e é isso que permite
 * reaproveitar `app__conversa_minha` aqui. Sem esta policy o §1 seria contornável
 * por um link: quem não pode ler a thread ouviria o áudio dela.
 *
 * Não há INSERT nem UPDATE para `authenticated`. A mídia entra por UM caminho —
 * o worker decifrando o que veio do webhook, com service role — e um upload
 * direto do browser poria na thread um arquivo que ninguém mandou.
 */
create policy comunicacao_midia_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'comunicacao-midia'
    and (select public.app_tem_modulo('comunicacao'))
    and not public.app__conversa_oculta(
      public.app__uuid_ou_nulo((storage.foldername(name))[1])
    )
    and (
      (select public.app_is_admin())
      or public.app__conversa_minha(public.app__uuid_ou_nulo((storage.foldername(name))[1]))
    )
  );

-- =============================================================================
-- §3 — Faxina de grant, aproveitando a passagem
-- =============================================================================

/*
 * `anon` tinha SELECT em `token_secret_id` e `webhook_secret_hash` — o ponteiro
 * para o token do provedor e o hash do segredo de webhook.
 *
 * Não era explorável: as policies de `whatsapp_contas` são todas `to
 * authenticated`, e a RLS barra o anônimo antes do grant importar. Mas um grant
 * que só não vaza porque OUTRA camada segura é o tipo de coisa que deixa de
 * segurar no dia em que alguém escreve uma policy nova sem reparar. Revogar custa
 * uma linha.
 */
revoke select (token_secret_id, webhook_secret_hash) on public.whatsapp_contas from anon;
