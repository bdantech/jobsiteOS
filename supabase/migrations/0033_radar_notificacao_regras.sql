-- 0033 — Radar: perfis Crédito/Comercial + regras de notificação (§9)
-- Cria os perfis referenciados pelas regras (se não existirem) e seeda o roteamento
-- evento→perfil. O fan-out (0003/0014) casa empresa_eventos.tipo com tipo_evento.

insert into perfis (nome, descricao)
select 'Crédito', 'Análise de crédito e risco (protestos).'
where not exists (select 1 from perfis where nome = 'Crédito');

insert into perfis (nome, descricao)
select 'Comercial', 'Time comercial (sinais de clientes).'
where not exists (select 1 from perfis where nome = 'Comercial');

insert into notificacao_regras (tipo_evento, perfil_id, ativo)
select v.tipo, p.id, true
from (values
  ('lote.aguardando_aprovacao', 'Admin'),
  ('lote.concluido',            'Admin'),
  ('orcamento.alerta',          'Admin'),
  ('orcamento.estourado',       'Admin'),
  ('protesto.detectado',        'Admin'),
  ('protesto.detectado',        'Crédito'),
  ('cliente.dormente',          'Comercial')
) as v(tipo, perfil)
join perfis p on p.nome = v.perfil
where not exists (
  select 1 from notificacao_regras r where r.tipo_evento = v.tipo and r.perfil_id = p.id
);
