# Comercial (Prompt 04g)

Quem vende o quê, para quem, e quanto isso paga.

## A ideia que organiza tudo

**Um lançamento de comissão é uma afirmação sobre o passado.** Quem era dono da empresa
no dia do evento recebe, mesmo que a carteira tenha mudado ontem; a regra que valia no
dia do evento é a que precifica, mesmo que a tabela tenha subido hoje.

Isso decidiu o esquema. `vendedor_carteira` é **temporal** (`desde`/`ate`) em vez de uma
coluna `vendedor_id` em `empresas`, porque uma coluna só sabe o presente — e o presente é
justamente o que não interessa quando alguém contesta a folha de março. `comissao_regras`
tem vigência pelo mesmo motivo.

A segunda ideia: **passivo é passivo de verdade.** Não é filtro visual.

## Ativo × passivo

`empresas.gestao_operacao` ∈ {`prospeccao_ativa`, `passivo`, null}. **Só existe para
`estagio` ∈ {`cliente`, `ex_cliente`}** — a pergunta "esta conta é trabalhada ou antecipa
sozinha?" pressupõe uma conta que antecipa. Numa empresa de mercado ela não tem resposta
possível, e responder assim mesmo teria efeito real: `passivo` a tira da distribuição do
SDR, ou seja, um rótulo sem sentido bloquearia a prospecção que deveria acontecer.

Garantido em três camadas (0095): CHECK na tabela, trigger `empresas_gestao_so_cliente`
que LIMPA a gestão quando o estágio sai da régua, e recusa em português no
`app_definir_gestao_operacao`. O trigger limpa em vez de recusar porque quem rebaixa um
ex-cliente para `mercado` está corrigindo o cadastro, não mexendo no comercial — um CHECK
sozinho transformaria a operação legítima em violação de constraint.

Um segundo trigger (`empresas_fecha_gestao_passiva`) encerra a vigência em
`vendedor_carteira` no mesmo movimento. Carteira órfã é pior que carteira errada: a
comissão de volume lê a vigência e não olha `gestao_operacao`, então uma linha vigente
sobrevivente continuaria pagando gestão de uma conta que ninguém gere — e o valor
apareceria na folha do mesmo jeito de sempre.

Efeitos reais de `passivo`:

| efeito | onde |
|---|---|
| Não gera outbox | `sacadosPassivos()` em `outbox.ts` filtra as notas antes de montar a mensagem |
| Fora da carteira de originação | `rotearNota()` devolve sem dono antes de qualquer regra |
| Fora da distribuição de SDR | o SQL de candidatas exclui `gestao_operacao = 'passivo'` |
| Entra na comissão de volume | `vendedor_carteira` papel `gestao_passiva` — somando a holding E as SPEs |

**Nunca muda sozinho.** O job mensal (`comercial/sugerir-passivos`) aponta candidatos e
notifica; quem aceita é gente, na seção Comercial da Company 360. O motivo é que "não
recebeu toque" é uma afirmação sobre o nosso REGISTRO, não sobre o mundo: uma conversa
por telefone que ninguém anotou aparece aqui como ausência, e marcar sozinho
transformaria falha de anotação em perda de comissão de alguém.

## Duas atribuições diferentes

A distinção organiza o módulo inteiro:

| | trabalha | recebe por | onde se configura |
|---|---|---|---|
| **Originador** | NOTA | escolha — lista de empresas a dedo | carteira, no cadastro do vendedor |

| **Closer** | CONTA + contas passivas | recorte — UF + faixa de faturamento; passivas por escolha | território **e** carteira de passivas, no cadastro do vendedor |
| **SDR** | LEAD | recorte, para a distribuição semanal | território + direção + cota |

Quem originou a relação continua dono dela mesmo que a empresa mude de porte ou de
estado — por isso o originador recebe por escolha. Quem fecha negócio é alocado por
perfil de cliente — por isso o closer recebe por recorte.

O closer acumula as duas formas, e elas não competem: o **recorte** diz que negócio novo
cai nele, a **carteira de passivas** diz que conta antiga ele mantém. A segunda é o
insumo da comissão por volume — sem ela, o closer só recebe por venda nova.

A carteira de passivas se monta por dois caminhos, e é o mesmo fato visto de dois lados:
pela **ficha da empresa** ("quem cuida desta conta") e pelo **cadastro do vendedor**
("quais contas são deste closer", que é a pergunta de quem monta carteira). O RPC
`app_definir_carteira_passiva` recebe o CONJUNTO inteiro, não um delta — um delta
obrigaria a tela a saber o que mudou desde que carregou, e duas abas abertas gravariam
metade da intenção cada uma. Entrar marca a empresa como passiva; **sair devolve a "não
definido"**, não a "prospecção ativa": parar de gerir passivamente não é decidir
prospectar, e inventar a segunda afirmação colocaria a conta na fila do SDR sem ninguém
ter pedido.

A carteira do originador só aceita **cliente em prospecção ativa**, e o recorte é o
conjunto das empresas cuja nota pode de fato ser roteada: quem não é cliente não emite
nota no funil, e a de passivo é descartada antes do roteamento. Empresa já escolhida que
deixa de ser elegível continua na lista, **marcada** — tirá-la sozinho seria decidir por
quem cadastrou, e a marca é o que faz alguém revisar.

## A conta é a holding E as SPEs dela

Uma construtora não é um CNPJ: é uma holding com dezenas de SPEs, e **é contra a SPE que
se fatura**. O módulo inteiro tratava "empresa" como CNPJ, e o preço disso, medido no
banco antes da correção:

| | pelo CNPJ da holding | pelas SPEs do grupo |
|---|---|---|
| volume antecipado (comissão de gestão) | R$ 1.882.263 | **R$ 1.347.408** |
| NFs vivas (carteira de originação) | 3.148 | **1.112** |

O caso extremo é VL Construtora: **706 notas vivas, todas contra SPEs**. Um originador que
escolhesse a VL na carteira recebia zero.

Uma função resolve o vínculo, e uma só — `app_holding_do_sacado(cnpj)`. Ela decide dinheiro
(comissão de volume) e trabalho (carteira de NF), e duas cópias divergentes pagariam uma
coisa e mostrariam outra, com o agravante de quem confere olhar a tela e achar que bate.

Três decisões dentro dela:

- **Só cliente ou ex-cliente pode ser a dona.** A primeira versão dizia "se o sacado é uma
  empresa cadastrada, é dela a operação" e não funcionou: 13 sacados são SPEs que TÊM linha
  própria em `empresas`, com `estagio = 'mercado'`. O casamento direto vencia, a SPE virava
  dona de si mesma, e a função devolvia um id que não está na carteira de ninguém — zero
  linhas mudariam e o bug pareceria corrigido.
- **Só sobe pelo grupo quando o sacado é `is_spe`.** O grupo econômico também junta
  empresas operacionais irmãs, que são contas próprias com dono próprio. Dos 29 casos
  observados, 28 são SPE e 1 é irmã operacional.
- **Uma holding por sacado, sempre.** Há um grupo com dois clientes (ATW Instalações e One
  Construction); sem o desempate a mesma antecipação pagaria comissão duas vezes.

No roteamento, quem tem a empresa **direto** ganha de quem a alcança pela SPE — senão uma
nota cujo fornecedor é o cliente A e cujo sacado é SPE do cliente B iria para B, e A veria
o nome do próprio cliente numa nota que não é dele.

E `sacado_gestao` passa a vir da holding: a SPE não tem gestão própria, então ler o campo
dela devolvia nulo e a nota de uma conta PASSIVA entrava em carteira como se fosse ativa.

## Roteamento de NFs

`packages/core/src/comercial/roteamento.ts`, com testes. O critério é **um só**: a
carteira explícita do originador (`settings.empresas_escolhidas`), casando com o sacado
OU com o fornecedor. Sem carteira que cubra, a nota vai para a **fila sem dono**
(`/comercial/fila`), que é resposta, não falha.

**Território não roteia nota.** Uma versão anterior o usava como segundo critério, e isso
trocava as duas atribuições de lugar: fazia o originador receber conta por região (que é
a régua do closer) e deixava o closer sem régua nenhuma.

Duas exclusões, testadas:

- **Sacado passivo** sai antes de tudo.
- **`vendedor_origem = 'manual'`** não é revisto. Sem isso o gestor corrige e o próximo
  sync desfaz.

Empate (dois originadores com a mesma empresa) entrega ao de menor carga e **denuncia o
cadastro** no motivo; empate de carga resolve pelo id, para ser reprodutível — um
roteador não determinístico faz a mesma nota trocar de dono a cada sync.

Roda encadeado no diário da Antecipação, depois da reclassificação de faixa.

## O closer de uma conta

`closerParaConta()` acha o closer cujo território cobre a UF e o faturamento da empresa.
É o que o SDR vê **sugerido** ao agendar a reunião — sugestão, não imposição: território
descreve o recorte normal, e a exceção (o closer que já conhece aquele dono, a conta que
pede alguém sênior) é justamente o que uma regra automática erraria.

Ninguém cobre → a tela mostra a lista inteira e diz por quê, em vez de escolher "o mais
parecido", que seria um palpite com cara de regra.

## Uma carteira de originação, não duas

Havia duas com o mesmo nome e leitores diferentes:

| onde | escrita por | lida por |
|---|---|---|
| `vendedores.settings.empresas_escolhidas` | o formulário | o **roteamento** |
| `vendedor_carteira` papel `originacao` | `app_definir_carteira` — **nenhuma tela** | a **comissão** |

Consequência medida: zero linhas de `originacao` na tabela, e portanto
`donoNaData(..., 'originacao', ...)` devolvendo null para toda antecipação convertida. **A
comissão do originador nunca foi paga** — sem erro nenhum: o job contava a linha como "sem
regra" e seguia. É o pior formato de bug possível, porque a tela que a pessoa olha para
conferir (o funil de NFs, alimentado pelo `settings`) mostra o trabalho acontecendo normal.

Agora `app_salvar_vendedor` **espelha** `settings` em `vendedor_carteira`, na mesma
transação. `settings` continua sendo o que a tela edita — editar um conjunto é natural ali
— e a tabela é a forma temporal, a única que responde "quem era dono na data da conversão".

Três regras no espelho:

- **Recusa em vez de roubar.** Empresa já vigente com outro originador devolve o nome de
  quem tem. Passar de mão é duas operações de propósito: tirar de um e dar a outro são duas
  decisões, e uma delas costuma ser a que ninguém queria.
- **Conta passiva não entra**, nem que esteja no `settings` — senão a mesma operação pagaria
  o originador (NF convertida) e o closer (volume). O gatilho de `gestao_operacao` fecha as
  vigências de `originacao` quando a conta vira passiva.
- **O backfill começa hoje.** `jsonb` não guarda histórico, então não há data real de
  entrada; inventar uma retroativa criaria vigência para um período em que a decisão talvez
  não existisse. O que converteu antes não gera comissão — conservador e honesto.

E a comissão passou a usar a **mesma régua do roteamento**: os dois lados da nota, com
rollup para a holding quando a contraparte é SPE, na mesma ordem de precedência (direto
ganha de SPE). Antes olhava só `fornecedor_empresa_id`.

## Quando o link surte efeito

O roteamento é uma **varredura completa**, não incremental: toda rodada reavalia cada nota
viva. Linkar uma empresa hoje traz o histórico inteiro dela, não só o que sincronizar
depois. Ficam de fora `convertida`/`perdida` (encerrada não é trabalho) e
`vendedor_origem = 'manual'` (decisão humana não se revisa).

Salvar a carteira de um originador **dispara o roteamento na hora** e a tela diz quantas
NFs vivas a carteira alcança — com a fatia que vem por SPE. O alcance é calculado na hora
porque responde "meu link pegou?", que é a pergunta real; "quantas mudaram de dono" só se
saberia depois do job, e trocaria uma dúvida curta por uma espera longa.

## Ciclo da comissão

```
evento → apurado → aprovado → pago
```

`comercial/apurar-comissoes` roda no dia 1 e fecha a competência anterior. Três origens
e um estorno:

| origem | quem | conta |
|---|---|---|
| `reuniao_agendada` | SDR | valor fixo por reunião **agendada** |
| `nf_convertida` | originador | `gross_value ÷ 1.000.000 × valor_por_milhao` |
| `volume_passivo` | vendedor | volume do mês das passivas que ele gere, por milhão |
| `estorno` | espelho negativo | antecipação que regrediu, ou no-show quando ligado |

**Idempotente** pelo `unique (origem_tipo, origem_id, vendedor_id)`: rodar duas vezes não
paga duas vezes. É `upsert ... ignoreDuplicates`, não "apaga e reinsere" — reinserir
apagaria a aprovação já dada.

**O estorno entra na competência em que foi DESCOBERTO**, não na do original: reabrir uma
competência já paga reescreveria uma folha fechada.

**Aprovar é por vendedor e por mês**, não linha a linha — aprovar 40 linhas uma a uma é o
tipo de tarefa que leva alguém a aprovar sem ler. `pago` não volta para `aprovado`.

Sem regra vigente na data do evento, **não se lança nada**. Um default inventaria dinheiro
que ninguém aprovou.

## Os dois funis

**SDR** (`sdr_leads`): a contatar → em conversa → reunião agendada → no-show → reunião
realizada → qualificada. A ordem é a do que acontece: no-show vem depois de agendar e
antes de sentar, não numa caixa de descarte no fim.

**Fit não é etapa.** É um julgamento sobre a empresa (`fit boolean`, null = não
avaliado), feito depois do contato, e que continua valendo em qualquer estágio seguinte.
Como coluna, ele apagava a informação de até onde o lead tinha chegado: quem morreu antes
do primeiro contato e quem morreu depois de uma reunião viravam a mesma linha no mesmo
lugar — e essa distância é justamente o que revisa a régua do Mercado.

Marcar **sem fit** exige motivo e **encerra o lead onde ele está** (`encerrado_em` +
`encerrado_motivo = 'sem_fit'`), sem mexer no estágio. Marcar com fit num lead encerrado
por engano o reabre. Julgar fit em quem nunca foi contatado é recusado: não é julgamento,
é descarte, e vira estatística que mente sobre a régua.

Agendar cria, na mesma transação, o card no funil do closer e o evento de calendário dos
dois. Uma reunião agendada que não aparece no funil de quem vai atendê-la é uma reunião
que ninguém preparou.

**Closer** (`vendas`): reunião agendada → reagendada → aguardando documentação → em
análise de crédito → proposta enviada → preparação do MOU → MOU assinado → onboarding.

**Ganho e perdido não são etapas** — são `situacao` (em_andamento | ganho | perdido), e
não movem o card. Um negócio ganho pode estar em onboarding, e é lá que o trabalho
continua; como coluna, "ganho" tirava o card da etapa onde o trabalho acontece justamente
quando ele passou a exigir trabalho de verdade.

Ganhar promove a empresa a cliente e **abre** a pergunta ativo/passivo — não responde por
ela. Perder exige motivo (CHECK no banco) e deixa o card onde está: o estágio é o que diz
até onde a venda chegou antes de morrer.

**Ganho continua no funil até a primeira operação.** Ganho sem operar ainda é trabalho
(onboarding, cadastro, primeira nota), e é aí que um negócio fechado morre por falta de
acompanhamento. O job diário detecta a primeira antecipação convertida da empresa — dos
dois lados, como sacado ou como fornecedor — depois do ganho, preenche
`primeira_operacao_em` e o card some sozinho. Rotina não mora em funil.

A decisão da seguradora (04d) age sozinha: **aprovada** move o estágio para proposta
enviada, **negada** muda a situação para perdido com "Crédito negado" e deixa o estágio
onde está. **Parcial não anda**: metade do limite pode ser ótimo ou inviável, e essa
leitura é de quem está na mesa.

## Distribuição semanal

Segunda 07:00 SP (10:00 UTC). Fonte configurável (`som` por padrão), ordenada por
`valor_esperado_mensal` — a régua do Crédito, que já multiplica limite × giro × taxa ×
chance. Ordenar por faturamento daria peso a empresa grande que nunca vai antecipar.

Não entra: passiva, já cliente, com lead vivo, ou com `sem_fit` dentro da carência (90d).

Guloso com balanceamento: a melhor empresa disponível vai para o SDR elegível de **menor
carga**. Sortear seria mais justo entre SDRs e pior para a empresa.

**SDR de entrada fica fora.** O prompt prevê que ele receba "empresas com evento de
resposta ou interesse", e esse canal não existe até o Prompt 05. Inventar um proxy
encheria a fila de quem trabalha inbound com empresa fria. Ele recebe por criação manual
(`origem = 'inbound'`) até lá.

**SLA**: lead `a_contatar` parado além de 7 dias é encerrado com motivo `expirado` e
volta ao pool. O estágio não muda — "morreu em a_contatar" é o dado, e diz que ninguém
falou com a empresa, não que ela não presta (que é o que um estágio "desqualificada"
dizia). Expirado **não tem carência**: a empresa continua boa, quem não trabalhou foi a
gente.

## Calendário

Eventos dos funis, mais o feed `.ics` por vendedor em `/api/calendario/<token>`.

O feed é **público por natureza** (Google e Outlook buscam sem cabeçalho de
autenticação), então o token É a credencial: aleatório, por vendedor, e gerar outro revoga
o anterior — é assim que se tira o acesso de um celular perdido.

O feed carrega **só título e horário**. Um link de assinatura vaza com facilidade, e o que
vaza junto tem que ser inócuo. Token inexistente e token revogado devolvem o mesmo 404:
distinguir os dois diria a quem tropeçou no link que ele existiu, e para quem.

## As abas de cada tipo

A navegação do módulo é montada pelo TIPO do vendedor logado, e a **primeira aba é sempre
o funil**:

| tipo | abas, nesta ordem |
|---|---|
| **SDR** | Funil de Reuniões · Calendário · Comissão |
| **Originador** | Funil de NFs · Empresas da Carteira · Comissão |
| **Closer** | Funil de Vendas · Calendário · Comissão · Passivas na Carteira |
| **Gestor** | tudo acima, mais Fila sem Dono, Painel e Configurações |

A ordem não é estética. Estas abas são o dia de trabalho de alguém, e o dia começa no
funil: é lá que está a próxima ação. Calendário, comissão e carteira são consulta — abrir
o módulo neles seria abrir o trabalho pela contabilidade dele.

`/comercial` não é tela: é o despacho para o funil de quem entrou (gestor sem cadastro de
vendedor cai no Painel, que para ele É a tela inicial — o trabalho dele é olhar o dos
outros). Redirecionar em vez de renderizar mantém UMA url por funil; duas rotas pintando a
mesma tela deixariam a aba ativa piscando conforme o caminho de entrada.

O **funil de NFs** do originador é o mesmo Kanban da Antecipação recortado por
`vendedor_id`. Mesma tela e mesmas ações de propósito: o trabalho sobre uma nota é
idêntico, o que muda é de quem ela é — uma segunda tela "igual mas do originador"
duplicaria as regras de conversão e perda, que são exatamente as que não podem divergir.
A nota vive sob a RLS do módulo `antecipacao`, não do `comercial`; quem tem só o Comercial
recebe uma explicação em vez de um Kanban vazio, porque funil vazio e carteira vazia são
conclusões diferentes sobre o próprio trabalho.

A **carteira** é uma tela só para os dois papéis, com a coluna que muda: o originador vê
NFs vivas (empresa sem nota viva é cadastro que não virou trabalho), o closer vê volume
antecipado no mês (é literalmente o insumo da comissão dele). Nenhuma das duas se edita
ali — carteira se monta em Configurações ou na ficha da empresa, e um terceiro lugar seria
mais um jeito de a mesma decisão divergir.

## Os dois funis usam a forma da esteira

Reuniões e Vendas têm o mesmo layout da esteira de crédito (04d §4.4): um cartão só,
cabeçalho com título/descrição/ações, kanban em colunas leves e **tabela como
alternativa**. A forma é a mesma porque a pergunta é a mesma — "onde está cada coisa, e o
que falta nela" — e duas telas que respondem à mesma pergunta com layouts diferentes
obrigam a pessoa a reaprender a ler a cada troca de módulo.

Herdam também o que a esteira **não** faz: nada de arrastar-e-soltar. Lá porque metade dos
estágios pertence à seguradora; aqui porque perder exige motivo, e um gesto de arrastar
que abre um diálogo obrigatório é pior que um botão.

E o tom do card conta a situação antes de qualquer leitura: verde para ganho e para lead
com fit, vermelho para perdido e sem fit, cinza para encerrado sem toque.

## Perfis

Seis perfis, três deles do Comercial:

| perfil | módulos | é gestor? |
|---|---|---|
| **SDR** | comercial, empresas, notificacoes | não |
| **Originador** | comercial, **antecipacao**, empresas, notificacoes | não |
| **Closer** | comercial, empresas, notificacoes | não |
| **Comercial** | antecipacao, comercial, empresas | **sim** |
| **Admin** | todos | **sim** |

Antes destes três, quem tivesse o módulo era gestor por definição — `app_gestor_comercial()`
responde sim para Admin e Comercial, e gestor vê todos os funis, muda carteira e aprova
comissão. Ou seja, a separação por tipo e a visibilidade cruzada estavam implementadas e
não eram exercidas por ninguém: não havia como existir um vendedor que NÃO fosse gestor.

`empresas` entra nos três porque todo card dos funis linka para a Company 360 — é lá que
se julga a conta e, para o closer, se decide ativo × passivo. Sem o módulo, o link
principal da tela de trabalho devolve "sem acesso". `antecipacao` só no originador: a nota
vive sob a RLS daquele módulo e o funil de NFs é a tela principal dele. `credito` fica fora
de todos, inclusive do closer — a venda passa por análise, mas o card anda sozinho quando a
seguradora decide, e ler o parecer é trabalho de quem opera crédito.

Consequência no código: "é gestor?" passou a vir de `contextoComercial()` em
`lib/comercial.ts`, que pergunta ao banco. A conta local de antes (`isAdmin(context) ||
!vendedor`) era verdadeira enquanto só Admin e Comercial tinham o módulo, e passaria a
tratar como gestor um closer ainda não cadastrado como vendedor.

## Permissões

Escrita: ninguém escreve direto. Nenhuma tabela do módulo tem grant de insert/update para
`authenticated`, e toda mutação passa por RPC — é assim que "agir em nome do outro" fica
impossível sem depender de policy.

Leitura: `vendedor_acessos` decide. Desde a 0095 ele vale para **funil de reuniões, funil
de vendas, agenda e comissão** — antes só filtrava comissão, e todo o resto era visível
para quem tivesse o módulo. Isso era verdade enquanto o módulo só existia para Admin e
Comercial, que são gestores e veem tudo por definição; no instante em que existe um perfil
de vendedor, "quem eu enxergo" vira uma decisão — e uma decisão que só vale na tela não é
decisão, porque basta a URL do outro funil para contorná-la.

Duas exceções deliberadas na policy de `sdr_leads`: quem vê o lead é o SDR dono **ou** o
closer destino. Sem a segunda, o closer abriria uma reunião sem conseguir ler de onde ela
veio.

O cadastro de pessoas (`vendedores`) continua legível para quem tem o módulo — um roster
não é segredo. O que muda é **abrir o painel** de alguém, e é por isso que os seletores da
tela se montam com `comercial_vendedores_visiveis()` e não com a lista de vendedores:
oferecer um nome cujo funil a RLS devolve vazio ensina que a tela está quebrada.

A visibilidade cruzada se concede no cadastro do vendedor, em "Pode ver o painel de".

## Mobile

Painel, funil de reuniões e funil de vendas — lista, não kanban, com **um** botão por
card: o próximo passo. As saídas que exigem motivo (sem fit, perdido) não estão no
celular de propósito: escolher um motivo numa lista de seis com o polegar é como o motivo
vira sempre "Outro", e o motivo é o dado mais valioso destes funis.

Comissões, calendário, fila sem dono e configurações são web — leitura longa ou decisão
de gestor, e nenhuma das duas acontece entre uma reunião e outra.

## O que ficou de fora

- **Toggle "ocultar NFs de sacados passivos" no funil de NFs.** O efeito real do passivo
  (sem outbox, sem roteamento) está implementado. A coluna que faltava
  (`sacado_gestao_operacao`) já entrou na view em 0095; falta só o controle na tela.
- Envio real de mensagens, automação do vendedor de IA, OAuth do Google Calendar, metas e
  forecast, comissão de gestor — todos Prompt 05+, como o próprio 04g define.

## Cadastro (Configurações)

Vendedor, território, regra de comissão e motivos são editáveis na tela, por RPC com
`audit_log` — mesma disciplina do resto do sistema.

Não há **excluir** em lugar nenhum: vendedor se desativa, regra se substitui, motivo se
inativa. Apagar qualquer um dos três levaria junto a explicação de uma comissão já paga.

Três decisões que a tela toma por quem usa:

- **Território, carteira e acessos são salvos junto com o vendedor**, na mesma submissão.
  Em telas separadas, o estado mais provável é originador ativo com território em branco —
  que não casa com nada e não diz por quê. A carteira de passivas vai **sempre** que o
  tipo é closer, inclusive vazia: a lista vazia é como se esvazia a carteira, e pular a
  chamada faria "removi todas" não gravar nada.
- **Regra nova encerra a anterior na véspera.** A busca por vigência já resolveria a
  sobreposição pela data de início, mas duas regras vigentes ao mesmo tempo é o estado
  que faz alguém conferir a folha e não conseguir explicar o número.
- **O campo de valor muda de rótulo com o tipo.** Gravar `valor_por_reuniao` numa regra
  de originador faz o cálculo não achar o parâmetro, devolver null, e a pessoa
  simplesmente não receber — sem erro, sem linha na folha.

Os campos de configuração salvam no **blur**, não a cada tecla: salvar por tecla mandaria
`2`, `25`, `250` ao banco, e o job pegaria o número do meio se rodasse no instante errado.

## Ponte para o Prompt 05

As mensagens da outbox já nascem com o fornecedor e as notas; o que 05 acrescenta é o
**remetente**: `vendedores.whatsapp_conta_id` e `email_remetente` existem desde esta
migração justamente para que a mensagem saia atribuída ao dono da carteira. Humano
aprova, IA dispara.
