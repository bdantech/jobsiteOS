# Voz — a Ana liga, e o desfecho volta

A Ana é o serviço de voz da OnePay, fora deste repositório. Ela recebe uma oferta de
antecipação, **liga para o fornecedor**, conversa em português, e devolve o que aconteceu.
A fila é dela: uma ligação por vez, em horário comercial, sem rediscar sozinha.

Daqui sai o pedido; de lá volta um webhook assinado.

---

## O caminho inteiro

```
Comunicação → Ligações ──▶ voz_ligacoes ──▶ voz-enviar ──▶ POST /api/ligacoes (Ana)
   (uma PESSOA escolhe,       a_enviar         (cron)              │
    o portão confere)         recusada                             │ liga, conversa
                                                                   ▼
   comunicacoes ◀── app__voz_registrar_resultado ◀── POST /webhooks/voz (assinado)
   supressao                                              (worker)
   notas_fiscais.estagio_funil
```

**Quem escolhe é uma pessoa.** Não existe cron que decida quem recebe ligação — a régua
automática foi deixada de fora de propósito: a ligação é o canal mais caro de errar, e neste
sistema nem mensagem sai sem alguém aprovar. A tela mostra as notas candidatas com o veredicto
do portão em cada uma, e o clique põe na fila (`origem = 'manual'`, `enfileirada_por`).

**O envio é separado da escolha.** No dia em que a Ana estiver fora do ar, o que falha é o
envio — o `a_enviar` continua lá, com o pedido já montado.

| Cron | Quando | O que faz |
| --- | --- | --- |
| `/api/cron/voz-enviar` | 9h–17h30, de 30 em 30 min | Leva para a Ana o que já está na fila |

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
→ vencimento_estimado → vencida → taxa_padrao → sem_taxa → sem_tac → sem_desconto
→ sem_liquido
```

Da mais permanente para a mais temporária, como no outro portão. Quem está no Procon nunca
vai ser ligado; a nota com vencimento estimado passa a poder no dia em que o XML trouxer a
data de verdade.

O `no_procon` não é campo do nosso cadastro: a marca chega do enriquecimento dentro de
`contatos_descobertos.evidencia` ("… celular, VIVO, no Procon, com WhatsApp"), e é de lá
que a tela e a action a leem (`packages/core/src/voz/procon.ts`). Enquanto não for coluna,
é ali que ela mora — e sem essa leitura o portão parecia fechado e estava aberto.

---

## A taxa que ela fala vem da análise — e sobe para a mãe

`taxa_usada` existe para **ordenar** o funil: sem análise do sacado ela cai no default
da config, e para "esta nota vale mais que aquela" um chute bom cumpre o papel. Dita ao
telefone, a mesma taxa deixa de ordenar e vira **condição** — e o default não é condição
de ninguém.

Por isso a Ana fala `notas_fiscais.taxa_analise_am`, resolvida por `app__taxa_da_analise`:

```
análise do próprio sacado  →  análise da EMPRESA-MÃE  →  não liga
   (analises_plataforma)      (app_holding_do_sacado)     (taxa_padrao)
```

SPE e filial não têm análise própria: quem tem é a construtora dona delas, e é a
condição dela que a plataforma aplica. A subida é a mesma de `app_holding_do_sacado`,
que a carteira já usa — vínculo explícito, mesmo CNPJ, mesma raiz, grupo da SPE.

Nas 385 notas que a tela ofereceria hoje: **213** têm análise do próprio sacado, **142**
só têm pela mãe, e **30** não têm nenhuma. Sem a subida, 37% das ligações diriam a taxa
padrão como se fosse a da empresa.

E o deságio é **recalculado** com essa taxa, em vez de lido da view: dizer a taxa da
análise e o deságio calculado com outra seria falar dois números que não fecham entre si,
e quem atende tem calculadora.

## O líquido desconta TAC e seguro

`valor − deságio` era a conta até a 0221 mostrar que faltavam a TAC do sacado e os R$ 125
de seguro por nota. Nas notas desta tela são **R$ 282 a mais em média, até R$ 573** —
ditos em voz alta, numa ligação gravada, dois dias antes de a proposta escrita chegar
com o número certo. O pedido leva `valor_tac` e `valor_seguro` explícitos para que a
composição feche.

## O IOF: resolvido

A operação é **cessão de recebível, não empréstimo — e não tem IOF** (confirmado com a OnePay
em 17/09/2026).

Isso resolve o que era o maior bloqueio: o deságio é o custo inteiro, e
`valor_liquido = valor − receita_esperada` é exatamente o que `valorLiquidoEstimado` já
calcula. O campo `valor_iof` continua no contrato, opcional e zero, para o caso de um dia
existir operação que tenha — e, com zero, a Ana **não menciona IOF em nenhum momento**: ela
não fala de imposto que não existe.

## Uma decisão em aberto

É decisão de negócio, não de código, e está aqui para ser decidida em vez de descoberta
numa ligação gravada.

### 1. O vencimento pode ser estimado

`notas_fiscais.vencimento_origem` admite `estimado`. A Ana diz a data em voz alta; com data
estimada ela erra na frente de quem sabe a data de cor. O portão recusa.

---

## Ligar de novo para a mesma nota

"Ninguém atendeu, liga amanhã" é pedido legítimo, e a Ana **nunca redisca sozinha** — de
propósito: rediscar quem estava no meio de uma conversa é pior que não ligar.

Por isso a chave da fila é **(nota, tentativa)**, e cada tentativa vira um `id_externo`
diferente do lado dela: `<access_key>` na primeira, `<access_key>:2` na segunda. É o que
permite a segunda ligação existir sem que um reenvio acidental do mesmo pedido vire duas
ligações para a mesma pessoa.

A tela recusa enquanto houver tentativa aberta (`a_enviar` ou `enviada`) para aquela nota:
duas na fila seriam duas ligações com minutos de diferença.

---

## O que volta, e o que isso muda aqui

O desfecho chega em `POST /webhooks/voz` (worker), assinado com HMAC-SHA256 sobre o corpo
cru. `app__voz_registrar_resultado` faz quatro coisas **na mesma transação**:

O corpo do webhook é **a ligação inteira**: transcrição com tempos de cada fala, ferramentas
usadas (inclusive as recusadas por guarda), eventos de turno, métricas de ritmo, objeções,
quem decide, o pedido de não-contato quando houve, e a versão do prompt que conduziu. Mais
`links.painel` e `links.gravacao` para abrir e **ouvir** — os dois exigem login no painel da
Ana, porque é ligação gravada de uma pessoa real.

Tudo isso fica cru em `voz_ligacoes.resultado`; o que entra no ledger é o resumo.

1. fecha a linha em `voz_ligacoes`;
2. grava a conversa em **`comunicacoes`** (`canal = 'ligacao'`, `provedor = 'voz'`,
   `por_ia = true`) — o ledger continua sendo a única fonte do que foi falado. A ficha
   da empresa é CRIADA aqui quando não existe (`app__promover_fornecedor_para_empresa`):
   a aba Comunicação do card lê o ledger por empresa, e fornecedor de NF quase nunca tem
   ficha — sem isso a ligação existiria no banco sem aparecer em lugar nenhum, e o
   `ultima_conversa_em` da empresa não andaria;
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

Nasce **desligada**: com `ligada: false`, a tela continua deixando enfileirar e nada sai.
`kill_switch: true` para tudo sem apagar a fila, e vale também para a tela. Também são config:
`maximo_por_envio` e `validade_dias` (o prazo que a Ana cita em voz alta).

As variáveis (`VOZ_API_URL`, `VOZ_API_TOKEN`, `VOZ_WEBHOOK_SECRET`) dizem **onde** ela está e
**como** as duas pontas se provam. Ligar e desligar é decisão de operação, feita no banco,
sem redeploy — e por isso não mora em variável de ambiente.
