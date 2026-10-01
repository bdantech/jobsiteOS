# Voz — a Ana liga, e o desfecho volta

A Ana é o serviço de voz da OnePay, fora deste repositório. Ela recebe uma oferta de
antecipação, **liga para o fornecedor**, conversa em português, e devolve o que aconteceu.
A fila é dela: uma ligação por vez, em horário comercial, sem rediscar sozinha.

Daqui sai o pedido; de lá volta um webhook assinado.

> ### O que mudou no Prompt 09 (27/09/2026)
>
> - **Quem põe na fila:** uma pessoa (tela de Ligações, `origem = 'manual'`) ou um **agente de
>   mandato** (ferramenta `ligar`, `origem = 'agente'`, `app__voz_enfileirar_mandato`). Não há
>   régua automática escolhendo notas.
> - **A ligação se desprendeu da nota:** `voz_ligacoes.id` é a chave; `access_key` é opcional
>   (ligação de mandato pode ser sobre agendar reunião) e ganhou `mandato_id`, `objetivo` e
>   `empresa_id`. Uma tentativa aberta por (mandato, contato); por nota, para as manuais.
> - **O portão de permissão roda no banco**, dentro de toda RPC que enfileira
>   (`app__voz_portao`): telefone E.164, supressão, cobrança, Procon, base legal — e o
>   `pedido.telefone` tem de ser o `telefone` da linha (antes eram checados números
>   diferentes do discado). O "sem base legal" do fallback da NF é conferido contra o
>   `contato_fornecedor` da própria nota, não carimbado.
> - **O envio reexecuta os dois portões** com dados de agora e **remonta a oferta** (taxa,
>   TAC, líquido, estágio da nota). O que mudou cancela a ligação com o motivo e acorda o
>   mandato.
> - **Nada é descartado no webhook:** desfecho ou status fora da lista são aceitos (desfecho
>   vira `desconhecido`, o cru fica em `resultado`), o corpo cru vai para a RPC, e `links`,
>   `transcricao`, `custo_centavos` e `duracao_s` ganharam coluna — o botão "Ouvir" funciona.
> - **Ligação órfã:** discada e sem resultado há mais de `voz_timeout_minutos` vira `falhou`
>   (`/api/cron/voz-varrer-orfas`) e libera a nota; se o resultado chegar depois, reabre. A
>   ainda não discada segue a regra da fila, abaixo (0274).
> - **Cancelar:** a tela cancela do nosso lado (`app_voz_cancelar`) e o worker tenta o
>   `DELETE` na Ana.
> - **Versão da Ana:** o worker pergunta `GET /api/versao` (404 = v1) e grava em
>   `agentes_config.voz_status`. Em v1, só `ofertar_antecipacao` é enviado; os demais
>   objetivos são recusados com erro claro (`core/agentes/voz-adapter.ts`).
> - **Desfechos estruturados** (`indicou_outro_contato`, `agendar_retorno`,
>   `reuniao_agendada`) são consumidos pelo mandato: contato novo registrado, retorno anotado,
>   janela confirmada vira reunião.

> ### A v2 real (resposta da Ana, 28/09/2026)
>
> - **No ar**, com os quatro objetivos. `GET /api/versao` responde `2` e a lista `objetivos`;
>   o JobsiteOS só manda o que estiver nela.
> - **A fila é uma ligação por vez**, ~3 min cada, só das 9h às 18h em dias úteis. Por isso:
>   - o prazo de `voz_timeout_minutos` conta da **discagem** (`ligacao.iniciada`, gravado em
>     `voz_ligacoes.iniciada_em`, 0274), não da entrada na fila;
>   - ligação não discada até o fim do expediente em que devia ser (`fimDoExpedienteDaVoz`) é
>     cancelada na Ana pela varredura (`DELETE`), e só vira falha se ela confirmar (`200`/`404`);
>   - as janelas de uma ligação de agendamento ficam reservadas até esse mesmo instante, e só
>     são oferecidas janelas que começam depois dele — a Ana confere o `expira_em` na hora.
>   O `ligacao.iniciada` é melhor esforço (sem reenvio); o `ligacao.encerrada` é durável.
> - **`oferta` só em `ofertar_antecipacao`**: com outro objetivo a Ana devolve 422.
> - **`voz_conta_id` é o nome da voz** do GPT-Live (`bossa`, a padrão, `tempo`, `marin`,
>   `cedar`, `vale`…). Vazio ou desconhecido cai na `bossa`.
> - **`custo.valor_brl` vem nulo** até a Ana ter a tarifa por minuto; os `minutos` vêm. Enquanto
>   isso, o orçamento fica com a estimativa da ferramenta `ligar` (`precos.ferramentas_centavos`).
> - **Transferência ao vivo desligada** até a Ana ter o número de destino: ela encerra com
>   `transferido_humano`, e o mandato escala.
> - **Teste de payload: `POST /api/ligacoes?validar=1`**, que valida sem ligar. Um teste da
>   v2 com o telefone de exemplo do contrato ligou para uma pessoa de verdade — ligação real,
>   só para número nosso.

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

**Quem escolhe é uma pessoa — ou um agente sob mandato.** Não existe cron que decida quem
recebe ligação. Na tela, as notas candidatas aparecem com o veredicto do portão e o clique põe
na fila (`origem = 'manual'`, `enfileirada_por`). O agente de mandato (Prompt 09) pede ligação
pela ferramenta `ligar`, sob orçamento, cota diária e disjuntor (`origem = 'agente'`).

**O envio é separado da escolha.** No dia em que a Ana estiver fora do ar, o que falha é o
envio — o `a_enviar` continua lá, com o pedido já montado.

| Cron | Quando | O que faz |
| --- | --- | --- |
| `/api/cron/voz-enviar` | 9h–17h55, de 5 em 5 min | Leva para a Ana o que já está na fila |

---

## O portão é dois

O de **permissão** mora no banco (`app__voz_portao`, 0270a): telefone E.164, supressão,
cobrança, Procon e base legal, conferidos na transação que enfileira e de novo no envio. O
portão de mensagens (`comunicacao/portao.ts`) NÃO é chamado pela voz — a janela da ligação é
o horário do cron e o horário comercial da própria Ana; o cooldown ao mesmo contato, para o
agente, é a cota `cooldown_minutos_mesmo_contato` verificada pela ferramenta.

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

Tudo isso fica cru em `voz_ligacoes.resultado` — de verdade só desde o Prompt 09: antes o zod
podava os campos não declarados e os `links` nunca chegavam. `links`, `transcricao`,
`custo_centavos` e `duracao_s` também têm coluna própria. O que entra no ledger é o resumo.

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
