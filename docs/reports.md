# Reportar Bugs & Melhorias + Modo Beta

Prompt 04m. Migração `0141`. Web e mobile.

Uma ferramenta de feedback dentro do produto, com painel de triagem no Admin e uma tarja de beta
controlada por configuração.

---

## Não é um módulo, e isso decide tudo

Reportar não aparece no registry, não tem `perfil_modulos`, não tem guard de módulo em lugar nenhum.
O botão fica na barra de topo de **toda** a aplicação, ao lado do sino, e a permissão de escrita é
`app_usuario_ativo()`.

Isso é deliberado. Um perfil sem módulo nenhum liberado é justamente o perfil com mais motivo para
dizer que a tela está quebrada — amarrar o feedback a um módulo faria a ferramenta calar exatamente
quem mais precisa dela.

**Ler** é o contrário: `reports_select` entrega ao autor apenas as linhas dele, e ao admin todas.

| quem | escreve report | lê os próprios | lê todos | triagem | modo beta |
| --- | --- | --- | --- | --- | --- |
| qualquer usuário ativo | ✅ | ✅ | ❌ | ❌ | ❌ |
| módulo `admin` | ✅ | ✅ | ✅ | ✅ | ✅ |

O painel de triagem é `webOnly` — vive em `/admin/reports`, e `admin` já é `webOnly` no registry.

---

## Duas esteiras, não uma com dez estados

```
bug        aberto → em_analise → em_correcao → resolvido
                                             ↘ nao_procede
                                             ↘ duplicado

melhoria   aberto → em_analise → planejado → em_desenvolvimento → entregue
                                                                ↘ nao_planejado
                                                                ↘ duplicado
```

Um bug é **consertado**; uma melhoria é **planejada e entregue**. Os verbos são diferentes porque o
trabalho é diferente. Um CHECK único com a união dos dez deixaria o painel oferecer "entregue" para
um bug — uma transição que não quer dizer nada e que ninguém consegue desfazer sem explicar.

A régua está escrita **duas vezes**, de propósito, e as duas têm de concordar:

- `reports_status_do_tipo`, o CHECK cruzado da migração `0141`;
- `STATUS_BUG` / `STATUS_MELHORIA` em `packages/core/src/reports/schemas.ts`.

`packages/core/src/reports/schemas.test.ts` compara as listas. Sem esse teste, um status acrescentado
só no TypeScript viraria um erro de constraint no meio de um clique — e quem descobre é o usuário.

**Terminais** (`resolvido`, `entregue`, `nao_procede`, `nao_planejado`, `duplicado`) preenchem
`resolvido_em`. Reabrir limpa a data; trocar um terminal por outro **preserva** a original — trocar
"resolvido" por "entregue" não é resolver de novo.

**`duplicado` exige o original.** O CHECK `reports_duplicado_aponta` amarra os dois lados: status
duplicado ⟺ `duplicado_de` preenchido. "Duplicado" sem apontar é informação pela metade — diz que
não vamos tratar e não diz onde a conversa continua. Sair de duplicado desfaz o vínculo.

**Prioridade é do admin, nunca de quem reporta.** Deixar o autor escolher faria toda linha nascer
"crítica" — não por má-fé, mas porque o bug que trava o *seu* dia é crítico. E é assim que o campo
deixa de ordenar coisa alguma.

---

## Contexto: seis chaves, e a RPC escolhe quais

`contexto` é jsonb vindo do cliente, e por isso `app_report_criar` **monta o objeto** a partir de uma
lista fechada — `rota`, `url`, `plataforma`, `user_agent`, `viewport`, `app_versao` — cortando cada
uma no limite da coluna. Um cliente que mandar `{"token": "..."}` junto vê o campo ser descartado, e
não gravado. É a diferença entre "campo de contexto" e "campo livre no banco preenchido pelo
navegador".

`montarContexto()` (core) é o mesmo helper nas duas plataformas: web passa `navigator`/`window`,
mobile passa `Platform.OS`/`Dimensions`/`Constants.expoConfig.version`. Duas implementações seriam
duas formas do mesmo objeto, e a segunda a divergir viraria uma linha em branco no painel sem
ninguém perceber.

Na tela ele aparece **colapsado, não escondido**: o usuário tem direito de ver exatamente o que
viaja junto com o texto dele. Um campo invisível anexado ao report é a diferença entre capturar
contexto e coletar dado sem avisar.

---

## O anexo

Bucket **privado** `report-anexos`, 5 MB, só imagem — limite e mime-types no **bucket**, porque uma
checagem em JavaScript é uma sugestão e o Storage aceita o que chegar pela API.

Um print de dentro do sistema mostra nome de cliente, CNPJ, limite, comissão. Bucket público seria um
link permanente e adivinhável para isso, e o "anexo opcional" viraria o maior vazamento da
plataforma. A leitura sai por **URL assinada de 5 minutos** — tempo de abrir a imagem, não de colar o
link num chat.

O caminho é `{usuario_id}/{arquivo}`: o primeiro segmento é a âncora da policy, porque no momento do
upload o report ainda não existe para servir de chave. `app_report_criar` confere de novo — repetir
impede que alguém registre no report o caminho do arquivo de outra pessoa e ganhe uma URL assinada.

**O upload acontece no envio, não ao escolher.** Quem escolhe um print e desiste não deve deixar um
objeto órfão num bucket cuja policy de DELETE é só do admin.

**Sem DELETE para o autor**, e isso é decisão: o anexo é a prova de que o bug existe, e apagá-lo
depois de a triagem começar deixaria o admin com um report que descreve uma tela que ninguém mais
pode ver.

---

## Quem é avisado de quê

Um caminho por evento — a regra que a migração `0016` estabeleceu para não tocar dois sinos pela
mesma coisa.

| evento | quem recebe | por onde | push? |
| --- | --- | --- | --- |
| `report.criado` | perfis com o módulo `admin` | trigger de `empresa_eventos` + `notificacao_regras` | não |
| `report.status_alterado` | o autor | `notificar()` na server action | **sim** |
| `report.comentario` (admin escreveu) | o autor | `notificar()` na server action | **sim** |
| `report.comentario` (autor respondeu) | os admins | `notificar()` na server action | **sim** |
| comentário **interno** | ninguém | — | — |
| `beta.alterado` | perfis com o módulo `admin` | trigger de `empresa_eventos` | não |

Só **dois** eventos são semeados em `notificacao_regras`, e a ausência dos outros não é esquecimento:
o destinatário de `report.status_alterado` é *o autor daquele report*, e a tabela só sabe endereçar
perfil ou usuário fixo. Além disso o §4 exige **push**, e o trigger só escreve o sino — push existe
apenas em `notify()`, que roda com service role.

O alvo das regras é o perfil que **tem o módulo** `admin`, não o perfil *chamado* "Admin": renomear
um perfil não pode desligar a triagem em silêncio.

**O evento `report.criado` não carrega o título do report.** `empresa_eventos` é legível por quem tem
o módulo `empresas` — quase todo mundo —, enquanto o report em si só o autor e o admin leem. Copiar o
título para o payload publicaria para a empresa inteira o texto que a policy acabou de restringir. O
sino diz "Report #42 aguardando triagem" e aponta para a página; o conteúdo está lá.

**Ninguém é notificado da própria ação**, nos dois mecanismos: o trigger exclui `ator_usuario_id`, e
as server actions comparam com `context.usuario.id`. Um admin que reporta e depois resolve o próprio
report receberia um push contando o que acabou de fazer.

**Salvar prioridade não notifica.** Só `mudou_status` dispara — é o que `app_report_atualizar`
devolve. Um sino a cada clique de "salvar" é como o autor aprende a ignorar os avisos que importam.

**Comentário interno nunca notifica.** A policy já esconde a linha do autor; avisá-lo de que "há um
comentário novo" que ele não consegue abrir seria pior que não avisar — anunciaria a existência do
que foi escondido.

### O deep link precisa de uma rota

`/reports/{id}` existe nas duas plataformas justamente por isso. "Meus reports" vive dentro do modal
da barra de topo, e um modal não tem URL — o push abriria a aplicação sem levar a lugar nenhum.

A rota não pertence a módulo nenhum, então `resolveNotificationHref` (mobile) a deixa passar. O
report de outra pessoa vira **404**, e não "sem permissão": a segunda resposta confirmaria que ele
existe.

---

## A thread tem dois lados

O admin comenta em qualquer report; o autor comenta no dele. `app_report_comentar` decide pelas duas
portas.

O spec dá o comentário ao admin, e um canal onde só um lado escreve transforma "qual navegador você
usou?" numa pergunta sem resposta possível — a triagem pararia na primeira dúvida. Por isso o autor
também escreve, e a resposta dele notifica quem tria.

`interno` é privilégio de admin, e a função **ignora** a flag vinda do autor em vez de recusar: quem
não pode marcar como interno também não deveria descobrir que a marca existe.

---

## Modo beta

Mora em `app_config.beta` (`{ habilitado, texto }`), tabela que já existe desde a `0016` e já é
legível por qualquer usuário ativo — que é exatamente o público do banner.

**Como ligar:** Admin → Configurações → Modo beta. Liga o interruptor, escreve o texto (até 200
caracteres), salva. Reflete em **todas as sessões abertas, sem novo login**: `app_config` entrou na
publicação `supabase_realtime` na `0141`, e o shell assina `chave=eq.beta` nas duas plataformas.

Ligar sem texto é recusado no banco, no zod e no botão. Uma tarja âmbar vazia no topo de todas as
telas é pior que tarja nenhuma.

**Sem botão de fechar**, e a ausência é o que dá sentido ao componente. Isto não é uma notificação —
é o estado da plataforma. Se desse para dispensar, cada pessoa veria uma coisa diferente e o aviso
deixaria de significar "você está usando um sistema em beta" para significar "você ainda não clicou
no x".

`app_definir_beta` existe apesar de `app_definir_config` genérica já existir, por duas razões: o §5
pede o evento `beta.alterado` (emiti-lo na genérica faria toda troca de configuração disparar um
evento de beta), e a genérica aceita qualquer jsonb no `valor` — um `{"habilitado": "sim"}` gravaria
liso e o banner sumiria sem erro nenhum.

**Onde a tarja é montada:**

- **Web** — no `AppShell`, entre a `TopBar` e o `<main>`, dentro do frame que não rola. Se rolasse
  com a página, sumiria no primeiro scroll e passaria a avisar apenas quem está no topo de uma tela.
- **Mobile** — pelo `screenLayout` do `<ModuleStack>`, ou seja **dentro de cada tela**, logo abaixo
  do header nativo. Acima do navegador ela brigaria com o inset de status bar que o header nativo
  calcula sozinho, e o resultado seria uma faixa em branco entre a tarja e o título, diferente em
  cada plataforma. As telas que não passam por `ModuleStack` (`mais`, `configuracoes`,
  `reports/[id]`) montam a tarja explicitamente.

`lerEstadoBeta()` nunca lança: um jsonb inesperado devolve *desligado*. O banner mora no shell de
toda a aplicação, e uma plataforma sem tarja é infinitamente melhor que uma plataforma sem casca.

**Regra que passa a valer para `app_config`:** a tabela é lida pela empresa inteira e agora chega ao
cliente por Realtime. Nada de credencial, chave ou segredo entra ali. Mesma régua de
`fornecedores_config`.

---

## Escritas: só por RPC

`authenticated` recebe **SELECT e nada mais** nas três tabelas. Não há policy de INSERT/UPDATE porque
não há grant de INSERT/UPDATE — criar, comentar e mudar status passam por funções SECURITY DEFINER
que autorizam por dentro.

| RPC | quem | o que faz |
| --- | --- | --- |
| `app_report_criar(p)` | usuário ativo | cria, grava histórico inicial, audita, emite `report.criado` |
| `app_report_atualizar(p)` | admin | status/prioridade/duplicado, histórico, audita; devolve `mudou_status` |
| `app_report_comentar(p)` | admin ou autor | comenta; `interno` só para admin |
| `reports_painel()` | admin | contadores do topo |
| `app_definir_beta(p)` | admin | grava `app_config.beta`, audita, emite `beta.alterado` |

As policies usam `(select app_is_admin())` e `(select auth.uid())`, não as funções nuas. Medido com
400 reports sob JWT de admin: **InitPlan, 2,98 ms, 115 buffers** — uma chamada por consulta, e não
uma por linha varrida. Sem o `select`, `app_is_admin()` rodaria por linha, que é o incidente que a
migração `0138f` documenta.

Os contadores do topo vêm de `reports_painel()` e **não** da lista já carregada: a lista tem limite
de página e vem filtrada, e contar sobre ela diria "3 abertos" com 40 abertos no banco.
"Resolvidos no mês" conta `resolvido` e `entregue` — não `nao_procede`/`nao_planejado`/`duplicado`,
que também fecham o report mas fariam o número subir ao arquivar sem fazer nada.

---

## Fora de escopo (§7)

Integração com issue tracker externo, votação de melhorias por outros usuários, SLA automático,
categorização por módulo. O `contexto.rota` já diz de que tela veio o report — categorizar por módulo
seria pedir ao usuário o que o sistema captura sozinho.
