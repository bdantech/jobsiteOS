# JOBSITEOS — Claude Code Prompt 04h: Ex-Clientes via Análises de Crédito da Plataforma
## Sync de análises (role=drawee), detecção de ex-clientes e filtro na página de clientes

> Small focused prompt building on Prompts 01–04g. Reuse: worker patterns, `clientes_onepay` (Radar/03), `credito_snapshots` (04), estágio de empresa (01: `mercado | lead | prospect | cliente | ex_cliente`), event log, `notify()`. UI pt-BR, code English. Migrations via Supabase MCP.

---

## 1. Fonte

`GET {ONEPAY_BI_URL}/api/v1/credit-analyses?role=drawee` — paginado (`page`, `pageSize`, `totalPages`). **Sempre com `role=drawee`** (sacados; sem o filtro viriam cedentes). Retorna TODAS as análises, aprovadas e expiradas. Payload por item: bloco `company` (id, name, taxId, accountType, isSubscriber, companyType) + bloco `analysis` (id, role, status, expirationDate, creditLimit/consumed/available, comissões, feeD0/D1, minFees, monthlyRateD0/D1, maxInvoiceDeadlineInDays, maxAnticipationValue, billFine, investBack{...}, hasInsurance, hasReferral, fidcReady).

**Regra de ouro da fonte**: `company.id` ou `company.name` **null/vazio** = a empresa teve análise mas **nunca foi cadastrada** na plataforma → NÃO é ex-cliente (nunca foi cliente). É outra coisa valiosa (§4).

## 2. Banco

```sql
create table analises_plataforma (
  id_externo int primary key,          -- analysis.id
  cnpj text not null,                  -- taxId normalizado 14 dígitos
  empresa_cadastrada boolean not null, -- company.id E company.name presentes
  onepay_company_id int,               -- company.id quando houver
  company_name text,
  status text not null,                -- approved | expired | ...
  expiration_date date,
  credit_limit numeric(14,2), consumed_limit numeric(14,2), available_limit numeric(14,2),
  commission_percent numeric(6,3),
  fee_d0 numeric(6,3), min_fee_d0 numeric(6,3), fee_d1 numeric(6,3), min_fee_d1 numeric(6,3),
  monthly_rate_d0 numeric(6,3), monthly_rate_d1 numeric(6,3),
  max_invoice_deadline_days int, max_anticipation_value numeric(14,2),
  bill_fine numeric(6,3),
  invest_back jsonb, has_insurance boolean, has_referral boolean, fidc_ready boolean,
  raw jsonb,
  sincronizada_em timestamptz default now()
);
create index on analises_plataforma (cnpj, expiration_date desc);

alter table empresas add column ex_cliente_desde date;          -- data de expiração da última análise válida
alter table empresas add column ex_cliente_motivo uuid;         -- referencia motivos_perda (contexto 'ex_cliente')
alter table empresas add column ex_cliente_motivo_obs text;     -- detalhe livre opcional
alter table empresas add column teve_analise_sem_cadastro boolean default false;
```

### Motivo do churn (por que virou ex-cliente)

Reusar a tabela `motivos_perda` (04g) com novo contexto **`ex_cliente`**. Seeds:

| Motivo | Quando usar |
|---|---|
| Taxa alta / preço | Achou o custo da antecipação caro; negociou e não fechou |
| Inadimplência / default | Deu default ou atrasos recorrentes; saída pelo lado do risco |
| Limite insuficiente | Limite aprovado não atendia a necessidade |
| Migrou para concorrente | Passou a antecipar em outra plataforma/banco |
| Conseguiu crédito mais barato | Linha bancária, capital próprio, ou funding direto |
| Fluxo de caixa melhorou | Deixou de precisar antecipar |
| Redução de atividade / obras encerradas | Menos NFs, operação encolheu |
| Encerrou atividades / recuperação judicial | Empresa fechou, RJ ou falência |
| Problemas operacionais / atendimento | Atrito com plataforma, suporte ou processo |
| Certificado / cadastro vencido e não renovado | Deixou morrer a conexão por fricção operacional |
| Relacionamento (troca de gestão) | Mudou o decisor/financeiro e o vínculo se perdeu |
| Análise não renovada pela plataforma | Nós optamos por não renovar (crédito/risco nosso) |
| Motivo desconhecido | Default quando ninguém sabe — melhor explícito que vazio |

Comportamento:
- Ao detectar ex-cliente automaticamente (§3), o motivo nasce como **"Motivo desconhecido"** e o evento `cliente.tornou_ex` notifica o vendedor/gestor responsável pedindo a classificação — o sistema detecta o fato; o porquê é conhecimento humano.
- Editável na Company 360 e na própria lista de ex-clientes (dropdown inline + campo de observação). Alteração → `audit_log` + evento `excliente.motivo_definido`.
- **Sugestão automática apenas quando há evidência forte** (pré-preenche, humano confirma): protesto/score despencou no período → sugerir "Inadimplência/default"; empresa baixada/RJ na Receita → "Encerrou atividades"; certificado vencido sem renovação → "Certificado/cadastro vencido". Nunca gravar sugestão sem confirmação.
- Coluna "Motivo" na lista de ex-clientes + gráfico simples de distribuição de motivos no topo (contagem por motivo, período configurável) — é o começo da resposta a "por que perdemos clientes".
- Variável nova no catálogo de filtros: `ex_cliente_motivo` (permite segmento "saíram por taxa alta" → alvo perfeito de campanha de reativação com proposta recalibrada).

## 3. Sync e classificação (job `credito/sync-analises-plataforma`, diário — encadeado após o temperature report)

1. Pagina o endpoint; normaliza CNPJ; upsert por `id_externo`. Mudança de status → evento `analise_plataforma.status_alterado`. Alimentar também `credito_snapshots` (origem `credit_analyses`) quando os valores do sacado mudarem — as taxas/fees por sacado deste payload são mais ricas que as do sync de NF.
2. **Classificação por CNPJ** (após o upsert, agregando todas as análises drawee do CNPJ):
   - **Tem análise vigente** (`status = approved` e `expiration_date ≥ hoje`) → nada a fazer aqui (o estágio `cliente` é governado pelo temperature report; este sync não promove).
   - **Ex-cliente**: teve ≥ 1 análise `approved` no passado, **nenhuma vigente hoje**, e `empresa_cadastrada = true` → marcar `estagio = 'ex_cliente'` + `ex_cliente_desde = max(expiration_date)` + evento `cliente.tornou_ex` no timeline.
     **Guarda anti-conflito**: se o CNPJ está em `clientes_onepay` com `status = 'active'` ou teve antecipação conversora nos últimos 60 dias (04e), **não rebaixar** — marcar para revisão (evento `excliente.conflito_dados` → notifica Admin). O temperature report é a fonte de verdade de "cliente atual"; este sync nunca ganha dele.
   - **Análise sem cadastro** (`empresa_cadastrada = false`, com análise `approved` histórica ou vigente): marcar `teve_analise_sem_cadastro = true` na empresa (criar via `cnpj_lookup_fila` se não existir). NÃO mexer no estágio.
3. **Reativação**: o sync diário de clientes (03) já promove `ex_cliente → cliente` quando a empresa reaparece no temperature report — garantir que essa transição emite `cliente.reativado` e limpa `ex_cliente_desde` (mantendo o histórico no timeline).
4. Registrar em `mercado_ingestoes` (fonte `onepay_credit_analyses`), política padrão de retry/alerta.

## 4. UI — página Clientes Onepay (`/empresas?tab=clientes`)

- **Filtro segmentado no topo da aba**: `Atuais` (default, comportamento de hoje) | `Ex-clientes` | `Ambos`.
- Linhas de ex-cliente mostram: nome, CNPJ, **ex-cliente desde** (+ "há X meses"), último limite aprovado, consumo histórico (`consumed_limit` da última análise), taxas da última análise (monthlyRateD0), e ação "abrir Company 360". Ordenação default: `ex_cliente_desde` desc (os mais recentes primeiro — mais quentes para reativação).
- **Sub-lista "Análise aprovada, nunca cadastrada"** (link discreto na mesma aba): empresas com `teve_analise_sem_cadastro = true` — análise paga, aprovada, e nunca operaram. Colunas: nome/CNPJ, status e validade da análise, limite aprovado. É lista de prospecção de altíssima temperatura.
- Company 360: badge "Ex-cliente desde {data}" quando aplicável; timeline com os eventos de transição.
- **Mobile**: o filtro segmentado e as listas funcionam na visão mobile existente da aba clientes.

## 5. Integração com o resto do sistema

- **Catálogo de filtros** (novas variáveis): `e_ex_cliente`, `ex_cliente_desde` (meses), `teve_analise_sem_cadastro`, `ultima_analise_limite`, `ultima_analise_expirou_em`.
- Ex-clientes e "aprovadas sem cadastro" ficam automaticamente elegíveis para: segmentos, distribuição de SDR (04g — entram pela fonte configurada normalmente; a variável nova permite criar distribuição dedicada de reativação), scorecard (04d — histórico de análise aprovada já pontua no fator existente) e Perfil (04f — coorte futura "ex-clientes" para aprender por que saem; fora deste prompt).
- Seeds `notificacao_regras`: `cliente.tornou_ex` → perfis Admin + Comercial; `excliente.conflito_dados` → Admin.

## 6. Tools de IA

- `clientes.ex_clientes` (read): lista/contagem de ex-clientes com tempo e último limite.
- `clientes.status_cnpj` (read): situação consolidada de um CNPJ — cliente atual / ex-cliente desde X / análise sem cadastro / nunca analisado.

## 7. Entregáveis

**Worker**: `credito/sync-analises-plataforma` (diário, encadeado, idempotente por analysis id). **Web/Mobile**: filtro segmentado + listas + badges conforme §4. **Core**: classificador de status por CNPJ com testes (vigente, ex-cliente, sem cadastro, conflito com temperature report, reativação). **Env**: reutiliza `ONEPAY_BI_URL`/token.

## 8. Fora de escopo

Campanha/cadência de reativação de ex-clientes (Prompt 05+), coorte de ex-clientes no Perfil (adicionar depois no 04f), análise de motivo de churn.
