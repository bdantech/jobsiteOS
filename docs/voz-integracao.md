# Voz — a Ana liga, e o desfecho volta

A Ana é o serviço de voz da OnePay, fora deste repositório. Ela recebe uma oferta de
antecipação, **liga para o fornecedor**, conversa em português, e devolve o que aconteceu.
A fila é dela: uma ligação por vez, em horário comercial, sem rediscar sozinha.

Daqui sai o pedido; de lá volta um webhook assinado.

---

## O caminho inteiro

```
notas_funil ──▶ voz-gerar ──▶ voz_ligacoes ──▶ voz-enviar ──▶ POST /api/ligacoes (Ana)
   (faixa,        (portão)      a_enviar          (cron)              │
   estágio)                     recusada                              │ liga, conversa
                                                                      ▼
   comunicacoes ◀── app__voz_registrar_resultado ◀── POST /webhooks/voz (assinado)
   supressao                                              (worker)
   notas_fiscais.estagio_funil
```

**Dois jobs, e é de propósito.** Gerar é decidir quem ligar; enviar é gastar. Separados, a
fila pode ser olhada antes de sair, e no dia em que a Ana estiver fora do ar o que falha é
o envio — o `a_enviar` continua lá, com o pedido montado.

| Cron | Quando | O que faz |
| --- | --- | --- |
| `/api/cron/voz-gerar` | 8h30, dias úteis | Escolhe as notas e grava o motivo de cada recusa |
| `/api/cron/voz-enviar` | 9h–17h30, de 30 em 30 min | Leva a fila para a Ana |

---

## O portão é dois

O **de sempre** (`comunicacao/portao.ts`) continua valendo: supressão, base legal, cooldown,
janela. Uma ligação é comunicação de saída como qualquer outra.

O **segundo** é novo e mora em `packages/core/src/voz/pedido.ts`. Ele existe por um motivo
que só a voz tem: a Ana **fala** o líquido, a taxa e o vencimento em voz alta, numa ligação
gravada, e a proposta escrita chega dois dias depois. Número estimado numa tela é
estimativa; o mesmo número dito ao telefone é promessa.

Por isso dado duvidoso não vira ligação com ressalva — vira ligação que não acontece, com o
motivo em `voz_ligacoes.motivo_recusa`:

```
kill_switch → suprimido → sem_contato → sem_base_legal → no_procon → telefone_invalido
→ nota_cancelada → nao_operavel → sem_numero_da_nota → sem_vencimento
→ vencimento_estimado → vencida → sem_taxa → taxa_padrao → sem_desconto → sem_iof
→ sem_liquido
```

Da mais permanente para a mais temporária, como no outro portão. Quem está no Procon nunca
vai ser ligado; a nota sem IOF passa a poder no dia em que a conta existir.

---

## Três decisões em aberto

Hoje **quase toda nota para em `sem_iof`** — de propósito. São decisões de negócio, não de
código, e estão aqui para serem decididas em vez de descobertas numa ligação gravada.

### 1. O líquido não desconta IOF

`valorLiquidoEstimado` é `valor − receita_esperada`, e a `receita_esperada` é só o deságio.
O payload real da plataforma (`/api/v1/anticipations`) tem `netValue`, `discountedAmount` e
`witholdTaxAmount` certos — mas só existe **depois** que a antecipação foi solicitada, e na
hora da ligação ela ainda não foi.

Caminhos: incluir o IOF na estimativa do funil; pedir uma cotação à plataforma antes de
ligar; ou a Ana não falar o líquido (perde força — é o número que faz decidir na hora).

### 2. A taxa pode ser a padrão

`calcularReceitaEsperada` cai no default do `antecipacao_config` quando o sacado não tem
snapshot de crédito, e marca `taxa_padrao: true`. Na tela isso é "estimativa menos
confiável"; na ligação seria a Ana dizendo uma condição que não é a real.

O campo `taxa_padrao` do portão existe e hoje chega sempre `false`, porque a `notas_funil`
não expõe o flag. Enquanto não expuser, a ausência de taxa é o único sinal.

### 3. O vencimento pode ser estimado

`notas_fiscais.vencimento_origem` admite `estimado`. A Ana diz a data em voz alta; com data
estimada ela erra na frente de quem sabe a data de cor. O portão recusa.

---

## O que volta, e o que isso muda aqui

O desfecho chega em `POST /webhooks/voz` (worker), assinado com HMAC-SHA256 sobre o corpo
cru. `app__voz_registrar_resultado` faz quatro coisas **na mesma transação**:

1. fecha a linha em `voz_ligacoes`;
2. grava a conversa em **`comunicacoes`** (`canal = 'ligacao'`, `provedor = 'voz'`,
   `por_ia = true`) — o ledger continua sendo a única fonte do que foi falado;
3. move `estagio_funil` para `em_negociacao` quando a ligação fechou algo, e só a partir de
   `a_prospectar`/`em_prospeccao` — uma ligação não desfaz o que um humano moveu adiante, e
   `convertida` continua sendo carimbo do sync da plataforma;
4. **suprime** quando a pessoa pediu para não ser mais procurada.

O item 4 é o irreversível. Da recusa comercial se volta em 90 dias; deste não se volta, e a
prova é uma ligação gravada. Por padrão suprime o **telefone** (eterna, `solicitacao_lgpd`,
contexto `antecipacao`); quando o pedido foi sobre a empresa toda, chama
`app__suprimir_fornecedor`, que é o mesmo caminho do "sem interesse".

**O webhook pode chegar mais de uma vez** — a Ana reenvia até receber 2xx. A idempotência é
da RPC: a segunda entrega não gera segunda linha de ledger nem segunda supressão.

---

## Ligar e desligar

```sql
insert into antecipacao_config (chave, valor) values ('voz', '{"ligada": true}'::jsonb)
on conflict (chave) do update set valor = excluded.valor;
```

Nasce **desligada**. `kill_switch: true` para tudo sem apagar a fila. Também são config:
`faixas`, `maximo_por_rodada`, `maximo_por_envio`, `validade_dias`.

As variáveis (`VOZ_API_URL`, `VOZ_API_TOKEN`, `VOZ_WEBHOOK_SECRET`) dizem **onde** ela está e
**como** as duas pontas se provam. Ligar e desligar é decisão de operação, feita no banco,
sem redeploy — e por isso não mora em variável de ambiente.
