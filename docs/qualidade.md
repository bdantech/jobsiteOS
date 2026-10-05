# Inteligência de Conversas (05C)

Captura de reuniões, rubrica de qualidade, nota e feedback automático. Telas: aba **Reunião**
dos funis (captura, transcrição e análise), **Comercial → Feedback** (o vendedor sobre si) e
**Comercial → Qualidade** (gestores: visão do time, contestações, calibração, rubricas,
vinculação e configurações).

Este módulo **não envia nada e não decide nada**. Ele lê o que já aconteceu, julga contra uma
rubrica e devolve. As únicas escritas no mundo são o convite do Fireflies e o write-back
cadastral aditivo.

## Onde cada coisa mora

| Peça | Onde |
|---|---|
| Tabelas, gatilhos, RLS, RPCs, seeds | `supabase/migrations/0283a`…`0283e` |
| Regras puras (testadas) | `packages/core/src/analise/` — `classificador`, `rubrica`, `revisao`, `calibracao`, `vinculacao`, `fireflies`, `estado` |
| Leituras e escritas da tela | `packages/core/src/analise/leituras.ts`, `mutations.ts`, `apps/web/src/actions/qualidade.ts` |
| Worker | `apps/worker/src/qualidade/` — webhook, análise, calibração, janelas, vinculação, vigia |
| Convite do Fireflies | `apps/worker/src/jobs/comercial/reunioes-google.ts` → `qualidade/captura.ts` |
| Ferramentas da barra de IA | `packages/core/src/registry/modules/qualidade-tools.ts` (só leitura) |
| Pendências no Meu Dia | bloco `pendencias_conversas` (`app__md_comuns`, 0283e) |

## Captura (Fireflies)

### Como o bot entra

Convidar `admin@oneos.com.br` não basta. O join é disparado porque a reunião está no
calendário conectado da conta Fireflies, com o auto-join atendido. Por isso **toda reunião
da plataforma convida os dois**:

- `admin@oneos.com.br` põe a reunião no calendário da conta central, que vira **dona do
  transcript**. Os webhooks são entregues para as reuniões que a conta possui.
- `fred@fireflies.ai` dispara o join.

Na conta central, o auto-join tem de estar em **"somente quando eu convidar o fred"**, nunca
em "todas as reuniões com link". Do contrário, qualquer reunião interna que cair naquele
calendário vira transcript gravado.

### Um caminho de criação

Hoje dois caminhos criam reunião. O SDR humano usa `app_mover_lead_sdr`; o agente de IA usa
`app__agente_agendar_reuniao`, pelo chat e pela Ana. Os dois desembocam num INSERT em
`vendedor_eventos`.

A linha de captura (`reunioes`) nasce por **gatilho** nessa tabela, então um terceiro caminho
escrito amanhã também cai nela. Os dois convidados entram no único lugar que escreve no
Google, o job `comercial/reunioes-google`.

### Reunião é uma só

O spec propõe uma tabela `reunioes` com horário, link e evento do Google. Isso já mora em
`vendedor_eventos` desde a 0201, que foi escrita justamente contra a reunião em dois registros
que discordam. Aqui `reunioes` é o **estado da captura**, 1:1 por `evento_id`.

### Como a transcrição volta amarrada

O `client_reference_id` só existe para áudio enviado por upload. Reunião em que o bot entra
pelo calendário volta sem ele. Ele é guardado (é o próprio id da reunião), mas o casamento de
verdade segue esta ordem:

1. `client_reference_id`, quando vier;
2. `meeting_id` já conhecido;
3. **`cal_id` da transcrição = `vendedor_eventos.google_evento_id`**, porque fomos nós que
   criamos o evento no Google;
4. link da conferência normalizado, a reunião mais próxima no tempo.

Nunca por título nem por horário.

**Só guardamos transcrição de reunião nossa.** Transcrição que não casa com reunião da
plataforma é registrada em `fireflies_webhooks` e o texto é descartado. O mesmo vale para
reunião marcada "não gravar", mesmo que o bot tenha entrado.

### Webhook

O endpoint é `POST <worker>/webhooks/fireflies`. É público e verificado por HMAC-SHA256 no
`X-Hub-Signature`, sobre o corpo cru, com comparação em tempo constante. Sem segredo
cadastrado, falha fechado.

Toda requisição é gravada antes de validar. Entrega repetida bate no índice único
`(evento, meeting_id)` e não duplica nada. Evento desconhecido é registrado e devolvido como
"não tratado", nunca com 200 silencioso. O trabalho acontece depois da resposta, porque o
Fireflies desiste em 30 s. O que falhar, o vigia retoma.

### Quando o bot não entra

O vigia (`qualidade-vigiar`) roda a cada 5 minutos:

- Reunião que começou há mais de `minutos_para_bot` (padrão 5) sem bot gera **alerta** a
  quem conduz, por sino, push e e-mail.
- Reunião que acabou há horas sem transcrição vira `sem_captura`.

**Resgate manual.** O botão "Chamar o bot agora" usa `addToLiveMeeting`. O limite do Fireflies
é **3 chamadas a cada 20 minutos** para a conta inteira. Os pedidos vão para
`fireflies_resgates`, o worker envia respeitando o contador, e a tela mostra quando abre a
próxima vaga.

**Não gravar.** Reunião interna ou cliente que não autorizou: a aba Reunião dispensa a captura
antes do início, e o convite é reenviado sem o notetaker. Presencial e telefone dispensam
sozinhos (não há onde o bot entrar). Voltar a ser Meet reabre a captura que o sistema
dispensou, mas nunca a que uma pessoa dispensou.

### Mídia

Áudio e vídeo **não são copiados**. Guardamos o link (`url_fireflies`), a transcrição, o
resumo e a análise.

## A interação como unidade de análise

Reunião e ligação da Ana se analisam inteiras. WhatsApp e e-mail se analisam por **janela**:
tudo o que passou na conversa desde a última análise.

O job diário `qualidade-janelas` fecha a janela de cada conversa com pelo menos
`min_mensagens` mensagens novas (padrão 4) e `horas_silencio` horas sem mensagem (padrão 12).
Conversa parada não gera análise nova, e conversa acontecendo agora espera o silêncio.

**Contato ignorado não é analisado.** A conversa cujo número ou LID foi ignorado na fila
de identificação fica fora do recorte das janelas (0286), com a mesma regra que a tira do
Meu Dia (0278). O worker confere de novo antes de analisar, porque o contato pode ter sido
ignorado depois de a janela fechar.

Quem é julgado:

- **Reunião:** quem conduz, ou seja, o dono do evento (o closer).
- **Janela:** o responsável da conversa.
- **Ligação:** o agente do mandato. Sem mandato, a análise é só da gestão; quem fala é a Ana,
  e ninguém é cobrado pelo que ela disse.

Agente de IA é vendedor (`is_ia`), e é assim que IA e humano ficam na mesma régua.

## A rubrica

### Como se escreve um item

| Campo | O que é |
|---|---|
| `chave` | Identidade do item **entre versões**. Os rótulos de calibração são guardados por chave. |
| `etapa` | Agrupador visual (Dor · Solução · Segurança · Próximos passos). |
| `rotulo` | O nome curto na explicação da nota ("faltou: próximo passo com data"). |
| `pergunta` | A pergunta tipada que vai ao classificador, inteira, como se lê. |
| `tipo_resposta` | `sim_nao`, `escolha` ou `score`. |
| `atende` | Que respostas contam como atendido. "Alguma pergunta ficou sem resposta?" atende com `{nao}`. |
| `peso` | Na média ponderada. **Peso zero é item informativo** (objeção, concorrente): grava, não pontua, não gasta Claude. |
| `condicao_aplicabilidade` | Outra pergunta sim/não, avaliada antes. Nulo = sempre aplicável. |
| `orientacao` | O que o vendedor deveria ter feito. É o texto que ele lê quando falha. |
| `gera_pendencia` | Quando reprovado (e publicado), vira item no Meu Dia. |

Escreva a pergunta para ser respondida **só com o texto da conversa**. "O vendedor foi
convincente?" não tem resposta observável. "O vendedor trouxe caso, número, garantia ou
referência?" tem.

### Por que a condição de aplicabilidade existe

Rubrica aplicada fora de contexto gera ruído e mata a credibilidade do feedback na primeira
semana. "Definiu próximo passo" numa ligação de 90 segundos em que o cliente disse "não tenho
interesse" é falso negativo: o vendedor seria punido por ter encerrado certo.

Item inaplicável **sai do denominador**. Não conta como atendido nem como falho.

### Versionamento

Editar a rubrica cria **versão nova**; a vigente não muda. A nova nasce inativa, e ativá-la é
um segundo passo, porque ela começa **em sombra** até a recalibração.

**Mudar a rubrica reinicia a comparabilidade histórica da nota.** Nota de uma versão não se
compara com nota de outra, e a tela de evolução separa por versão e avisa quando o período
cruza a fronteira. Os rótulos de calibração são reaproveitados pela chave. Se um item mudar
de **sentido** (e não só de redação), use uma chave nova; senão os rótulos antigos calibram
uma pergunta que não existe mais.

## O motor e a nota

```
texto → Jev (aplicabilidade + itens, UM pedido) → decisão por item
      → Claude só nos reprovados e na banda cinzenta → nota (aritmética) → pendências
```

- **O Jev roda em tudo**: probabilidade calibrada, texto só na entrada. Aplicabilidade e
  resposta vão no mesmo pedido, porque o estado (a transcrição) é o que custa.
- **Queda automática.** Erro, timeout ou resposta incompleta do Jev cai para o Claude dentro
  da mesma análise, só nas perguntas que faltaram. O provedor vai item a item para
  `analise_itens.provedor`.
- **Banda cinzenta**: `[limiar − delta, limiar + delta]` (padrão 0,10). Dentro dela, decide o
  Claude.
- **O Jev nunca é o único juiz de um item que reprova.** Todo reprovado passa pelo Claude,
  para citação e orientação. Se o Claude disser que o item foi atendido, vale o Claude e a
  divergência fica gravada. Se a revisão não acontecer (Claude fora), o item **não reprova
  sozinho**: sai da nota marcado como "revisão pendente".
- **A chamada ao Claude, quando acontece, aproveita**: extrai os compromissos que o nosso
  lado assumiu (viram pendências com prazo), escreve o resumo quando o Fireflies não deu um,
  e lê cargo e telefone dos participantes. Contatos com e-mail vêm de graça dos convidados
  do Fireflies.

### Como ler a nota

```
nota = Σ(peso × atendido) / Σ(peso)      — só sobre itens APLICÁVEIS e publicados
```

Nenhum modelo opina sobre a nota final; ela sai dos itens. "0,62 porque faltou: próximo passo
com data e objeções respondidas" é a explicação gravada em `analises.explicacao`.

- Sem item aplicável, a nota é **nula**, e aparece como "sem avaliação aplicável", nunca zero.
- Contestação procedente muda o item e **recalcula** a nota no banco
  (`app__qualidade_recalcular`), com a mesma regra do core.

## Modo sombra e calibração

**Nenhuma nota chega a um vendedor antes da calibração.** Rubrica não calibrada roda em
sombra: analisa, grava, não publica. A gestão vê a "nota que seria" (`score_sombra`). O
vendedor não vê a análise, e sombra não gera pendência, porque pendência é cobrança.

### Procedimento

1. Em **Qualidade → Calibração**, escolha o tipo (reunião, ligação, conversa) e rotule
   interações item a item, com a **mesma pergunta** que vai ao classificador. A tela não
   mostra o que o modelo respondeu, para não ancorar quem rotula.
2. Com `min_amostras_calibracao` interações rotuladas (padrão 20), a rubrica calibra sozinha
   na rodada diária. "Recalibrar agora" adianta.
3. Para cada item, o limiar é o ponto que **maximiza o F1 da classe "não atendeu"**: é a
   saída que chega ao vendedor como cobrança. Em empate, o menor limiar, o que reprova menos.
   A tela mostra a curva precisão/recall e quantas amostras sustentam cada ponto.
4. O item fica **inativo** sem amostras suficientes, ou sem pelo menos `min_por_classe`
   (padrão 3) casos de cada lado. Sem nenhuma falha rotulada, não há como saber se o
   classificador enxerga falha.
5. O item fica **em sombra ("pergunta mal formulada")** com F1 abaixo de `f1_minimo` (padrão
   0,70), ou quando ele não supera a régua trivial de apontar falta em todas. Com 70% de
   falhas, essa régua já dá F1 0,82; um item que não a supera está lendo a estatística do
   time, não a conversa. **O problema é a rubrica, não o vendedor.**
6. A rubrica sai de sombra quando pelo menos um item publica. Itens que não passaram
   continuam gravando, fora da nota.

### O limiar só tem dois escritores

A calibração e o **override explícito** de gestor, que exige motivo, fica registrado com quem
e quando, e vai para o audit log. A próxima recalibração substitui o override pelo valor
calibrado.

### Recalibração

A recalibração roda nos seguintes casos:

- quando alguém pede;
- quando uma versão nova é ativada;
- quando entram `n_contestacoes_para_recalibrar` contestações rotuladas desde a última
  calibração (padrão 15).

Rótulos são da **interação e da chave**. A probabilidade é do classificador respondendo a
**uma** redação. Para cada interação rotulada sem probabilidade da versão atual, a
recalibração pergunta de novo ao classificador (no Jev é barato), e é isso que deixa uma
versão nova sair de sombra sem ninguém rotular de novo. Só entram amostras do braço
configurado: probabilidade do Claude não calibra limiar do Jev.

## Contestação

Cada item publicado tem **Contestar**. Contestar não apaga a nota: abre uma revisão na fila
da gestão, com a citação e a justificativa do vendedor. Os vereditos são estes:

- **Procedente**: o gestor diz qual era a resposta certa, o item muda e a nota é recalculada.
  Pendência nascida de falta que não era falta é descartada.
- **Improcedente**: o item fica como está.
- **A pergunta precisa ser reescrita**: o item ganha `precisa_revisao`.

**Todo rótulo humano entra no conjunto de calibração.** É isso que faz o loop girar sem
ninguém montar dataset.

A taxa de contestação por item aparece **ao lado** das notas, na visão do gestor. Item muito
contestado é rubrica mal escrita, e mostrar isso evita que o instrumento seja usado contra as
pessoas quando o defeito é dele.

## Vinculação de contas a empresas

A fila de "não vinculados" passa por esta cascata antes de chegar a uma pessoa (job diário
`qualidade-vinculacao`):

1. **Determinístico, grátis.** Domínio do e-mail ou telefone já cadastrado. Uma empresa só
   vincula na hora. Domínio de várias (a contabilidade que atende quinze clientes) **não
   determina**: vai para humano.
2. **Shortlist** por similaridade de nome (pg_trgm), **deduplicada pela raiz do CNPJ**.
   Matriz e filiais são uma candidata só.
3. **Jev** pontua cada par.
4. **Banda cinzenta (ou empate no topo) → Claude.**
5. **Fila humana**, ordenada por valor potencial, com as candidatas já pontuadas.

E-mail pessoal (gmail, hotmail…) não é forçado: fica como "não resolvível automaticamente". A
lista é a mesma do filtro de ingestão do Gmail. Par na faixa 0,2–0,5 nunca é automático.

O vínculo automático usa o mesmo `app_conversa_vincular` da tela, com o mesmo contato, as
mesmas threads irmãs e o mesmo ledger. A 0283c só deixou o service role passar pelo portão
do módulo.

**Medir:** % automático, % humano e **precisão por auditoria mensal**. Qualidade → Vinculação
sorteia dez vínculos automáticos do mês para alguém marcar como certo ou errado.

## Write-back cadastral

- **Aditivo grava direto.** Contato novo de uma reunião (com e-mail, telefone ou cargo, não
  só um nome solto), e cargo, e-mail ou telefone quando o campo está vazio. Sempre com
  `origem = 'analise_conversa'` e `contatos.origem_interacao` apontando para a análise e a
  reunião, e base legal `relacao_comercial`, porque a pessoa estava numa reunião com a gente.
- **Sobrescrita propõe.** Campo preenchido com valor diferente vira sugestão em
  `empresa_sugestoes_cadastro`, que aparece na ficha da empresa para aceitar ou recusar.
- Gente nossa nunca vira contato: e-mail de usuário, domínio de usuário e o notetaker.

## Retenção, acesso e privacidade

| O quê | Quem vê |
|---|---|
| Captura e transcrição | Quem vê a reunião (dono, acompanhante, quem tem acesso a eles) ou a empresa |
| Análise | A mesma régua de ver o trabalho de outro no resto do Comercial (`app_pode_ver_vendedor`, 0285): o gestor vê todos; os demais veem a própria e a de quem estiver **marcado para eles** em `vendedor_acessos` (o auxiliar, a do seu closer). Contestar é só de quem foi avaliado |
| Análise em sombra, de agente de IA, de ligação sem mandato | Gestores |
| Rubrica | Todo o comercial: a régua é pública para quem é medido por ela |
| Calibração, fila, webhooks | Gestores |
| Segredos | Ninguém: só o service role lê o Vault |

Os **toggles por pessoa** ficam em Qualidade → Configurações:

- **Desligar a captura** tira o notetaker das reuniões futuras daquela pessoa (o convite é
  reenviado), e por consequência não há o que analisar.
- **Desligar a análise** mantém gravação e transcrição.

**Expurgo**: `retencao.dias_transcricao` (padrão nulo = manter). O texto sai; a análise, o
resumo e o link ficam.

**Subprocessadores.** Fireflies (gravação e transcrição) e TypeSafe AI (classificação Jev)
recebem conversa de cliente e precisam constar da lista de subprocessadores da OnePay, ao
lado da Anthropic.

## Configurar do zero

1. **Fireflies**, na conta `admin@oneos.com.br`:
   - conectar o Google Calendar;
   - auto-join em "somente quando eu convidar o fred";
   - criar o webhook V2 apontando para `<URL pública do worker>/webhooks/fireflies`, com
     signing secret e os eventos `meeting.bot_joined`, `meeting.transcribed` e
     `meeting.summarized`;
   - gerar a API key.
2. Em **Qualidade → Configurações**, cadastrar a API key e o segredo do webhook (vão para o
   Vault), e a chave do Jev.
3. Ligar a captura. A RPC recusa ligar sem as duas credenciais do Fireflies.
4. Daí em diante, toda reunião nova (ou editada) ganha os dois convidados. Reuniões já
   marcadas e não editadas seguem sem gravação.
5. Rotular as primeiras 20 interações de cada tipo para a rubrica sair de sombra.

### Dependências do plano do Fireflies

- **Webhook de time** (que entrega reuniões de todos os membros) exige Super Admin em plano
  Enterprise. **Este desenho não depende dele**: a conta central é a dona das reuniões,
  porque está no convite.
- **Todas as transcrições caem num assento só.** Confira o teto de transcrições do plano
  antes de ligar para o time inteiro.

### O que este módulo não faz (§15)

- Não grava ligação fora da Ana.
- Não analisa reunião interna.
- Não tem ranking público.
- **A nota não entra em cálculo de comissão**: instrumento de coaching não vira instrumento
  de remuneração sem outra discussão.
- Não traduz transcrição.
- Não detecta emoção por áudio.
- Não integra outro provedor de reunião.
