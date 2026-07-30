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

`declarado_cliente` > `apollo` > `apollo_search` > `lista` > `modelo` > `bracket_simples`

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
   `sem_dominio`, declaradamente, em vez de sumir.

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
4. Confiança: **alta** = 2+ modelos concordando dentro de 2×; **média** = 1 modelo ou
   modelos divergentes; **baixa** = só bracket.
5. Snapshot só é gravado se variou mais que `variacao_minima_snapshot` (10%) contra o
   último snapshot **de modelo** — não contra o valor vigente, senão o job regravaria todo
   mês só porque a estimativa nunca bate com a declaração.

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

`construtora | incorporadora | fornecedor | subempreiteiro`. **Nada foi reclassificado** e
`construtora` continua sendo o default. A distinção incorporadora/subempreiteiro é
refinada à mão porque inferir por CNAE erraria justamente nas empresas que fazem as duas
coisas — que são as maiores e as que mais importam.

## Fora de escopo

eSocial como fonte de headcount real (futura Carteira), faturamento observado via grafo
NF-e, inferência de regime tributário.
