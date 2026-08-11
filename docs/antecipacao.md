# Módulo Antecipação (Prompt 04)

O **funil de notas fiscais**. Duas unidades, deliberadamente separadas:

- **A NF é a unidade do funil** — dinâmica (novas a cada sync), perecível (expira com o
  vencimento), classificada em faixas por regra versionada.
- **O fornecedor é a unidade de abordagem** — tipagem comercial, cooldown de toques,
  agrupamento de mensagens. Ninguém recebe um toque por nota; recebe um toque pelo
  conjunto de notas vivas.

## `faixa` não é `estagio_funil`. Comece por aqui.

É a mesma distinção de `camada` vs. `estagio` no Mercado, e pelo mesmo motivo:
misturar as duas transforma um sinal automático numa opinião editável.

|  | `faixa` | `estagio_funil` |
| --- | --- | --- |
| O que é | Classificação **computada** por regra versionada | Posição no funil |
| Valores | `alta` \| `boa` \| `media` \| `null` | `a_prospectar` → `em_prospeccao` → `em_negociacao` → `antecipacao_andamento` → `convertida` \| `perdida` \| `expirada` |
| Quem muda | O job de reclassificação | **Ação humana** (RPC `app_mover_estagio_nf`) |
| Onde se muda o critério | Regras de faixa (`/antecipacao/faixas`) | Não se muda: é o registro do que aconteceu |

Ninguém "move" uma nota de faixa. Muda-se a regra, ou muda-se o dado. Quando a faixa
sai, `faixa_motivo` diz por quê: `regra`, `expirada`, `suprimido` ou `fora_das_faixas`.

## Precedência da classificação

O job aplica, nesta ordem, **antes** de qualquer regra:

1. `fornecedor_suprimido` → fora das faixas (`suprimido`)
2. `dias_para_vencimento < minimo_operavel` (default 7) → fora das faixas (`expirada`)
3. `alta` → `boa` → `media`, a primeira que casar
4. nenhuma → fora das faixas (`fora_das_faixas`)

As duas guardas ficam **fora** das regras de propósito. Repeti-las nas três regras e
esquecer numa delas seria mandar mensagem para quem pediu para não ser abordado.

## Política de expiração

**Sem o job diário o funil apodrece em duas semanas.** As notas não mudam — o
calendário muda. Uma nota que estava em faixa alta com 40 dias de prazo vira, sozinha,
uma nota impossível de operar, e continuaria no topo do Kanban ordenada por uma receita
esperada que também está errada (a receita depende do prazo).

O job diário (`/api/cron/antecipacao-diario`, 05:00 UTC) faz, nesta ordem — que é uma
cadeia de dependências, não uma preferência:

1. **Supressões expiradas** — um fornecedor cuja supressão caiu hoje precisa voltar a
   ser elegível *antes* de a faixa ser recalculada.
2. **Lookup cadastral** — o dado que chega agora é o que as variáveis de faixa vão ler.
3. **Reclassificar** — recalcula `dias_para_vencimento`, `receita_esperada`, faixa e
   expiração; move para `expirada` o estágio de quem estava em prospecção ativa.
4. **Outbox** — só faz sentido sobre faixas já corretas.

Sair da faixa **não** é sair do funil: uma nota que só deixou de casar a regra continua
`a_prospectar` (a regra pode voltar a casar amanhã). Quem sai do funil é quem expirou.

## O modo sombra, e o que falta para ligar os envios

Ligar um canal em `/antecipacao/disparos` **não liga envio**. Liga a *geração* da fila:
o job produz a mensagem exata que sairia, com o destinatário que seria escolhido, e a
deixa em `mensagens_outbox` com `status = 'pendente_envio'`. **Nada sai neste prompt.**

É de propósito que a validação venha antes do canal: ligar canais primeiro e conferir
depois é como se queima uma base de contatos.

Três portas antes de gerar, cada uma por um motivo diferente:

| Porta | Por quê |
| --- | --- |
| `estaSuprimido()` | É um pedido explícito de não ser abordado (ou LGPD) |
| Cooldown | Protege a relação — e conta **toque manual** do vendedor, para a régua não atropelar quem acabou de ligar |
| Contato | Sem canal válido não há mensagem. O descarte com motivo `sem_contato` é insumo direto para um lote de contatos no Radar |

**Para ligar os envios (Prompt 05) falta:** o transporte de e-mail (Resend já está nas
deps do web), o cliente do provedor de WhatsApp lendo o token do Vault, o passo de
`aprovada` → `enviada` com retry e registro de falha, warmup por número, e o tratamento
de **resposta** (que é o que transforma a outbox num inbox). A tabela, o agrupamento, a
escolha de destinatário, o cooldown e o round-robin entre contas **já existem** — o que
falta é o transporte, não a régua.

## Supressão: soft vs. eterna

`supressao` é **uma** lista (a do Radar), agora com validade:

- **Soft** (`expira_em = hoje + 90 dias`, configurável): "sem interesse agora". O job
  diário remove a linha e o fornecedor volta a ser elegível.
- **Eterna** (`expira_em = null`): LGPD, ou a multinacional que nunca vai antecipar.
  Nunca expira, e o job de limpeza **não a toca**.

`estaSuprimido()` e a view `notas_funil` aplicam o **mesmo** predicado de validade. Se
discordassem, um fornecedor sumiria do Kanban e continuaria recebendo mensagem — ou o
contrário.

## Ponto focal

`contatos.ponto_focal`, no máximo um por empresa (índice parcial único). Existe porque
"melhor contato disponível" é heurística, e heurística escolhe o estagiário do
financeiro quando ele é o único com e-mail preenchido.

**Toda** escolha de destinatário segue a mesma hierarquia — ponto focal → melhor
contato com canal válido e não suprimido. Vale para a outbox **e** para os botões de
contato de um toque no mobile. Se o app escolhesse diferente da automação, o vendedor
ligaria para uma pessoa e a mensagem automática iria para outra.

Marcar um desmarca o anterior **na mesma transação** (`app_definir_ponto_focal`): duas
chamadas do cliente deixariam uma janela em que a segunda falha e a empresa fica sem
ponto focal nenhum.

## Enriquecimento cadastral de fornecedores (§3.1)

Fornecedores chegam pela NF só com nome e CNPJ, e a maioria tem CNAE **fora** do recorte
de construção — portanto não existe em `mercado_universo`. Sem dado cadastral, as
variáveis de faixa e a Company 360 ficam cegas justamente para o lado do funil que mais
cresce.

`cnpj_lookup_fila` + cascata de APIs públicas **gratuitas**:

1. `minhareceita.org` — espelho do dump oficial, o mais completo e rápido
2. `brasilapi.com.br` — mesma origem, outra hospedagem (cobre a queda da primeira)
3. `receitaws.com.br` — **último recurso**, 3 req/min no plano free, throttle rígido

O resultado normalizado entra em **`mercado_universo`** com `origem_ingestao = 'lookup'`
e `fora_recorte_cnae = true` quando o CNAE não é 41/42/43. A partir daí todo o resto do
sistema — filter engine, reconciliação com `empresas`, Company 360 — funciona sem uma
linha de código nova. E a regra do TAM exige `fora_recorte_cnae = false`, então eles
existem no staging **sem** poluir a pirâmide comercial.

Só marca `nao_encontrado` quando alguma fonte respondeu dizendo que não conhece, ou
quando as tentativas acabaram (default 10). Um dia de rede ruim não condena um CNPJ a
nunca mais ser consultado.

### A fila estava crescendo, não drenando

Medido: **4.280 fornecedores** distintos nas notas, **1.134 (26%)** com cadastro. A fila
tinha 3.330 pendentes e **nenhum deles jamais tentado**. A causa não era bug de código —
era aritmética: `max_por_execucao = 300`, rodando **uma vez por dia**, contra ~1.100
CNPJs novos por dia.

Duas mudanças, as duas de custo zero, porque as fontes são gratuitas:

- **`max_por_execucao` foi para 2.000.** O teto por corrida precisa ser maior que a
  chegada diária, senão a fila só cresce. A primeira fonte responde em ~250ms: 2.000
  CNPJs são ~8 minutos.
- **`orcamento_ms` (novo, 10 min).** O teto por quantidade não protege sozinho: se a
  primeira fonte cair, a cascata desce para a ReceitaWS a 21s por CNPJ e 2.000 viram 11
  horas. O relógio é checado **antes** de gastar a chamada — parar no meio de um CNPJ
  marcaria a fila como tentada sem resposta nenhuma. A fila é persistente; o que sobra é
  a primeira coisa da próxima corrida.

### E o lookup entrou no sync, entre o sync e a reclassificação

A ordem certa é **sincroniza NF → coleta o cadastro do fornecedor → classifica**. O job
diário já fazia isso; o sync de 4 em 4 horas, não:

```
antes:  sync-nfs → reclassificar → outbox
agora:  sync-nfs → lookup → reclassificar → outbox
```

Sem o lookup no meio, a nota de um fornecedor novo era classificada com o cadastro em
branco e só corrigida na madrugada seguinte — **até 16h de faixa errada**, em silêncio.
Isso era inofensivo enquanto nenhuma regra usava capital social; deixa de ser no minuto
em que a primeira existir. A fila prioriza `criado_em desc`, então os CNPJs daquela
corrida são exatamente os primeiros da vez. O orçamento aqui é mais curto (4 min): há um
sync a cada 4h esperando atrás.

## Contatos: o dado chega na nota, e agora vira contato

O payload da NF traz `supplier.contact` e `recipient.contact`. Até a rodada de melhorias
esse dado só era gravado como **jsonb dentro da nota**, servindo de último recurso para a
Outbox. Resultado medido: `contatos` com **zero linhas** enquanto 21 fornecedores e 89
sacados mandavam nome, e-mail e telefone seis vezes por dia — e o Radar era acionado para
redescobrir (pagando) o que a API já tinha entregue.

`materializarContato` roda no sync e `backfillContatosNf` varre o que já está no banco. A
lógica de decisão está em `core/antecipacao/contato-nf.ts`, testada, e sai toda de uma
premissa: **o dado da NF é o mais fraco de todos.** Não foi curado por ninguém, veio de um
cadastro preenchido para emitir nota, e chega repetido a cada sync.

| situação | ação |
| --- | --- |
| não existe contato equivalente | **insere**, `origem = 'nf'` |
| existe e veio da NF | **completa só os campos vazios** |
| existe de outra origem (Apollo, manual) | **não toca** |

"Completa só o que está vazio" é o que torna seguro rodar seis vezes por dia para sempre:
a segunda passagem não desfaz a primeira, e uma correção manual sobrevive a todas elas.
Equivalência é por e-mail **ou** por telefone normalizado — o mesmo número em duas formas
(`+5511…` e `11…`) tem de casar, senão a supressão fura.

**Exige `empresa_id`**, e isso é decisão: `contatos.empresa_id` é NOT NULL, e um contato
órfão não aparece em ficha nenhuma nem é alcançável pela hierarquia de ponto focal.
Fornecedor de aquisição só ganha contatos depois de **promovido** (abaixo); até lá a
Outbox continua lendo o jsonb da nota normalmente.

O backfill roda **depois** do lookup no job diário, de propósito: promover cria a empresa,
e só a partir daí o contato tem onde ser gravado.

## Fornecedor de aquisição não vira `empresas` — e isso é decisão

O sync só cria empresa para participante `registered`. São centenas de CNPJs novos por
semana que ninguém trabalha; criar empresa para todos transformaria o CRM num espelho da
carteira de notas dos clientes. Eles existem em **`mercado_universo`** via lookup
cadastral, que é o suficiente para o funil classificar e para a ficha mostrar cadastro.

A decisão só se sustenta porque existe a **porta manual**: o botão *Promover para
Empresas* na ficha do fornecedor. Ele chama `app_promover_empresa` com
`tipo = 'fornecedor'`, e esse parâmetro é novo (migration `0058`) — antes o RPC gravava
`'construtora'` fixo, o que envenenaria a pirâmide comercial, os segmentos e o TAM, que
leem essa coluna. O `tipo` também precisou entrar no **schema zod**: zod descarta chave
desconhecida em silêncio, então sem isso o valor sumiria a caminho do banco e o erro
apareceria meses depois, como um fabricante de esquadria contado no TAM.

### A promoção virou consequência, não pré-requisito (0068)

A porta manual tinha um problema de ordem. `contatos.empresa_id` é NOT NULL, então
cadastrar contato de fornecedor exigia lembrar de promover **antes** — e o passo que se
precisa lembrar é o passo que não acontece. Agora o formulário de contato promove no
**submit**, e só no submit: promover ao *abrir* o diálogo criaria empresa para quem
desistiu no meio. Um fornecedor com contato é, por definição, um fornecedor que alguém
trabalha; ele merece a ficha.

`EmpresaContatos` aceita `empresaId: null` + `aoPrecisarDeEmpresa`, então é o **mesmo
componente** com ou sem empresa. Duas versões da lista de contatos divergiriam na
primeira mudança.

**E aqui apareceu a terceira porta fechada da mesma família (0060, 0066).** Promover a
partir do funil esbarrava em três coisas, todas de módulos que o Comercial não tem:

| onde | exigia |
| --- | --- |
| `promoverEmpresaAction` | módulo `mercado` |
| policy `empresas_insert` | módulo `empresas` |
| policy `mercado_universo_vincular` (UPDATE) | módulo `mercado` |

E `app_promover_empresa` é SECURITY INVOKER, então nada disso era contornável do lado da
aplicação. `app_promover_fornecedor` (0068) é DEFINER com um recorte estreito: só CNPJ
que **é fornecedor de alguma nota**, `tipo` sempre `'fornecedor'` e `origem` sempre
`'antecipacao'`, fixados no corpo da função e nunca vindos do cliente. Este caminho não
consegue criar construtora nem tocar a pirâmide. É idempotente, como o de Mercado.

## Protesto do fornecedor, direto do funil (0066)

A hipótese comercial é que fornecedor com protesto antecipa mais — é dinheiro parado e um
caminho de crédito a menos. O protesto já era variável do motor de faixa
(`fornecedor_tem_protesto`, `fornecedor_protesto_valor`); o que faltava era **como
consultar** sem passar por Mercado.

O modelo sempre permitiu: `protestos_consultas.cnpj` é NOT NULL e `empresa_id` é
nullable. Exigir a promoção antes inverteria a ordem da decisão — é o protesto que ajuda
a decidir quem vale promover.

- Botão na ficha do fornecedor → lote de **1 item** em `lotes_enriquecimento`, com
  `motivo: 'antecipacao_fornecedor'`. O gasto continua auditável no mesmo lugar de sempre.
- `incluir_fora_sp: true` de propósito: o roteamento **pula** o item quando a UF não é SP
  e o parâmetro está desligado. Num clique deliberado, voltar "pulado" sem consultar nada
  seria o pior resultado.
- **Reclassifica o funil em seguida**, na mesma corrida. Consultar e não reclassificar
  deixaria o dado novo na tabela e a faixa velha no card — pagou-se por uma informação
  que a tela ainda não usa.
- O preço aparece **antes** do clique (R$ 0,36 SP / R$ 3,50 nacional), vindo de
  `radar_config` por um DEFINER que devolve só dois números (0067). Chumbar no front
  criaria uma segunda verdade, e um botão que promete um preço e cobra outro é pior que
  um botão sem preço.

### O buraco de RLS que isso expôs (de novo)

Mesma família da `0060`, agora em protestos: a policy de `protestos_consultas` era
`app_tem_modulo('radar')`, `notas_funil` é `security_invoker`, e a view faz
`coalesce(fpa.tem_protesto, false)`. Para o perfil Comercial o resultado não era "não
sei" — era **`fornecedor_tem_protesto = false`**. Fornecedor com protesto aparecendo como
limpo, sem erro e sem aviso.

A classificação nunca esteve errada: o worker roda com service role e ignora RLS. Errado
era só o que a **pessoa** via, que é o que decide a ligação. E passaria a doer de verdade
agora: o Comercial pagaria R$ 3,50 e a tela continuaria dizendo a mesma coisa.

`fornecedor_protesto_em` também entrou na view, porque sem ela "sem protesto" e "nunca
consultado" são a mesma tela — e a diferença é justamente a que decide se vale gastar.

## O que promoção NÃO destrava

Vale registrar, porque a intuição erra aqui: promover **não** é o que libera a análise de
capital social e protesto. Isso já chega ao funil por CNPJ, via `mercado_universo` e
`protestos_atual` (0058/0060/0066), e o catálogo de faixa já tem as variáveis. O que
depende de `empresas` é só **contatos** — e, por tabela, timeline e Company 360.

Promover os 4.280 fornecedores para "ter análise" resolveria o problema errado, e não
sairia de graça: `empresas` alimenta contadores, listas e segmentos, e nem toda tela
filtra por `tipo`.

### A hipótese de conversão ainda não é testável

Medido contra a base: **6** fornecedores já anteciparam, contra 4.274 que não. Os 6 têm
capital social mediano de R$ 13,5M contra R$ 60k, e 19,8 anos de idade média contra 12,4
— o **oposto** da hipótese. Com n=6 isso não prova nada, e há viés claro:
`fornecedor_ja_antecipou` sai de `clientes_onepay.last_anticipation`, ou seja, são
clientes Onepay existentes, naturalmente maiores.

Por isso capital e protesto entram como **sinal e ordenação**, nunca como porta de
exclusão, até haver desfecho suficiente para medir.

## Cadastro da Receita na ficha (capital social e afins)

`empresas` **não guarda** capital social, situação cadastral nem data de abertura — e não
vai guardar. A tabela registra o que *o time* sabe (estágio, ERP, dono); o que a Receita
diz mora em `mercado_universo`. Duplicar criaria duas verdades que divergem no dia em que
uma das duas for atualizada.

O card `CadastroRfb` (web: `components/cadastro/`, mobile: `features/cadastro/`) lê o
universo por CNPJ e aparece em três telas: ficha da empresa, ficha do fornecedor no funil,
e a versão mobile das duas. Ausência é **estado**, não erro: sem linha no universo o card
diz que o CNPJ está na fila de enriquecimento. Um card vazio seria lido como "capital zero,
empresa nova" — uma conclusão, não uma ausência.

### O recorte de RLS que isso expôs

`notas_funil` é `security_invoker`, e `mercado_universo` só liberava leitura para quem tem
o módulo **`mercado`**. Medido contra a base real, simulando o perfil **Comercial** (que
tem só `antecipacao`):

| | Admin | Comercial |
| --- | --- | --- |
| notas visíveis | 766 | 766 |
| notas com `sacado_construcao` | 8 | **0** |
| notas com capital do fornecedor | 76 | **0** |
| **sacados a prospectar** | 8 | **0** |

A tela de prospecção ficava **vazia** — sem erro, sem aviso — exatamente para o único time
que a usa. E vazia de um jeito convincente: "nenhuma construtora nesta condição" é uma
frase em que se acredita. Ninguém foi atingido só porque ainda não existe usuário
Comercial; isso é sorte de cronograma, não desenho.

Migration `0060` estende a policy: Mercado lê o universo inteiro; Antecipação lê **apenas
o cadastro de CNPJs que aparecem em notas que a própria pessoa pode ler** (61 de 876.204
linhas, na base atual). Uma policy só com `or` em vez de duas, porque `or` curto-circuita
por linha e o usuário de Mercado não pode pagar o `exists` numa varredura de 740 mil
linhas. O probe de RLS cobre os dois lados.

## O leitor de NF

Clicar num card abre a nota **como documento** — layout de DANFE no desktop, blocos
empilhados no celular. Dois formatos:

| Formato | Suporte |
| --- | --- |
| **NFe** (modelo 55) | completo: identificação, protocolo, emitente/destinatário com endereço e IE, itens com imposto, totais, transporte, fatura e duplicatas |
| **NFS-e nacional** (`infNFSe`/`DPS`) | completo: prestador, tomador, serviço, valores e ISS |
| **NFS-e municipal antiga** (ABRASF, `Rps`) | **não suportada** — cada prefeitura tem o seu layout e não há esquema único. O leitor diz isso em vez de desenhar errado |

A detecção é por marcador, e a **ordem importa**: `InfNfse` (municipal) e `infNFSe`
(nacional) são a mesma string sob comparação case-insensitive, então os marcadores
municipais são checados primeiro. O discriminador confiável é o RPS — o padrão nacional
o substituiu pelo DPS. Um teste trava isso.

O leitor (`packages/core/src/antecipacao/documento-fiscal.ts`) é compartilhado pelas
duas plataformas; o que muda é o desenho. **Nada nele lança**: um XML corrompido vira um
aviso legível, porque a alternativa é uma tela branca no meio de uma ligação.

**O XML é carregado sob demanda**, quando o modal abre — nunca na consulta da lista. Um
XML de NFe tem dezenas a centenas de KB e o Kanban pinta 40 cards por coluna.

O modal tem aba **XML** (bruto, copiável e baixável) porque quando um campo não aparece
no documento desenhado, a pergunta seguinte é sempre "mas está no XML?".

Não é o DANFE oficial e não finge ser: sem código de barras, sem canhoto, sem tarja de
documento auxiliar. O rodapé diz que é representação para conferência interna.

## O card

**Web** — enxuto: fornecedor, número e tipo da nota, valor, sacado e crédito. Receita
esperada e vencimento saem do corpo e vivem no **tooltip**, junto do nome completo do
fornecedor (quase sempre truncado). Uma coluna tem 40 cards; cada linha a menos é uma
linha a mais de contexto sem rolar.

**Mobile** — ganha número e tipo, mas **mantém o prazo com cor de urgência**. Não há
hover para compensar, e o §9 pede o sinal: é o que faz o card ser lido em um segundo, na
rua. Enxugar os dois igualmente deixaria o card do celular bonito e mudo.

Em ambos, **clicar/tocar abre a nota**. O caminho para o fornecedor não se perdeu: no
web o nome é link e o "+N notas" é link; no mobile o "Ver fornecedor" é explícito.

## Tabelas ordenáveis: a convenção

Duas telas usam (`components/antecipacao/tabela-ordenavel.tsx`): **capacidade por sacado**
e **sacados a prospectar**. O cabeçalho, o primeiro clique e a persistência vivem lá, e
não em cada tela, porque "clicou no cabeçalho, ordenou" tem de se comportar igual em toda
a Antecipação — duas implementações viram duas convenções em uma semana.

Três decisões que valem para as duas:

- **O ícone da coluna inativa é invisível até o hover.** Sete setas acesas ao mesmo tempo
  escondem qual é a ordem em vigor, que é a única coisa que o cabeçalho precisa dizer de
  relance.
- **O primeiro clique já vem na direção útil**: `desc` em coluna de número e de data (o
  topo é o que se procura), `asc` em texto.
- **O desempate é sempre por nome, ascendente**, mesmo com a coluna em `desc`. Sem ele,
  empates grandes — 108 sacados sem análise de crédito, 149 construtoras em `universo` —
  trocam de lugar entre dois carregamentos e a mesma tela parece outra lista.

A preferência é salva em `localStorage`, uma chave por tela. É do **navegador, não da
URL**: um link colado no grupo tem de abrir a lista inteira para quem recebe. O estado
inicial é sempre o padrão, nunca o storage — ler no render divergiria do HTML do servidor
e quebraria a hidratação; a leitura acontece no efeito. E o que volta do storage passa
por `sanear()` obrigatório: é texto editável pelo usuário que sobrevive a refatoração, e
uma coluna que saiu do catálogo viraria um `sort` por campo inexistente, com tabela em
ordem aleatória e nenhum erro na tela.

## Capacidade por sacado: ordenação e filtro

As sete colunas da tabela ordenam por clique no cabeçalho. **A ordenação é feita no
cliente**, sobre as até `LIMITE_SACADOS` (300) linhas que a leitura já trouxe — são 154
hoje. Refazer a consulta a cada clique trocaria um `sort` instantâneo por um round-trip
com skeleton, e não há ganho nenhum nessa escala.

O preço disso está declarado na tela: se a leitura bater no teto, um rodapé avisa que a
ordem vale sobre o recorte. Sem esse aviso, "ordenar por receita" devolveria *as maiores
receitas entre as 300 maiores demandas* — um resultado errado com cara de certo.

**Crédito ordena por proximidade de operar**, não por alfabeto: aprovado, em análise,
pendente, expirado, recusado, bloqueado, sem análise. Por texto, "Aprovado, Bloqueado, Em
análise" juntaria quem opera hoje com quem nunca vai operar.

O **filtro por status de crédito** fica salvo em `jobsiteos.antecipacao.sacados.v1`,
junto da ordenação — quem trabalha essa tela trabalha um recorte só, e refazer a escolha
toda visita é o atrito que faz a pessoa parar de usar o filtro.

Duas defesas contra "a tela está vazia e eu não sei por quê": com filtro ativo, o
cabeçalho diz *mostrando X de Y* e a contagem de sacados estourando o limite conta só as
linhas visíveis — um número que conta a base inteira não bate com nenhuma linha da
tabela. As opções do Select saem **dos dados**, não de uma lista fixa: `credito_status`
vem cru da Onepay, e um status novo apareceria no badge da linha sem existir no filtro.

## Sacados a prospectar: o recorte é por CNAE

Construtoras que **recebem NF** e **não estão na plataforma**. Duas condições, e só:

```sql
where not sacado_cadastrado
  and sacado_construcao      -- CNAE na divisão 41, 42 ou 43
```

**A regra original do Prompt não funcionava.** Ela pedia "sacado não cadastrado E fornecedor
que já antecipou", e `fornecedor_ja_antecipou` casa o CNPJ do FORNECEDOR contra
`clientes_onepay` — que só contém **construtoras**, isto é, os sacados. O predicado era
quase sempre falso e a tela vinha vazia.

O que de fato separa oportunidade de ruído é o **CNAE do sacado**. Sem ele a lista vira
"todo CNPJ que já apareceu como destinatário": posto de gasolina, papelaria, o contador
do fornecedor. O sinal antigo não sumiu — virou a coluna
`notas_de_quem_ja_antecipou`, um indicador de temperatura **dentro** da lista em vez de
um portão na entrada dela.

**De onde vem o CNAE:** `mercado_universo` — inclusive dos sacados que nunca estiveram no
recorte de construção do dump da Receita, porque o lookup cadastral (§3.1) os insere lá.
O sync já enfileira todo sacado desconhecido com motivo `sacado_nf`.

**A troca assumida:** sacado com CNAE ainda desconhecido **não aparece**. Existe uma
janela entre a nota chegar e o lookup responder. A tela mostra quantos estão pendentes —
sem isso, uma lista curta pareceria "não há oportunidade" quando na verdade é "ainda não
sabemos".

O ranking **padrão** é por valor agregado, sem janela de tempo: um relacionamento grande
e antigo ainda supera um menor e atual. Todas as colunas ordenam por clique — inclusive
`ultima_nota_em`, que antes estava na tela só para você notar.

### A camada do sacado (0065)

A lista responde "quem recebe nota e não está na plataforma". O que ela não dizia é se
aquele CNPJ **já é alvo de Mercado** — e são perguntas que se respondem juntas. Uma
construtora em **SOM** tem sinal de compra hoje e a abordagem é outra; uma em `universo`
recebe nota e não passou em nenhuma regra, e vale entender por quê antes de gastar uma
ligação.

Na base atual, das 279: **149 universo, 81 SAM, 38 TAM, 11 SOM**. Nenhuma fora de
`mercado_universo` — o recorte por CNAE já garante isso, porque é de lá que o CNAE vem.

O badge é o **mesmo componente de Mercado** (`CamadaBadge`), com a rampa ordinal da
pirâmide e do Mapa. Recolorir aqui faria a mesma palavra significar duas coisas
dependendo da tela em que você a lê.

`sacado_camada` sai só de `mercado_universo`, **sem coalesce com `empresas`**: camada é
decisão das regras de Mercado, não atributo do cadastro. `NULL` quer dizer "fora do
universo", que é diferente de `universo` — este passou pelas regras e não subiu em
nenhuma. Ordenar por camada usa **proximidade de virar cliente** (SOM, SAM, TAM,
universo), não alfabeto: por texto sairia "sam, som, tam, universo", que não quer dizer
nada.

## Fornecedores a prospectar: a mesma pergunta pelo outro lado da nota (0101)

A tela irmã. Lá o lead é a construtora que **recebe** e não é nossa; aqui é quem **emite**
para as construtoras que já são nossas:

```sql
from notas_funil f
  join antecipacao_sacados_com_credito cc on cc.cnpj = f.sacado_cnpj
where emitida_em >= now() - interval '90 days'
  and not exists (select 1 from notas_fiscais n2
                  where n2.fornecedor_cnpj = f.fornecedor_cnpj and n2.fornecedor_cadastrado)
group by fornecedor_cnpj
```

**O que qualifica o lead é o sacado ter crédito aprovado**, e ele faz aqui o que o CNAE
faz na outra lista: separa oportunidade de ruído. Sem esse recorte a lista viraria "todo
CNPJ que já emitiu uma nota". Não há portão de CNAE: não é o setor do fornecedor que diz
se ele é oportunidade.

### "Cadastrado" não bastava (0102)

A primeira versão usou `sacado_cadastrado`, e a base mostrou o tamanho do erro:

| Sacado na janela de 90 dias | Notas | Sacados |
|---|---:|---:|
| cadastrado + `APPROVED` | 5.199 | 56 |
| cadastrado + **sem análise** | **12.069** | 172 |

Sete de cada dez linhas eram fornecedores emitindo contra empresas que estão na
plataforma mas **não têm limite aprovado** — para essas não existe operação a oferecer.
A lista caiu de 5.512 para 1.808 fornecedores, e os contadores por fornecedor passaram a
contar só as notas que interessam: quem emite 100 notas e 6 para sacado aprovado aparece
com 6, não com 100.

**Holding ou SPE.** A aprovação nem sempre está no CNPJ da nota: em **18 dos 78** sacados
que entram, o crédito foi aprovado noutro CNPJ do mesmo grupo — a holding cliente cuja
SPE aparece na nota, o caso que a `0097` modelou. Exigir a aprovação no CNPJ da nota os
descartaria em silêncio. É o que a view `antecipacao_sacados_com_credito` resolve, e ela
acha o grupo por **`mercado_universo`, não por `empresas`**: a policy de `mercado_universo`
já libera para quem tem `antecipacao` as linhas cujo CNPJ aparece nas suas notas, enquanto
passar por `empresas` exigiria outro módulo — e o custo de errar aí é a tela vir vazia sem
dizer por quê.

O `bool_or(credit_status = 'APPROVED')` é por **sacado**, não por nota: a análise costuma
chegar depois das primeiras notas, e exigir o flag em cada linha faria o mesmo sacado ser
aprovado numa nota e desconhecido na anterior.

**A janela de 90 dias vive na view, não na tela.** Como a lista é ordenada por *volume de
notas*, deixar a janela aberta premiaria o passado: quem emitiu muito no ano passado e
parou passaria na frente de quem está emitindo agora.

**O "não cadastrado" do fornecedor vale sobre todas as notas dele**, não só as que
passaram no filtro — estar na plataforma é propriedade do fornecedor, não de um
subconjunto das suas notas. Na 0101 esse `not exists` custava 1,2 s, e por isso a regra
morava num `having bool_or(...)` sobre as linhas filtradas; com o recorte por crédito o
conjunto caiu de 17.050 para 5.887 linhas e o anti-join sai por **240 ms**.

**O teto foi dimensionado para não morder.** Era 500, recortando por número de notas, e
isso escondia lead bom: DIAGRAMA AR CONDICIONADO emitiu **uma** nota de R$ 644 mil para um
sacado aprovado — 14º maior valor da lista e 1.233º em contagem de notas, portanto fora da
tela. Não era daquele CNPJ: **826 dos 1.808** fornecedores têm exatamente uma nota e somam
R$ 9,4 mi. Truncar por contagem e depois deixar o usuário ordenar por valor responde a
pergunta errada, e o aviso no rodapé explicava o defeito em vez de corrigi-lo. A lista
inteira são 741 kB numa leitura só; o teto virou 3.000 e existe como rede.

Com 1.808 linhas a tela ganhou **busca por nome ou CNPJ** (dígitos só, como a de clientes
Onepay). `notas_operaveis` (a regra de natureza, `0061`) segue sendo a armadilha da tela:
fornecedor com volume alto e **zero** notas que a operação consegue atender.

**O `.limit()` não é a última palavra — a leitura é paginada.** Subir o teto de 500 para
3.000 trouxe 1.000 linhas, não 1.808: o PostgREST tem um teto próprio por resposta (1.000
por padrão no Supabase) e **ignora em silêncio** um `.limit()` maior — não erra, não avisa,
devolve menos. É o pior formato possível de bug, porque a tela mostrou *mais* fornecedores
do que antes e pareceu resolvida enquanto o lead da 1.233ª posição continuava fora.

Por isso `buscarFornecedoresAProspectar` roda um laço de `.range()`. Dois detalhes que
parecem cosméticos e não são:

- **O desempate no `order by` é obrigatório.** 826 fornecedores empatam em uma nota; sem
  uma segunda chave (`fornecedor_cnpj`), o banco pode devolvê-los em ordens diferentes a
  cada página, e a paginação passa a repetir linhas e pular outras.
- **O laço avança pelo que veio, não pelo que foi pedido.** Tratar resposta curta como
  "acabou" pararia no meio da lista se o teto do servidor fosse menor que a página.

RLS: nenhuma policy nova. A de `mercado_universo` (`0060`) já cobre `fornecedor_cnpj`
explicitamente, não só o sacado.

**RLS não mudou.** `notas_funil` é `security_invoker` e a policy de 0060 já libera, para
quem tem `antecipacao`, as linhas de `mercado_universo` cujo CNPJ aparece numa nota que a
pessoa pode ler. Camada é mais uma coluna **dessas mesmas linhas**; o recorte de 0060 é
por linha e continua valendo inteiro.

**Um bug que apareceu no caminho:** a leitura tinha `limit(200)` e a lista já tem 279 —
79 construtoras eram cortadas em silêncio, e nada na tela dizia isso. O teto virou 500 e,
se um dia encostar, aparece o aviso de que a ordem vale sobre o recorte.

Clicar num sacado abre `/antecipacao/sacados/{cnpj}` com **as notas que ele recebeu** —
a mesma tela que a aba de capacidade usa, porque a pergunta ("quem emite para ele, e
quanto?") é a mesma nos dois caminhos.

## Conversão automática: quem marca a nota como convertida (04e)

Até aqui `estagio_funil = 'convertida'` só existia por clique humano — **5 notas em
15.870**. A métrica por faixa media intenção, não receita: "a faixa alta converte melhor"
era uma frase sobre quem alguém lembrou de arrastar.

Agora a **antecipação realizada na plataforma** é quem marca. O sync de
`/api/v1/anticipations` roda **encadeado ao sync de NFs**, de 4 em 4 horas, e casa cada
antecipação com a nota que ela antecipou.

### A regra que governa tudo: precisão acima de recall

Casar com a NF errada marca como antecipada uma nota que ninguém antecipou — e **nada na
tela denuncia**. O funil fica verde, a métrica conta uma conversão que não houve, e a
próxima decisão comercial sai de um número inventado. Um caso a mais na fila de revisão
custa um clique.

Por isso não existe caminho de "melhor palpite". As regras, em ordem
(`packages/core/src/antecipacao/matching.ts`, puro e testado):

1. **Número idêntico, candidata única** → casa (`exata`).
2. **Número idêntico, várias candidatas** (mesmo número em séries diferentes) → o valor
   desempata (±1%); se não desempatar sozinho, **revisão**.
3. **Número aproximado** (`84` vs `840`) → só casa com valor **E** vencimento
   confirmando (±1%, ±5 dias). Uma guarda só não basta.
4. **Nenhuma nota parecida** → `sem_nf`, re-tentado a cada ciclo por 7 dias (a NF pode
   simplesmente não ter chegado ainda). Passado o prazo, vira definitivo **com evento**.

As candidatas são SEMPRE recortadas pelo par fornecedor↔sacado — a média é 2,6 notas por
par, a pior 407. Esse recorte é a única parte do casamento que não admite aproximação, e
por isso **a fila de revisão também o respeita**: o RPC `antecipacao_candidatas` só
oferece notas do mesmo par. Uma tela que oferecesse notas de fora dele convidaria a
pessoa a cometer, no clique, o erro que a automação se recusa a cometer.

### A assimetria dos zeros

`normalizarNumeroNf` (compartilhada pelos dois lados — `documentNumber` e
`notas_fiscais.numero`) tira zeros à **esquerda** e nunca os da **direita**:

- `0084` e `84` são a mesma nota escrita por dois sistemas.
- `84` e `840` são **notas diferentes**.

Quando as fontes parecem divergir só por um zero ao final, quem decide é o valor — nunca
a normalização. A série também sai (`8821/1`, `8821 SÉRIE 1` → `8821`), mas só até 3
dígitos depois do separador: sem esse limite, `2024-1234` viraria `2024` e casaria com
uma nota que existe e não é essa.

### Status conversores são settings, não deploy

`antecipacao_config.conversao.status_conversores` lista os 9 status em que a antecipação
já é dinheiro operado. Os outros (`DRAFT`, `REPROVED`, …) são sincronizados e casados —
para visibilidade — mas **não convertem**. Um status desconhecido nunca converte: deixar
de converter aparece na fila e alguém corrige a config; converter por engano não aparece
em lugar nenhum.

### Regressão não se desfaz sozinha

Se uma antecipação já convertida muda para status não-conversor ou ganha
`invoiceCancelledAt`, o estágio da nota **não é revertido**. A nota ganha
`conversao_em_disputa = true`, o card diz isso em vermelho, e Admin + Comercial recebem
push. Reverter em silêncio seria a máquina apagando receita sem que ninguém visse — e
regressão financeira é exatamente o caso que merece olho, não automação.

### Calibração com a carteira (§5)

Três constantes digitadas multiplicam a receita esperada de todo o funil e o valor
esperado de todo o Crédito: taxa (% a.m.), prazo médio e ticket médio. O job mensal
(dia 5) mede as **medianas reais** das antecipações `CONCLUDED` dos últimos 90 dias e as
põe lado a lado com o configurado, em `/antecipacao/config`.

O botão aplica; o job nunca. E a taxa é gravada nos **dois** lugares em que ela vive —
`antecipacao.economia.taxa_mensal_padrao` (receita esperada da NF) e
`credito.economia.taxa_padrao_am` (potencial do sacado) — porque aplicar só uma
corrigiria metade da casa em silêncio. Métrica sem amostra suficiente (n < 5) fica `null`
e é **ignorada** no aplicar, não zerada.

## Onde está o quê

- **Banco**: migrations `0045`–`0061`, `0065`–`0068`, `0077`–`0079`, `0101`.
  - `notas_fiscais` (chave natural `access_key`) + `nota_itens` + `credito_snapshots`
  - `faixa_regras` (versionadas, uma ativa por faixa) + `faixa_disparos`
  - `whatsapp_contas` (token no **Vault**) + `mensagens_outbox`
  - `cnpj_lookup_fila` + `antecipacao_config`
  - `0058`/`0059`: cadastro do fornecedor em `notas_funil` (capital social, situação,
    valor protestado, último nº de NFe) + `tipo`/`origem` em `app_promover_empresa`
  - `0060`: Antecipação lê o cadastro dos CNPJs que aparecem nas suas notas
  - views: `notas_funil` (a superfície única), `antecipacao_fornecedores`,
    `antecipacao_sacados`, `antecipacao_sacados_a_prospectar` (recorte por CNAE)
  - `0065`: `sacado_camada` em `notas_funil` e na lista a prospectar
  - `0101`: `antecipacao_fornecedores_a_prospectar` — o espelho: quem **emite** contra
    sacado nosso nos últimos 90 dias e não está na plataforma
  - `0102`: `antecipacao_sacados_com_credito` (aprovação própria ou do grupo holding/SPE)
    passa a ser o qualificador da lista acima — "cadastrado" era 70% ruído. Mais
    `clientes_onepay_lista` (protesto do grupo, faturamento, gestão)
  - `0066`: Antecipação lê protesto dos CNPJs das suas notas + `fornecedor_protesto_em`
  - `0067`: `antecipacao_custo_protesto()` — o preço, para quem não tem Radar
  - `0068`: `app_promover_fornecedor` — promover do funil, sem Mercado nem Empresas
  - `0077`: `antecipacoes` (chave natural `id_externo`) + `conversao_antecipacao_id` e
    `conversao_em_disputa` em `notas_fiscais` (e no fim de `notas_funil`) + a config
    `conversao` + fonte de ingestão `onepay_antecipacoes`
  - `0078`: índice único em `notificacao_regras` — o `on conflict do nothing` de todas as
    migrações anteriores nunca fez nada, e a 0077 criou a primeira duplicata visível
  - RPCs: `app_mover_estagio_nf`, `app_marcar_sem_interesse`, `app_salvar_faixa_regra`,
    `app_ativar_faixa_regra`, `app_salvar_faixa_disparo`, `app_salvar_whatsapp_conta`,
    `app_descartar_mensagem`, `app_definir_ponto_focal`, `app_registrar_toque_manual`,
    `app_salvar_antecipacao_config`, `antecipacao_metricas_faixa`,
    `antecipacao_resumo_funil`, `app_casar_antecipacao`, `antecipacao_candidatas`,
    `antecipacao_status_conversoes`, `antecipacao_calibracao_carteira`
- **Core** (`packages/core/src/antecipacao/`): schemas e vocabulário, `faixas.ts` (o
  **segundo** engine de filtros — catálogo próprio sobre `notas_funil`), `nfe-xml.ts` (o
  parser, semente do Pricing), `economia.ts` (receita esperada, tipagem, urgência,
  templates), `contato-nf.ts` (a decisão inserir/completar/não-tocar), `numero-nf.ts` +
  `matching.ts` (o motor de casamento, puro e testado), `antecipacao-payload.ts`,
  `calibracao.ts`, mutations. Registry: `antecipacaoModule` — **não** é webOnly.
- **Worker** (`apps/worker/src/jobs/antecipacao/`): `sync-nfs`, `sync-antecipacoes`,
  `calibrar-economia`, `reclassificar`, `outbox`, `lookup-cadastral`, `contatos-nf`,
  `supressoes`; config em `apps/worker/src/antecipacao/`.
- **Web** (`apps/web/src/app/(app)/antecipacao/` + `components/antecipacao/`): Kanban,
  por sacado, sacados a prospectar, **fornecedores a prospectar**, **antecipações + fila
  de revisão**, métricas por
  faixa, regras de faixa, disparos, Outbox, contas WhatsApp, settings (com a calibração
  da carteira no topo).
- **Mobile** (`apps/mobile/app/(tabs)/antecipacao/` + `src/features/antecipacao/`):
  funil (tela principal), detalhe do fornecedor, por sacado, a prospectar.

## O engine de filtros agora tem duas instâncias

`criarFiltroEngine(catalogo)` em `packages/core/src/mercado/filters.ts`. Os
compiladores (PostgREST, SQL, JSON resolvido) são compartilhados; o **catálogo** não:

| Engine | Catálogo | View |
| --- | --- | --- |
| `mercadoEngine` | `CATALOGO` | `mercado_explorador` |
| `faixaEngine` | `CATALOGO_FAIXAS` | `notas_funil` |

Um catálogo único deixaria uma regra de faixa referenciar `capital_social` e compilar
para uma coluna que a view do funil não tem — erro que só aparece quando a
reclassificação noturna falha sobre 40 mil notas. O isolamento nos dois sentidos é
testado (`src/antecipacao/faixas.test.ts`).

O construtor visual (`apps/web/src/components/filtros/`) é genérico sobre o engine; a
pirâmide passou a usar a versão compartilhada com o engine do Mercado amarrado.

Repare que a variável de capital no funil se chama `fornecedor_capital_social`, e não
`capital_social`. O prefixo não é estilo: se ela tivesse o mesmo nome da variável do
Mercado, o teste de isolamento passaria a **compilar** em vez de lançar, e o guarda-corpo
entre os dois catálogos sumiria sem nada quebrar. Há teste para isso.

### Métricas cadastrais do fornecedor, e o que cada uma NÃO diz

| Variável | Cuidado |
| --- | --- |
| `fornecedor_capital_social` | **Nulo** enquanto o lookup não rodar, e nulo não satisfaz comparação — uma regra com ela exclui em silêncio quem a fila ainda não processou. |
| `fornecedor_situacao_cadastral` | `ativa`/`suspensa`/`inapta`/`baixada`/`nula`. Nota de empresa baixada não se antecipa. |
| `fornecedor_tem_protesto` | Consulta de protesto é **paga e opt-in por empresa**. `false` significa "não consultamos" muito mais vezes do que "não tem". Serve para **excluir quem tem**, nunca para atestar quem não tem — hoje, 1 fornecedor consultado em 378. |
| `fornecedor_protesto_valor` | R$ 800 e R$ 800 mil de protesto não são o mesmo risco, e o booleano não distingue. |
| `fornecedor_ultimo_numero_nf` | Proxy de **porte**, não de relação conosco: o `nNF` é sequencial por emitente, então estima quantas notas ele emitiu no total. **Só NFe** — o número da NFS-e nacional é identificador composto (chega a 2.6 × 10¹² nesta base) e misturá-lo faria qualquer emissor de serviço parecer o maior da carteira. Quem só emite serviço fica nulo. Na base atual: mediana 71.952, máximo 23,2M, 262 de 378 fornecedores com valor. |

O uso que motivou a última: *"grandes fornecedores não antecipam, mas emitem muitas NFs"* —
um corte por `fornecedor_ultimo_numero_nf < N` tira do funil quem tem caixa e não precisa
da antecipação.

## O sync (§3)

- **Agenda**: 06:30, 10:30, 14:30, 18:30, 22:30, 02:30 America/São_Paulo →
  `30 9,13,17,21,1,5 * * *` em UTC (`apps/web/vercel.json`).
- **A janela é o que o endpoint permite**, e ele oferece dois filtros
  **mutuamente exclusivos** (mandar os dois → 400):

  | Filtro | O que traz | Limite |
  | --- | --- | --- |
  | `sync_hours=N` | notas **sincronizadas** nas últimas N horas | N ∈ [1, 4] |
  | `start_date`/`end_date` | notas **emitidas** no intervalo | máximo 10 dias |

  O incremental é o `sync_hours` — é literalmente a pergunta do job. Mas o teto é 4h e o
  cron roda de 4 em 4: a cobertura é contígua e **sem folga**. Daí três modos
  (`packages/core/src/antecipacao/sync-plano.ts`, testado):

  - **incremental** — gap ≤ 4h → `sync_hours = ceil(gap)`. O arredondamento para cima é
    o único colchão que o teto permite (~1h).
  - **recuperação** — gap > 4h (corrida falhou ou atrasou) ou primeira execução → janela
    por **emissão**, fatiada em blocos de ≤10 dias.
  - **varredura** — o job diário revarre os últimos 30 dias de emissão. É o que fecha,
    em até 24h, o buraco que o teto de 4h deixa quando uma corrida falha.

  Tudo isso é barato porque o processamento é **idempotente por `access_key`**: nota
  nova insere, repetida atualiza — e cancelamento e mudança de `creditAnalysis` chegam
  como UPDATE da mesma linha, que é exatamente o que se quer. Sobrepor não custa nada.

  **A recuperação é uma aproximação**, e vale saber: ela filtra por emissão, não por
  sincronização. Uma nota antiga sincronizada durante o buraco não cai nela — cai na
  varredura diária, desde que tenha sido emitida nos últimos 30 dias. Fora disso, só
  aumentando `varredura_dias`.
- **O XML é guardado sempre** (`raw_xml`). É a semente do Pricing. Falha de parse
  **loga e segue**: valor e vencimento também vêm do endpoint, o erro fica em
  `xml_parse_erro` e o XML fica para reprocessar.
- **Vencimento**: `cobr/dup/dVenc` (primeira parcela em aberto) → endpoint → emissão +
  30 dias. `vencimento_origem` é **sempre** gravada: uma data estimada não pode se
  passar por uma data real de duplicata.
- **Snapshot de crédito só quando algo mudou.** O valor está na derivada (o limite caiu,
  o status virou), não em 40 mil linhas idênticas por dia.
- **Receita esperada** = `valor × (taxa_mensal / 100) × (dias / 30)`, com a
  `monthlyRateD0` do snapshot mais recente do **sacado** (é o risco dele que
  precifica), caindo no default de `antecipacao_config`. A taxa usada é gravada em
  `taxa_usada`, senão a receita de ontem é impossível de auditar depois que a taxa muda.
- Registra execução em `mercado_ingestoes` com fonte **`onepay_nf`** — mesma política de
  retry/alerta dos outros syncs, mesma tela de Ingestões, mesmo botão de reexecutar.
- **A cadeia da corrida**, e cada elo está onde está por uma razão:
  `sync NFs → lookup cadastral → reclassificar → sync de antecipações → outbox`.
  As antecipações vêm **depois** da reclassificação porque ela expira notas cujo
  vencimento chegou perto demais, e uma nota recém-**antecipada** não é uma nota
  expirada — a conversão é a última palavra, já que é a única das duas que descreve um
  fato consumado. E a outbox vem por último porque mandar mensagem para quem acabou de
  antecipar é o disparo que faz o comercial perder credibilidade.
  O sync de antecipações abre a **própria** ingestão (`onepay_antecipacoes`) e é
  best-effort por dentro: uma indisponibilidade daquele endpoint não derruba a ingestão
  das notas, que já terminou com sucesso quando chegamos ali.

## Notificações

| Evento | Quem | Como |
| --- | --- | --- |
| `sacado.limite_insuficiente` | Admin + Crédito | fan-out (sino) |
| `nf.convertida` | Comercial + Admin | fan-out (sino) |
| `sacado.credito_alterado` | Crédito | fan-out (sino) |
| `antecipacao.regrediu` | Comercial + Admin | **`notify()` no worker** — sino **e** push |
| nova NF em faixa **alta** | Comercial + Admin | **`notify()` no worker** — sino **e** push, com deep link |

O último não pode ser uma regra de `notificacao_regras` por duas razões: o gatilho de
fan-out casa apenas o **tipo** (uma regra em `nf.faixa_alterada` dispararia também ao
sair da faixa e ao entrar em média — ruído suficiente, num sync 6× ao dia, para o time
desligar as notificações), e o gatilho **não faz push**. Migration `0051` remove a regra
para que o sino não mostre a mesma notícia duas vezes. A notificação é **agrupada por
rodada**: uma por nota transformaria um sync de 40 notas em 40 buzinas no bolso.

`antecipacao.regrediu` segue a mesma convenção e pelo mesmo motivo — e por isso **não**
tem regra de fan-out: uma conversão que talvez não exista não pode depender de alguém
estar olhando a timeline. `antecipacao.sincronizada`, `antecipacao.status_alterado`,
`antecipacao.casada` e `antecipacao.sem_nf` ficam só na **timeline da empresa**: são
histórico do fornecedor, não interrupção.

## Mobile: o funil é experiência de primeira classe

- **Tela principal do módulo**, não um dashboard: quem abre no celular está na rua.
- Segmented control por estágio + chips de faixa e tipagem, lista ordenada por receita
  esperada, pull-to-refresh, busca.
- **Swipe** no card: direita move estágio, esquerda marca sem interesse. As duas abrem
  uma folha, porque as duas exigem escolha (qual estágio; 90 dias ou eterna) e motivo —
  um swipe que executa direto seria irreversível por acidente.
- **Ações de um toque**: `tel:`, `wa.me` (abre o app **do próprio vendedor**, sem relação
  com as contas de API cadastradas) com mensagem pré-preenchida do template da faixa, e
  `mailto:`. Cada uso registra `toque.manual` — e é esse evento que o cooldown da outbox
  lê. O registro **não bloqueia** a ação: discar é o que o usuário pediu.
- Editor de regras, Outbox, disparos, contas de WhatsApp e settings são `webOnly` e
  **não** estão declarados no stack mobile.

## Limitações conhecidas

- **O endpoint de antecipações não foi provado contra a API real.** O envelope descrito
  no Prompt (`page`, `pageSize`, `totalPages`, `period`) é exatamente o de
  `/api/v1/invoices`, que já está mapeado e testado — mesma API, mesmo token, mesma
  convenção — então o job manda `page`, `page_size`, `start_date` e `end_date`, com o
  significado das datas trocado para **criação** da antecipação. Se a API discordar da
  grafia, o sintoma será zero linhas com HTTP 200, e o conserto é o querystring em
  `sync-antecipacoes.ts`. O **payload por item** está travado por fixture
  (`antecipacao-payload.test.ts`), inclusive o `witholdTaxAmount` com um L só. Nenhuma
  variável nova precisa ser provisionada: sem `ONEPAY_ANTECIPACOES_URL`, cai em
  `ONEPAY_BI_URL` + `/api/v1/anticipations`.
- **`contractor` é o SACADO e `contracted` é o FORNECEDOR.** A inversão mais cara do
  módulo, e a mais silenciosa: trocados, o matching nunca encontra candidata e 100% das
  antecipações viram `sem_nf` sem que nenhum erro seja registrado. Tem teste próprio.
- **O sync de NFs ainda não rodou contra o endpoint real**, mas o contrato inteiro é conhecido
  e está travado por teste: o recurso é `{ONEPAY_BI_URL}/api/v1/invoices`, os filtros
  estão em `sync-plano.test.ts` e o formato do payload em `nf-payload.test.ts` — cujo
  fixture é o payload real, colado inteiro. Como é a mesma API e o mesmo token do sync
  de clientes, **nenhuma variável nova precisa ser provisionada**: sem
  `ONEPAY_NF_URL`/`ONEPAY_NF_TOKEN`, ele cai em `ONEPAY_BI_URL` + caminho padrão e em
  `ONEPAY_BI_TOKEN`. Se o recurso mudar de lugar, o conserto é `ONEPAY_NF_URL` com a URL
  completa — sem deploy de código.
  A normalização (`packages/core/src/antecipacao/nf-payload.ts`) é tolerante de
  propósito: o XML é a segunda fonte de tudo, então uma nota chega mesmo que o JSON não
  traga `accessKey`, `amount`, `number` ou as datas.
- **`notas_funil` é `security_invoker`.** Um usuário com `antecipacao` mas sem `radar`
  ou `mercado` vê `fornecedor_tem_protesto` e `fornecedor_uf` como null — as tabelas de
  base são de outros módulos. A **classificação** não é afetada: o worker usa service
  role. É o mesmo comportamento (e a mesma decisão) de `mercado_explorador`.
- **O Kanban não tem drag-and-drop.** Mover para "perdida" exige motivo, e um gesto de
  arrastar que abre um diálogo obrigatório é pior que um menu. O menu do card faz o mesmo
  em dois cliques, com o motivo onde ele precisa estar.
- **A escolha de destinatário tem três degraus**, e o terceiro é novo: `contatos`
  (curado, ponto focal primeiro) → `supplier.contact` do payload da NF → descarte
  `sem_contato`. O segundo degrau existe porque descartar tendo um e-mail na mão seria
  pagar um lote de contatos no Radar para redescobrir o que a API já mandou.
- **`nota_itens` não é lido por ninguém ainda.** É a base do Pricing, extraída agora
  porque o XML está passando agora. O leitor de NF desenha os itens direto do
  `raw_xml`, não desta tabela — são consumidores diferentes do mesmo dado.
- **A impressão do modal depende de `[role="dialog"]`.** A regra em `globals.css` esconde
  o shell e promove o diálogo a fluxo normal da folha. Se o diálogo mudar de primitivo, a
  impressão volta a sair com a sidebar — barulhento o bastante para ser notado na
  primeira vez.
