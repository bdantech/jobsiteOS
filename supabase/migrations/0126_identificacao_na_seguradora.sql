-- ─── Como nos identificamos para a Atradius ─────────────────────────────────
--
-- Dois campos na linha `atradius` de `credito_config`:
--
-- `organizacao_id` — o customer id da ONE OS na Atradius. Não é secreto (identifica, não
-- autentica), e por isso pode morar aqui em vez de virar mais uma variável por ambiente.
--
-- `uid_type` — como o CNPJ se apresenta na busca de buyer. A API tem um enum FECHADO
-- (VAT, NRN, CR, DB, FC, SN, TK) e `CNPJ` não está nele. Qual dos sete vale para um
-- registro nacional brasileiro é o que falta descobrir.
--
-- É setting, e não constante de código, por causa do modo de falha: errar o uid_type não
-- devolve erro de rota — devolve "buyer não encontrado", que a esteira lê como "não existe
-- na Atradius" e manda para revisão manual. Falha silenciosa numa chamada que pode ser
-- cobrada. Descobrir qual é o certo significa tentar na sandbox, e tentar precisa ser um
-- clique, não um deploy.

update public.credito_config
   set valor = valor || jsonb_build_object(
         'organizacao_id', coalesce(valor ->> 'organizacao_id', '24953910'),
         'uid_type', coalesce(valor ->> 'uid_type', 'NRN')
       ),
       atualizado_em = now()
 where chave = 'atradius';

insert into public.credito_config (chave, valor)
values ('atradius', jsonb_build_object(
  'ambiente', 'sandbox',
  'organizacao_id', '24953910',
  'uid_type', 'NRN',
  'poll_intervalo_horas', 6,
  'validade_padrao_meses', 12
))
on conflict (chave) do nothing;
