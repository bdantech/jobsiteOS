-- ═════════════════════════════════════════════════════════════════════════════
-- 0206 — O CNPJ diz se a segunda linha é uma SPE (ou só o mesmo nome de novo)
--
-- ─── O SINTOMA ──────────────────────────────────────────────────────────────
-- O card da nota mostra a CONTA em cima e, embaixo, "via {sacado}" — a SPE
-- contra a qual a nota foi emitida. A segunda linha só deveria existir quando as
-- duas são empresas diferentes, e a regra que decidia isso era comparar os dois
-- NOMES:
--
--     const spe = conta && conta !== nomeSacado ? nomeSacado : null
--
-- Só que os dois nomes vêm de lugares diferentes. `conta` é a razão social do
-- nosso cadastro; `notas_fiscais.sacado_nome` é o que o FORNECEDOR digitou no
-- XML da NF-e. Eles quase nunca batem caractere a caractere:
--
--     RIBEIRO CARAM                ←→  CONSTRUTORA RIBEIRO CARAM LTDA.
--     RIBEIRO CARAM                ←→  CONSTRUTURA RIBERIO CARAM LTDA   (sic)
--     HALSTEN INCORPORADORA LTDA   ←→  HALSTEN INCORPARADORA LTDA       (sic)
--     HALSTEN INCORPORADORA LTDA   ←→  HALSTEN INCORPORADORA - SEDE
--     CALURE EMPREENDIMENTOS LTDA  ←→  Calure empreendimentos ltda
--     A.F. CONSTRUCOES E EMPRE...  ←→  AF CONSTRUES E EMPREENDIMENTOS LTDA
--
-- Em todos esses o `sacado_cnpj` da nota é o CNPJ da própria conta: não existe
-- SPE nenhuma. O card mostrava o nome da construtora e, logo abaixo, "via" a
-- mesma construtora escrita errado — barulho que ocupa uma linha e ensina a
-- ignorar a linha.
--
-- Medido no funil de hoje: de 101 pares com mesmo CNPJ, só 16 batiam como texto.
-- Os outros 85 mostravam a segunda linha à toa. Os 89 pares de outra raiz (SPE
-- de verdade) continuam mostrando as duas, como devem.
--
-- ─── A CORREÇÃO É TROCAR O CRITÉRIO, NÃO NORMALIZAR O TEXTO ────────────────
-- Dava para comparar sem acento, sem pontuação e em maiúsculas, e ainda assim
-- "CONSTRUTURA RIBERIO CARAM" não casaria com "RIBEIRO CARAM" — e nenhuma régua
-- de similaridade deveria decidir se duas empresas são a mesma quando o CNPJ,
-- que é a resposta exata, está ali do lado.
--
-- A função passa a devolver `conta_cnpj`. A tela compara CNPJ com CNPJ: mesma
-- pessoa jurídica, uma linha; pessoas diferentes, duas. O nome digitado no XML
-- deixa de ter voto sobre isso — ele continua aparecendo, mas só quando há mesmo
-- uma segunda empresa para nomear.
--
-- ─── POR QUE `drop` ANTES ───────────────────────────────────────────────────
-- `create or replace` não muda a lista de colunas de uma função que devolve
-- TABLE. O drop é obrigatório, e por isso o grant é reaplicado no fim.
-- ═════════════════════════════════════════════════════════════════════════════

drop function if exists public.app_contas_dos_sacados(text[]);

create or replace function public.app_contas_dos_sacados(p_cnpjs text[])
returns table (cnpj text, conta_id uuid, conta_nome text, conta_fantasia text, conta_cnpj text)
language plpgsql stable security definer set search_path = '' as $function$
begin
  if not (public.app_tem_modulo('antecipacao') or public.app_tem_modulo('comercial')) then
    raise exception 'Sem acesso aos módulos Antecipação ou Comercial.' using errcode = '42501';
  end if;

  return query
    select c.cnpj, e.id, e.razao_social, e.nome_fantasia,
           /*
            * O CNPJ da conta é o que decide se o sacado da nota é a própria empresa
            * ou uma SPE dela. Comparar os NOMES não funciona: o da conta é o nosso
            * cadastro e o do sacado é o que o fornecedor digitou no XML — e ele vem
            * com prefixo, com sufixo, em minúsculas e com erro de digitação.
            */
           e.cnpj
      from unnest(p_cnpjs[1:500]) as c(cnpj)
      left join public.empresas e on e.id = public.app_holding_do_sacado(c.cnpj);
end $function$;

comment on function public.app_contas_dos_sacados is
  'CNPJ do sacado → a CONTA a que ele pertence (holding/cliente), com o CNPJ dela. '
  'O `conta_cnpj` existe para a tela saber se o sacado É a conta (uma linha) ou uma SPE '
  'dela (duas) — comparação por nome erra, porque o nome do sacado vem do XML da NF-e.';

grant execute on function public.app_contas_dos_sacados(text[]) to authenticated;
