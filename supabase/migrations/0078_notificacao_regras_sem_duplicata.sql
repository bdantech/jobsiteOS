-- `on conflict do nothing` em notificacao_regras nunca fez nada: a tabela só tem
-- PK em `id`, então cada re-seed inseria uma linha nova e o sino duplicava. A 0077
-- criou a primeira duplicata visível (nf.convertida → Comercial); as migrações que
-- usam esse padrão desde a 0073 estavam a um re-apply de fazer o mesmo.

delete from notificacao_regras a
using notificacao_regras b
where a.id > b.id
  and a.tipo_evento = b.tipo_evento
  and a.perfil_id is not distinct from b.perfil_id
  and a.usuario_id is not distinct from b.usuario_id;

create unique index if not exists notificacao_regras_perfil_uniq
  on notificacao_regras (tipo_evento, perfil_id) where perfil_id is not null;
create unique index if not exists notificacao_regras_usuario_uniq
  on notificacao_regras (tipo_evento, usuario_id) where usuario_id is not null;

-- `antecipacao.regrediu` NÃO entra aqui: o job notifica Admin e Comercial por
-- notify() (sino + push), e uma regra de fan-out somada a isso duplicaria o sino.
-- É a mesma convenção dos outros eventos críticos do Radar.
delete from notificacao_regras where tipo_evento = 'antecipacao.regrediu';
