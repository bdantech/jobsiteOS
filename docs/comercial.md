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

`empresas.gestao_operacao` ∈ {`prospeccao_ativa`, `passivo`, null}. Aplica-se a sacados;
`null` significa "a pergunta ainda não existe" (não-cliente).

Efeitos reais de `passivo`:

| efeito | onde |
|---|---|
| Não gera outbox | `sacadosPassivos()` em `outbox.ts` filtra as notas antes de montar a mensagem |
| Fora da carteira de originação | `rotearNota()` devolve sem dono antes de qualquer regra |
| Fora da distribuição de SDR | o SQL de candidatas exclui `gestao_operacao = 'passivo'` |
| Entra na comissão de volume | `vendedor_carteira` papel `gestao_passiva` |

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
| **Closer** | CONTA | recorte — UF + faixa de faturamento | território, no cadastro do vendedor |
| **SDR** | LEAD | recorte, para a distribuição semanal | território + direção + cota |

Quem originou a relação continua dono dela mesmo que a empresa mude de porte ou de
estado — por isso o originador recebe por escolha. Quem fecha negócio é alocado por
perfil de cliente — por isso o closer recebe por recorte.

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

**Closer** (`vendas`): reunião agendada → … → onboarding → ganho. Perder exige motivo em
qualquer estágio — o CHECK do banco recusa `perdido` sem motivo.

A decisão da seguradora (04d) move o card sozinha: **aprovada** → proposta enviada,
**negada** → perdido com "Crédito negado". **Parcial não anda**: metade do limite pode ser
ótimo ou inviável, e essa leitura é de quem está na mesa.

`ganho` promove a empresa a cliente e **abre** a pergunta ativo/passivo — não responde por
ela.

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

## Permissões

Leitura: quem tem o módulo lê tudo — é uma equipe pequena onde o funil do colega é
contexto de trabalho. O que ninguém pode é **agir em nome do outro**, e isso vem da
ausência de grant de escrita (toda mutação passa por RPC), não de policy.

A exceção é `comissao_lancamentos`: dinheiro de pessoa. Cada um vê o seu, mais os acessos
cruzados de `vendedor_acessos`, mais Admin e Comercial.

## Mobile

Painel, funil de reuniões e funil de vendas — lista, não kanban, com **um** botão por
card: o próximo passo. As saídas que exigem motivo (sem fit, perdido) não estão no
celular de propósito: escolher um motivo numa lista de seis com o polegar é como o motivo
vira sempre "Outro", e o motivo é o dado mais valioso destes funis.

Comissões, calendário, fila sem dono e configurações são web — leitura longa ou decisão
de gestor, e nenhuma das duas acontece entre uma reunião e outra.

## O que ficou de fora

- **Toggle "ocultar NFs de sacados passivos" no funil de NFs.** O efeito real do passivo
  (sem outbox, sem roteamento) está implementado; o filtro visual precisa de
  `gestao_operacao` na view `notas_funil`, que é uma migração de view inteira.
- Envio real de mensagens, automação do vendedor de IA, OAuth do Google Calendar, metas e
  forecast, comissão de gestor — todos Prompt 05+, como o próprio 04g define.

## Cadastro (Configurações)

Vendedor, território, regra de comissão e motivos são editáveis na tela, por RPC com
`audit_log` — mesma disciplina do resto do sistema.

Não há **excluir** em lugar nenhum: vendedor se desativa, regra se substitui, motivo se
inativa. Apagar qualquer um dos três levaria junto a explicação de uma comissão já paga.

Três decisões que a tela toma por quem usa:

- **Território é salvo junto com o vendedor**, na mesma submissão. Em telas separadas, o
  estado mais provável é originador ativo com território em branco — que não casa com
  nada e não diz por quê.
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
