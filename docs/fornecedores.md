# Cadastro de Fornecedores (Prompt 04l)

Fornecedores que emitem NF contra nossos sacados e **não estão na plataforma** são
demanda latente de antecipação. Este módulo transforma essa lista num funil com dono,
munição de abordagem e um motor de descoberta de contato com orçamento.

Fica em **Comercial → Cadastro de Fornecedores**.

## O que já existia, e o que faltava

A view `antecipacao_fornecedores_a_prospectar` (migração 0101) já **listava** esses
CNPJs desde o Prompt 04. Ela continua existindo e continua correta. O que faltava era
tudo que separa uma lista de um funil: quem trabalha cada nome, em que ponto da
conversa ele está, o que dizer na primeira frase, e por onde falar.

Três medições da base, feitas em 25/08/2026, sustentam quase todas as decisões daqui:

| Medida | Número |
| --- | --- |
| Fornecedores que emitiram contra sacado nosso em 180 dias | 7.892 |
| Destes, com **volume ≥ R$ 50 mil em 90 dias** | **688** |
| Volume cedido por esses 688 na janela | R$ 289,2 milhões |
| Potencial mensal somado (volume 90d ÷ 3) | R$ 96,4 milhões |
| Com telefone no `<emit>` do XML da NF-e | 528 (77%) |
| Com e-mail no `<emit>` | 201 (29%) |
| Com telefone no cadastro da Receita | 75 (11%) |
| Com e-mail no cadastro da Receita | 70 (10%) |
| Com originador titular na carteira de originação | 112 (16%) |

## O corte de volume é a decisão de produto

Sem corte a lista tem 7.892 nomes. Isso não é um funil — é a mesma lista morta com
kanban em volta, e a ordenação por potencial não significa nada quando 90% da lista é
ruído. O corte (`fornecedores_config.corte_volume`, default R$ 50 mil em 90 dias) é o
que faz o primeiro card da tela ser um card que vale a ligação.

A entrada é **automática**: quem passa do corte entra, sem curadoria. Ninguém revisa
688 nomes, e a revisão não acrescentaria nada que o volume já não diga.

A saída também: quando o sync marca `fornecedor_cadastrado`, o card vira `cadastrado`,
sai da lista ativa e emite `fornecedor.cadastrado`. As NFs dele seguem o funil normal de
antecipação e a titularidade passa a ser a do 04k.

## Potencial mensal é volume ÷ 3, e nada além disso

É a conta mais simples possível, de propósito. Ela responde "quanto ele fatura por mês
contra nossos sacados" — não "quanto ele vai antecipar". A segunda pergunta depende de
apetite, prazo e limite, e um número que fingisse respondê-la colocaria o originador
numa ligação prometendo o que não é dele.

**O limite do sacado não entra na ordenação.** Ele é o teto da operação, não do lead: um
fornecedor de R$ 900 mil/mês contra um sacado com limite estourado continua sendo o
melhor telefone da lista, porque limite se resolve com análise e fornecedor grande não
aparece por decreto.

## A cascata de descoberta

A ordem vai do mais barato e mais certo para o mais caro e mais incerto — e ela não é
intuição. O XML da NF-e tem telefone para **sete vezes mais** fornecedores que o cadastro
da Receita, e custa zero: ele já está no nosso banco desde o Prompt 04. Rodar qualquer
provedor pago antes de esgotá-lo é pagar por 77% de informação que já temos.

### Camada 0+1 — automática, roda para todos, sem clique

| # | Fonte | Custo | Confiança | Observação |
| --- | --- | --- | --- | --- |
| 1 | `xml_nfe` | zero | **alta** | `emit/enderEmit/fone`, `emit/email`, e varredura de `infCpl`/`obsCont` |
| 2 | `receita` | zero | média | `email_rfb`, `telefone1_rfb`, `telefone2_rfb` |
| 3 | `contatos_base` | zero | média | contatos que já temos, da ficha ou de empresas do mesmo domínio |
| 4 | `site_empresa` | zero | média | lê `/contato`, `/fale-conosco` e o rodapé quando o domínio resolve |
| 5 | `google_places` | R$ 0,18 | alta se o endereço bater | cobertura excelente para PME local de construção |

Só o Google Places custa, e ele sai do **orçamento automático da casa**
(`orcamento_automatico_mensal`), nunca do teto de um originador: ninguém autorizou
individualmente uma varredura noturna, e debitá-la do saldo de alguém faria essa pessoa
descobrir o gasto no dia em que precisasse clicar. Estourado o orçamento, o job **não
para** — só o item pago é pulado, e as quatro etapas grátis continuam rodando, porque são
elas que trazem os 77%.

### Camada 2+4 — um clique do originador, pago

O botão mostra o **custo estimado** antes de perguntar, e o número é o **teto**: com
`parar_ao_encontrar_alta` (default ligado) a cascata para na primeira fonte de confiança
alta, e a fatura sai menor. Prometer o teto e cobrar menos é a única direção aceitável do
erro.

| Fonte | Custo | Quando roda |
| --- | --- | --- |
| `novavida` | R$ 0,35 | sempre (sócios enriquecidos — em PME de construção o sócio quase sempre É quem decide) |
| `apollo` | R$ 1,20 | só com domínio resolvido **e** porte acima do mínimo |
| `claude_busca` | R$ 0,10 | sempre (site, **Instagram e Facebook**, Maps, listas locais, sindicatos) |

O Apollo é pulado, com o motivo registrado, quando falta domínio ou porte. Uma
serralheria de quatro pessoas em Sorocaba não tem página de empresa no LinkedIn, e pagar
R$ 1,20 para descobrir isso 688 vezes é a definição de gasto sem retorno.

O **teto mensal por originador** (`teto_mensal_por_originador`, default R$ 150) é a
autorização, não o gestor: dentro dele o originador aciona sozinho. Estourou, precisa de
liberação. Pedir aprovação para cada R$ 1,65 transformaria a descoberta num processo com
fila, e uma fila de aprovação de centavos é como um recurso pago vira um recurso que
ninguém usa.

### Camada 3 — pedir apresentação ao sacado

Botão **separado**, e a separação é a decisão: pedir um favor a um cliente não pode
acontecer como efeito colateral de alguém tentando achar um telefone.

O seletor de sacado prioriza quem **tem ponto focal conhecido**, não quem compra mais. O
pedido é um favor pessoal e funciona com quem atende: um sacado de R$ 2 milhões sem
ninguém conhecido é uma mensagem para o `contato@`; um de R$ 300 mil com ponto focal é
uma mensagem para alguém que responde.

Nesta fase o texto é **copiável**. Não existe canal de envio (Prompt 05), e um botão
"Enviar" que na verdade copia é a forma mais rápida de alguém acreditar que mandou uma
mensagem que nunca saiu.

O template padrão **não cita o volume** que o fornecedor fatura contra o sacado: o número
vem das notas que o próprio sacado nos enviou, e devolvê-lo na mensagem soa como
vigilância mesmo sendo um dado que ele nos deu. As variáveis existem para quem quiser
adaptar.

## Como interpretar confiança e evidência

**Confiança** não é uma nota de qualidade do contato — é uma afirmação sobre a
**procedência**:

- **alta** — campo estruturado declarado pela própria empresa, com data. O `<fone>` do
  bloco `<emit>` de uma NF-e emitida na semana passada; uma ficha do Google Places cujo
  endereço bate com o cadastral; um link `wa.me` publicado pela empresa no próprio site.
- **média** — a informação é da empresa, mas sem data ou sem estrutura. O telefone que o
  contador cadastrou na Receita na abertura; um e-mail no texto livre da nota; o celular
  de um sócio.
- **baixa** — achado com procedência fraca, ou reprovado na validação.

"Alta" declarada por um modelo vira **média** na gravação. Leitura de página web não
alcança campo estruturado, por melhor que a leitura seja.

**Evidência** fica visível em toda linha, sempre. "Achado no `emit` da NF 12345 de agosto"
e "achado numa página do Google" pedem tons de voz diferentes na primeira frase — e é a
primeira frase que decide se a ligação continua. Contato do Claude **sem URL de origem é
descartado**: um telefone sem procedência é indistinguível de um inventado, e a evidência
não é auditoria, é a prova de que a busca aconteceu.

## O que o extrator de XML não faz

Duas guardas, ambas nascidas de linhas reais da base:

1. **Só o bloco `<emit>`.** `<dest><enderDest><fone>` é o telefone do NOSSO CLIENTE, na
   mesma tag, no mesmo documento. Gravá-lo faria o originador ligar para a construtora
   perguntando pelo fornecedor dela — com confiança "alta", porque veio de tag
   estruturada.
2. **Rótulo do outro lado no texto livre.** `Email do Destinatario:
   fernandabin@imincorporadora.com.br` é uma linha real, no XML do fornecedor, com o
   e-mail da incorporadora. Qualquer coisa precedida de "destinatário", "comprador", "do
   cliente" ou "tomador" é descartada.

A **frequência** é o sinal barato: o mesmo telefone em 40 notas dos últimos 90 dias é
outra coisa que um visto uma vez numa nota de 170 dias atrás. Ela acumula (`greatest`) em
vez de sobrescrever, e a confiança sobe mas nunca desce sozinha — rebaixar é trabalho da
validação, que testa o canal em vez de opinar sobre a origem.

## Validação: rebaixa, nunca apaga

Diária, sobre qualquer fonte. Telefone: forma canônica E.164 e DDD que existe no plano da
Anatel. E-mail: sintaxe e **registro MX** do domínio — se o domínio não aceita e-mail, o
endereço não recebe, e isso se sabe sem mandar nada.

Nada aqui envia mensagem, disca ou faz probe de caixa postal. Verificação por envio é
toque, e toque passa pela supressão e por uma pessoa.

**Contato inválido não é apagado.** Ele fica com confiança rebaixada e marcado em
`validado`. Apagar destruiria justamente a evidência de que uma fonte entrega lixo — e um
provedor com 200 contatos e 5% de validade sumiria do painel de eficácia parecendo limpo.

## Aprendizado de fontes

Para cada fornecedor que chega a `cadastrado`, a atribuição é o **último toque antes da
conversão**: o contato com que a pessoa efetivamente falou. Não é o mais recente nem o de
maior confiança.

É por isso que cada toque (ligar/WhatsApp/e-mail, na web ou no celular) grava
`toque.manual` **com o id e a fonte do contato usado**. Sem isso o painel sabe quantos
contatos cada provedor trouxe e nunca quantos viraram cliente — que é a única pergunta que
decide desligar um provedor.

`descoberta_execucoes` registra **toda tentativa**, inclusive `pulado` e `sem_dados`. O
`pulado` é o registro mais fácil de esquecer e o mais importante: sem ele, "o Apollo tem
4% de acerto" é indistinguível de "o Apollo é ruim", quando a verdade pode ser que ele
quase nunca foi tentado.

`custo_por_cadastro` fica **nulo** enquanto não houver cadastro atribuído. Um zero ali
leria como "sai de graça", que é o oposto de "ainda não sabemos".

## Atribuição e a fila sem dono

O originador de um fornecedor é derivado do **sacado** contra o qual ele mais fatura, pela
carteira de originação (`vendedor_carteira`, papel `originacao`). O desempate é o volume,
porque é a porta de entrada mais forte da abordagem.

Hoje **112 dos 688** têm titular; os outros 576 nascem sem dono. É por isso que a fila sem
dono é o filtro que o gestor abre por padrão — e por que ela é dele, e não visível a todos
os originadores: dois deles ligariam para a mesma empresa na mesma semana, cada um achando
que era seu.

Reatribuir marca `originador_origem = 'manual'`, e o job noturno passa a não sobrescrever.
Sem esse flag a correção do gestor sumiria de madrugada e a pessoa a refaria no dia
seguinte, sem saber por quê.

## "Sem interesse" vale nos dois funis

Marcar sem interesse grava **três coisas numa transação**:

1. a **supressão** de canal, com validade (90 dias soft, ou eterna com peso de LGPD);
2. a linha em `antecipacao_fornecedor_sem_interesse`, que é o que a lista a prospectar da
   Antecipação lê;
3. o estágio do card.

Sem a segunda, o originador marcaria "não vai se cadastrar" aqui e o fornecedor
continuaria no topo da lista a prospectar da Antecipação com cara de lead novo. Duas telas
discordando sobre o mesmo CNPJ é como o trabalho é refeito.

O motivo vem da **lista enumerada** do 04 (`MOTIVOS_SEM_INTERESSE`), e reusá-la é o ponto:
"quantos perdemos porque já operam com outro?" só tem resposta se os dois funis
responderem com o mesmo vocabulário.

Reabrir o card (movê-lo para fora de `sem_interesse`) desfaz as três. Um desfazer que
desfaz metade — deixando o card no kanban e o CNPJ suprimido — é pior que nenhum. O
delete da supressão filtra por `contexto = 'comercial'`: sem isso, reabrir um card aqui
apagaria um bloqueio que o Radar ou a Antecipação criaram sobre o mesmo CNPJ.

### A data de volta mora na linha do funil, não em `supressao`

A policy de `supressao` exige o módulo **radar**, que o time Comercial não tem. A view do
funil é `security_invoker`, então um `left join supressao` viria **vazio** para exatamente
o público da tela — e devolveria `suprimido = false` com a cara de resposta certa. O card
de um fornecedor bloqueado apareceria normal, e o originador ligaria para alguém que o
sistema inteiro trata como "não abordar".

Por isso `fornecedores_funil.sem_interesse_ate` é escrito pelo RPC, e a view lê a própria
linha. O caso cruzado — alguém suprime o CNPJ pela tela da Antecipação — é reconciliado
pelo **job noturno**, que roda com service_role e enxerga as duas coisas: ele move o card
para `sem_interesse` quando a supressão aparece, e o devolve ao funil quando ela vence.
Sem essa volta, "soft 90 dias" seria eterna na prática.

Esses dois defeitos foram pegos por um teste de ponta a ponta dos RPCs rodando **como o
usuário** (`set role authenticated` com o JWT real). Nenhum deles é visível consultando
como superusuário — que é o modo como quase toda verificação de banco acaba sendo feita.

## Quem vê o quê

| | Originador | Gestor (Admin/Comercial) |
| --- | --- | --- |
| Funil e ficha | os fornecedores da carteira dele | tudo |
| Fila sem dono | não | sim, e é o filtro padrão |
| Buscar contatos (pago) | sim, dentro do teto | sim, e pode liberar quem estourou |
| Pedir apresentação | sim | sim |
| Tornar ponto focal | sim | sim |
| Reatribuir originador | não | sim |
| Eficácia por fonte | não | sim |
| Settings do módulo | não | sim (web) |

## Web e mobile

**Web**: funil (kanban ou tabela), ficha completa, busca paga, pedido de apresentação,
painel do originador, eficácia por fonte e settings.

**Mobile**: é a tela do Comercial que **mais pertence ao celular** — o uso real é na obra
ou no carro, com a ficha de abordagem na mão e ligar a um toque. Tem funil por estágio,
ficha, contatos com ligar/WhatsApp/e-mail, mover estágio, tornar ponto focal e marcar sem
interesse.

Fica **só na web**: settings, eficácia por fonte e o **clique pago**. O clique roda uma
cascata de até um minuto e meio, e uma rede de obra é o pior lugar para descobrir que a
chamada caiu no meio de uma cobrança. "Outro" como motivo de sem interesse também é só
web: ele exige observação escrita, e digitar um parágrafo em pé é o caminho mais curto
para uma justificativa vazia.

## Jobs e relógios

| Job | Quando | O que faz |
| --- | --- | --- |
| `fornecedores/atualizar-funil` | atrás de cada sync de NF | recalcula munição e titularidade, aplica entrada e saída |
| `fornecedores/descoberta-automatica` | 04h20, diário | camadas 0+1 em lote, na ordem do potencial |
| `fornecedores/buscar-contatos` | no clique | camadas 2+4 para um fornecedor, síncrono |
| `fornecedores/validar-contatos` | 05h40, diário | E.164 e MX; rebaixa o que não valida |

O funil roda **atrás do sync**, e não num cron próprio: a munição é derivada exatamente
das notas que acabaram de chegar. Num relógio separado, o card mostraria o volume de até
quatro horas atrás e um fornecedor que virou cliente hoje continuaria no kanban de alguém
como lead a prospectar.

## Credenciais

`NOVAVIDA_USUARIO`, `NOVAVIDA_SENHA`, `NOVAVIDA_CLIENTE` e `GOOGLE_PLACES_API_KEY` vivem
**só em variável de ambiente do worker**. Nunca em `fornecedores_config`, que é lida por
`authenticated` para o card poder mostrar o custo do clique — pôr uma credencial ali seria
distribuí-la a todo mundo que tem o módulo. O RPC de settings recusa qualquer chave com
"token" ou "senha" no nome.

O token da Nova Vida vive em `integracao_tokens`: RLS habilitada **sem policy nenhuma** e
`ALL` revogado de `anon`/`authenticated`. Duas camadas, porque o default do Supabase
concede ALL em toda tabela nova de `public` e uma policy escrita distraidamente amanhã
entregaria a credencial a todo mundo com sessão.

Sem a credencial, o provedor é **pulado com o motivo registrado** e a cascata segue nos
outros. É a diferença entre "não configurado" e "quebrado", e ela aparece no painel de
eficácia.

## O que ficou de fora (Prompt 05+)

- Envio real do pedido de apresentação e das mensagens ao fornecedor.
- Cadência automatizada de prospecção de fornecedor.
- Agente autônomo decidindo quem buscar. As tools de IA **planejam** o clique pago (dizem
  quanto custa e o que roda) mas nunca o executam: um modelo que decide sozinho gastar o
  teto de alguém é exatamente isso.
