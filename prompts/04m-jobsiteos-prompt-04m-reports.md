# JOBSITEOS — Claude Code Prompt 04m: Reportar Bugs & Melhorias + Modo Beta
## Ferramenta leve de feedback com painel administrativo e banner de beta

> Small focused prompt building on Prompts 01–04l. Reuse: shell (barra de topo, sino de notificações), `notify()`, `usuarios`, perfis/RBAC, Supabase Storage, `audit_log`. UI pt-BR, code English. Migrations via Supabase MCP.

---

## 1. Modelo

```sql
create table reports (
  id uuid primary key default gen_random_uuid(),
  numero serial unique,                   -- identificador curto e humano (#42)
  tipo text not null,                     -- 'bug' | 'melhoria'
  titulo text not null,
  descricao text not null,
  status text not null default 'aberto',
    -- bug:      aberto | em_analise | em_correcao | resolvido | nao_procede | duplicado
    -- melhoria: aberto | em_analise | planejado | em_desenvolvimento | entregue | nao_planejado | duplicado
  prioridade text,                        -- baixa | media | alta | critica (definida pelo admin)
  duplicado_de uuid references reports(id),
  -- contexto capturado automaticamente
  contexto jsonb default '{}',            -- { rota, url, plataforma, user_agent, viewport, app_versao }
  anexo_url text,                         -- screenshot opcional (Supabase Storage, bucket privado)
  criado_por uuid not null references usuarios(id),
  criado_em timestamptz default now(),
  atualizado_em timestamptz default now(),
  resolvido_em timestamptz
);
create index on reports (status, criado_em desc);
create index on reports (criado_por, criado_em desc);

create table report_comentarios (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  autor_id uuid not null references usuarios(id),
  texto text not null,
  interno boolean default false,          -- true = visível só para admins
  criado_em timestamptz default now()
);

create table report_historico (           -- trilha de mudanças de status
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  status_anterior text, status_novo text not null,
  alterado_por uuid not null references usuarios(id),
  alterado_em timestamptz default now()
);
```

Configuração do modo beta em `app_config` (criar a tabela se não existir; chave/valor jsonb com `atualizado_por`/`atualizado_em`):
```jsonc
"beta": { "habilitado": false, "texto": "Plataforma em fase beta — sua opinião ajuda a melhorar." }
```

## 2. Reportar (barra de topo, web e mobile)

- Ícone ao **lado do sino de notificações** (sugestão: `MessageSquareWarning` / `Megaphone` do lucide), disponível em toda a aplicação.
- Modal/sheet simples: seletor **Bug** ou **Melhoria** (dois botões grandes, não dropdown), **título** (obrigatório, curto), **descrição** (obrigatória; placeholder muda por tipo — bug: "O que aconteceu? O que você esperava?"; melhoria: "O que facilitaria seu trabalho?"), e **anexo opcional** (imagem; no mobile, câmera ou galeria).
- **Contexto capturado automaticamente** (sem o usuário digitar), exibido de forma discreta e colapsada ("detalhes técnicos incluídos automaticamente"): rota atual e URL, plataforma (web/iOS/Android), user agent, viewport, versão da aplicação.
- Envio → toast de confirmação com o número (`#42`) + evento `report.criado`.
- **"Meus reports"** no mesmo modal (aba secundária): lista dos próprios reports com status atual e comentários públicos — o usuário acompanha sem depender de aviso.

## 3. Painel admin (nova aba no menu Admin)

- **Lista/kanban** com filtros por tipo, status, prioridade e autor; busca por texto; ordenação por data ou prioridade. Contadores no topo (abertos, em andamento, resolvidos no mês).
- **Detalhe do report**: descrição, autor, data, contexto técnico expandido, anexo, histórico de status, thread de comentários (com toggle **comentário interno**, invisível ao autor).
- **Ações do admin**: alterar status (fluxos distintos por tipo, §1), definir prioridade, marcar como duplicado (vinculando ao original), comentar.
- Somente perfis com o módulo Admin acessam; ações registradas em `audit_log`.

## 4. Notificações ao autor

- **Toda mudança de status** e **todo comentário público** notificam o autor: notificação in-app + push (web/Expo), com deep link para o report. Mensagem clara, ex.: *"Seu report #42 mudou para 'Em correção'"* / *"Novo comentário no seu report #42"*.
- Comentário interno **nunca** notifica o autor.
- Eventos: `report.criado` (→ notifica perfis Admin), `report.status_alterado`, `report.comentario` (→ notifica autor). Seeds em `notificacao_regras`.

## 5. Modo beta

- Toggle em **Admin → Configurações**: habilitar/desabilitar + texto editável.
- Quando habilitado: **banner fixo no topo** da aplicação (web e mobile), abaixo/junto da barra superior, com estilo de aviso discreto (fundo âmbar suave, texto curto, sem botão de fechar — é estado da plataforma, não notificação).
- Estado lido no carregamento do shell e propagado via Realtime — ligar/desligar reflete sem exigir novo login.
- Alteração registrada em `audit_log` e evento `beta.alterado`.

## 6. Entregáveis

**Web**: botão na barra de topo + modal de report (com "Meus reports"), aba Reports no Admin (lista/kanban + detalhe), toggle e texto do modo beta em Admin → Configurações, banner beta no shell.
**Mobile**: mesmo botão no header + sheet de report com anexo por câmera/galeria, "Meus reports", banner beta. Painel admin = `webOnly`.
**Core**: helper de captura de contexto (rota/plataforma/versão) compartilhado entre as duas plataformas.
**Docs**: README — fluxos de status por tipo, quem é notificado quando, como ligar o modo beta.

## 7. Fora de escopo

Integração com issue tracker externo (GitHub/Linear), votação de melhorias por outros usuários, SLA automático, categorização por módulo.
