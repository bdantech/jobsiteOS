-- ─── Ambiente da seguradora: sandbox ou produção ────────────────────────────
--
-- A escolha vira SETTING (`credito_config.atradius.ambiente`) em vez de variável de
-- ambiente do worker. O motivo é operacional: quem alterna é a pessoa que está
-- homologando a integração com a Atradius, e alternar por env obriga um redeploy do
-- worker a cada ida e volta — o que na prática significa que ninguém alterna, e o teste
-- acaba rodando contra produção "só desta vez".
--
-- As credenciais NÃO vêm para cá. Client id, secret, application key e apólice continuam
-- em variáveis do worker (ATRADIUS_PROD_* e ATRADIUS_SANDBOX_*), porque esta tabela é
-- legível por qualquer usuário com o módulo Crédito. O que muda aqui é só QUAL dos dois
-- conjuntos o worker usa — e o worker não herda nada de um ambiente para o outro.
--
-- Default `sandbox`: se esta linha sumir ou vier com um valor desconhecido, o worker cai
-- em homologação. O pior caso de um erro de configuração tem de ser um teste que não
-- valeu nada, nunca um pedido de cobertura real feito sem querer.

update public.credito_config
   set valor = jsonb_build_object('ambiente', 'sandbox') || valor,
       atualizado_em = now()
 where chave = 'atradius'
   and not (valor ? 'ambiente');

-- Se a linha não existir (base nova que não rodou o seed da 0073), cria com os padrões.
insert into public.credito_config (chave, valor)
values ('atradius', jsonb_build_object(
  'ambiente', 'sandbox',
  'poll_intervalo_horas', 6,
  'validade_padrao_meses', 12
))
on conflict (chave) do nothing;

comment on table public.credito_config is
  'Parâmetros de economia, limite, scorecard e esteira. Editável pela tela de Crédito '
  '(perfil Crédito). Nada aqui é constante de código porque tudo aqui muda com o negócio. '
  'A linha `atradius` carrega o ambiente da seguradora (sandbox|producao) — as credenciais '
  'de cada ambiente ficam no worker, nunca aqui.';
