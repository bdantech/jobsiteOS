-- Retroage o tipo das empresas que nasceram do formulário, e recolhe o andaime.
--
-- A 0194 criou `tipo_por_cnae` e a rota do formulário passou a derivar o tipo do CNAE em
-- vez da auto-declaração (`tipoDeEmpresaPorCnae`, em packages/core/src/leads/roteamento.ts).
-- Isto corrige o que entrou antes: 11 empresas, 10 marcadas construtora e 1 incorporadora,
-- todas com CNAE de fornecedor — pintura de edifícios, obras de alvenaria, serviços de
-- engenharia, usinagem.
--
-- SÓ `origem = 'formulario'`. Cadastro curado não cai por régua automática, que é a mesma
-- regra que a 0191 já tinha estabelecido ao dizer que "empresa que já existe mantém a
-- ficha". Aqui o alvo é justamente a empresa cuja ficha foi escrita por uma resposta de
-- landing page — nunca houve curadoria para preservar.
--
-- E DERRUBA A FUNÇÃO no fim. Ela existiu para este backfill: a régua de verdade mora no
-- TypeScript, onde `inferirPapel` já a usava para levantar divergência de papel, e manter
-- uma cópia em SQL seria plantar duas fontes para a mesma decisão — exatamente o que
-- custou o report semanal (dois nomes para o mesmo remetente) algumas horas antes desta
-- migração. O andaime sai junto com a obra.

update public.empresas e
set tipo = public.tipo_por_cnae(u.cnae_principal)
from public.mercado_universo u
where u.cnpj = e.cnpj
  and e.origem = 'formulario'
  and public.tipo_por_cnae(u.cnae_principal) is not null
  and public.tipo_por_cnae(u.cnae_principal) <> e.tipo;

drop function if exists public.tipo_por_cnae(text);
