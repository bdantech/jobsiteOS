# Funil de NFs — filtro de novidades (04t)

"O que entrou desde a última vez que eu trabalhei." Um filtro a mais no funil de NFs, web
e mobile. Nada do funil muda de comportamento: é mais um predicado no `where`, e compõe
com origem, faixa, originador, valor e datas.

## A janela

O pedido era "as últimas 6 horas, e na segunda desde sexta". A exceção é a regra: a janela
padrão começa no **fim do último expediente útil anterior a agora** e termina agora.

> O maior instante T tal que T = (dia D às `expediente_fim`), com D dia útil e T < agora.

| Momento | Início da janela |
| --- | --- |
| Segunda 09:00 | sexta 18:00 |
| Terça 15:00 | segunda 18:00 |
| Quarta, com terça feriado | segunda 18:00 |
| Sexta 20:00 | a própria sexta 18:00 |
| Segunda, com sexta emendada | quinta 18:00 |

As outras opções do seletor são fixas: **últimas 6 horas**, **hoje** (desde o início do
expediente), **últimos 7 dias** e **personalizado** (duas datas e horas).

O cálculo mora em `packages/core/src/funil/janela-novidades.ts` e é o mesmo para o Kanban,
o contador da aba, o card do Meu Dia, o celular e a tool `funil.novidades`. Tudo em
`America/Sao_Paulo`, convertido para UTC só na borda da consulta.

Quando o filtro está ligado a tela escreve a janela por extenso — *"Mostrando o que entrou
desde sexta, 16/10, às 18:00 — 23 itens"* — para o originador conferir a conta sozinho.

### Limitação: é o calendário da empresa, não a presença de cada pessoa

A janela segue o expediente e os dias não úteis cadastrados. **Quem volta de férias ou de
folga não tem a janela esticada automaticamente**: para esse caso existe o intervalo
personalizado. Ausência individual não é inferida, de propósito.

## O que conta como "entrou"

`entrou_funil_em` é quando o item apareceu no funil — **não** a emissão. A NF de três dias
atrás que o certificado só capturou hoje é novidade hoje. A coluna existe em
`notas_fiscais`, `sienge_titulos` e `pre_autorizacoes`, e o filtro lê `novidade_em`
(`coalesce(reentrou_funil_em, entrou_funil_em)`), exposta nas views do funil.

Quem grava é o gatilho `funil_carimbar_entrada` (migração 0296), não o sync:

- **O carimbo é imutável.** Nenhum upsert consegue reescrevê-lo — nem com outro valor, nem
  com `NULL`. Sem isso a base inteira viraria novidade a cada rodada do sync.
- **Mudança de estágio não é novidade.** É trabalho acontecendo, não chegada.
- **A reentrada** (`reentrou_funil_em` + `reentrou_funil_motivo`) marca o item que já
  existia e só agora virou trabalho de alguém. O card diz o motivo:
  - `carteira` — "voltou ao funil: entrou na sua carteira" (mudou de titular);
  - `sacado_aprovado` — "voltou ao funil: sacado aprovado";
  - `operavel` — a nota deixou de ser não operável.

Duas guardas no gatilho:

1. A primeira atribuição de dono nas primeiras 12 horas é parte da chegada (o roteamento
   roda logo atrás do sync) e não carimba reentrada.
2. O status de crédito oscila na origem. "Sacado aprovado" só carimba quando o sacado **não**
   estava aprovado no último snapshot de crédito com mais de 12 horas.

O que **não** carimba: o título que passa a aparecer porque entrou na régua de 180 dias de
vencimento (0295). Essa régua é calculada na leitura, sem evento para carimbar.

O comportamento está coberto por `supabase/tests/funil-carimbo.sql` (roda numa transação e
termina em rollback).

## Dias não úteis

Tabela `dias_nao_uteis`. Tudo que está nela conta como dia sem expediente, além de sábado e
domingo.

- **Nacionais**: job `calendario/importar-feriados` (cron `/api/cron/calendario-feriados`,
  2 de janeiro), que busca a BrasilAPI e grava o ano corrente e o seguinte. O botão
  "Importar feriados nacionais" faz o mesmo sob demanda, sem depender do worker.
- **Estaduais, municipais e pontos facultativos da empresa**: cadastro do gestor. A
  BrasilAPI não traz 9 de julho, aniversário de cidade nem a emenda que a empresa decidiu
  tirar — e é isso que gera a segunda-feira errada. O que é cadastrado à mão não é
  sobrescrito pela importação.

**Calendário indisponível** (ano sem feriados importados): a janela cai para "só fim de
semana e o que foi cadastrado à mão", **a tela avisa** que feriados podem não estar
considerados, e segue. Nunca devolve janela vazia.

## Selo "Novo"

A janela resolve a chegada; no meio do dia ela traz junto o que já foi trabalhado de manhã.
O selo marca o que entrou depois da **visita anterior** ao funil (`usuarios.funil_visto_em`
e `funil_visto_anterior`). Abrir o funil avança o marcador só se passaram mais de
`minutos_para_avancar_marcador` desde a última visita — por isso os selos ficam estáveis
durante a sessão. "Marcar tudo como visto" zera todos.

## Onde aparece

- **Funil** (web `/comercial/nfs` e `/antecipacao`; mobile "Funil de NFs"): seletor
  Novidades, a janela por extenso, o carimbo "entrou há 2h" e o selo no card.
- **Contador**: na aba do funil (web) e no cartão do menu do Comercial (mobile) — itens da
  janela padrão, no recorte de quem abriu. Atualiza a cada 5 minutos e sempre que o funil é
  invalidado; não há Realtime nessas tabelas.
- **Meu Dia** do originador: "Entraram 23 novidades desde seu último expediente", por tipo
  e com o valor somado. Na web abre o funil filtrado em modal; no celular, a tela do funil.
- **Barra de IA**: tool `funil.novidades` — "o que entrou desde sexta?".

## Configuração

Comercial → Configurações → aba **Funil** (web, gestor): início e fim do expediente,
minutos do marcador de visita e o calendário de dias não úteis. Fica em
`antecipacao_config`, chave `funil_novidades`.

## Fora de escopo

Janela por pessoa (presença, férias, folga) · push de novidade · histórico de quando cada
originador viu cada item · o mesmo filtro em outros funis.
