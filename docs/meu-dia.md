# Meu Dia (04p)

A home do vendedor: **Comercial → Meu Dia**. Não é um dashboard — é uma lista de trabalho
finita e completável. Cada item responde três coisas num olhar: **por que está aqui**,
**quanto vale** e **qual o botão que resolve**.

Três regras governam a tela inteira, e cada uma resolve um jeito conhecido de matar a
adoção de um painel:

- **Bloco vazio some.** A página encolhe conforme o dia é trabalhado, e o fim dela é
  "Tudo em dia por aqui", não uma lista de zeros.
- **Indicador abre modal, nunca navega.** Perder a página é perder o contexto do dia.
- **O gráfico é o navegador, e é o único.** Clicar numa fatia filtra os cards; ele
  responde "meu dia é feito de quê", não repete a lista logo abaixo.

## Onde cada coisa mora

| Peça | Arquivo |
|---|---|
| Catálogo dos blocos (fonte da verdade) | `packages/core/src/comercial/meu-dia.ts` |
| Agregador | `meu_dia()` + `app__md_originador/sdr/closer/comuns` no banco |
| Carga e projeção de comissão | `apps/web/src/components/comercial/meu-dia/queries.ts` |
| Tela | `apps/web/src/components/comercial/meu-dia/meu-dia-tela.tsx` |
| Ações (adiar, descartar, tarefas) | `apps/web/src/actions/meu-dia.ts` |
| Tabelas | migração `0190_meu_dia.sql` |

O **catálogo** é a única lista de blocos que existe. Ele dirige, ao mesmo tempo, os
limiares que o agregador aplica, o rótulo e a ação de cada card, e a tela de settings.
Três listas em três lugares divergiriam no primeiro bloco novo — e o sintoma seria um
bloco que aparece na tela e não aparece nas configurações.

## De onde vem cada número

### Originador
| Bloco | Fonte | Limiar |
|---|---|---|
| NFs de alta não prospectadas | `notas_fiscais` faixa `alta`, estágio `a_prospectar`, do vendedor | — |
| Antecipações travadas | `antecipacoes` em `DRAFT/REQUESTED/REPROVED/DENY_BY_CONTRACTED` sem conversão | dias parada (3) |
| Cedentes que pararam | `antecipacoes` agrupadas por cedente da carteira | dias sem antecipar (45), mínimo de antecipações (2) |
| Fornecedores a cadastrar | `fornecedores_funil` estágio `a_cadastrar` com contato | — |
| Fornecedores sem contato | idem, sem contato encontrado | — |
| Certificados a prospectar | `certificado_universo` das empresas da carteira | — |

### SDR
| Bloco | Fonte | Limiar |
|---|---|---|
| Inbound não contatado | `sdr_leads` origem `inbound`, estágio `a_contatar`, sem toque após a chegada | horas para virar urgente (4) |
| Leads perto de expirar | `sdr_leads` abertos, pelo último toque | SLA em dias (7), avisar faltando (2) |
| Conversas sem reunião | `conversas` do vendedor sem lead com reunião | dias parada (3) |
| No-shows | `sdr_leads` estágio `no_show` | — |
| Com fit, sem agendamento | `sdr_leads` com `fit` e sem `reuniao_em` | dias desde o fit (2) |
| Reuniões de hoje e amanhã | `sdr_leads.reuniao_em` | horizonte em dias (2) |

> **"Não contatado" não é `ultimo_toque_em is null`.** A rota de inbound carimba
> `ultimo_toque_em = distribuido_em` no nascimento do lead. A pergunta certa é se houve
> toque **depois** da chegada — sem isso, o bloco mais importante do SDR (aquele em que
> minutos importam) nunca encontrava nada.

### Closer
| Bloco | Fonte | Limiar |
|---|---|---|
| Aguardando documentação | `vendas` no estágio, pelo `atualizada_em` | dias parada (5) |
| Reuniões pendentes de aceite | `sdr_aceites` pendentes com destino nele | — |
| Crédito decidido | `vendas` + `analises_credito` aprovada/parcial/negada | — |
| Propostas sem resposta | `vendas` em `proposta_enviada` | dias parada (4) |
| Carteira passiva ociosa | `clientes_onepay` das empresas em `gestao_passiva` | dias sem antecipar (30), limite mínimo (50k) |
| Novos clientes | `empresas.marco_ativacao` dentro da janela | janela em dias (60) |
| Certificados vencendo | `certificados` das empresas da carteira | avisar faltando (30) |
| Análises expirando | `analises_credito.expira_em` | avisar faltando (60) |

### De todos
Conversas paradas, aguardando minha resposta, próximos passos do Agente (05A),
conversas não identificadas e tarefas manuais.

## Comissão projetada

Calculada em `projetarComissao()`, que roda **o motor do 04k** — mesmo VOP
(`valor × dias / N`), mesma fase, mesma taxa vigente, mesmo sunset. Uma segunda fórmula
"só para a projeção" seria a tela prometendo o que a folha não paga.

Só dois blocos projetam: **NF de faixa alta** e **antecipação travada**. Nos dois,
"converter" significa uma cessão de uma conta identificável. `cedentes_que_pararam` fica
de fora de propósito — ali o item soma meses de várias contas, e a taxa depende da
classificação de **uma**; escolher uma seria inventar o número.

O prazo presumido é **30 dias**, que é o denominador do VOP e portanto a ponderação
neutra: a projeção não infla nem desconta por um prazo que ninguém negociou ainda. O
rótulo na tela é honesto: *"se tudo converter"*.

## Quem vê o dia de quem

- **Auxiliar do closer**: espelha integralmente o dia do superior. O cabeçalho diz
  "Carteira de {closer}". A tradução mora em `cargoDeVisao()` e em `app_meu_dia_cargo()`.
- **Gestor**: seletor no topo, **leitura**. Ele vê, mas não adia nem descarta — decidir o
  dia dos outros é diferente de olhar para ele. Quem pode **mexer** vem de
  `app_meu_dia_alvos()`: eu, e o meu closer quando sou auxiliar.

## Ajustar os limiares

`Settings → Comercial → Meu Dia`, por tipo de vendedor. A tabela `meu_dia_config` guarda
**só o override** — chave ausente cai no padrão do catálogo. Guardar o catálogo inteiro
faria cada bloco novo nascer invisível para quem já tem linha salva.

A calibragem tem insumo: `meu_dia.item_adiado` e `meu_dia.item_irrelevante`. A distinção
importa — adiar é escolha de agenda, marcar irrelevante é **voto contra a régua do bloco**,
e por isso o descarte pede motivo. Um bloco que acumula descartes com o mesmo motivo está
pedindo um limiar diferente.

## O que as ações NÃO fazem

Nenhuma delas escreve no funil. Adiar uma NF não move a nota; descartar um lead não o
encerra. A tela é uma **leitura priorizada** do que já existe — se ela também escrevesse
no funil, "não é relevante" viraria uma forma silenciosa de perder negócio. Quem escreve
o funil é o card do funil, que o botão primário abre em outra aba.
