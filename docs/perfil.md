# Perfil de Quem Opera (04f)

Feedback loop: as características de quem realmente opera viram sugestões de ajuste
das réguas — camadas (TAM/SAM/SOM) e faixas do funil. **O sistema recomenda com
evidência e nunca aplica.**

Vive no módulo **Mercado**: `/mercado/perfil` (web) e uma tela de leitura no mobile.

---

## Como ler um achado

Cada card diz uma frase, mostra **duas barras** e um número. As barras são o produto,
não a tabela: um *lift* de 3,2 não significa nada para quem não lida com razão de
prevalência; duas barras lado a lado, uma três vezes maior que a outra, significam para
qualquer pessoa.

- **Barra de cima** = a coorte que opera. **Barra de baixo** = o controle.
- O percentual é calculado **dentro de quem tem dado**, não sobre a coorte inteira.
  Quem não tem o dado sai do numerador **e** do denominador — diluí-lo inventaria uma
  resposta. É a mesma renormalização do scorecard de crédito.
- **"3,2× mais"** é o lift: a característica é 3,2 vezes mais frequente entre quem
  opera. **"0,3× "** aparece como "3,3× menos" — a força é simétrica, porque quatro
  vezes menos informa tanto quanto quatro vezes mais.

### Quando o painel se cala, e por quê

| Selo | O que aconteceu |
| --- | --- |
| **poucos dados** | A célula tem menos de 15 casos de um dos lados. Com 9 fornecedores conversores, "3 de 9 são S.A." é 33% — e um fornecedor a mais move isso em 11 pontos. |
| **dado escasso** | A variável está preenchida em menos de 40% de um dos lados. Ela descreve as 40%, não a coorte, e a barra não denunciaria isso. Some do painel principal e fica em "ver todas as variáveis". |
| **"só aqui"** | A categoria não existe no controle. O lift seria divisão por zero, e "∞× mais provável" é a forma mais rápida de uma amostra de um virar política. |

Nenhum achado com esses selos vira sugestão automática. **A ausência de achado quase
sempre significa "ainda não há dado", não "não há padrão"** — e as duas exigem ações
opostas: a primeira pede esperar, a segunda pede mudar a régua.

---

## A auditoria: a parte que morde

A régua é lida todo dia. Quem ela **deixa de fora**, nunca — porque quem fica de fora não
aparece em tela nenhuma. Por isso as coortes são rodadas pelas regras vigentes, pelo
**mesmo compilador** (`compileToSql`) que a reclassificação usa. Auditar com uma segunda
implementação seria auditar uma regra que não existe.

Duas frases saem daí:

- **Camadas** — "50% dos sacados pesados não passariam na regra de SAM", seguido de
  quais condições os barram, contadas **uma a uma**. A soma pode passar do total: uma
  mesma empresa costuma falhar em mais de uma condição.
- **Faixas** — taxa de conversão real por faixa, e quantas NFs converteram estando
  **fora de qualquer faixa**. Este segundo número é confiável como história porque a
  reclassificação pula `estagio_funil in ('convertida','perdida')`: a faixa congela na
  saída do funil.

### `sem_cadastro`

Uma terceira linha aparece quando parte da coorte **não pôde ser avaliada**: são
empresas que operam de verdade mas não têm linha no universo (nunca passaram pelo lookup
cadastral). Contá-las como reprovadas inflaria a mordida; omiti-las esconderia que a
régua sequer as enxerga.

Não é hipótese: na primeira execução real, **4 dos 9 fornecedores conversores** estavam
nessa situação — e a primeira versão do job, que partia de `mercado_explorador` com
INNER JOIN, simplesmente os perdia e reportava uma coorte de 5.

---

## Sugestão → versão de regra

Dois padrões geram sugestão, e **só eles**:

1. **Afrouxar** uma condição que barra uma fatia grande de quem opera. O corte proposto
   é o **percentil** que incluiria 95% da coorte, arredondado para um número redondo —
   nem o mínimo (uma empresa recém-aberta zeraria a régua de idade) nem um valor exato
   ("capital ≥ R$ 483.219" não se defende numa reunião).
2. **Adicionar** um sinal com lift alto que a regra ainda não usa.

**O gerador nunca aperta.** Sugerir exclusão a partir de lift baixo transformaria o viés
de onde historicamente prospectamos numa regra que garante que nunca prospectaremos lá —
exatamente o que o aviso de rodapé existe para denunciar. Também não afrouxa condições de
integridade (`situacao_cadastral = ativa`, `fora_recorte_cnae = false`): ali, afrouxar
não é ajuste, é bug.

O fluxo do um-clique:

```
card de sugestão
  → "Criar nova versão com este ajuste"
  → registra a decisão em perfil_sugestoes_log (a árvore vem do SNAPSHOT, nunca do browser)
  → abre /mercado/piramide?sugestao=<log> ou /antecipacao/faixas?sugestao=<log>
  → o editor carrega o rascunho e mostra um banner
  → preview de impacto → ativação HUMANA
  → a versão criada é carimbada de volta no log
```

Nada é ativado pelo card. Uma regra de camada reclassifica ~2M linhas e reescreve todos
os números contra os quais o comercial planeja — é a coisa mais cara de desfazer no
sistema.

O **impacto simulado** no card é um dry-run real, pelo mesmo caminho do preview do
editor. Um card que dissesse "≈2.400" e o editor mostrasse 900 destruiria a confiança nos
dois.

---

## Por que existe o aviso de viés

> Este perfil descreve quem já chegou até nós — ele pode refletir onde historicamente
> prospectamos, não só quem é bom. Use como evidência, não como verdade.

As coortes são de clientes e de fornecedores que **já entraram no funil**. Se nunca
prospectamos no Norte, a coorte não terá empresas do Norte — e o perfil dirá que quem
opera é do Sudeste e do Sul. Isso é verdade sobre a nossa história, não sobre o mercado.

O contraste `conversores × expostos não-conversores` é o que mais protege contra isso: os
dois lados tiveram NF em faixa no período, ou seja, a **mesma exposição**. O que muda é o
desfecho. Comparar conversores contra "todos os fornecedores" mediria sobretudo quem
entrou no funil — uma tautologia com cara de descoberta.

O texto do aviso vive em `AVISO_VIES`, no core, e é o **mesmo** na web, no mobile e no
retorno das tools de IA. Um aviso que existe na tela e some na resposta do assistente é
um aviso que não existe — e a resposta do assistente é justamente a que costuma ser
colada num slide.

---

## Onde está o quê

- **Banco**: migração `0080`. `perfil_config` (coortes + análise), `perfil_snapshots`
  (um por comparação, **sempre novo**, nunca update — a série no tempo é o produto),
  `perfil_sugestoes_log`. RPCs: `app_registrar_sugestao_perfil` (lê a árvore do snapshot),
  `app_vincular_versao_sugestao`, `app_salvar_perfil_config`, `perfil_snapshot_atual`.
- **Core** (`packages/core/src/perfil/`): `natureza-juridica.ts`, `contraste.ts` (lift,
  cobertura e as regras de silêncio), `variaveis.ts` (o catálogo + o mapa categoria →
  condição de regra), `auditoria.ts` (os tipos), `sugestoes.ts` (o gerador),
  `frases.ts` (templates — nunca IA), `schemas.ts`, `mutations.ts`.
- **Worker** (`apps/worker/src/jobs/perfil/`): `coortes.ts`, `auditoria.ts`,
  `recalcular.ts`. Mensal (dia 8, depois das calibrações do 04c e 04d) e sob demanda.
- **Web**: `/mercado/perfil` + `components/mercado/perfil/`.
- **Mobile**: `app/(tabs)/mercado/perfil.tsx` — leitura.
- **Tools**: `perfil.resumo`, `perfil.sugestoes_pendentes` (no módulo Mercado).

## Limitações conhecidas

- **`perfil.recalcular` como tool de IA NÃO foi implementada.** Uma tool recebe apenas
  `{ userId, supabase }` — não há canal para o worker a partir do core, que é
  compartilhado com o mobile. Criar uma tabela de fila com um poller só para isso seria
  máquina demais para um botão que está a um clique na mesma tela. As duas tools de
  leitura apontam para ele.
- **`protesto_recente (<90d)` não existe.** `protestos_atual` guarda quando **nós
  consultamos**, não quando o protesto foi lavrado. Usar a data da consulta como se fosse
  a do protesto seria trocar um dado que falta por um número errado.
- **A categoria `EIRELI/SLU` é residual por lei, não por descuido.** A EIRELI foi extinta
  em 2021 e convertida em Sociedade Limitada Unipessoal, que a Receita registra como
  **2062** — o mesmo código de uma LTDA comum. Restam 9 empresas com 2305 na base
  inteira. Um achado vazio ali não diz nada sobre unipessoais: elas estão em `ltda`,
  indistinguíveis.
- **As comparações são fixas** (§2), não configuráveis. Três contrastes bem escolhidos
  valem mais que um construtor de coortes que ninguém usa — e que produziria comparações
  sem controle, o erro que este módulo existe para não cometer.
- **A trilha de fornecedores não gera sugestão de afrouxar faixa.** Barreira de faixa
  fala de NOTAS, e a coorte é de FORNECEDORES; o caminho honesto para afrouxar faixa é a
  auditoria de conversão fora de faixa, que a tela mostra.
