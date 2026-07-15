# @jobsiteos/worker — ingestão do Mercado

O serviço que carrega o universo de empresas. Roda **fora da Vercel**: o dump mensal da Receita
Federal tem ~5 GB zipados e ~40 GB de CSV, e nenhuma função serverless sobrevive a isso — nem no
tempo, nem na memória. É um contêiner Node/TypeScript, feito para o Railway, acordado por um Vercel
Cron mensal.

```
Vercel Cron ──POST /jobs/receita (bearer WORKER_SECRET)──▶ worker
                                                            │
   Receita Federal ──zip──▶ latin-1 ──▶ csv-parse ──▶ COPY ─┤
                                                            ▼
                        mercado_universo · mercado_socios · mercado_obras
                                            │
                     SPE ▶ grupos ▶ métricas ▶ reclassificação ▶ promoção
```

## Rodando local

```bash
cp apps/worker/.env.example apps/worker/.env   # preencha
pnpm --filter @jobsiteos/worker build
pnpm --filter @jobsiteos/worker start          # sobe em PORT (8080)
```

`DATABASE_URL` precisa ser a conexão **direta** do Postgres (porta 5432), não o pooler de transações
(6543): o worker usa `COPY` e tabelas `TEMP`, e as duas coisas são estado de sessão — no pooler de
transações a tabela TEMP some no statement seguinte.

## `--sample`: a única forma de testar isto

```bash
pnpm --filter @jobsiteos/worker sample
```

Roda o **pipeline inteiro** em ~10 segundos, sem baixar um byte. As fixtures (`src/sample/fixtures.ts`)
estão no layout real da Receita — mesma ordem de colunas, mesmos códigos (`02` = ativa, `01` = ME),
mesmas datas `20180131`, mesmo decimal `1500000,00`, separador `;` — são codificadas em **latin-1** e
**zipadas em tempo de execução** (`src/sample/zip.ts`). O caminho percorrido é idêntico ao da execução
mensal: unzip → latin-1 → csv-parse → filtro → COPY → upsert → SPE → grupos → métricas →
reclassificação → promoção → CNO → reclassificação. **Só o download é pulado.**

As 12 linhas da amostra existem para que cada ramo do código seja observável:

| empresa | por que está ali | camada esperada |
|---|---|---|
| ALFA PARTICIPACOES (6462) | holding fora do recorte CNAE: entra **só** pela 2ª passada de sócios-PJ | universo |
| ALFA CONSTRUTORA + filial | `qtd_filiais = 1` → SAM; `grupo_spes_24m = 2` → SOM | som |
| SPE ALFA 01 | sócio-PJ construtora + padrão de razão social → `is_spe` | som |
| SPE ALFA 02 / 03 | abertas há 8 e 20 meses: alimentam `grupo_spes_24m`, mas têm < 3 anos | universo |
| BETA (SC, 2,5M) | chega ao SAM e para: nenhum sinal de compra | sam |
| GAMA (ME, 1 ano) | nova e pequena demais | universo |
| DELTA + filial | **só** chega ao SOM pela obra ativa no CNO (a filial não tem obra → fica no SAM) | som / sam |
| EPSILON (AM) | perfil perfeito, geografia errada | tam |
| ZETA (baixada) | morre na primeira condição do TAM | universo |

O CNO da amostra traz uma obra de um responsável fora do universo — ela **tem** que ser descartada.

Aponte o `DATABASE_URL` para um branch do Supabase, não para produção, a menos que seja de propósito.

## Rotas

Todas exigem `Authorization: Bearer $WORKER_SECRET` (comparação em tempo constante), menos `/health`.

| rota | o que faz | resposta |
|---|---|---|
| `POST /jobs/receita` | `{ sample?, fallback? }` — dump mensal da Receita | `202 { ingestao_id }` |
| `POST /jobs/cno` | `{ sample?, fallback? }` — obras | `202 { ingestao_id }` |
| `POST /jobs/reclassificar` | `{ camada? }` — aplica as `camada_regras` ativas | `202 { job_id }` |
| `POST /jobs/metricas` | SPE + grupos + `mercado_metricas` | `202 { job_id }` |
| `POST /jobs/preview-regra` | `{ camada, definicao }` — dry-run, não grava nada | `200 { movidas, sobem, descem, resumo }` |
| `GET /jobs/:id` | status de um job avulso | `200` |
| `GET /health` | probe do Railway | `200 / 503` |

**202, sempre.** Uma execução da Receita leva horas; não existe cliente HTTP que segure essa conexão.
O chamador acompanha por `mercado_ingestoes`.

`reclassificar` aceita `camada`, mas **sempre recomputa as três**: uma linha recebe a camada mais alta
cuja regra casa, então mexer no SAM pode empurrar alguém para o SOM ou tirá-lo de lá. "Reclassificar só
o SAM" não é uma operação bem definida.

## O fallback é manual. Sempre.

A fonte primária é a Receita. Cada download tenta 5 vezes, com backoff exponencial espalhado por
**horas** (15min → 45min → 2h15 → 6h45): o servidor da Receita é lento, não instável — repetir de 5 em
5 segundos queima as 5 tentativas em um minuto e derruba uma execução que teria funcionado às 3 da
manhã. Cada tentativa incrementa `mercado_ingestoes.tentativa`.

Esgotadas as tentativas: a execução vira `falhou`, sai um evento `mercado.ingestao_falhou` (com
`payload.titulo` e `payload.url`, porque é um evento de sistema e sem eles o sino mostraria a string
literal "Empresa — mercado.ingestao_falhou") e o `notify()` avisa os admins — no sino e no push.

A mensagem carrega a instrução do fallback. Um admin decide, em **Mercado → Ingestões → "Reexecutar com
fallback"**, que o espelho (`RECEITA_FALLBACK_URL`) serve por este mês. Isso chama
`POST /jobs/receita { "fallback": true }`. **Nunca é automático**: trocar a fonte da verdade do mercado
por uma cópia de terceiros é uma decisão humana.

## Railway

`railway.json` já descreve o serviço. Duas coisas que não são opcionais:

1. **Contexto de build = raiz do repositório.** O worker importa `packages/core`, e core é código-fonte
   TypeScript (sem build, sem `dist`). Um Dockerfile que copiasse só `apps/worker` produziria uma imagem
   que morre no `tsc`.
2. **Um volume montado em `DOWNLOAD_DIR`.** Sem volume, um restart na terceira hora do download recomeça
   do zero — e a retomada por `Range` (que já está implementada) não tem em que se apoiar.

Variáveis: veja `.env.example`. O `WORKER_SECRET` precisa ser o mesmo no Vercel.
