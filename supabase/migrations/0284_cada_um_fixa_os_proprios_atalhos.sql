-- ─────────────────────────────────────────────────────────────────────────────
-- 0284 — Cada um fixa os próprios atalhos
--
-- A sidebar ganha uma seção "Fixados" no topo: módulos e abas que a PESSOA escolheu,
-- na ordem em que escolheu. É preferência individual, então mora na linha dela em
-- `usuarios`, ao lado de `prefs_notificacoes`, e segue a mesma regra daquela coluna:
--
--   sem grant para `authenticated` (a 0005 fez o grant de `usuarios` coluna a coluna,
--   e coluna nova não entra nele). Leitura e escrita passam pelo service role, presas
--   ao id da sessão revalidada — ver apps/web/src/actions/atalhos.ts.
--
-- O que se guarda é o CAMINHO ("/comercial/meu-dia", "/empresas?tab=clientes"), não
-- um id de catálogo: o caminho já é o que o guard de rota entende, então o acesso é
-- conferido na hora de desenhar com a mesma `canAccessRoute()` de sempre. Um atalho
-- para um módulo que o perfil perdeu some sozinho, sem limpeza.
--
-- O teto de 20 é de sanidade, não de produto: a tela oferece bem menos que isso por
-- pessoa, e uma lista sem teto é uma coluna que alguém um dia enche por um bug.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.usuarios
  add column if not exists atalhos_fixados text[] not null default '{}';

alter table public.usuarios
  drop constraint if exists usuarios_atalhos_fixados_ck;

alter table public.usuarios
  add constraint usuarios_atalhos_fixados_ck check (
    cardinality(atalhos_fixados) <= 20
    and array_position(atalhos_fixados, null) is null
  );

comment on column public.usuarios.atalhos_fixados is
  'Caminhos que a pessoa fixou no topo da sidebar, na ordem dela. Só service role lê/escreve (0284).';
