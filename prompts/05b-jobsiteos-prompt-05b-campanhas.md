# JOBSITEOS — Claude Code Prompt 05B: Campanhas
## Disparo em massa a partir de segmentos, win-back de ex-clientes e lotes operacionais

> Builds on 05A (ledger `comunicacoes`, `conversas`, transportes, portão de envio `podeEnviar()`, templates, triagem, Agente de Próximo Passo) e nos módulos anteriores (filter engine do Mercado, segmentos, ex-clientes 04h, certificados 04b, funil de vendas 04g, funil de fornecedores 04l). UI pt-BR, code English. Migrations via Supabase MCP.
>
> **A diferença essencial em relação ao 05A**: lá o problema é *uma relação*; aqui é *muitos destinatários*. Toda campanha é uma forma de gerar mensagens individuais que, **assim que alguém responde, deixam de ser campanha e viram conversa do Agente**.

---

## 1. Modelo

```sql
create table campanhas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  tipo text not null,               -- prospeccao | winback | operacional | anuncio
  objetivo text,                    -- herdado pela conversa ao iniciar (usa os objetivos do 05A)
  canal text not null,              -- whatsapp | email
  -- público
  origem_publico text not null,     -- segmento | filtro | lista_manual | preset
  segmento_id uuid references segmentos(id),
  definicao_filtro jsonb,           -- filter tree (mesmo motor do Mercado)
  preset text,                      -- winback_ex_clientes | spes_sem_certificado | docs_pendentes | fornecedores_a_cadastrar
  -- conteúdo
  variantes jsonb not null,         -- [{ id, template_id, peso }] — 1 ou mais (teste A/B)
  -- execução
  contas_remetentes uuid[] not null,-- números/inboxes usados (rodízio)
  vendedor_id uuid references vendedores(id),  -- dono; null = casa/IA
  inicio_em timestamptz, 
  ritmo_por_dia int not null,       -- mensagens/dia no total da campanha
  respeitar_janela boolean default true,
  -- guardrails
  excluir_contatados_dias int default 14,
  excluir_conversa_aberta boolean default true,
  modo_agente_ao_responder text default 'sugestao',  -- sugestao | autonomo
  -- estado
  status text not null default 'rascunho',
    -- rascunho | aguardando_aprovacao | agendada | executando | pausada | concluida | cancelada
  aprovada_por uuid references usuarios(id), aprovada_em timestamptz,
  criada_por uuid references usuarios(id), criada_em timestamptz default now(),
  concluida_em timestamptz
);

create table campanha_destinatarios (
  id uuid primary key default gen_random_uuid(),
  campanha_id uuid references campanhas(id) on delete cascade,
  empresa_id uuid references empresas(id),
  contato_id uuid references contatos(id),
  variante_id text,
  status text not null default 'pendente',
    -- pendente | agendada | enviada | falhou | excluida | respondida | optout
  motivo_exclusao text,             -- suprimido | sem_contato | contatado_recente | conversa_aberta
                                    -- | sem_base_legal | teto_diario | duplicado
  comunicacao_id uuid references comunicacoes(id),
  conversa_id uuid references conversas(id),
  agendada_para timestamptz, enviada_em timestamptz, respondida_em timestamptz,
  unique (campanha_id, contato_id)
);
create index on campanha_destinatarios (campanha_id, status);
```

## 2. Construção do público (reusar tudo)

- **Segmento salvo** (Mercado) ou **filtro montado na hora** com o mesmo construtor visual — inclusive as variáveis de todos os módulos (camada, faixa, score, `e_ex_cliente`, `ex_cliente_motivo`, `tem_processo_nosso_ativo`, `gestao_operacao` etc.).
- **Presets** (atalhos de 1 clique, todos editáveis depois):
  - `winback_ex_clientes` — ex-clientes (04h), **agrupáveis por `ex_cliente_motivo`**: quem saiu por "taxa alta" recebe proposta recalibrada; quem saiu por "fluxo de caixa melhorou" recebe mensagem de disponibilidade. Reativação genérica é spam com nostalgia — o preset **exige** escolher o motivo ou tratar cada motivo como variante.
  - `spes_sem_certificado` — a cauda de SPEs sem certificado válido (04b), destinatário = ponto focal da matriz.
  - `docs_pendentes` — cards de venda parados em `aguardando_documentacao` há mais de N dias.
  - `fornecedores_a_cadastrar` — funil 04l, filtrado por potencial mínimo.
- **Resolução de destinatário por empresa**: ponto focal → melhor contato com canal válido e base legal. Uma empresa gera **um** destinatário (nunca dois contatos da mesma empresa na mesma campanha).

## 3. Simulação obrigatória antes de aprovar

Ao sair do rascunho, o sistema roda um **dry-run** e mostra:
- Total de empresas no público → **destinatários elegíveis** → **excluídos, com motivo detalhado** (suprimidos, sem contato no canal, contatados nos últimos N dias, com conversa aberta, sem base legal, duplicados).
- **Duração estimada** com o ritmo escolhido e as contas remetentes (ex.: "1.240 mensagens · 80/dia · ~16 dias úteis").
- Prévia renderizada de **cada variante** com dados de destinatários reais.
- Aviso quando o público contém contato sem `formulario_aceite` (e-mail sairá com link de descadastro).

Aprovação explícita (perfil gestor) muda para `agendada`. Campanha nunca dispara sem esse passo.

## 4. Execução

- Job `campanhas/executar` distribui o `ritmo_por_dia` ao longo da janela de envio, com **rodízio entre contas remetentes** e o intervalo aleatório do 05A. Respeita os tetos por número (warmup) — se o teto do dia acabar, o resto vai para o dia seguinte, sem estourar.
- **Cada mensagem passa pelo portão `podeEnviar()`** no momento do envio (não só na simulação): quem virou suprimido ou foi contatado no meio do caminho é excluído ali.
- Envio grava no ledger (`origem = 'campanha'`, `campanha_id` no contexto) e **abre/atualiza a `conversa`** com o `objetivo` da campanha.
- **Resposta = fim da campanha para aquele destinatário**: status `respondida`, e o Agente (05A) assume a conversa no modo configurado. Nenhuma mensagem seguinte de campanha vai para quem respondeu.
- **Controles**: pausar, retomar, cancelar (o que não saiu não sai) — e o kill switch global do 05A para tudo.

## 5. Sequência leve (o piso, não uma cadência nova)

Uma campanha pode ter **até 3 toques** (`variantes` com `passo` e `dias_apos`), com regra dura: **para no primeiro sinal** — resposta, opt-out, supressão, ou conversa assumida pelo Agente. Sequências longas e ramificadas são responsabilidade do Agente, não da campanha. Se um destinatário está em qualquer passo e o Agente cria ação para ele, a campanha cede o lugar.

## 6. Métricas e atribuição

Dashboard por campanha e comparativo entre campanhas: enviadas · entregues · falhas · **taxa de resposta** · respostas por intenção (da triagem do 05A) · opt-outs · reuniões agendadas · e o funil até o fim — **cadastros/conversões e valor esperado gerado**. Quebra por **variante** (teste A/B) e por conta remetente (detecta número com problema de entrega).
Métricas de saúde do canal: bounce e complaint por domínio remetente, opt-out por campanha — com alerta quando passam de limiares configuráveis (`campanhas_config.alerta_optout_pct`, `alerta_bounce_pct`), porque campanha ruim queima domínio e número.

## 7. Guardrails específicos de massa

- **Teto global de campanhas ativas** simultâneas e teto de mensagens/dia por conta somando todas as campanhas + envio individual (o individual tem prioridade na fila — vendedor nunca fica sem mandar por causa de campanha).
- **Nenhum contato em duas campanhas ativas** ao mesmo tempo; ao criar, o sistema exclui quem já está em outra.
- **Frequência máxima por contato**: config `max_campanhas_por_contato_90d` (default 2).
- **Nunca** incluir: suprimidos (soft ou eterna), contatos sem base legal para o canal, empresas com processo jurídico ativo nosso (04j), sacados passivos quando a campanha for de prospecção.
- Conteúdo de campanha **não cita taxa, limite ou valor de operação** (mesma regra do Agente); a validação avisa se o template contiver esses termos.

## 8. UI

**Menu Comercial → Campanhas**: lista com status e métricas resumidas; construtor em 4 passos (público → conteúdo/variantes → execução/ritmo → simulação e aprovação); detalhe com progresso ao vivo, destinatários (com filtro por status e motivo de exclusão) e métricas; presets em destaque na criação.
**Company 360 / cards**: badge "em campanha X" no contato, visível ao vendedor — evita o clássico "o vendedor liga sem saber que a pessoa recebeu um disparo hoje".
**Mobile**: acompanhar campanhas e aprovar/pausar (leitura + ações simples); construtor = `webOnly`.

## 9. Eventos, tools, entregáveis

**Eventos**: `campanha.aprovada`, `campanha.iniciada`, `campanha.pausada`, `campanha.concluida`, `campanha.destinatario_respondeu`, `campanha.alerta_saude` (bounce/opt-out acima do limiar).
**Tools**: `campanhas.status` (read), `campanhas.criar` (mutates — **sempre em rascunho**, nunca aprova nem dispara), `campanhas.pausar` (mutates).
**Worker**: `campanhas/simular`, `campanhas/executar` (contínuo, respeitando janela e tetos), `campanhas/avancar-sequencia` (diário), `campanhas/metricas` (agregação).
**Core**: resolvedor de destinatário por empresa, motor de exclusão com testes (cada motivo), distribuidor de ritmo entre contas.
**Docs**: README — como criar campanha a partir de segmento, o que cada motivo de exclusão significa, limiares de saúde de canal e por que resposta encerra a campanha.

## 10. Fora de escopo

Voz, transcrição e análise de conversas (05C) · sequências longas e ramificadas (responsabilidade do Agente, 05A) · landing pages e formulários (já em 04i) · SMS.
