-- 0096 — Um perfil por tipo de vendedor: SDR, Originador e Closer.
--
-- Até aqui o Comercial tinha UM perfil, e quem o tivesse era gestor por definição:
-- `app_gestor_comercial()` responde sim para Admin e Comercial, e gestor vê todos os
-- funis, muda carteira e aprova comissão. Ou seja, a separação por tipo de vendedor e a
-- visibilidade cruzada (0095) estavam implementadas e não eram exercidas por ninguém —
-- não havia como existir um vendedor que NÃO fosse gestor.
--
-- Estes três perfis são essa possibilidade. Nenhum deles é gestor: quem entra por aqui
-- vê o próprio funil, o próprio calendário e a própria comissão, mais os acessos
-- cruzados que alguém lhe conceder no cadastro.
--
-- Idempotente, como o 0004. Módulos batem com `AppModule.id` em packages/core/registry.

insert into public.perfis (nome, descricao) values
  ('SDR',
   'Prospecção: funil de reuniões, calendário e comissão. Vê o próprio funil e o de quem '
   'lhe for liberado — não é gestor do módulo.'),
  ('Originador',
   'Originação de NF: funil de notas da carteira, empresas da carteira e comissão. '
   'Não é gestor do módulo.'),
  ('Closer',
   'Fechamento: funil de vendas, calendário, comissão e as contas passivas da carteira. '
   'Não é gestor do módulo.')
on conflict (nome) do nothing;

/*
 * `empresas` entra nos três, e não é generosidade.
 *
 * Todo card dos dois funis linka para a Company 360 — é lá que se julga a conta, se lê o
 * histórico e, no caso do closer, se decide ativo × passivo. Sem o módulo, o link
 * principal da tela de trabalho devolve "sem acesso", e a pessoa conclui que o sistema
 * está quebrado quando na verdade o cadastro dela é que está.
 *
 * `antecipacao` só para o originador: a nota fiscal vive sob a RLS daquele módulo, e o
 * funil de NFs é a tela principal dele. Dar a todos abriria a carteira inteira de notas
 * para quem trabalha reunião, que não precisa dela para nada.
 *
 * `credito` fica FORA dos três, inclusive do closer. A venda passa por análise de
 * crédito, mas o card anda sozinho quando a seguradora decide — ler o parecer é trabalho
 * de quem opera crédito. Se algum closer precisar, é um insert de uma linha.
 */
insert into public.perfil_modulos (perfil_id, modulo_id)
select p.id, m.modulo_id
from public.perfis p
join (values
  ('SDR',         'comercial'),
  ('SDR',         'empresas'),
  ('SDR',         'notificacoes'),
  ('Originador',  'comercial'),
  ('Originador',  'antecipacao'),
  ('Originador',  'empresas'),
  ('Originador',  'notificacoes'),
  ('Closer',      'comercial'),
  ('Closer',      'empresas'),
  ('Closer',      'notificacoes')
) as m (perfil, modulo_id) on m.perfil = p.nome
on conflict (perfil_id, modulo_id) do nothing;

/*
 * E o perfil Comercial ganha `empresas` pelo mesmo motivo dos outros três.
 *
 * Ele já era o perfil de quem trabalha o funil, e o funil já linkava para a ficha da
 * empresa — o acesso faltava desde o 04g e ninguém tinha esbarrado nele porque os dois
 * usuários com esse perfil também abriam tudo por outros caminhos.
 */
insert into public.perfil_modulos (perfil_id, modulo_id)
select p.id, 'empresas' from public.perfis p where p.nome = 'Comercial'
on conflict (perfil_id, modulo_id) do nothing;
