-- ═════════════════════════════════════════════════════════════════════════════
-- 0203 — Falar com um cliente não é prospectar a nota dele
--
-- ─── O QUE ACONTECEU ────────────────────────────────────────────────────────
-- 10/09, 13:57:58.856008. O Rodrigo vinculou a Dayane Salles, da RIBEIRO CARAM,
-- a uma conversa de WhatsApp que estava na fila de identificação. No MESMO
-- microssegundo, quatro notas fiscais emitidas pela Ribeiro Caram saltaram de
-- `a_prospectar` para `em_prospeccao`: R$ 14.041.081,89, 18% de todo o valor do
-- funil de originação.
--
-- Ninguém prospectou nada. A conversa era suporte — está no ledger:
--
--     "estamos com alguma operação vencida com vocês?"
--     "a tela fica toda branca, não aparece nem a opção para colocar meu acesso"
--
-- ─── POR QUE ─────────────────────────────────────────────────────────────────
-- `app__primeiro_contato_empresa` varre TODAS as notas em que a empresa é
-- fornecedora e as empurra para "em prospecção". O racional dela está escrito no
-- código e é bom: o card é a nota, mas a conversa é com o fornecedor, e falar com
-- ele sobre uma nota é falar sobre a carteira dele — deixar as irmãs em "a
-- prospectar" faria o funil dizer que ninguém o procurou logo depois de alguém o
-- ter procurado.
--
-- Esse raciocínio vale para um FORNECEDOR que a gente está prospectando. Ele não
-- vale para uma CONTA NOSSA. Com uma conta contratante a gente fala o tempo todo
-- — suporte, cobrança, relacionamento, renovação de limite — e nenhuma dessas
-- conversas é sobre antecipar recebível dela.
--
-- ─── POR QUE A TRAVA É `clientes_onepay` E NÃO O PAPEL NEM O `tipo` ─────────
-- Duas travas óbvias não funcionam, e é importante registrar por quê:
--
--   PELO PAPEL NA NOTA não pega nada. A Ribeiro Caram ERA a fornecedora naquelas
--   quatro notas — foi ela quem emitiu. O que a separa de um fornecedor de
--   verdade não é o papel; é ela já ser conta nossa.
--
--   PELO `empresas.tipo` deixa passar. A CALURE EMPREENDIMENTOS é classificada
--   como `fornecedor` pelo CNAE e é uma conta contratante passiva, com limite na
--   plataforma e zero antecipações como fornecedora. `tipo` vem do CNAE (0194) e
--   descreve a atividade, não a relação.
--
-- O fato confiável é ter CONTA: uma linha em `clientes_onepay` significa limite
-- de crédito aprovado na plataforma, ou seja, contratante. São 55 contas, todas
-- com ficha (`empresa_id` preenchido em 55/55).
--
-- CUSTO MEDIDO: dos 249 fornecedores que já anteciparam, só 3 também têm conta
-- contratante — e nenhum deles tem nota em `a_prospectar` hoje. O funil legítimo
-- (295 fornecedores de mercado, R$ 80,2 mi, mais 18 construtoras que emitem como
-- subempreiteiras, R$ 2,9 mi) não é tocado por esta migração.
--
-- ─── A TRAVA VALE TAMBÉM PARA O CAMINHO EXPLÍCITO ───────────────────────────
-- Eu tinha proposto poupar o caminho preciso — mensagem enviada de DENTRO do card
-- de uma nota (`funil = 'nfs'` + `funil_card_id`), que move só aquela nota — com
-- o argumento de que ali a intenção foi declarada. A régua escolhida foi a mais
-- simples: conta Onepay não muda de estágio por causa de mensagem, ponto.
--
-- E ela é melhor, por um motivo que o argumento da intenção não cobria: a aba
-- Mensagens do card da nota mostra a thread da EMPRESA. Responder dali a um
-- chamado de suporte carimba `funil = 'nfs'` sem que ninguém tenha decidido
-- prospectar coisa alguma — a mesma origem do bug, por uma porta menor.
--
-- O que se perde é pequeno e continua possível: quem realmente quiser prospectar
-- o recebível de um cliente move o card à mão, pelo funil, e aí o movimento tem
-- autor e fica no histórico. Um movimento deliberado registrado é melhor que um
-- implícito.
--
-- ─── O QUE ESTA MIGRAÇÃO NÃO FAZ ────────────────────────────────────────────
-- 1. Não mexe na varredura de `sdr_leads`. O assunto aqui é o funil de notas, e
--    hoje não existe um único lead aberto em `a_contatar` de empresa cliente —
--    mexer nisso seria consertar um problema que ninguém tem com uma regra que
--    ninguém pediu.
--
-- 2. Não mexe na raiz mais funda, que fica anotada: `estagio_funil` nasce
--    `a_prospectar` por DEFAULT para toda nota sincronizada. Os sacados das
--    quatro notas da Ribeiro Caram são AMAZON, HITACHI ENERGY, MANÉ DO BRASIL e
--    SKM TOKIO — não são construtoras, estão fora do recorte, e as quatro têm
--    `faixa` nula (nunca foram pontuadas por regra nenhuma). Elas não deveriam
--    estar no funil de originação em estágio nenhum, nem antes nem depois da
--    conversa. Isso é recorte de ingestão, e merece decisão própria.
-- ═════════════════════════════════════════════════════════════════════════════

-- ─── §1 A pergunta, com um nome ─────────────────────────────────────────────
--
-- Função e não um `exists` repetido nos dois lugares: a regra é uma só e vai ser
-- lida por quem for investigar o funil daqui a seis meses. Um `exists` solto em
-- dois pontos é a chance de um deles mudar sozinho.

create or replace function public.app__e_conta_contratante(p_empresa_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.clientes_onepay c where c.empresa_id = p_empresa_id
  );
$$;

comment on function public.app__e_conta_contratante is
  'A empresa é uma CONTA nossa — contratante com limite aprovado na plataforma. É a '
  'trava do funil de originação: com uma conta a gente fala o tempo todo (suporte, '
  'cobrança, relacionamento) e nenhuma dessas conversas é prospecção do recebível dela. '
  'Não use `empresas.tipo` para isto: ele vem do CNAE e descreve atividade, não relação.';

-- ─── §2 A varredura pula as contas ──────────────────────────────────────────

create or replace function public.app__primeiro_contato_empresa(p_empresa_id uuid)
returns integer language plpgsql security definer set search_path = '' as $function$
declare
  v_movidos int := 0;
  v_n int;
begin
  if p_empresa_id is null then return 0; end if;

  /*
   * NF: o card é a nota, mas a CONVERSA é com o fornecedor. Falar com ele sobre uma
   * nota é falar sobre a carteira dele — deixar as irmãs em "a prospectar" faria o
   * funil dizer que ninguém o procurou, logo depois de alguém o ter procurado.
   *
   * MENOS quando a empresa é conta nossa (0203). Aí a conversa provavelmente não era
   * sobre nota nenhuma, e o palpite "isto foi prospecção" é o palpite errado: com uma
   * conta contratante a gente fala de suporte, de cobrança e de limite. Foi assim que
   * R$ 14 mi entraram no funil porque alguém respondeu a um chamado.
   */
  if not public.app__e_conta_contratante(p_empresa_id) then
    update public.notas_fiscais
      set estagio_funil = 'em_prospeccao', estagio_alterado_em = now()
    where fornecedor_empresa_id = p_empresa_id and estagio_funil = 'a_prospectar';
    get diagnostics v_n = row_count;
    v_movidos := v_movidos + v_n;
  end if;

  /*
   * O funil de SDR continua igual, de propósito. O assunto da 0203 é o funil de notas,
   * e não existe hoje um único lead aberto em `a_contatar` de empresa cliente — a regra
   * que não foi pedida resolveria um problema que ninguém tem.
   */
  update public.sdr_leads
    set estagio = 'em_conversa', ultimo_toque_em = now(), atualizado_em = now()
  where empresa_id = p_empresa_id and estagio = 'a_contatar' and encerrado_em is null;
  get diagnostics v_n = row_count;
  v_movidos := v_movidos + v_n;

  return v_movidos;
end $function$;

-- ─── §3 O caminho explícito também ──────────────────────────────────────────

create or replace function public.comunicacoes__move_o_card()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  /* Só o que realmente foi para a rua. 'pendente' ainda pode falhar, e mover o card
     numa mensagem que não saiu é registrar um contato que não houve. */
  if new.direcao <> 'saida' or coalesce(new.status_envio, 'enviada') not in ('enviada', 'entregue', 'lida') then
    return null;
  end if;

  -- O card exato de onde a mensagem partiu, quando o ledger sabe qual é.
  if new.funil = 'nfs' and new.funil_card_id is not null then
    /*
     * A trava de conta vale AQUI TAMBÉM (0203), e não é excesso de zelo.
     *
     * A aba Mensagens do card da nota mostra a thread da EMPRESA, não uma conversa
     * sobre aquela nota. Responder dali a um chamado de suporte carimba `funil = 'nfs'`
     * na mensagem sem que ninguém tenha decidido prospectar nada — é a mesma origem do
     * bug da varredura, por uma porta menor (uma nota em vez da carteira inteira).
     *
     * Quem realmente quiser trabalhar o recebível de um cliente move o card à mão, e aí
     * o movimento tem autor e fica no histórico.
     */
    update public.notas_fiscais nf
      set estagio_funil = 'em_prospeccao', estagio_alterado_em = now()
    where nf.access_key = new.funil_card_id and nf.estagio_funil = 'a_prospectar'
      and not public.app__e_conta_contratante(nf.fornecedor_empresa_id);
  elsif new.funil = 'sdr' and new.funil_card_id is not null then
    update public.sdr_leads
      set estagio = 'em_conversa', ultimo_toque_em = now(), atualizado_em = now()
    where id = new.funil_card_id::uuid and estagio = 'a_contatar' and encerrado_em is null;
  elsif new.funil = 'fornecedores' and new.funil_card_id is not null then
    update public.fornecedores_funil
      set estagio = 'em_prospeccao', estagio_alterado_em = now()
    where fornecedor_cnpj = new.funil_card_id and estagio = 'a_cadastrar';
  elsif new.empresa_id is not null then
    /* Sem card: a mensagem saiu da ficha da empresa, e "mensagem para a empresa" é o
       que o comportamento pede. A trava de conta mora dentro da função chamada. */
    perform public.app__primeiro_contato_empresa(new.empresa_id);
  end if;

  return null;
end $function$;

-- ─── §4 As quatro notas voltam ──────────────────────────────────────────────
--
-- `estagio_alterado_em` recebe AGORA, e não a data original: a nota está mudando de
-- estágio neste instante, e reescrever o carimbo para 10/09 apagaria o fato de que
-- houve uma correção. O histórico da empresa registra o porquê logo abaixo.
--
-- `conversao_antecipacao_id is null` é o que torna isto seguro: nota que virou
-- antecipação não volta para lugar nenhum, aconteça o que acontecer com a regra.

with corrigidas as (
  update public.notas_fiscais nf
     set estagio_funil = 'a_prospectar', estagio_alterado_em = now()
   where nf.estagio_funil = 'em_prospeccao'
     and nf.conversao_antecipacao_id is null
     and public.app__e_conta_contratante(nf.fornecedor_empresa_id)
  returning nf.access_key, nf.valor, nf.fornecedor_empresa_id
)
insert into public.empresa_eventos (empresa_id, tipo, payload)
select c.fornecedor_empresa_id, 'nf.estagio_alterado',
       jsonb_build_object(
         'titulo', 'Nota devolvida para "A prospectar"',
         'resumo', 'A nota tinha ido para "Em prospecção" por causa de uma conversa de '
                   || 'relacionamento, não de prospecção. Corrigido pela 0203.',
         'url', '/antecipacao',
         'access_key', c.access_key,
         'valor', c.valor,
         'de', 'em_prospeccao',
         'para', 'a_prospectar',
         'origem', 'correcao_0203')
from corrigidas c;
