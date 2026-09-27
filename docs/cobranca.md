# Cobrança: cobrança extrajudicial e sinistro (Prompt 07)

O elo entre o título que não foi pago e o processo judicial. Não é régua de vencidos de
curto prazo: atraso de 1 a 14 dias continua na plataforma de produção (Onepay), como
sempre. A Cobrança começa em **D+15**, com a notificação extrajudicial, e termina em um de
quatro desfechos: quitação, acordo cumprido, protesto/processo, ou sinistro pago.

E tem uma segunda função, que é a razão de ela existir com esta forma: a apólice Atradius
**9000373_SUSEP** exige, como documentação obrigatória de sinistro (cl. 22208.00),
exatamente os artefatos que esta esteira produz — notificações, provas de entrega,
certidão de protesto, confissão de dívida, extrato. Cobrar mal, ou cobrar sem registrar,
não é só perder o título: é perder a indenização. O módulo é, ao mesmo tempo, ferramenta
de cobrança e **construtor do dossiê de sinistro**.

**Nada dispara sozinho.** Toda criação, todo envio, todo protesto, todo sinistro é ação
humana explícita. O sistema calcula, redige, alerta e cobra prazo — quem aperta o botão é
gente. Não há trigger que envie nada, e nenhuma tool da AI bar notifica, protesta, abre
sinistro ou bloqueia sacado: todas são leitura ou rascunho.

---

## A régua da apólice

Todo prazo é contado sobre o **vencimento ORIGINAL** do título (D). A cl. 16900.20 diz
textualmente que a prorrogação não desloca a data usada para aplicar os termos da
apólice — por isso `titulos.vencimento` é escrito uma vez e nunca mais; uma data nova
vinda da produção vai para `vencimento_prorrogado`, que serve só para a conversa comercial.
Contar o relógio sobre a data prorrogada seria perder o D+90 achando que faltava um mês.

| Marco | Quando | Cláusula | O que é | Perder custa |
| --- | --- | --- | --- | --- |
| **D+60** | fim do período máximo de prorrogação | **cl. 17700.20 a** | Parada automática de cobertura | Novas cessões daquele sacado deixam de ser cobertas |
| **D+90** | 30 dias após D+60 | **cl. 18500.01** | Prazo final para notificar a Atradius do inadimplemento | **Perda do direito à indenização** (cl. 28509.01 iv) |
| **D+180** | fim do período de espera | **cl. 00500.00** | Data da Perda por mora prolongada | — (é o gatilho que abre o direito) |
| **D+360** | Data da Perda + 6 meses | **cl. 22100.20 §1** | Prazo final para enviar o sinistro completo | Sinistro inadmissível |
| sob demanda | 30 dias da solicitação | (apólice, docs complementares) | Documentos complementares pedidos pela seguradora | Suspensão ou negativa da análise |
| — | — | **cl. 16900.20** | Prorrogação não desloca a data de referência | Prazo contado da data errada |

**Insolvência (cl. 00300.00)** não segue esse calendário: a Data da Perda é a data da
decisão judicial (ou do evento equivalente), e os 6 meses de envio correm dela. Quando o
Jurídico registra recuperação judicial ou falência do sacado, o relógio recalcula para o
caminho de insolvência e avisa no ato (`apolice.insolvencia_detectada`) — esse caminho
costuma ser **mais curto** que o de mora, e descobrir isso pelo calendário antigo é perder
o prazo.

### Os números são da apólice, não da casa

Tudo acima vive em `apolices` (percentagem segurada, período de espera, prorrogação,
notificação após prorrogação, prazo de envio, documentos complementares, franquia,
responsabilidade máxima) e em `cobranca_config.apolice` (antecedência dos avisos, contato
da seguradora, modo de envio). **Nada é hardcoded**, porque a renovação anual muda
parâmetro.

> **Em toda renovação da apólice, reveja os parâmetros.** A vigente vai de 01/06/2026 a
> 31/05/2027. Uma apólice nova é uma LINHA nova em `apolices`, não uma edição da antiga:
> o título que venceu na vigência anterior continua regido por ela, e o relógio escolhe a
> apólice pelo vencimento original (`escolherApolice`). Editar a antiga reescreveria
> prazos que já estão correndo.

## Por que colocar em cobrança interrompe a cobertura

São duas causas de Interrupção Automática de Cobertura, e elas **voltam diferente**:

| | (a) D+60 sem pagamento | (b) valores postos em cobrança |
| --- | --- | --- |
| Cláusula | 17700.20 a | 17700.20 b |
| Quando para | no D+60 do vencimento original | no primeiro envio da notificação |
| Pago em até 30 dias da parada | cobertura volta **com efeito retroativo** — as cessões do intervalo voltam a estar cobertas | não existe retroatividade |
| Pago depois | cobertura volta só para o que for cedido **após o pagamento** | idem: só para o que for cedido **a partir do pagamento** |

A (b) é a que surpreende o comercial: a notificação extrajudicial é, para a apólice, a
declaração formal de que o sacado não pagou. A partir dela, **toda nova cessão contra
aquele grupo está descoberta**, e continua descoberta até o pagamento — e, depois dele,
só o que for cedido dali em diante volta a ser coberto. É por isso que o primeiro envio
exige o aceite do aviso do §6.4 (`AVISO_APOLICE_COBRANCA`, com registro de quem aceitou) e
é por isso que o grupo é bloqueado (abaixo): a equipe comercial não pode descobrir isso
depois, com a operação já feita.

Com as duas causas presentes, vale a (b) — ela não tem retroatividade a oferecer. A regra
está em `restabelecimentoCobertura` (`packages/core/src/cobranca/relogio-apolice.ts`) e
na regularização (0269h), e as duas dizem a mesma coisa: regularizar pressupõe cobrança,
então **a regularização nunca grava `restabelecimento_retroativo = true`**. A
retroatividade de 30 dias só aparece para títulos que passaram do D+60 **sem** cobrança e
foram pagos a tempo — quem a calcula é o relógio.

A data em que a cobertura volta (`apolice_prazos.cobertura_volta_em`) aparece na **seção
Cobrança da Company 360** do sacado. É dinheiro (§6.3 item 2): é o que o comercial precisa
olhar antes de ceder de novo contra aquele grupo.

## O relógio

`cobranca/relogio-apolice`, diário às 06:00 (09:00 UTC). Para todo título coberto, em
aberto e vencido, cria ou atualiza `apolice_prazos`; fecha os que foram pagos
(`encerrado_pagamento`, com a regra de restabelecimento acima); e avisa:

| Aviso | Quando | Nível |
| --- | --- | --- |
| Parada de cobertura em 15 dias | D+45 | aviso |
| Notificação à seguradora em 15 dias | D+75 | alto |
| **5 dias para perder a indenização** | **D+85, todo dia até resolver** | crítico |
| Data da Perda em 30 dias — prepare o dossiê | D+150 | aviso |
| Prazo de envio do sinistro | D+300 e D+345 | alto |

Cada marco avisa **uma vez** — na primeira execução em que a antecedência foi alcançada,
para que um dia sem job não engula o aviso (`apolice_prazos.alertas_emitidos`, 0269h). O
crítico de D+85 repete diariamente, de propósito.

Os avisos saem **agregados por grupo e marco**, não por título: um sacado com quarenta
títulos vencidos no mesmo dia produziria quarenta pushes idênticos, e o quadragésimo não é
lido. O prazo perdido vira `apolice.prazo_perdido` na timeline do sacado — é fato, não
aviso.

Título **fora de cobrança** também tem relógio (`alertar_titulos_fora_de_cobranca`, ligado
por padrão): a parada de D+60 corre com ou sem alguém cuidando do título, e o título
vencido que ninguém está olhando é justamente o que perde o D+90.

**O relógio nunca envia nada à seguradora.** O alerta é a ação.

### Por que o D+85 não está no Meu Dia

O prompt pede o D+85 "no topo do Meu Dia do responsável". O Meu Dia (04p) é do
**Comercial** — a lista de trabalho do vendedor —, e o responsável de uma cobrança é do
time de Cobrança, que não tem essa tela. O item crítico mora, então, **no topo do Painel
da Cobrança**, no bloco "Relógio da apólice", que é a primeira coisa que o módulo mostra; e
o aviso diário chega por push, e-mail e sino (`apolice.prazo_critico`, que ignora o
horário de silêncio).

## O agrupamento: quem recebe carta

Confirmada a cobrança, o sistema calcula **notificações**, não títulos
(`agruparNotificacoes`, com testes):

- **Uma notificação para a matriz** do sacado com **todos** os títulos selecionados, de
  todas as SPEs/filiais do grupo. A matriz responde pelo conjunto.
- **Uma para cada SPE/filial devedora**, com só os títulos dela.
- **Dedup**: título cujo sacado é a própria matriz entra só no consolidado — a matriz
  nunca recebe duas cartas.
- Com `escopo = sacado_e_cedente`: **uma por cedente**, com todos os títulos dele na
  cobrança, e a mesma regra matriz/filial aplicada ao cedente quando
  `notificar_matriz_cedente` (padrão ligado).
- Seleção com títulos de **dois grupos diferentes é recusada**: uma cobrança é de um
  grupo, e é o grupo que é bloqueado.

A consolidação por grupo não é só economia de papel. A franquia de R$ 20.000 é **por
Comprador** (cl. 26100.00): fatiar o grupo em uma cobrança por SPE levaria cada fatia a
um sinistro abaixo da franquia, e nenhuma seria indenizável.

### O que é "o grupo"

Não havia no banco uma função "todos os CNPJs do grupo deste sacado". O grupo é a
**união** de: o cabeça (a holding resolvida por `app_holding_do_sacado`, ou a matriz da
raiz); toda SPE/filial que já apareceu como sacado de um título dele; a raiz do CNPJ; os
vínculos manuais (`sacado_vinculo`); e as SPEs que dividem o `grupo_id` do cabeça. No
momento do bloqueio essa lista é materializada em `cobranca_bloqueios_cnpj`, e SPE nova de
um grupo já bloqueado entra nela assim que a projeção a vê — "este CNPJ está bloqueado?"
vira um lookup por chave em qualquer tela.

Nas telas, o match é pelo CNPJ do sacado, pela matriz que a tela já conhece e pela matriz
da mesma raiz (`sacadoEmCobranca`, no core); no banco, `app_cobranca_sacado_bloqueado`
ainda resolve a holding na hora. Filial nova casa pela raiz; SPE de outra raiz que a
cobrança nunca viu só é pega pelo banco — é por isso que quem **recusa** é sempre o banco,
e as telas só evitam **oferecer**.

## O bloqueio e o que ele muda nos outros módulos

Quando uma cobrança chega a `estagio_que_bloqueia` (padrão `notificada`, isto é, no
primeiro envio), o grupo inteiro recebe `empresas.bloqueio_cobranca` e entra em
`cobranca_bloqueios_cnpj`. Os efeitos (§11):

| Onde | O que acontece | Quem garante |
| --- | --- | --- |
| Esteira de crédito (04d) | Nenhuma análise nova para o grupo. Erro em pt-BR: "Este sacado está em cobrança extrajudicial…" | Trigger `BEFORE INSERT` em `analises_credito` (0269f) — pega os seis caminhos de criação; só o backfill da Atradius passa, porque importa uma decisão que a seguradora já tomou |
| Scorecard | Knockout `em_cobranca` ("Grupo em cobrança extrajudicial"), avaliado **antes** do `processo_nosso_ativo`: os dois são ato nosso, e a cobrança é o fato mais recente — é a esteira que desemboca no processo | `calcularScore` (core) + `bloqueio_cobranca` lido pelo worker |
| Company 360 e esteira | Selo vermelho "Em cobrança — análises suspensas" onde o limite aparece; o botão de pedir análise some | Web |
| Funil de NFs e Sacados por NF | Selo vermelho "Em cobrança", tira no topo da precedência, e "Antecipação em andamento" desabilitado | Trigger em `notas_fiscais`, `pre_autorizacoes` e `sienge_titulos` para **sessão de usuário** — o sync da produção continua podendo espelhar uma operação que já aconteceu lá |
| Link de antecipação | Retido: `{link_antecipacao}` não é preenchido (o compositor trava o envio) e a aba do fornecedor/o celular dizem "link suspenso" | `buscarLinkDaNota` e `montarValoresVariaveis` (core) |
| Pré-autorizações (04s) | Recusadas com motivo `sacado_em_cobranca` — exceto as já convertidas ou revogadas, que são fatos | `preAutorizacaoEntraNoFunil` (core), alimentado pelo sync |
| Campanhas e sequências (05B) | Motivo de exclusão `em_cobranca`, logo depois de `processo_juridico`, para qualquer tipo de campanha | `avaliarDestinatario` (core) + coletor de fatos do worker |

### Regularização

Quando **todos** os títulos de **todas** as cobranças ativas do grupo estão quitados, o
gestor (Admin ou perfil "Gestor de Cobrança") pode **Regularizar sacado**:

1. **Quitação parcial não regulariza** — a RPC recusa e diz quantos títulos faltam.
2. **Protesto sem instrução de cancelamento bloqueia** a regularização: protesto não
   retirado depois de pago vira dano moral contra nós. Cada um precisa de instrução enviada
   ou de "não aplicável" com motivo.
3. Os prazos da apólice fecham com `encerrado_pagamento`, `restabelecimento_retroativo =
   false` e `cobertura_volta_em = data do pagamento` (cl. 17700.20 b, acima).
4. O bloqueio sai do grupo inteiro e o limite entra em **revisão pós-inadimplência**
   (`empresas.credito_revisao_pos_inadimplencia`, selo âmbar no crédito). Ele **não volta
   sozinho**: a marca cai quando uma análise aberta depois da regularização é decidida.
   `restaurar_limite_automaticamente` (padrão **false**) muda isso — mas quem já não pagou
   uma vez merece uma segunda olhada, não um carimbo.

## Manual e API: muda o transporte, nunca o prazo

A Atradius tem uma Non-Payments API (`api.atradius.com/non-payments`), da mesma família
OAuth 2.0 das Buyers/Cover/Policy que já usamos. O acesso é por registro e entitlement por
apólice, e **não temos a credencial**. O envio tem, então, dois modos
(`cobranca_config.apolice.modo_envio`):

- **`manual`** (padrão, funciona no dia 1): o sistema monta o dossiê (ZIP com índice e
  hashes + sumário executivo) e manda um e-mail formal ao contato da apólice; o operador
  registra o protocolo que a seguradora devolver.
- **`api`** (atrás de feature flag): o mesmo dossiê, montado das mesmas estruturas, sai
  pela API.

Ligar a API **não muda o dossiê, o checklist, os estágios nem os prazos** — só o cano. E a
regra inegociável: **o prazo nunca depende da API**. Se a chamada falhar, o alerta continua
vermelho, a mensagem diz para usar o modo manual, e o botão manual continua no mesmo lugar.
O estágio do sinistro só muda depois do `ok` do envio, com o protocolo. Um prazo de
apólice não pode morrer por um 500.

## Protesto: o que é preciso assinar em cada UF

Protesto eletrônico existe, mas não há API pública de auto-serviço. Para protestar:

1. **Convênio de apresentante** com o IEPTB/CRA **de cada estado** (em SP, IEPTB-SP /
   CENPROT; cada estado tem seu CRA, a maioria no padrão de troca de arquivos CRA/CRA21).
2. **Certificado digital e-CNPJ ICP-Brasil da cessionária** — quem apresenta é a nossa
   entidade (Construcredit Securitizadora), não o cedente. Os certificados que já temos são
   **dos cedentes** (usados para NF-e) e não servem para isso.
3. **Abrangência estadual**: o convênio de SP não protesta devedor no PR. O rollout é por
   UF, priorizando onde a carteira está (`cobranca_config.protesto.convenios`).

Enquanto o convênio de uma UF não existe, o modo é `portal_manual`: o sistema gera a
remessa no layout do CRA, o operador a envia pelo portal e sobe o retorno, que o parser lê.
A **certidão de protesto entra sozinha no item (g) do dossiê** — é por isso que protestar
antes de sinistrar quase sempre compensa. A **retirada é obrigatória depois da quitação**
(`retirar_protesto_ao_quitar`, que só se desliga com justificativa).

## A lacuna de dados da produção

`titulos` é uma **projeção** de `antecipacoes` (o sync 04n), feita em SQL
(`app__cobranca_projetar_titulos`, 0269c) depois de cada sync. A produção hoje **não
expõe a liquidação do título pelo sacado** — só o ciclo da antecipação. Isso tem três
consequências, e nenhuma delas é resolvida inventando valor:

- **`pago_em` vem do `completionDate` da antecipação `CONCLUDED`.** Medido em 26/09/2026,
  ele cai no dia seguinte ao vencimento em quase todas as linhas — é, na prática, a
  liquidação pelo sacado. Mas não é um campo de liquidação declarado, e a coluna
  `pago_em_origem = 'conclusao_producao'` diz isso; a tela também.
- **`BILLET_SWAPPED` com 15+ dias de atraso é ambíguo**: pode ser inadimplência, ou um
  pagamento que a produção ainda não reportou. Não dá para distinguir daqui. Por isso os
  alertas saem **agregados por grupo** e dizem o que é conhecido — um alarme por título
  num caso ambíguo seria ruído que ensina a ignorar o alarme.
- **Sem valor pago, pagamento parcial e recompra**, `valor_pago` fica nulo e o status
  `parcial`/`recomprado` não aparece; o limite de crédito vigente vem da análise
  (`app__limite_da_analise`), não do que a produção considera vigente. A perda segurada
  (§7.3) é calculada com o que existe e **mostra a conta aberta**, com o teto do limite
  marcado como estimado quando for.

O que falta está pedido ao time de produção em
[`docs/requisicao-titulos-plataforma-producao.md`](requisicao-titulos-plataforma-producao.md).
Quando o endpoint existir, a projeção troca a fonte e `pago_em_origem` passa a `producao`.

## Onde o prompt e o repositório divergem

- **`processos` é chaveado pelo número CNJ**, não por uuid. A cobrança aponta para ele por
  `processo_cnj`, e `processos.vinculo_cobranca_id` (reservado na 0143) ganhou a FK que lá
  ficou prometida.
- **Não existe `processo_titulos`.** O elo do Jurídico com o que é cobrado é
  `processo_operacoes`, e a conversão em processo liga os títulos por ali.
- **A calculadora é a do Jurídico** (`packages/core/src/juridico/calculo.ts`), reusada e
  não duplicada. O que a Cobrança pede a mais — índice "nenhum" e juros por mês cheio —
  entrou lá como `opcoes`, com defaults que reproduzem exatamente o comportamento anterior.
- **`notify()` do prompt é o motor de avisos da 0262** (`notificacao_tipos` +
  `notificacao_regras`): os tipos do módulo estão semeados na 0269g, com regras para o
  perfil "Gestor de Cobrança" e para os `nomeados` (o responsável de cada cobrança).
- **O Meu Dia é do Comercial**, então o item de D+85 mora no topo do Painel da Cobrança
  (acima).

## Mobile

Consulta e acompanhamento, mais **registrar contato** (§12): lista das cobranças vivas
(minhas/todas, filtro por estágio, ordenada pelo próximo prazo da apólice com a cor da
contagem regressiva), detalhe (títulos, notificações com o status de cada entrega,
histórico de interações e eventos, próximo prazo, selos) e a lista de prazos da apólice nos
próximos 30 dias. **Criar, notificar, protestar e sinistrar é pela web** — são atos com
consequência jurídica e de apólice, e a tela do celular diz isso em vez de esconder os
botões sem explicação.

## Tarefas externas (roadmap)

- [ ] **Non-Payments API da Atradius** — solicitar acesso em
      `api.atradius.com/register-now`, referenciando a apólice **9000373_SUSEP**. Sem isso
      o modo `api` não liga; o `manual` cobre tudo enquanto isso.
- [ ] **Protesto em SP** — assinar o convênio de apresentante com o **IEPTB-SP**
      (ieptbsp@ieptbsp.com.br, 11 2189-9666) e emitir o **e-CNPJ ICP-Brasil da
      cessionária**. Depois, as demais UFs por ordem de carteira.
- [ ] **Endpoint de títulos na produção** — o pedido está em
      [`docs/requisicao-titulos-plataforma-producao.md`](requisicao-titulos-plataforma-producao.md).
- [ ] **Renovação da apólice (31/05/2027)** — cadastrar a nova linha em `apolices` com os
      parâmetros revistos antes de 01/06/2027.
