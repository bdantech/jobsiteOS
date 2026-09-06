# Faturamento estimado & funcionários (Prompt 04c)

Duas métricas, um desenho: **série temporal** em `empresa_metricas`, nunca update, mais
um cache do valor vigente em `empresas`.

A série existe porque a pergunta comercial quase sempre é sobre a **derivada** — "essa
empresa está crescendo?" — e não sobre o nível. Guardar só o último valor destrói
exatamente o dado que interessa, e destrói em silêncio: ninguém percebe a informação que
não existe. O cache existe porque o filtro do Explorador precisa de **coluna** (é o
contrato do catálogo), e uma lateral sobre a série em 740 mil linhas do universo seria
paga em toda varredura.

## O aviso honesto, antes de qualquer número

Fontes tipo Apollo contam **perfis indexados no LinkedIn**. Elas subcontam mão de obra de
canteiro de forma brutal: uma construtora com 800 pessoas aparece com 40, porque pedreiro
não tem LinkedIn.

Isso **não** invalida o método, e o motivo é sutil: a calibração absorve o viés desde que
clientes e prospects sejam medidos pela **mesma régua torta**. O ratio "faturamento por
funcionário" sai de clientes medidos pelo Apollo e é aplicado em prospects medidos pelo
Apollo — os dois lados erram na mesma direção e na mesma proporção.

O dia em que isso quebra está marcado: quando o headcount de um cliente vier do eSocial e
o do prospect continuar vindo do Apollo, o coeficiente calibrado num vira erro sistemático
no outro. E ninguém vai notar, porque o número continuará com a mesma cara.

## Hierarquia de origens

`analise_credito` > `declarado_cliente` > `publicacao` > `apollo` > `apollo_search` >
`lista` > `modelo` > `bracket_simples`

**`analise_credito` é a receita do balanço** que o cliente entregou na esteira de crédito,
com a extração revisada por uma pessoa. Fica no topo porque declarar é dizer um número e um
balanço é o número com o documento atrás. Só extração **revisada** entra: um modelo lendo
PDF acerta quase sempre e erra o suficiente, e este valor passa a mandar na régua de 5.109
empresas.

O cache só é atualizado se a leitura nova tem origem **melhor ou igual** à vigente. Igual
conta porque a mesma fonte falando de novo é informação nova.

**A série é gravada sempre, mesmo quando a origem perde.** É o que permite responder
depois "o Apollo dizia 40 quando o cliente declarou 800" — que é a medida direta do viés
de canteiro. Jogar fora a leitura pior apagaria essa evidência.

Sem essa regra, o job mensal de estimativa apagaria todo mês o faturamento que o cliente
declarou na reunião da semana passada, em silêncio.

`apollo_search` é fonte **separada** de `apollo` de propósito: o `total` do `mixed_people`
conta perfis indexados, o que subconta ainda mais que a estimativa do `organizations/enrich`.
Misturar as duas esconderia por que uma construtora de 800 pessoas aparece com 40.

## Como o headcount chega (três caminhos, nenhum caro)

1. **Backfill retroativo** (`/jobs/radar/backfill-funcionarios`) — varre o payload dos
   enriquecimentos de contatos **já pagos**. O snapshot nasce com `capturado_em` da
   leitura **original**: datar como hoje inventaria uma série achatada e faria
   "crescimento em 12 meses" mentir na primeira consulta.

   **Medido na base real: hoje ele recupera zero.** A spec supunha que o payload já
   carregasse `estimated_num_employees`, mas o `enriquecerOrg` anterior devolvia só o
   `id` da organização e o resto era descartado antes de chegar ao banco — os 79 payloads
   existentes têm apenas `{creditos, revelados}`. O job continua no lugar porque a carona
   passou a guardar `organizacao`: daqui para frente ele tem o que reler, e um
   enriquecimento interrompido antes de gravar a métrica vira recuperável.
2. **Carona** — todo enriquecimento de contatos passou a extrair o headcount do passo
   `organizations/enrich`, sem chamada nem custo adicional. Gravado **antes** da
   revelação: se o `bulk_match` falhar no meio, o snapshot que custou zero não se perde
   junto.
3. **Sob demanda e em lote** — botão na Company 360 e `tipo = 'funcionarios'` no
   construtor de lotes. Exige **domínio resolvido**; sem ele o item falha com
   `sem_dominio`, declaradamente, em vez de sumir. Na ficha o botão fica desabilitado
   nesse caso e dá lugar a **Resolver domínio** — antes ele disparava, o worker
   respondia 202 e a tela dizia "Consultando o Apollo" para uma consulta que nunca
   existiu.

TTL de 180 dias. Headcount não custa crédito, mas reconsultar toda semana encheria a série
de pontos idênticos e arruinaria a leitura de crescimento — que é a razão de a série
existir.

## O estimador

### Calibração (mensal, nos clientes declarantes)

Por **tipo** de empresa, com piso de amostras (`n_minimo_calibracao_por_tipo`, default 5).
Abaixo disso o tipo não ganha coeficientes próprios e cai no global: um ratio calibrado em
duas empresas não é um ratio, é o acaso das duas com aparência de coeficiente.

| coeficiente | como sai |
|---|---|
| `ratio_fat_por_funcionario` | mediana de `faturamento_declarado / funcionarios` |
| `pct_mrr_sobre_faturamento` | mediana de `erp_mrr × 12 / faturamento_declarado` |
| `fat_por_usuario_erp` | mediana de `faturamento_declarado / erp_qtd_usuarios` |

**Mediana, não média**: um cliente gigante deslocaria o coeficiente inteiro.

**O peso de cada modelo é o inverso do erro mediano em log** do modelo ao prever os
próprios clientes declarados. Modelo que erra mais pesa menos — o sistema descobre sozinho
qual sinal funciona para qual tipo, em vez de alguém arbitrar que "funcionários é melhor
que MRR". Erro em log porque prever 2× e prever metade erram igual.

Modelo **sem amostra** para medir o erro entra com peso neutro (1), não com zero: zerar
mataria o único modelo disponível de uma empresa e a estimativa sumiria.

Coeficientes são **versionados** em `estimador_versoes`, mesmo padrão das regras da
pirâmide. Sem isso é impossível responder "por que a estimativa desta empresa mudou?", que
é a primeira pergunta que alguém faz quando o número muda.

### Estimativa

1. Calcula cada modelo que os sinais permitem.
2. Combina por **média geométrica ponderada**. Faturamento é log-normal: a média
   aritmética de "R$ 2M e R$ 200M" dá R$ 101M, um número que não descreve nenhuma das
   duas. A geométrica dá R$ 20M.
3. Aplica as restrições, **nesta ordem**:
   - optante do Simples → cap no teto; **sem modelo nenhum** → `teto × pct_default`,
     origem `bracket_simples`, confiança baixa;
   - saiu do Simples em data conhecida → o teto vira **piso** (quem estourou o teto não
     fatura menos que ele);
   - `regime_tributario = 'presumido'` → cap no teto do presumido. O regime **limita**, não
     informa: diz que a empresa está abaixo do teto, não onde.
4. Confiança: **alta** = duas **famílias de sinal** concordando dentro de 2×; **média** =
   uma família só, ou famílias divergentes; **baixa** = só bracket.
5. Snapshot só é gravado se variou mais que `variacao_minima_snapshot` (10%) contra o
   último snapshot **de modelo** — não contra o valor vigente, senão o job regravaria todo
   mês só porque a estimativa nunca bate com a declaração.

### Famílias de sinal: concordar não é o mesmo que confirmar

`mrr` e `usuarios_erp` **não são evidências independentes** — saem do mesmo
`erp_detalhes`. Medido na base: o MRR por usuário tem mediana de R$ 477, com quartis em
R$ 366 e R$ 572. É a mesma medida vezes uma constante, então os dois modelos concordam
**mecanicamente**, sempre.

Tratá-los como independentes tinha duas consequências:

- **A confiança saía `alta` apoiada numa medição só.** São ~5.000 empresas na base com os
  dois sinais — todas receberiam o rótulo que faz ninguém questionar o número.
- **A família de ERP levava peso dobrado na combinação**, por contagem de modelos e não
  por qualidade.

Agora cada família é **colapsada num valor só** antes de combinar, com peso igual à
**média** (não à soma) dos pesos dos seus modelos. Só a concordância entre famílias
diferentes — ERP × equipe — promove para `alta`.

Efeito prático hoje: **o valor não muda** (com uma família só, o representante dela é
exatamente a média geométrica ponderada de antes), e nenhuma estimativa passa de `média`
enquanto não houver headcount na base. Que é o rótulo correto.

**A restrição vem depois da combinação, e isso é o ponto.** Aplicar o cap do Simples antes
faria dois modelos discordantes virarem dois valores idênticos no teto, e a confiança
sairia `alta` — o sistema afirmando com convicção justamente onde não sabe de nada. Há
teste para isso.

### Sem calibração, não se estima

Sem cliente declarante, o job registra `sem_amostras` e não escreve nada. Deliberado: um
modelo com coeficientes inventados preencheria a base inteira de números plausíveis e
errados, e plausível é exatamente o que ninguém questiona.

## Onde está o quê

- **Banco**: migrations `0069` (tabelas, cache, tipo com 4 valores, config, RPC de
  declaração), `0070` (`regime_tributario` editável), `0071` (cobertura de headcount no
  painel).
  - `empresa_metricas` (append-only) + `estimador_versoes`
  - cache em `empresas`: `faturamento_*`, `funcionarios_*`, `regime_tributario`
  - RPC: `app_declarar_metrica`
- **Core** (`packages/core/src/radar/faturamento.ts`): modelos, combinação geométrica,
  restrições, calibração, `crescimento12m`, hierarquia de origens. 32 testes.
- **Worker**: `radar/funcionarios.ts` (backfill, carona, lote, sob demanda) e
  `radar/estimador.ts` (calibrar + estimar).
- **Web**: card "Faturamento & Equipe" na Company 360, página `/radar/estimador`, tipo
  `funcionarios` no construtor de lotes, cobertura no painel do Radar.
- **Mobile**: bloco de leitura na Company 360 — sem disparo, porque um job assíncrono que
  ninguém está olhando não é uma ação útil no celular.
- **Cron**: `/api/cron/radar-estimador`, dia 6 às 8h UTC — um dia depois dos protestos
  mensais, para calibrar com o mês já assentado.

## Tipo da empresa: quatro valores

`construtora | incorporadora | fornecedor | subempreiteiro`. `construtora` continua sendo o
default da coluna. A distinção incorporadora/subempreiteiro é refinada à mão porque inferir
por CNAE erraria justamente nas empresas que fazem as duas coisas — que são as maiores e as
que mais importam.

**O lead do formulário respeita o que a pessoa respondeu.** O formulário tem um campo
obrigatório "Tipo de empresa", e por muito tempo a resposta morria em
`formulario_submissoes.dados`: `app_processar_submissao` inseria a empresa sem `tipo` e
todo lead inbound virava construtora. Nove das quatorze submissões com o campo respondido
divergiam da ficha — sete fornecedores e uma incorporadora, entre elas a TS PINTURAS LTDA.
Corrigido na criação e retroagido para os nove. Empresa que já existe mantém o que está na
ficha: cadastro curado por gente não cai por resposta de landing page. "outro", que o
formulário oferece e o CHECK não aceita, fica sem destino de propósito.

## A revista, e por que ela rende menos amostra do que parece

`usar_amostras_publicadas` decide se o Ranking da Engenharia entra na calibração ao lado dos
declarantes. Ele mora em `radar_config.faturamento` e **está desligado**.

Duas coisas justificam:

1. **A medição de agosto/2026** (15 declarantes, 9 empresas do ranking): incluir a revista
   PIOROU o erro fora da amostra — 1,34x → 1,47x nos declarantes e 1,29x → 1,41x nas
   próprias empresas da revista. O suspeito é uso parcial do ERP: uma construtora de R$ 1,5
   bi com 3 usuários paga um MRR que não fala do tamanho dela.
2. **Das 141 empresas importadas, só 11 viram amostra.** Uma amostra precisa do rótulo E de
   um sinal. Nenhuma das 141 tem headcount aproveitável — o ranking publica *pessoal
   graduado* e a base é medida pelo Apollo, que conta perfis do LinkedIn; nas 4 empresas
   onde temos as duas medidas a razão deu 3,43, com p10 em 1,98 e p90 em 5,75, o que é
   espalhamento e não fator de conversão. Sobram as 11 que são clientes do ERP.

Ligá-lo hoje somaria 11 amostras e deslocaria `fat_por_usuario_erp` de R$ 4,9 mi para
R$ 6,2 mi (+26%) — cerca de 20% para cima em toda estimativa que dependa de sinal de ERP.
É um `update` no jsonb, sem deploy.

> **O flag esteve desligado por acidente, não por decisão.** O padrão no código é `true`, a
> linha `faturamento` no banco nunca teve a chave, e `ler()` substituía o objeto padrão
> inteiro pelo salvo em vez de mesclar — então a chave chegava como `undefined`. `ler()`
> agora mescla, e o valor foi escrito explicitamente para que a mescla não LIGASSE a revista
> em silêncio, que seria a troca oposta e igualmente sem decisão.

## Fora de escopo

eSocial como fonte de headcount real (futura Carteira), faturamento observado via grafo
NF-e, inferência de regime tributário.
