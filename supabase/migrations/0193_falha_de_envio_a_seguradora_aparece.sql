-- A falha de envio à seguradora passa a aparecer.
--
-- Uma análise foi criada, o buyer foi resolvido na Atradius e o pedido de cobertura
-- falhou. A esteira ficou parada em `solicitada`, com `atradius_buyer_id` preenchido e
-- `atradius_case_id` nulo, e NADA na tela disse por quê — nem uma notificação, nem uma
-- linha na timeline. O motivo existia só no log do container.
--
-- Dois desenhos se somavam para produzir esse silêncio, e nenhum deles está errado
-- sozinho: a action da web responde `ok` assim que o worker aceita o trabalho (ela não
-- espera o envio, que pode demorar), e o worker devolve os erros num campo `detalhes`
-- que ninguém persiste. O resultado é que só quem sabia ler o log descobria a falha.
--
-- O worker agora emite `analise.envio_falhou` (com o texto do erro no resumo) nos três
-- pontos em que uma análise pode falhar no envio. Esta migração é a outra metade: sem
-- regra em `notificacao_regras`, o evento entraria na timeline e não acenderia o sino de
-- ninguém — `fanout_evento_para_notificacoes` só notifica quem alguma regra nomeia.
--
-- Crédito porque é quem trabalha a esteira. Admin junto, seguindo o precedente de
-- `analise.limite_reduzido`: uma falha que ninguém percebe é exatamente o que aconteceu
-- aqui, e quem administra a plataforma é quem consegue distinguir um erro de credencial
-- de uma recusa da seguradora.
--
-- Idempotente por `not exists`, e NÃO por `on conflict`: a tabela só tem chave primária
-- em `id`, que é gerado — não existe unique em (tipo_evento, perfil_id) para o conflito
-- casar. Um `on conflict do nothing` aqui nunca dispararia e a segunda execução criaria
-- regras duplicadas, o que faria o sino tocar duas vezes para a mesma falha.

insert into notificacao_regras (tipo_evento, perfil_id, ativo)
select 'analise.envio_falhou', p.id, true
from perfis p
where p.nome in ('Crédito', 'Admin')
  and not exists (
    select 1 from notificacao_regras r
    where r.tipo_evento = 'analise.envio_falhou' and r.perfil_id = p.id
  );
