# Certificados digitais (Prompt 04b)

Certificado vencido = **cegueira de NF-e** naquela empresa. Todo o módulo existe para
que essa cegueira seja avisada com antecedência, em vez de descoberta quando as notas
param de chegar.

## Onde está o quê

- **Banco**: migrations `0062` (tabelas, RLS, seeds de notificação) e `0063` (RPCs).
  `certificados` (uma linha por CNPJ) e `certificados_spe_ocultas`.
- **Core** (`packages/core/src/certificados/`): `avaliarCertificado()` — a regra de
  estado/cor, compartilhada por web, mobile e worker.
- **Worker** (`apps/worker/src/jobs/radar/certificados.ts`): sync diário + alertas.
- **Web**: `/empresas/certificados` (grid) — aberta pelo botão no painel de Clientes
  Onepay.
- **Mobile**: `app/(tabs)/empresas/certificados.tsx` — indicadores + lista "Atenção".

## Estados e cores

| estado | cor | quando |
|---|---|---|
| `valido` | verde | `status = 'active'` e vence em mais de 30 dias |
| `vencendo` | amarelo | `status = 'active'` e vence em até 30 dias (inclusive hoje) |
| `vencido` | vermelho | data passou **ou** `status ≠ 'active'` |
| `ausente` | vermelho | não há certificado na base |

**`ausente` é vermelho, não cinza.** O efeito prático de "não temos o certificado" é o
mesmo de "está vencido": nenhuma NF-e daquela empresa é ingerida. Pintar de cinza
esconderia justamente o caso que mais importa.

A regra vive **em um lugar só** (`packages/core`) porque três consumidores dependem
dela responder igual. Um quadrado verde na tela ao lado de uma notificação de
"vencido" destrói a confiança na página inteira — e a notificação seria a correta.

### Datas: a armadilha do fuso

O endpoint devolve `"2026-08-15T23:59:59"` — **sem fuso**. `new Date()` leria isso
como hora local, e o worker (UTC no Railway) discordaria do browser (UTC−3) em um dia
inteiro, mudando a cor do quadrado e se o alerta dispara. `parseDataCertificado()`
interpreta como UTC.

Ela também normaliza o `+00` que o Postgres emite para `timestamptz`: é fuso válido em
Postgres e **inválido** em ECMAScript. Sem isso, toda data virava `Invalid Date`, todo
certificado virava `ausente` e o grid ficava inteiro vermelho — falha convincente e
silenciosa. Há teste para os dois casos, e a suíte roda igual em qualquer `TZ`.

## Sync (diário)

`POST /jobs/radar/certificados` → `sincronizarCertificados()`. Encadeado ao cron dos
clientes Onepay (`/api/cron/radar-onepay`): mesma origem, mesma janela.

O disparo dos certificados **não é condicionado** ao sucesso do temperature-report —
são dados independentes, e deixar de saber que um certificado vence porque o outro
endpoint caiu seria trocar um problema por outro pior.

- Guarda **todos** os certificados, inclusive de fornecedores (§1). O grid mostra só
  construtoras clientes e suas SPEs; o KPI "total ativos" conta tudo.
- Dois certificados para o mesmo `taxId` (renovação em curso): fica o de **maior**
  `expires_at`. A consolidação acontece depois de baixar todas as páginas, porque o
  mesmo CNPJ pode vir em páginas diferentes.
- Registra em `mercado_ingestoes` (fonte `onepay_certificados`) — é lá que alguém vai
  perguntar "por que o grid está com data de ontem?".

### Alertas e dedupe

`certificado.vencendo`, `certificado.vencido` e `certificado.renovado` viram evento na
empresa (timeline) e notificação para Admin e Crédito.

O dedupe é a coluna `ultimo_alerta`: **só emite quando o estado muda**. Sem isso,
"vencendo" seria reemitido todos os dias durante 30 dias — e um alerta que chega todo
dia deixa de ser lido no terceiro. Só empresas **na base** geram evento: alerta sobre
CNPJ que ninguém acompanha é ruído.

## O grid, e onde ele se afasta da spec

A spec pede "uma coluna por SPE". Contra a base real isso não funciona: uma
construtora tem **370 SPEs** (são 744 no total, entre 47 clientes). 370 colunas não
cabem em tela nem em impressão.

O que foi feito: o grid continua **por linha**, como a spec manda, mas cada linha rola
horizontalmente e as células vêm **ordenadas por urgência** (vencido → ausente →
vencendo → válido), com as 24 primeiras visíveis e o resto atrás de um "+N". Assim o
que exige ação está sempre nos primeiros centímetros da linha.

- **Clique numa SPE** → confirmação → some do grid (`certificados_spe_ocultas`).
- **A matriz não pode ser ocultada** — a RPC recusa, não só a UI.
- Ocultar é preferência **global**, não por usuário: quem esconde está dizendo "esta
  não opera", e isso vale para o time. Por usuário, cada um veria um grid diferente e
  a conversa sobre cobertura ficaria impossível.

### Por que a RPC é SECURITY DEFINER

As SPEs vivem em `mercado_universo`, cuja policy exige o módulo `mercado`. Quem tem só
`empresas` — o público desta página — não leria SPE nenhuma, e o grid apareceria com a
coluna Matriz e mais nada: vazio de um jeito convincente, que é o pior modo de falhar
(o mesmo problema que a migration `0060` documenta).

O recorte é estreito e é o que justifica o DEFINER: devolve apenas CNPJ e nome das
SPEs **do grupo de um cliente Onepay que é construtora**. Não é acesso ao universo de
mercado.

## Indicadores

1. **% clientes com certificado válido** — matrizes verdes ou amarelas ÷ construtoras
   clientes.
2. **% SPEs com certificado válido** — SPEs visíveis verdes ou amarelas ÷ SPEs
   visíveis. Ocultar uma SPE a tira do denominador.
3. **Total de certificados ativos** — **escopo maior de propósito**: conta a base
   inteira, inclusive fornecedores, que não aparecem no grid. O card diz isso no
   tooltip.

## Mobile

O grid não vem para o celular: 47 × 370 não é consultável em 6". A tela entrega os
três indicadores e a lista **Atenção** (amarelos e vermelhos, por urgência) com toque
para a Company 360 — só quando a SPE existe em `empresas`, senão não há para onde ir.

## Tools (módulo Empresas)

- `certificados.status_geral` — os três indicadores + até 50 itens que exigem ação.
- `certificados.consultar` — estado do certificado de um CNPJ, inclusive fornecedor.

Ficam em **Empresas**, e não em Radar, porque é lá que o painel de Clientes Onepay
mora hoje.

## Fora de escopo

Upload/renovação de certificado pelo JobsiteOS, fornecedores no grid (armazenados, não
exibidos) e histórico de certificados.
