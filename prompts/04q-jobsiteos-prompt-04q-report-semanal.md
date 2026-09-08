# JOBSITEOS — Claude Code Prompt 04q: Report Semanal Executivo
## Aba Relatórios (dashboards interativos) + PDF executivo enviado por e-mail

> Builds on Prompts 01–05A e 04p. Fontes de dados: antecipações e NFs (04/04e), funis SDR e vendas (04g), esteira e crédito (04d/04j/04o), certificados (04b), clientes e temperature report (03), ex-clientes (04h), fornecedores (04l), comissões e VOP (04k), comunicações (05A), jurídico (08), Radar/orçamento (03). UI pt-BR, code English. Migrations via Supabase MCP.
> **Localização**: menu **Comercial → Relatórios**. **Acesso restrito a perfis gestores** (não visível a vendedores).
> **Referência visual obrigatória**: o arquivo `wireframe-report-semanal-v2.html` (fornecido junto). Seguir a diagramação, hierarquia e paleta dele no PDF.

---

## 1. Régua de comparação (vale para TODOS os indicadores)

Três janelas, sempre:
- **12 meses** — total do período **+ a média** (mensal e semanal). A média é a régua, não o total.
- **Mês atual** (parcial) — comparado à **média mensal** dos 12m.
- **Semana** — comparada à **média semanal** dos 12m.

Variação sempre em % ou p.p. Em métricas onde **subir é ruim** (valor expirado, limite ocioso, ex-clientes, no-shows, antecipações travadas), a seta sobe mas o realce é **vermelho** com o rótulo "pior" — nunca deixar a leitura automática de que subir é bom.

## 2. Conteúdo (idêntico nas duas superfícies)

**Resumo de IA** (abre o report): 3 parágrafos gerados pela Anthropic API a partir dos números já calculados — (1) o que foi bem, (2) o que preocupa, (3) **onde agir**, com nomes e valores concretos. Restrições no prompt: usar apenas os números fornecidos, nunca inventar causa, citar o dado que sustenta cada afirmação, tom direto e sem jargão.

**Blocos**:
1. **KPIs de topo**: volume convertido · **VOP operado** · receita gerada · limite ocioso.
2. **Funil comercial da semana** com taxas de passagem vs. média 12m e apontamento do **maior vazamento**.
3. **Antecipação**: volume convertido · **VOP operado** (destaque — é a base de comissão) · prazo médio · receita (spread + TAC) · ticket médio · cedentes que operaram.
4. **Funil de NF**: capturadas · entradas por faixa (alta/boa/média) · **conversão por faixa** · valor expirado sem trabalho · antecipações travadas.
5. **Comercial**: leads (inbound/outbound) · taxa de fit · reuniões agendadas/realizadas · no-shows não remarcados · MoUs · ciclo médio 1º contato → 1ª operação.
6. **Crédito**: solicitadas/aprovadas/negadas · limite concedido · tempo médio na esteira (com o estágio gargalo) · divergências com a seguradora.
7. **Carteira**: clientes que operaram · limite ocioso · taxa de utilização · novos/reativados/ex-clientes.
8. **Listas**: carteiras que não estão performando (cliente, gestor, ocioso, dias sem operar) · novos clientes da semana · saíram/voltaram com motivo.
9. **Certificados digitais**: barra de cobertura (válidos / vencendo em 30d / sem certificado, com quebra matrizes × SPEs) + tabela das empresas sem certificado com **o volume de NF/mês estimado que está invisível** por causa disso. Quantificar em R$ é o que faz alguém agir.
10. **Time**: por vendedor — reuniões, conversões, **VOP**, comissão apurada — mais "filas acumulando" (inbound sem contato, docs parados, conversas sem resposta).
11. **Exige atenção**: limites reduzidos pela seguradora, protestos novos em clientes, certificados vencendo, processos com movimentação relevante, lotes aguardando aprovação, orçamento de enriquecimento, sugestões do Perfil pendentes, ex-clientes sem motivo, fornecedores sem contato.

## 3. Aba Relatórios (web, gestores)

Os **mesmos dados**, em versão interativa e mais visual que o PDF:
- Seletor de período (semana corrente, semanas anteriores, mês, trimestre) e filtros (vendedor, UF, faixa, tipo de conta).
- **Gráficos** onde o PDF usa tabela: séries temporais de volume/VOP/receita (12 meses, com marcação da semana), funil em gráfico de etapas, conversão por faixa em barras comparadas à média, distribuição do limite ocioso por gestor, cobertura de certificados em barra empilhada, ranking de time.
- **Interatividade no padrão do Meu Dia (04p)**: clicar em qualquer indicador ou segmento de gráfico **abre modal** com a lista dos itens que o compõem — nunca navega para outra página. Do modal, link para a Company 360 em nova aba.
- **Histórico de reports**: lista dos PDFs já gerados, com download e visualização.
- Botão **"Gerar PDF agora"** (prévia sob demanda, sem enviar).
- Botão **"Configurar envio"** (§5).

## 4. PDF

- Layout **conforme o wireframe de referência** (3 páginas A4). Gerado no **worker** (não no browser), para funcionar agendado sem ninguém logado.
- **Padrão de design — exigência explícita**: visual limpo e editorial. Hierarquia tipográfica clara (títulos de seção discretos em caixa alta com tracking, números grandes em fonte tabular), **muito espaço em branco**, paleta contida (zinc como base, `#1a7a4a` só como acento e sinal positivo, vermelho apenas para alerta), **sem bordas pesadas, sem sombras, sem cores de preenchimento decorativas**, tabelas com régua fina de 1px apenas onde separa. Sparklines discretas. Nada de logotipo grande ou capa — o report começa com conteúdo. **Regra editorial: cada elemento responde a uma pergunta; se não responde, sai.**
- Nome do arquivo: `report-semanal-oneos-{ano}-S{semana}.pdf`. Armazenado em Storage privado, retenção configurável.

## 5. Configuração de envio (na própria aba, gestores)

```sql
create table report_config (
  id uuid primary key default gen_random_uuid(),
  tipo text not null default 'semanal_executivo',
  destinatarios jsonb not null,        -- [{ email, nome, usuario_id? }]
  dias_semana int[] not null,          -- 1=seg ... 7=dom
  horario time not null default '06:00',
  timezone text default 'America/Sao_Paulo',
  ativo boolean default true,
  assunto_template text,
  atualizado_por uuid references usuarios(id), atualizado_em timestamptz default now()
);
create table report_execucoes (
  id uuid primary key default gen_random_uuid(),
  periodo_inicio date not null, periodo_fim date not null,
  pdf_url text, resumo_ia text,
  dados jsonb not null,                -- snapshot de todos os números (reprodutibilidade)
  status text default 'gerando',       -- gerando | enviado | falhou
  destinatarios_enviados jsonb, erro text,
  criado_em timestamptz default now(), enviado_em timestamptz
);
```

UI: adicionar/remover destinatários (usuários da plataforma ou e-mail externo), escolher os dias da semana em checkboxes e o horário, ligar/desligar, editar o assunto, e **"Enviar teste agora"** para o próprio usuário.

**Envio**: worker gera o PDF, salva, envia por **Resend** com o **PDF em anexo** e um corpo de e-mail curto contendo o resumo de IA em texto (para quem lê no celular sem abrir o anexo) e um link "abrir no JobsiteOS". Falha → retry (3x) e notificação aos admins.

## 6. Implementação

- **Camada de dados única**: um módulo `packages/core/reports/semanal.ts` que calcula **todos** os indicadores com as três janelas e devolve uma estrutura tipada. **A aba, o PDF e o e-mail consomem exatamente essa estrutura** — nunca recalcular em lugar diferente, ou os números divergem entre tela e anexo.
- Snapshot completo em `report_execucoes.dados`: report antigo abre com os números da época, mesmo que o histórico mude.
- Performance: queries agregadas em paralelo, com materialização das séries de 12 meses (job diário) — não recalcular 12 meses a cada abertura.
- PDF: gerar com uma lib headless (ex.: Puppeteer/Playwright renderizando um template HTML/CSS de impressão) — reaproveita o CSS do wireframe e mantém tela e papel coerentes.

## 7. Entregáveis

**Core**: módulo de cálculo com testes (cada indicador, cada janela, divisão por zero, período sem dados).
**Worker**: `reports/gerar-semanal` (agendado pelos dias configurados), `reports/materializar-series` (diário).
**Web**: aba Relatórios com dashboards interativos e modais, histórico, geração sob demanda, configuração de envio.
**Mobile**: leitura do resumo de IA e dos KPIs principais + download do PDF (dashboards completos e configuração = `webOnly`).
**Eventos**: `report.gerado`, `report.enviado`, `report.falhou`.
**Docs**: README — de onde vem cada indicador, como as médias são calculadas, como alterar destinatários e o que fazer quando o envio falha.

## 8. Fora de escopo

Relatórios customizáveis pelo usuário, exportação para Excel, reports por vendedor individual (acesso é restrito a gestores nesta versão), comparação com metas.
