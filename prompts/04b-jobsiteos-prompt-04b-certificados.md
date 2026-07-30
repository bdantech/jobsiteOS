# JOBSITEOS — Claude Code Prompt 04b: Gestão de Certificados Digitais
## Grid matriz × SPEs com validade, sync diário e alertas de vencimento

> Small focused prompt building on Prompts 01–04. Reuse: worker job patterns, `clientes_onepay`, grupos/SPEs (`grupo_id`, `is_spe`), event log, `notify()`. UI pt-BR, code English. Migrations via Supabase MCP.

---

## 1. Contexto

Os certificados digitais dos clientes são o que permite à plataforma ingerir NF-e — certificado vencido = cegueira de dados naquela empresa. Endpoint:

`GET {ONEPAY_BI_URL}/api/v1/certificates` (paginado: `page`, `pageSize`, `totalPages`)

```json
{ "data": [ { "companyName": "CONSTRUTORA EXEMPLO LTDA", "taxId": "12345678000190",
  "expiresAt": "2026-08-15T23:59:59", "status": "active" } ],
  "page": 1, "pageSize": 50, "total": 12, "totalPages": 1 }
```

**Importante**: o endpoint retorna certificados de TODAS as empresas da plataforma, incluindo fornecedores. O grid exibe **apenas construtoras clientes** (`clientes_onepay` × `empresas.tipo = 'construtora'`) e suas SPEs — mas o sync armazena tudo (fornecedores ficam disponíveis para uso futuro e para o KPI de total).

## 2. Banco de dados

```sql
create table certificados (
  cnpj text primary key,               -- 14 dígitos texto
  company_name text,
  expires_at timestamptz,
  status text,                         -- status do endpoint
  sincronizado_em timestamptz default now()
);

-- SPEs ocultadas do grid (preferência operacional GLOBAL, não por usuário)
create table certificados_spe_ocultas (
  cnpj text primary key,
  oculto_por uuid references usuarios(id),
  oculto_em timestamptz default now()
);
```

Se o endpoint retornar mais de um certificado para o mesmo `taxId` (renovação), manter o de **maior `expires_at`**.

## 3. Sync (diário)

Job `certificados/sync` no worker, disparado pelo mesmo cron diário do temperature report (encadeado após ele): pagina o endpoint, normaliza `taxId` para 14 dígitos, upsert em `certificados`. Registra em `mercado_ingestoes` (fonte `onepay_certificados`), mesma política de retry/alerta.

Após o sync, avaliar vencimentos e emitir eventos (com dedupe — não repetir o mesmo evento para o mesmo CNPJ enquanto o estado não mudar):
- `certificado.vencendo` — `expires_at` dentro de 30 dias (empresa cliente ou SPE de cliente).
- `certificado.vencido` — `expires_at` passou ou `status != 'active'`.
- `certificado.renovado` — `expires_at` aumentou vs. valor anterior.

Seeds `notificacao_regras`: `certificado.vencendo` e `certificado.vencido` → perfil Admin (e Crédito, se existir). Eventos também entram no timeline da empresa correspondente.

## 4. Página: Gestão de Certificados (webOnly, grid)

**Acesso**: botão "Gestão de certificados" no painel de Clientes Onepay (módulo Empresas/Radar), rota própria (abre em tab).

**Grid**:
- **Eixo Y**: construtoras clientes (nome), ordenadas alfabeticamente; busca por nome/CNPJ.
- **Eixo X**: primeira coluna **Matriz**; depois uma coluna por **SPE vinculada** (automático via `grupo_id` + `is_spe = true`, excluindo as ocultadas). Colunas de SPE mostram nome curto/CNPJ raiz no header. Como o número de SPEs varia por cliente, o grid é por linha: células além das SPEs daquele cliente ficam vazias (não renderizar quadrado).
- **Cor do quadrado** (estado do certificado do CNPJ daquela célula):
  - **Verde**: `status = 'active'` e `expires_at` > 30 dias.
  - **Amarelo**: `status = 'active'` e `expires_at` ≤ 30 dias.
  - **Vermelho**: vencido, `status != 'active'`, ou **sem certificado** na base.
- **Tooltip** (hover): data de vencimento formatada (`dd/mm/aaaa`), dias restantes, e "Sem certificado" quando ausente.
- **Clique no quadrado de SPE**: diálogo de confirmação → oculta a SPE do grid (insere em `certificados_spe_ocultas`). Matriz não pode ser ocultada.
- **Painel "SPEs ocultadas"**: botão na página abre lista das ocultadas (nome, CNPJ, quem ocultou, quando) com ação "reexibir".

**Indicadores no topo** (cards):
1. **% clientes com certificado válido**: matrizes de construtoras clientes com quadrado verde ou amarelo ÷ total de construtoras clientes.
2. **% SPEs com certificado válido**: SPEs visíveis (não ocultadas) verdes ou amarelas ÷ total de SPEs visíveis.
3. **Total de certificados ativos**: todos os certificados `status = 'active'` e não vencidos na base sincronizada — **incluindo fornecedores** (tooltip no card explicando o escopo).

## 5. Mobile

Grid completo não cabe em tela pequena — entregar: os 3 cards de indicadores + lista "Atenção" (certificados amarelos e vermelhos de clientes/SPEs, ordenados por urgência, com dias restantes e link para a Company 360). Push via as regras de notificação já definidas.

## 6. Registry e tools

Adicionar ao módulo existente (Empresas ou Radar — seguir onde está o painel de Clientes Onepay):
- `certificados.status_geral` (read): os 3 indicadores + lista de vencendo/vencidos.
- `certificados.consultar` (read): estado do certificado de um CNPJ/empresa.

**Env**: reutiliza `ONEPAY_BI_URL`/token.

## 7. Fora de escopo

Upload/renovação de certificados pelo JobsiteOS, certificados de fornecedores no grid (armazenados, não exibidos), histórico de certificados.
