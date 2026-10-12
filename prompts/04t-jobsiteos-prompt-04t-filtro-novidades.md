# JOBSITEOS — Claude Code Prompt 04t: Filtro de novidades no funil de NFs

## "O que entrou desde a última vez que eu trabalhei"

> Builds on Prompts 04 (funil de NFs), 04s (pré-autorizações e títulos do Sienge), 04k (carteira do originador), 04p (Meu Dia). Alteração pequena e cirúrgica: **nada do funil atual muda de comportamento**, só entra um filtro novo e um carimbo de data de entrada.
> UI pt-BR, código em inglês. Migrations via Supabase MCP. Web **e** mobile — o caso da segunda-feira de manhã é, na prática, um caso de celular.

---

## 1. O problema real

O pedido literal é "filtrar o que entrou nas últimas 6 horas". Mas a exceção que acompanha o pedido — numa segunda-feira ou depois de feriado, trazer tudo desde sexta — mostra que **a janela fixa de 6 horas é um atalho para outra coisa**: o originador quer ver o que chegou desde o fim do último expediente em que ele estava trabalhando.

Implementar `now() - interval '6 hours'` com um `if` para segunda-feira resolve segunda e quebra em todo feriado emendado, em ponto facultativo e na véspera de Natal. A regra certa é uma só e cobre todos esses casos sem caso especial.

**Semântica adotada**: a janela default começa no **fim do último expediente útil anterior a agora** e termina agora.

| Momento | Início da janela | Por quê |
| --- | --- | --- |
| Segunda 09:00 | sexta 18:00 | último dia útil foi sexta |
| Terça 15:00 | segunda 18:00 | já está no expediente |
| Quarta pós-feriado terça | segunda 18:00 | o feriado não é dia útil |
| Sexta 20:00 | sexta 18:00 | trabalhando além do expediente |
| Segunda pós-feriado emendado | quinta 18:00 | sai de graça, sem caso especial |

E **"últimas 6 horas" continua existindo** como uma das opções do seletor, porque às 15h de uma terça ela é a visão útil.

---

## 2. O carimbo de entrada — a parte que precisa de cuidado

### 2.1 Qual timestamp

"Entrou" significa **quando o item apareceu para o originador**, não quando a NF foi emitida. O sync de NFs roda de 4 em 4 horas a partir das 06:30; uma nota emitida há três dias que o certificado só capturou agora **é novidade hoje** — é hoje que ela entra na fila de trabalho dele.

Adicionar às três tabelas do funil:

```sql
alter table notas_fiscais        add column entrou_funil_em timestamptz;
alter table titulos_sienge       add column entrou_funil_em timestamptz;
alter table pre_autorizacoes     add column entrou_funil_em timestamptz;

create index on notas_fiscais    (entrou_funil_em desc) where entrou_funil_em is not null;
create index on titulos_sienge   (entrou_funil_em desc) where entrou_funil_em is not null;
create index on pre_autorizacoes (entrou_funil_em desc) where entrou_funil_em is not null;
```

*(Confirmar os nomes reais das tabelas de título e pré-autorização criadas no 04s e usar os existentes — não criar tabela nova.)*

### 2.2 Três armadilhas, e como evitar cada uma

**(a) `updated_at` não serve.** Mudança de status, recálculo de faixa ou troca de estágio alteram `updated_at` e **não** são novidade. O filtro lê `entrou_funil_em`, que é imutável depois de gravado.

**(b) O upsert do sync não pode reescrever o carimbo.** O sync de NFs é idempotente por `accessKey` e faz upsert. Se o carimbo for atualizado no conflito, **toda a base vira "novidade" na próxima rodada** e o filtro nasce inútil. Gravar com:

```sql
insert into notas_fiscais (..., entrou_funil_em) values (..., now())
on conflict (chave_acesso) do update set
  ...,                                  -- demais campos atualizam normalmente
  entrou_funil_em = coalesce(notas_fiscais.entrou_funil_em, excluded.entrou_funil_em);
```

Escrever teste para isso: rodar o sync duas vezes com o mesmo payload e verificar que `entrou_funil_em` não mudou na segunda.

**(c) Item que já existia e só agora entrou no funil daquele originador.** Dois casos reais:
- a NF existia mas o sacado só teve crédito aprovado hoje, então só hoje ela virou operável;
- o item foi reatribuído para a carteira dele hoje.

Nos dois, para esse originador é novidade, e o carimbo original mentiria. Tratar com uma segunda coluna, que só é preenchida nesses casos:

```sql
alter table notas_fiscais    add column reentrou_funil_em timestamptz;
alter table titulos_sienge   add column reentrou_funil_em timestamptz;
alter table pre_autorizacoes add column reentrou_funil_em timestamptz;
```

O filtro usa `coalesce(reentrou_funil_em, entrou_funil_em)`. Gravar `reentrou_funil_em = now()` quando o item passa de não-operável para operável, e quando muda de titular na carteira. **Não** gravar em mudança de estágio dentro do funil — isso é trabalho acontecendo, não chegada.

### 2.3 Backfill

Preencher `entrou_funil_em` dos registros existentes com o `created_at` de cada um. Sem isso o filtro volta vazio no primeiro dia e parece quebrado.

---

## 3. Calendário de dias úteis

```sql
create table dias_nao_uteis (
  data date primary key,
  nome text not null,
  escopo text not null default 'nacional',   -- nacional | estadual | municipal | empresa
  uf text,
  municipio text,
  origem text not null default 'brasilapi',  -- brasilapi | manual
  criado_em timestamptz default now()
);
```

- **Nacionais**: job anual que busca em `https://brasilapi.com.br/api/feriados/v1/{ano}` (BrasilAPI já está no stack) e popula o ano corrente e o seguinte. Falha da API não pode quebrar o filtro — ver §4.
- **Estaduais, municipais e pontos facultativos da empresa**: cadastro manual por gestor em settings. A BrasilAPI não traz 9 de julho, aniversário de cidade nem a emenda que a empresa decidiu tirar — e é exatamente isso que gera a segunda-feira errada.

**Expediente** em settings: `expediente_inicio` (default 09:00) e `expediente_fim` (default 18:00), fuso `America/Sao_Paulo` fixo.

**Limitação que precisa estar no README**: a janela é calculada pelo calendário da empresa, não pela presença de cada pessoa. Quem volta de férias ou folga não terá a janela esticada automaticamente — para esse caso existe o intervalo personalizado (§5). Não tentar inferir ausência individual.

---

## 4. O cálculo

`packages/core/funil/janela-novidades.ts`:

```ts
function inicioJanelaNovidades(agora: Date, cal: Calendario, cfg: Config): Date
```

Regra: **o maior instante T tal que T = (dia D às `expediente_fim`), com D dia útil e T < agora.**

Testes obrigatórios — é aqui que esse tipo de código erra:
- segunda 09:00 → sexta 18:00
- terça 15:00 → segunda 18:00
- quarta 08:00, com terça feriado → segunda 18:00
- segunda 10:00, com sexta feriado emendado → quinta 18:00
- sexta 20:00 → sexta 18:00 (mesmo dia, janela de 2h)
- sábado 11:00 → sexta 18:00
- domingo 23:00 → sexta 18:00
- **horário de verão / mudança de offset**: a janela não pode pular nem duplicar hora. Calcular sempre em `America/Sao_Paulo` e converter para UTC na borda da query, nunca o contrário.
- **calendário indisponível** (BrasilAPI fora do ar e sem cache): cair para "só fim de semana conta como não útil", **avisar na UI** que feriados podem não estar considerados, e seguir. Nunca retornar janela vazia.

---

## 5. UI — o seletor

No funil de NFs (web e mobile), ao lado dos filtros existentes, um seletor **Novidades**:

| Opção | Janela |
| --- | --- |
| **Desde meu último expediente** *(default quando o filtro é ligado)* | §4 |
| Últimas 6 horas | `now() - 6h` |
| Hoje | desde `expediente_inicio` de hoje |
| Últimos 7 dias | `now() - 7d` |
| Personalizado | duas datas/horas |

O filtro **compõe** com todos os existentes — tipo (NF · pré-autorização · título, do 04s), faixa, sacado, estágio, carteira. Nada do funil atual muda; este é mais um predicado no `where`.

Quando ativo, mostrar em texto claro o que está sendo exibido: *"Mostrando o que entrou desde sexta, 10/10, às 18:00 — 23 itens"*. Janela calculada em silêncio é janela que ninguém confia; escrita por extenso, o originador confere sozinho se a conta bate.

**Carimbo no card**: linha discreta com "entrou há 2h" / "entrou sexta 19:40". Item cujo `reentrou_funil_em` está preenchido mostra o motivo — "voltou ao funil: sacado aprovado" ou "voltou ao funil: entrou na sua carteira" —, porque um item com data de emissão antiga aparecendo como novo sem explicação parece bug.

**Contador na aba** do funil: badge com o número de itens na janela default, respeitando a carteira do originador (novidade é dele, não global; gestor vê tudo). Atualizar após cada sync, via Realtime se já estiver em uso naquela tela.

---

## 6. Opcional — selo "não visto" (§ pode ser cortado)

A janela resolve o caso da chegada. Não resolve o do meio do dia: às 15h de terça, a janela desde segunda 18:00 traz junto o que ele já trabalhou de manhã.

Solução barata, sem tabela nova:

```sql
alter table usuarios add column funil_visto_em timestamptz;
alter table usuarios add column funil_visto_anterior timestamptz;
```

Ao abrir o funil, se passaram mais de `minutos_para_avancar_marcador` (config, default 30) desde `funil_visto_em`: `funil_visto_anterior = funil_visto_em`, `funil_visto_em = now()`. O selo **novo** vai em todo item com `coalesce(reentrou_funil_em, entrou_funil_em) > funil_visto_anterior` — assim os selos ficam estáveis durante a sessão em vez de sumirem no primeiro refresh.

Botão **"Marcar tudo como visto"** para controle explícito.

Se for cortar esta seção, cortar inteira — meio selo é pior que nenhum.

---

## 7. Meu Dia

No topo do Meu Dia (04p) do originador, um card: **"Entraram 23 novidades desde seu último expediente"**, quebrado por tipo (NFs · títulos · pré-autorizações) e com o valor somado. Clicar abre o funil **já com o filtro aplicado**, em modal, sem trocar de página — padrão do 04p.

É o que transforma o filtro em hábito: na segunda de manhã, a informação vai até ele em vez de depender de lembrar de filtrar.

---

## 8. Settings, tools e entregáveis

**Settings** (Comercial → Funil de NFs, `webOnly`, gestor): `expediente_inicio` · `expediente_fim` · CRUD de `dias_nao_uteis` com importação anual da BrasilAPI e cadastro manual de feriados locais e pontos facultativos · `minutos_para_avancar_marcador`.

**Tool (barra de IA)**, leitura: `funil.novidades` — devolve o que entrou na janela, por tipo e por carteira, para a pergunta "o que entrou desde sexta?".

**Worker**: `calendario/importar-feriados` (anual, mais execução manual sob demanda).

**Core**: `janela-novidades.ts` com os testes de §4; teste de idempotência do carimbo (§2.2b); teste de `reentrou_funil_em` nos dois gatilhos e **não** disparando em mudança de estágio.

**Entregáveis**: migration com as colunas, índices e backfill · cálculo da janela com testes · seletor no funil web e mobile · carimbo e selo no card · contador na aba · card no Meu Dia · settings · README curto explicando a semântica da janela e a limitação de ausência individual.

---

## 9. Fora de escopo

Janela por pessoa baseada em presença, férias ou folga · notificação push de novidade (o contador e o Meu Dia bastam por ora) · histórico de quando cada originador viu cada item · aplicação do mesmo filtro em outros funis — se funcionar aqui, replicar depois.
