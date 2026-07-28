-- 0060 — Quem tem Antecipação enxerga o cadastro dos CNPJs que aparecem nas notas.
--
-- Bug LATENTE encontrado ao expor capital social no funil, e ele é maior do que a
-- coluna nova. `notas_funil` é `security_invoker`, então as policies das tabelas
-- de baixo valem para quem consulta. `mercado_universo` só liberava leitura para
-- quem tem o módulo `mercado`. Resultado, medido contra a base real simulando o
-- perfil Comercial (que tem SÓ `antecipacao`):
--
--                                      Admin   Comercial
--   notas visíveis                       766         766
--   notas com sacado_construcao            8           0
--   notas com capital do fornecedor       76           0
--   SACADOS A PROSPECTAR                   8           0
--
-- A tela inteira de prospecção ficava VAZIA — sem erro, sem aviso — exatamente
-- para o time comercial, que é o único público dela. E vazia de um jeito
-- convincente: "nenhuma construtora nesta condição" é uma frase que se acredita.
--
-- Hoje ninguém foi atingido porque só existe o usuário Admin. Isso é sorte de
-- cronograma, não desenho: o perfil Comercial já está criado e cadastrado com o
-- módulo, esperando o primeiro usuário.
--
-- O RECORTE. Dar `mercado_universo` inteiro para Antecipação seria entregar o
-- universo de mercado (centenas de milhares de CNPJs, com camada e grafo SEFAZ)
-- a quem tem acesso ao funil. O que Antecipação precisa é estritamente menor:
-- o cadastro de quem APARECE NUMA NOTA que a pessoa já pode ler. É o que a
-- cláusula abaixo diz, e nada além disso.
--
-- Uma policy só, com OR, em vez de duas: `or` curto-circuita por linha, então o
-- usuário de Mercado nunca paga o EXISTS. Duas policies separadas são avaliadas
-- ambas, e o custo cairia sobre a varredura de 740 mil linhas do Explorador.
--
-- Sem ciclo: a policy de `notas_fiscais` é `app_tem_modulo('antecipacao')` e não
-- referencia `mercado_universo`. E como o EXISTS roda sob RLS, o recorte é
-- honesto — ninguém enxerga cadastro por causa de uma nota que não pode ler.

alter policy mercado_universo_select on public.mercado_universo
using (
  app_tem_modulo('mercado')
  or (
    app_tem_modulo('antecipacao')
    and exists (
      select 1
      from public.notas_fiscais nf
      where nf.fornecedor_cnpj = mercado_universo.cnpj
         or nf.sacado_cnpj = mercado_universo.cnpj
    )
  )
);

-- O EXISTS acima é um OR de duas colunas. `notas_fiscais_sacado_idx` já cobre um
-- lado e `notas_fiscais_fornecedor_faixa_idx` cobre o outro pelo prefixo — o
-- planner resolve como bitmap OR. Nenhum índice novo é necessário.

comment on policy mercado_universo_select on public.mercado_universo is
  'Mercado lê o universo inteiro. Antecipação lê apenas o cadastro de CNPJs que '
  'aparecem em notas que a própria pessoa pode ler — o mínimo para o funil '
  'classificar e para a ficha do fornecedor mostrar capital social e situação.';
