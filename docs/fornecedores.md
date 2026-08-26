# Cadastro de Fornecedores (Prompt 04l)

Fornecedores que emitem NF contra nossos sacados e **não estão na plataforma** são
demanda latente de antecipação. Este módulo transforma essa lista num funil com dono,
munição de abordagem e um motor de descoberta de contato com orçamento.

Fica em **Comercial → Cadastro de Fornecedores**.

## O que já existia, e o que faltava

A view `antecipacao_fornecedores_a_prospectar` (migrações 0101/0102) já **listava** esses
CNPJs desde o Prompt 04. Ela continua existindo, continua correta, e agora é a **fonte
única** de quem é candidato — este funil não reimplementa a regra, ele lê a view.

O que faltava era tudo que separa uma lista de um funil: quem trabalha cada nome, em que
ponto da conversa ele está, o que dizer na primeira frase, e por onde falar.

### A régua é o sacado ter CRÉDITO APROVADO

Não basta o sacado estar cadastrado, e a 0102 mediu o estrago dessa confusão: **70% da
lista original** eram notas contra empresas que estão na plataforma mas não têm limite
aprovado. Para essas não há operação a oferecer — o lead não era lead. A aprovação vale
também quando está noutro CNPJ do grupo (holding ou SPE).

A primeira versão deste funil reimplementou a regra com `sacado_cadastrado` e trouxe o
problema de volta por outro caminho: dos 390 fornecedores que apareciam aqui e não na
tela de prospectar, **388 emitiam contra sacados sem limite aprovado**. Duas telas
discordando sobre quem é candidato é como o originador liga para alguém que a operação
não consegue atender.

Medido em 26/08/2026:

| Medida | Número |
| --- | --- |
| Candidatos (o que a view devolve) | 2.147 |
| Destes, com **volume ≥ R$ 25 mil em 90 dias** (`corte_volume`) | **516** |
| Volume cedido pelos candidatos na janela | R$ 77,5 milhões |
| Potencial mensal no funil | R$ 23,8 milhões |
| Com telefone no `<emit>` do XML da NF-e (amostra de 688) | 528 (77%) |
| Com e-mail no `<emit>` | 201 (29%) |
| Com telefone no cadastro da Receita | 75 (11%) |
| Com e-mail no cadastro da Receita | 70 (10%) |
| Com originador titular na carteira de originação | 212 |

## O corte de volume é a única diferença entre as duas telas

A tela de prospectar mostra os 2.147; este funil mostra os que passam do corte. É a
mesma lista, filtrada por quanto o lead vale — e o corte vive em
`fornecedores_config.corte_volume`, editável em Comercial → Configurações.

Sem corte nenhum, 87% da lista carrega 24% do volume e a ordenação por potencial perde
força. Com R$ 25 mil, entra a faixa de PME que fatura R$ 8–16 mil/mês contra nossos
sacados — que é justamente a que o Apollo não alcança e o XML da NF-e alcança.

A entrada é **automática**: quem passa do corte entra, sem curadoria. Ninguém revisa
quinhentos nomes, e a revisão não acrescentaria nada que o volume já não diga.

A saída também, mas com uma distinção que importa: sumir da view acontece por quatro
motivos — entrou na plataforma, o sacado perdeu o limite, parou de emitir na janela, ou
alguém marcou sem interesse. Só o primeiro é notícia, e só ele emite
`fornecedor.cadastrado`. Os outros deixam o card onde está: apagar a linha levaria junto
os contatos descobertos e o dinheiro já gasto para achá-los.

## A ordem é o valor emitido, do maior para o menor

E ela sai de `volume_90d`, não do `potencial_mensal` derivado dele. As duas dão exatamente
a mesma sequência — potencial é volume ÷ 3, e as 530 linhas concordam linha a linha —, mas
ordenar pelo número que a pessoa **não vê no card** é pedir que ela confie na ordem sem
poder conferi-la. O card mostra o volume; a consulta ordena pelo volume.

(A tela de fornecedores a prospectar ordena por **número de notas** por padrão, com o
argumento de que fluxo recorrente vale mais que uma nota grande e única. As duas leituras
são defensáveis; aqui a ordem é o valor.)

## Potencial mensal é volume ÷ 3, e nada além disso

É a conta mais simples possível, de propósito. Ela responde "quanto ele fatura por mês
contra nossos sacados" — não "quanto ele vai antecipar". A segunda pergunta depende de
apetite, prazo e limite, e um número que fingisse respondê-la colocaria o originador
numa ligação prometendo o que não é dele.

**O limite do sacado não entra na ORDENAÇÃO.** Ele é o teto da operação, não do lead: um
fornecedor de R$ 900 mil/mês contra um sacado que já usou o limite continua sendo o
melhor telefone da lista.

Isso é diferente de o sacado ter crédito **aprovado**, que é o que qualifica o lead a
existir. Ter limite e ter usado o limite são coisas distintas: a primeira decide se há
operação possível, a segunda é conjuntura do mês.

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
| `novavida` | R$ 0,35 | sempre — telefones e e-mail **da empresa**, mais celular dos sócios |
| `apollo` | R$ 1,20 | só com domínio resolvido **e** porte acima do mínimo |
| `claude_busca` | R$ 0,10 | sempre (site, **Instagram e Facebook**, Maps, listas locais, sindicatos) |
| `claude_aprofundado` | R$ 0,25 | botão próprio, **depois** da primeira passada e só quando há lacuna |

### A segunda busca não é repetir a primeira

Quando a primeira passada volta com pouco — um `contato@` genérico, um fixo que ninguém
atende, um e-mail cujo domínio não tem MX — existe uma pergunta melhor a fazer, e ela é
**outra**:

| | pergunta |
| --- | --- |
| primeira | "ache contatos comerciais desta empresa" |
| aprofundada | "estes já temos, estes não funcionam; ache uma **pessoa** com celular" |

Repetir o mesmo prompt pagaria duas vezes pela mesma resposta. Mandar junto o que já foi
achado e o que falhou na validação é o que muda a pergunta — e é o que autoriza procurar
em lugares mais caros de varrer: sindicato patronal, junta comercial, notícia local,
perfil de sócio, ficha de obra pública.

Três disciplinas:

- **É uma fonte própria** (`claude_aprofundado`), não a mesma com outro prompt. O §6 mede
  eficácia por fonte, e "a segunda passada paga?" é a pergunta que decide gastá-la —
  gravando as duas juntas, a resposta ficaria diluída na média.
- **O botão só aparece quando há lacuna.** Com uma pessoa nomeada e canal direto
  validado, ela não acrescentaria, e a tela não oferece. A conta é a **mesma função do
  core** que o worker usa para decidir: se a tela dissesse "vale" e o worker recusasse, o
  originador aprenderia a regra pelo erro.
- **O TTL não é o da primeira.** `claude_busca` tem 90 dias porque não se paga duas vezes
  pela mesma pergunta; esta é outra pergunta, com TTL próprio.

### O Apollo tinha as duas portas fechadas por construção

Ele exige domínio resolvido **e** porte acima do mínimo, e as duas condições eram
impossíveis de satisfazer para este funil:

- **Domínio:** dos 530 fornecedores, **zero** tinham domínio resolvido. Quem descobre
  domínio nesta cascata é a busca do Claude — que rodava *depois* do Apollo, e cujo
  achado virava uma linha `site` em `contatos_descobertos` e nada mais. Foi o que
  aconteceu com a I3M Engenharia: o Apollo pulou por "sem domínio resolvido" às
  14:20:17, e treze segundos depois a busca devolveu `i3m.com.br`. No segundo clique
  seria pulado de novo, e no terceiro.
- **Porte:** `funcionarios` vem da ficha em `empresas`, e um fornecedor do funil **por
  definição** não tem ficha — não estar na plataforma é o que o põe aqui. Porte
  desconhecido era tratado como porte pequeno, e o registro dizia "porte abaixo do
  mínimo" sobre uma empresa cujo porte ninguém tinha medido.

As três correções:

1. O `site` que a cascata acha é **gravado como domínio** (em `mercado_universo`, e em
   `empresas` quando há ficha), com a mesma guarda da cascata do Radar: decisão manual
   nunca é sobrescrita, e provedor genérico, placeholder e domínio de contabilidade são
   descartados. Isso destrava o Apollo e poupa o Radar de redescobrir.
2. **Sem domínio, o Apollo desce para depois da busca** e roda com o que ela achou na
   mesma corrida. Com domínio, a ordem da spec (§4.2 a/b/c) vale como está. De quebra é
   mais barato: a busca custa R$ 0,10 e o Apollo R$ 1,20, então a etapa que pode tornar
   a outra desnecessária vem primeiro.
3. **`porte_rfb` decide quando falta headcount.** `ME` e `EPP` são a própria empresa
   declarando que é pequena; `DEMAIS` é o contrário. Dos 530 do funil, 196 são `DEMAIS`.
   Sem porte nenhum, continua fora — aí realmente não se sabe nada.

Uma serralheria de quatro pessoas em Sorocaba não tem página no LinkedIn, e pagar R$ 1,20
para descobrir isso centenas de vezes é gasto sem retorno. Mas isso é diferente de nunca
tentar.

### O que a NVCHECK devolve, e o que o primeiro parser jogava fora

O mapeamento foi escrito a partir da descrição do prompt ("mapear telefones/e-mails de
sócios") e procurava uma chave `Socios` na raiz. O schema real é outro:

```
{ d: { CONSULTA: { CADASTRAIS:    {...QTDEFUNCIONARIOS, PORTE, FATURAMENTOPRESUMIDO}
                   TELEFONES:     [{DDD, TELEFONE, TIPO_TELEFONE, PROCON, FLWHATS}]
                   EMAILS:        [{EMAIL}]
                   CONTATOSRUINS: [{DDD, TELEFONE}]
                   QSA:           [{ QSA: [{NOME, QUALIFICACAO, DDD_SOCIO, CEL_SOCIO}] }] } } }
```

Três erros, e cada um sozinho zerava o resultado: o desembrulho parava em `d` sem descer
em `CONSULTA`; a lista de sócios é `QSA` e está **aninhada duas vezes**; e `TELEFONES` e
`EMAILS` **da própria empresa** — o dado mais valioso aqui — nem eram procurados.

Custou R$ 1,40 em quatro consultas registradas como "sem dados" tendo trazido dados: uma
delas com quatro telefones. As quatro foram reclassificadas como `erro` (o custo fica no
livro-razão; o status volta a dizer a verdade, e o TTL para de bloquear a repetição).

O que o parser faz agora:

- **telefone e e-mail da empresa** entram como confiança média — é cadastro de terceiro,
  sem a data que o `emit` de uma NF-e tem;
- **`FLWHATS = S` promove o registro a `whatsapp`**. É afirmação do provedor, não palpite
  nosso, e por isso vai para `validado.tem_whatsapp`;
- **`CONTATOSRUINS` são excluídos.** A própria base marca os telefones que já se sabe que
  não atendem; gravá-los seria pagar para pôr na tela um número que o fornecedor da
  informação avisou que não serve — e ele apareceria igual aos bons até alguém discar;
- **`PROCON = S` aparece na evidência** e não remove o contato: é sinal para quem liga,
  não bloqueio (o bloqueio é a lista de supressão);
- **o cadastral é gravado na ficha**. `QTDEFUNCIONARIOS` é exatamente o número que o gate
  de porte do Apollo procura e que nenhum fornecedor deste funil tem — pagar pela consulta
  e descartar essa metade era comprar a resposta e jogar fora a que resolve o problema
  seguinte da mesma cascata. Só grava onde está vazio: o headcount do Apollo é medido, o
  desta é presumido, e sobrescrever apurado por estimado faria a série contar uma queda
  que não existiu.

### `sem_dados` de um provedor pago é ambíguo, e a ambiguidade é cara

A consulta à Nova Vida pela I3M custou R$ 0,35 e devolveu zero contatos. Não havia como
saber se o CNPJ não tem sócio com telefone ou se o mapeamento errou a chave — duas
hipóteses que pedem ações opostas (esperar, ou corrigir código), e escolher entre elas
exigia repetir a chamada paga.

Agora, quando um provedor responde e não rende contato nenhum, o registro guarda a
**forma** da resposta: nomes de chave e tipos, nunca valores. A resposta traz nome, CPF e
telefone de pessoa física, e um log de diagnóstico não é lugar para isso.

Ela se pagou no primeiro uso. Foi o registro

```
{d: {CONSULTA: {CADASTRAIS: {23 chaves}, ENDERECOS: [1× …], TELEFONES: [4× …], …}}}
```

que mostrou que a Nova Vida vinha respondendo com dados o tempo todo e que o parser é que
os descartava. Sem ele, a hipótese "estes CNPJs não têm contato" e a hipótese "o parser
errou a chave" só se separariam repetindo a chamada paga.

A CONSULTA também devolve **erro como texto com HTTP 200** (doc §2: credencial errada,
consulta não liberada, cota do cliente, cota do usuário) — não só a geração do token. Isso
passou a ser verificado: antes, um "SEM ACESSO AO SISTEMA" virava zero contatos com R$ 0,35
cobrados e nada dizendo por quê.

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

Hoje **212 dos 530** têm titular; os outros 318 nascem sem dono. A fila sem dono é do
gestor, e não visível a todos os originadores: dois deles ligariam para a mesma empresa na
mesma semana, cada um achando que era seu.

Ela **não** é o filtro padrão, e isso foi corrigido depois de ver o efeito. O default era
a fila sem dono, com o argumento de que é a única ação exclusiva do gestor. O argumento é
verdadeiro e a decisão era errada: quem comparou esta tela com a de fornecedores a
prospectar viu o maior fornecedor sumido — ele tem dono — e concluiu que a ordenação
estava quebrada. Estava certa; a lista é que vinha filtrada, e nada dizia isso alto o
bastante. Um default que faz a pessoa desconfiar do dado custa mais do que economiza.

Reatribuir marca `originador_origem = 'manual'`, e o job noturno passa a não sobrescrever.
Sem esse flag a correção do gestor sumiria de madrugada e a pessoa a refaria no dia
seguinte, sem saber por quê.

## "Sem interesse" vale nos dois funis

Marcar sem interesse grava **três coisas numa transação**:

1. a **supressão** de canal, com validade (90 dias soft, ou eterna com peso de LGPD);
2. a linha em `antecipacao_fornecedor_sem_interesse`, que é o que a lista a prospectar da
   Antecipação lê;
3. o estágio do card, com a **origem** do descarte.

### Descartar acontece em três lugares, e a reconciliação precisa ler os três

| Onde | O que grava |
| --- | --- |
| Funil de cadastro (04l) | supressão + qualificação + estágio |
| Lista a prospectar (0104) | **só** `antecipacao_fornecedor_sem_interesse` |
| Radar / Antecipação (0047) | **só** `supressao` |

O job lia apenas `supressao`. Um fornecedor descartado pela lista a prospectar sumia dos
candidatos e o card ficava em `a_cadastrar` para sempre — o originador ligaria para quem
outra pessoa já trabalhou e descartou. Medido: 2 marcados lá, **zero** com supressão.

Por isso existe `sem_interesse_origem`: sem data no card, "definitivo" (LGPD) e
"reversível na outra tela" apareciam iguais, e essas duas coisas pedem ações opostas.

Sem a segunda, o originador marcaria "não vai se cadastrar" aqui e o fornecedor
continuaria no topo da lista a prospectar da Antecipação com cara de lead novo. Duas telas
discordando sobre o mesmo CNPJ é como o trabalho é refeito.

O motivo vem da **lista enumerada** do 04 (`MOTIVOS_SEM_INTERESSE`), e reusá-la é o ponto:
"quantos perdemos porque já operam com outro?" só tem resposta se os dois funis
responderem com o mesmo vocabulário.

Os descartados têm **tela própria** (`/comercial/fornecedores/sem-interesse`), com o
botão no topo do funil de onde eles saíram — que é o único lugar onde alguém se pergunta
"e o fornecedor que sumiu daqui, para onde foi?". É a mesma decisão da tela de
fornecedores a prospectar, e existe pela mesma razão: sem ela, "sumiu do kanban" e "nunca
esteve no kanban" seriam indistinguíveis.

Esta tela mostra uma coisa que a da Antecipação não tem: a **data de volta**. Aqui o
descarte tem validade, e "sem interesse hoje" e "nunca mais" são decisões diferentes — sem
a coluna, a supressão soft pareceria eterna e ninguém saberia quando voltar a ligar.

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
| Fila sem dono | não | sim, a um clique no cabeçalho |
| Lista de descartados | sim, os da carteira dele | sim, todos |
| Buscar contatos (pago) | sim, dentro do teto | sim, e pode liberar quem estourou |
| Pedir apresentação | sim | sim |
| Tornar ponto focal | sim | sim |
| Reatribuir originador | não | sim |
| Eficácia por fonte | não | sim |
| Settings do módulo | não | sim (web) |

## Web e mobile

**Web**: funil (kanban ou tabela), ficha completa, busca paga, pedido de apresentação,
painel do originador, eficácia por fonte e settings.

O funil usa a **mesma forma** do funil de reuniões, do funil de vendas e da esteira de
crédito: um cartão só, kanban por estágio com colunas roláveis, tabela como alternativa,
e o mesmo `ModalDoCard` com trilha de etapas ao abrir. A pergunta é a mesma nas quatro
telas — "onde está cada coisa, e o que falta nela" —, e duas telas que respondem à mesma
pergunta com layouts diferentes obrigam a pessoa a reaprender a ler a cada troca de
módulo. Também não há arrastar-e-soltar, pelo mesmo motivo dos outros.

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
| `fornecedores/atualizar-funil` | atrás de cada sync de NF | recalcula munição e titularidade, aplica entrada e saída, reconcilia descartes |
| `fornecedores/descoberta-automatica` | 04h20, diário | camadas 0+1 em lote, na ordem do potencial |
| `fornecedores/buscar-contatos` | no clique | camadas 2+4 para um fornecedor, síncrono |
| `fornecedores/validar-contatos` | 05h40, diário | E.164 e MX; rebaixa o que não valida |

O funil roda **atrás do sync**, e não num cron próprio: a munição é derivada exatamente
das notas que acabaram de chegar. Num relógio separado, o card mostraria o volume de até
quatro horas atrás e um fornecedor que virou cliente hoje continuaria no kanban de alguém
como lead a prospectar.

A tela **não** tem botão para forçá-lo. Um botão que dispara varredura convida a
apertá-lo quando a lista parece estranha — que é justamente quando ele não muda nada,
porque a lista já reflete as notas que chegaram. Para rodar fora de hora existe
`POST /jobs/fornecedores/atualizar-funil` no worker, que é trabalho de quem opera.

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
