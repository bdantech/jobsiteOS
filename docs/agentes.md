# Agentes comerciais de IA (Prompt 09)

Um agente de IA é um vendedor (`vendedores.is_ia`) com persona, linha de WhatsApp, caixa de
e-mail, conta de voz, closer designado, escopo e cotas — e um **loop de ferramentas** que o
faz perseguir objetivos sozinho. Ele não pede autorização a cada mensagem: opera sob teto de
orçamento, cota de volume, escopo de população e um disjuntor que o para sozinho. **O
controle é estrutural, não por aprovação.**

Código: `packages/core/src/agentes/` (regras puras, com testes), `apps/worker/src/jobs/agentes/`
e `apps/worker/src/agentes/` (o ciclo e as ferramentas reais), `apps/web/src/app/(app)/agentes/`
(telas). Migrações `0270a`–`0270f`.

---

## O mandato

Um **mandato** é um objetivo comercial delegado a um agente, com escopo, prazo, orçamento e
prestação de contas (`mandatos`). A diferença que faz tudo funcionar: **a conversa é presa a
um número de telefone; o mandato não é.** "Ligou, não era o decisor, buscou outro contato no
Apollo, ligou de novo, mandou e-mail, marcou" atravessa três conversas e um contato que não
existia no começo — e só é trabalho contínuo porque há uma entidade acima delas
(`mandato_conversas` liga as conversas; a resposta de qualquer uma acorda o mandato).

| Tipo | O agente é | Objetivo típico | População do filtro |
| --- | --- | --- | --- |
| `originacao_nf` | originador | o fornecedor antecipar a NF | `notas_funil` (catálogo das faixas) |
| `agendamento_reuniao` | SDR | reunião do closer com quem decide | `agentes_empresas_alvo` |
| `reativacao` | SDR | ex-cliente ou parado voltar a operar | `agentes_empresas_alvo` |
| `qualificacao` | SDR | descobrir fit e propor agendamento | `agentes_empresas_alvo` |

Estados: `aberto → em_andamento ⇄ aguardando_externo`, `pausado` (a casa parou: disjuntor ou
orçamento do mês), e os terminais `concluido`, `encerrado_sem_sucesso`, `escalado`. Um mandato
ativo por (empresa, tipo) — não duas IAs perseguindo a mesma coisa.

### Como nasce

- **Por regra** (`mandato_regras`, o caminho principal): a árvore do motor de filtros do Prompt
  02, em E com o escopo do agente (e o piloto por cima). O job diário
  `agentes/criar-mandatos` cria até o menor dos tetos: o da regra, a cota de mandatos ativos
  do agente e o índice único. Empresa em cobrança ou suprimida nunca entra. **Toda regra nasce
  desligada**, e só liga depois da prévia de impacto (quantas empresas pega hoje, quantos
  mandatos criaria, o custo se todos gastarem o orçamento) — editar o filtro desliga de novo.
- **Manual**: botão "Delegar ao agente" na empresa, na NF e no card do funil (gestores).
- **Por escalonamento**: o agente PROPÕE (`propor_mandato` → `mandato_propostas`), um gestor
  aprova ou recusa na aba Mandatos. O agente nunca cria mandato sozinho.

### Quando termina

Objetivo atingido; `expira_em`; `max_acoes`; orçamento do mandato; contatos esgotados; pedido
de não contato; empresa em cobrança ou suprimida; escalação para uma pessoa; "assumir
manualmente". O motivo é uma chave (`motivo_encerramento`) — um agente que encerra 80% por
"contatos esgotados" tem problema de dados, e isso só aparece no painel se o motivo for
estruturado. Disjuntor e orçamento do mês **pausam**, não encerram.

---

## Como o agente decide: o ciclo

`/api/cron/agentes-ciclo`, a cada 5 minutos (um agente que combinou ligar às 15h30 precisa
ligar às 15h30):

1. **Seleciona** os mandatos vencidos (`proxima_acao_em <= now`), por prioridade.
2. **Trancas**, nesta ordem, sem chamar o modelo (`core/agentes/trancas.ts`): kill switch ·
   agente pausado · disjuntor aberto (pausa) · orçamento do mês (pausa) · orçamento do
   mandato (encerra) · cota diária do agente (amanhã) · ações do mandato hoje (amanhã) ·
   `max_acoes` · prazo · supressão/cobrança (encerra) · fora da janela (reagenda).
3. **Contexto**: mandato e plano, playbook, as últimas 30 mensagens de todas as conversas do
   mandato, as ligações e seus desfechos, contatos conhecidos e tentados, a empresa,
   materiais, orçamento e cotas restantes — e PDFs/imagens que o cliente mandou, como
   documento e imagem para o modelo ler. Taxa e líquido não entram: quem fala números é a
   ligação ou a proposta.
4. **Loop de ferramentas** (`core/agentes/loop.ts`) com a API da Anthropic: o modelo chama,
   a ferramenta executa de verdade, o resultado volta. Limite de passos
   (`max_passos_por_ciclo`, 8) e de tempo. Toda chamada leva `intencao` (por que, em
   português) — é a linha do feed Ao vivo.
5. **`atualizar_plano` é obrigatória.** Sem ela o loop cobra uma vez; se não vier, o ciclo
   termina com erro registrado (`sem_plano`).
6. **Persiste** cada ação em `mandato_acoes` com intenção, custo e sinal; o custo do modelo
   do ciclo vira uma linha `ciclo` com os tokens — gravados sempre.
7. **Agenda** `proxima_acao_em` pela primeira próxima ação do plano.

A resposta do cliente (qualquer canal) e o resultado de uma ligação acordam o mandato na hora
(triggers em `comunicacoes` e na RPC de resultado da voz).

### Identificação

Política em `agentes_config.geral.identificacao` (`se_perguntada` · `sempre` ·
`nunca_afirmar_humano`), editável sem deploy. O piso não é configurável: a IA **nunca afirma
ser humana**, nunca inventa vida pessoal, e **perguntada, não nega ser IA**. Além do prompt,
uma trava confere o texto que vai sair (`violaIdentificacao`) e devolve ao modelo o que
violar. Perguntar "é robô?" não escala mais; reclamação, negociação de taxa, advogado,
cobrança e pedido expresso de uma pessoa escalam.

---

## O ritmo (desde 05/10/2026)

Os primeiros mandatos andavam um passo por dia: o ciclo acordava no horário que o modelo
escrevia no plano, e o modelo escrevia "amanhã às 10h" por hábito. A regra agora é do código
(`core/agentes/ritmo.ts`), e o prompt a explica:

| Situação | Quando o mandato acorda |
| --- | --- |
| Há um próximo passo possível | Em até `espera_maxima_min` (10 min), mesmo que o plano diga "amanhã" |
| Esperando resposta ou ligação (`aguarda` no plano) | No mesmo ritmo, mas sem chamar o modelo enquanto nada mudou, até `espera_sem_novidade_max_min` (2 h). A resposta e o resultado da ligação acordam na hora |
| O cliente pediu outro horário (`pedido_do_cliente` no plano, com o trecho da conversa) | No horário dele |
| Qualquer caso | Nunca depois da validade do mandato, que é contada em dias úteis (0275) |

Outras travas que vieram da mesma análise: uma ligação aberta por mandato (não por contato);
num mandato de NF, ligar com outro objetivo que não a oferta só quando a oferta está
bloqueada, e aí o briefing diz que não há valores e que o objetivo é achar quem decide; o
Apollo só busca com domínio da Receita, do site ou validado; o cache de prompt corta o custo
do modelo por ciclo. Todo webhook da Ana fica em `voz_webhooks`, com o status devolvido.

## As ferramentas

Ferramenta paga com orçamento insuficiente, fora do playbook ou com a cota do dia esgotada
**não aparece** para o modelo naquele ciclo. Custos são estimativas de `agentes_config.precos`
(o valor reservado antes da chamada); o real substitui o estimado depois.

| Ferramenta | Custo padrão | O que faz de verdade |
| --- | --- | --- |
| `consultar_empresa`, `consultar_historico`, `consultar_contatos`, `listar_materiais` | grátis | leitura |
| `buscar_dominio_empresa` | R$ 0,30 | heurística + busca web (Radar) |
| `buscar_contatos_apollo` | R$ 2,00 | Apollo pelo domínio, filtrado por cargo; custo real por pessoa revelada |
| `enriquecer_telefone` | R$ 1,65 | Nova Vida pelo CNPJ; marca Procon/WhatsApp |
| `registrar_contato` / `atualizar_contato` | grátis | contato indicado nasce com base legal `indicacao` e a evidência; "não é o decisor" nunca suprime |
| `enviar_whatsapp` | R$ 0,02 | enfileira pela LINHA da persona; portão do 05A (supressão, janela, teto, cooldown) |
| `enviar_email` | R$ 0,01 | enfileira pela caixa da persona (Gmail) ou remetente próprio (Resend) |
| `enviar_material` | R$ 0,02 | material da biblioteca (imagem/vídeo/áudio como mídia, PDF como documento) |
| `ligar` | R$ 3,50 | fila da Ana com objetivo; portão de permissão no banco; v1 só `ofertar_antecipacao` |
| `agendar_ligacao` | grátis | acorda o mandato no horário combinado |
| `consultar_agenda_closer` | grátis | janelas livres (Google Agenda + reuniões do sistema), com reserva temporária |
| `agendar_reuniao` | grátis | via `sdr_leads` com o agente como SDR: vale a fila de aceite do closer e "IA não titulariza" |
| `mover_estagio_funil` | grátis | só para frente; nunca `convertida`/`perdida` |
| `propor_mandato` | grátis | vai para aprovação humana |
| `escalar_humano` / `encerrar_mandato` | grátis | terminais: tiram o mandato das mãos do agente |
| `atualizar_plano` | grátis | obrigatória em todo ciclo |

Travas por contato, dentro das ferramentas: `tentativas_por_contato` e
`cooldown_minutos_mesmo_contato` (responder a quem acabou de escrever não é insistir).

---

## Limites

**Orçamento** (§8): teto global MENSAL (`agentes_orcamento`, a trava dura) + teto por MANDATO
+ teto diário do agente (opcional). Antes da ferramenta paga, o estimado é **reservado** numa
transação que confere os três; depois o real é **consumido** e a diferença estornada; se
falhou, estorno total (RPCs `app__agentes_reservar/_consumir/_estornar`). Tokens contam, pela
tabela de preço do modelo. Alertas em 50/80/95/100%. Em 100% as ferramentas pagas param e os
mandatos pausam até o mês virar ou o teto subir. **O padrão é teto zero: nada pago roda até
um gestor definir o teto.** A reconciliação diária estorna reservas órfãs e troca o custo
estimado das ligações pelo real.

**Cotas** (`vendedores.limites`): ligações, mensagens e e-mails por dia, mandatos ativos,
ações por mandato por dia, tentativas por contato, cooldown ao mesmo contato, gasto diário.

**Escopo** (`vendedores.escopo`): `filtro` (o de agora — a IA trabalha o que cai no filtro e
não recebe distribuição) ou `carteira` (entra no rodízio como um humano; implementado e
desligado por `agentes_config.geral.modo_carteira_habilitado`). `modo_rodagem = 'piloto'`
aplica o filtro de piloto por cima: cota limita volume, piloto limita a quem.

### O disjuntor

`agentes_disjuntor`, avaliado depois de cada ação com desfecho. Janela móvel por **contagem**
(padrão 20 ações — com volume baixo, taxa por hora engana). Qualquer taxa estritamente acima
do limiar abre: supressões (10%), sem interesse (60%), escalações (30%), falhas técnicas
(25%). Aberto: o agente pausa, os mandatos dele pausam, gestor e closer recebem push com as
últimas ações. **Reabertura só manual**, com motivo e registro de quem — e ela zera a janela.

**Kill switch único**: `agentes_config.geral.kill_switch`, espelhado nos dois antigos
(`comunicacao_config.agente` e `antecipacao_config.voz`) durante a transição.

---

## Como ler o plano de um mandato

```jsonc
{
  "objetivo_atual": "Falar com quem decide antecipação no financeiro da Construtora X",
  "hipotese": "A Marcia é do RH e indicou o Carlos como responsável financeiro",
  "proximas_acoes": [
    { "acao": "ligar", "quando": "2026-09-27T15:30:00-03:00", "contato": "Carlos Menezes",
      "por_que": "horário que a Marcia indicou", "condicao": "se não atender, tentar 17h" }
  ],
  "bloqueios": [],
  "confianca": 0.7
}
```

- **objetivo_atual** é o sub-objetivo DESTE momento, não o do mandato.
- **hipotese** é no que o agente está apostando — quando o mandato dá errado, é aqui que se
  vê a aposta errada.
- **proximas_acoes[0].quando** é quando o mandato acorda de novo.
- **bloqueios** é o que ele sabe que falta (janela do closer, contato sem telefone…).
- Cada mudança fica em `mandato_plano_versoes` com o motivo: ler a evolução do plano é como se
  audita um agente que errou.

---

## Canais

- **WhatsApp**: linha própria por agente (`vendedores.whatsapp_conta_id`, conta do tipo `ia`,
  uma linha por agente ativo). Sem linha, o agente não fica autônomo (a RPC recusa) e a fila
  recusa com o nome dele. O rodízio anônimo ficou só para a campanha "Casa / IA".
- **E-mail**: caixa real no Google Workspace (`email_caixas`, recomendação do §4.2), conectada
  em Personas pelo mesmo OAuth dos vendedores (`/api/auth/gmail/iniciar?caixa=<id>`; a conta
  autorizada tem de ser a própria caixa). Lida pelo sync do Gmail a cada 10 minutos (sem
  Pub/Sub para as caixas de persona). Sem caixa, sai pelo `email_remetente` via Resend.
- **Voz**: `docs/voz-integracao.md`.

---

## O que foi verificado antes de começar (§15), em 27/09/2026

1. **E-mail de entrada**: não havia rota de inbound no Resend (o webhook só trata entrega,
   bounce e spam); o MX de `oneos.com.br` aponta para o Google; a leitura via Gmail API já
   existia (4 caixas de vendedores). Seguimos a recomendação: caixa real + Gmail API.
   **Criar `ana@oneos.com.br` (ou a caixa de cada persona) no Workspace é passo manual.**
2. **Google Agenda**: escopo atual `calendar.events` — cobre ler eventos (janelas livres) e
   criar evento com convidados. 3 de 4 contas já consentiram; a do Viktor está sem escopos e
   precisa reconectar.
3. **WhatsApp tipo `ia`**: 0 contas. Personas não ficam autônomas sem uma.
4. **Versão da Ana**: detectada em tempo de execução (`GET /api/versao`); até a v2 existir,
   opera em v1 degradado, visível na tela de Ligações e em Configurações.

## Para ligar a operação

1. Aplicar as migrações `0270a`–`0270f` e regenerar os tipos.
2. Cadastrar uma conta de WhatsApp do tipo **IA** (Comunicação › Contas de WhatsApp).
3. Criar a persona em Agentes › Personas (linha, caixa, closer, escopo com piloto, cotas).
4. Definir o **teto mensal** em Agentes › Configurações (o padrão é zero).
5. Criar uma regra, ver a prévia, ligar — ou delegar um mandato à mão.
6. Ligar a autonomia da persona. Acompanhar em Ao vivo.
