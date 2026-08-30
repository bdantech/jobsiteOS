# Campanhas (05B)

Disparo em massa a partir de segmentos, win-back de ex-clientes e lotes operacionais.

A frase que organiza o módulo é do prompt: **toda campanha é uma forma de gerar mensagens
individuais que, assim que alguém responde, deixam de ser campanha e viram conversa do
Agente**. Tudo aqui deriva disso.

## A decisão de arquitetura

Campanha **não tem transporte próprio**. Ela materializa destinatários e, no ritmo
configurado, empurra linhas para `mensagens_outbox` — a mesma fila que o compositor, a
régua da Antecipação e o Agente usam. Quem envia continua sendo
`jobs/comunicacao/enviar-fila`.

Três coisas só ficam certas por causa disso:

| | |
| --- | --- |
| **Um teto por número** | Com fila própria, os dois remetentes contariam o mesmo número separadamente: cada um respeitando metade do limite e os dois juntos estourando. O warmup viraria ficção. |
| **Prioridade do individual** | Vira um `ORDER BY campanha_id NULLS FIRST`, não um acordo entre dois processos. O vendedor que aperta enviar às 11h não fica atrás de duzentos disparos. |
| **Portão no envio** | `podeEnviar()` roda no INSTANTE do envio porque o envio é o mesmo código de sempre. Quem virou suprimido no meio do caminho é barrado sem que campanha precise saber que supressão existe. |

O preço é o vínculo de volta: `mensagens_outbox` ganhou `campanha_destinatario_id` e um
trigger propaga o desfecho. Trigger, e não código no worker de envio, porque esse worker
não deve aprender o que é campanha — no dia em que existir uma quarta origem, ela também
não vai precisar ensinar nada a ele.

## O caminho de uma campanha

```
rascunho ──simular──► aguardando_aprovacao ──pessoa aprova──► agendada
                                                                  │
                                      executor materializa ◄───────┘
                                                  │
                                       enfileira a leva do dia
                                                  │
                              enviar-fila aplica o portão e envia
                                                  │
                        ┌─────────────────────────┴──────────────┐
                   respondeu                                 não respondeu
                        │                                         │
              vira conversa do Agente                    toque 2 (D+3), toque 3
```

**Qualquer edição zera a simulação.** Aprovar sobre um retrato antigo é aprovar outra
campanha, então o RPC de salvar apaga `simulacao` e devolve o status a `rascunho`.

**O público congela na materialização.** Uma empresa que passaria a casar o filtro amanhã
não entra numa campanha aprovada ontem: público que muda depois de aprovado é público que
ninguém aprovou.

## Os motivos de exclusão

Cada um é uma resposta diferente à mesma pergunta ("por que esta empresa não recebeu?"), e
é por isso que eles não podem virar um `inelegivel` genérico. Metade do valor da simulação
é a pessoa olhar a lista e dizer "opa, 400 sem contato — está faltando enriquecer, não
filtrar".

| Motivo | O que significa | O que fazer |
| --- | --- | --- |
| `suprimido` | Pediu para não ser abordada, ou o e-mail deu hard bounce | Nada. É a única regra que nunca se fura |
| `processo_juridico` | Temos processo nosso ativo contra ela | Nada. Cobrar quem estamos processando vira print |
| `passivo` | Conta classificada como passiva | Só barra **prospecção**. Campanha operacional passa: o certificado dela vence do mesmo jeito |
| `sem_contato` | Sem e-mail/WhatsApp válido no canal | **Enriquecer.** Não é filtro, é dado faltando |
| `sem_base_legal` | Contato sem base legal registrada | Registrar a base em Contatos |
| `duplicado` | Outra pessoa da mesma empresa já entrou | Nada. Uma empresa gera um destinatário |
| `outra_campanha` | Já está em outra campanha viva | Esperar a outra terminar |
| `frequencia_90d` | Passou de `max_campanhas_por_contato_90d` | Esperar, ou subir o teto conscientemente |
| `conversa_aberta` | Tem thread viva | Nada. Disparo por cima de conversa em andamento é o pior erro possível |
| `contatado_recente` | Dentro de `excluir_contatados_dias` | Baixar a janela, se fizer sentido |
| `teto_diario` | Os números já mandaram o que aguentam hoje | Nada: vai para amanhã sozinho |
| `cancelada` | A campanha foi cancelada antes de chegar nela | — |

A **ordem** importa: o primeiro motivo é o que aparece. Dizer "sem base legal" para quem
está suprimido seria tecnicamente verdadeiro e praticamente inútil — a pessoa corrigiria a
base legal e continuaria sem receber.

## Por que resposta encerra a campanha

O gatilho é o **ledger**, não o webhook. Podia estar no webhook do WhatsApp, mas então o
Gmail precisaria da sua cópia e o Resend do dele — três lugares para a mesma regra é a
receita para que um deles não seja atualizado. Toda entrada passa por `comunicacoes`; é o
único ponto que nenhum canal consegue contornar.

O trigger distingue dois casos que seria fácil confundir:

- **já enviamos e a pessoa respondeu** → `respondida`. Entra na taxa de resposta.
- **ainda não enviamos e a pessoa escreveu** → `excluida` por conversa aberta. Contar isso
  como resposta inflaria a taxa com gente que respondeu a outra coisa.

Depois disso quem conduz é o Agente (05A), no modo que a campanha configurou
(`sugestao` por padrão). A campanha existe para **começar** conversas, não para conduzi-las.

## Sequência leve: até 3 toques, e para no primeiro sinal

`variantes` com `passo` (1..3) e `dias_apos` (medido do toque **anterior**, não do início
da campanha). Antes de cada toque seguinte, quatro perguntas:

respondeu? · descadastrou? · entrou na supressão? · **o Agente assumiu?**

Uma só resposta positiva encerra a sequência. As quatro moram juntas numa função
(`sequenciaCessouPara`) porque quem chama não deve poder lembrar de três e esquecer da
quarta.

Três é o teto por decisão: sequências longas e ramificadas são trabalho do Agente, que
sabe ler a resposta. Uma campanha que insiste cinco vezes sem ler nada é a definição de
spam.

## Ritmo, variantes e warmup

**A repartição entre números é proporcional à folga**, pelo método do maior resto. As duas
alternativas óbvias são piores por motivos opostos: round-robin cego dá a mesma quantidade
ao número novo em warmup e ao maduro (o novo estoura primeiro); guloso pela maior folga dá
**tudo** ao maduro e o número novo recebe zero — e número que não envia não aquece, então o
guloso desliga o warmup fingindo protegê-lo.

**A variante é derivada do id do destinatário**, não sorteada. Três consequências: a prévia
da simulação mostra o texto que a pessoa vai receber de verdade; reexecutar a materialização
depois de uma pausa não troca a mensagem de ninguém no meio da sequência; e o teste A/B
fica reproduzível. O passo entra no hash — sem isso, quem pegou a variante A no toque 1
pegaria A de novo no toque 2, e o segundo toque seria uma repetição do primeiro para metade
da base.

## Saúde do canal

`campanhas_config.limites`:

| Chave | Padrão | O que faz |
| --- | --- | --- |
| `max_campanhas_ativas` | 3 | Teto de campanhas simultâneas. Duas já disputam o mesmo teto de número |
| `max_campanhas_por_contato_90d` | 2 | Frequência máxima por contato no trimestre |
| `alerta_optout_pct` | 2.0 | Limiar de opt-out |
| `alerta_bounce_pct` | 5.0 | Limiar de bounce |
| `minimo_para_alertar` | 50 | **Amostra mínima.** 1 opt-out em 3 enviadas é 33% e não significa nada; sem piso, o primeiro alerta chega antes da primeira campanha de verdade e ensina o time a ignorar alertas |

O job de métricas varre as campanhas vivas de meia em meia hora — ele existe para quando
**ninguém está olhando**. O painel de quem abre a tela é calculado na hora, porque quem abre
quer o número de agora.

`contasSuspeitas()` compara as contas **entre si dentro da mesma campanha**: mesmo texto,
mesmo público, mesma janela. Uma conta entregando abaixo de metade da mediana das irmãs é a
conta, não a mensagem. O limiar é grosseiro de propósito — um teste estatístico decente
exigiria volume que uma campanha nossa raramente tem, e um limiar explicável vale mais que
um limiar defensável no papel.

## Atribuição: o que o funil da campanha realmente diz

`reunioes_agendadas`, `vendas_abertas`, `ganhos` e `valor_esperado_mensal` são **atribuição
por janela**: a empresa recebeu a mensagem e **depois** avançou. É correlação temporal, não
prova de causa — pode ter avançado por outro motivo. Um modelo de atribuição de verdade
precisaria de grupo de controle, e inventar precisão aqui seria pior do que declarar a
régua. A tela diz isso em voz alta.

## Como criar uma campanha a partir de um segmento

1. **Mercado → Explorador**: monte o recorte e salve como segmento.
2. **Comercial → Campanhas → Nova**: escolha "Segmento salvo" e o segmento. Escolha o canal.
3. **Conteúdo**: nome, tipo, objetivo (o objetivo é herdado pela conversa — é por ele que o
   Agente sabe o que fazer quando a pessoa responder) e as variantes. Uma variante é um
   template com peso; duas no mesmo passo viram teste A/B.
4. **Execução**: ritmo por dia, janela, guardrails, e o que o Agente faz ao receber resposta.
5. **Simulação**: total → elegíveis → excluídos com motivo, duração estimada, e a prévia de
   cada variante renderizada com destinatários reais. **Aprovar** agenda.

Pelos atalhos é mais curto: os quatro presets da tela de lista montam o público num clique e
tudo o mais segue igual. `winback_ex_clientes` **exige** escolher o motivo da saída (ou
tratar cada motivo como variante) — reativação genérica é spam com nostalgia.

## Onde cada coisa mora

- **Core** (`packages/core/src/campanhas/`): schemas e presets, motor de exclusão
  (`exclusao.ts`), resolvedor de destinatário (`publico.ts`), distribuidor de ritmo
  (`ritmo.ts`), variantes e sequência (`variantes.ts`), saúde de canal (`saude.ts`),
  validação de conteúdo (`conteudo.ts`). Tudo puro e testado.
- **Worker** (`apps/worker/src/campanhas/` + `jobs/campanhas/`): construção de público
  (o único lugar com `compileToSql`), coleta de fatos em lote, e os quatro jobs.
  `avaliar.ts` é a função que a **simulação e a execução compartilham** — se fossem dois
  caminhos, o dry-run seria teatro.
- **Web** (`app/(app)/comercial/campanhas/` + `components/campanhas/`): lista com presets,
  construtor em 4 passos, detalhe com progresso ao vivo.
- **Mobile** (`app/(tabs)/comercial/campanhas.tsx`): acompanhar, aprovar, pausar, retomar.
  O construtor é `webOnly`.

## O que ficou de fora

Voz, transcrição e análise de conversas (05C) · sequências longas e ramificadas
(responsabilidade do Agente, 05A) · landing pages e formulários (já em 04i) · SMS.

`filtro` e `lista_manual` existem no modelo e nos RPCs, mas o construtor manda salvar o
recorte como segmento: é a mesma definição, com nome e histórico. Um filtro anônimo dentro
de uma campanha é um filtro que ninguém consegue auditar depois.
