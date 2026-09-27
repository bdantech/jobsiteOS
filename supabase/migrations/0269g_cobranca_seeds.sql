-- ============================================================================
-- 0269g — Cobrança: perfis, settings, apólice vigente, modelos e avisos
-- ============================================================================

-- ─── Perfis e módulo ────────────────────────────────────────────────────────

insert into public.perfis (nome, descricao)
select 'Cobrança', 'Cobrança extrajudicial: notificações, acordos, protesto e sinistro.'
where not exists (select 1 from public.perfis where nome = 'Cobrança');

insert into public.perfis (nome, descricao)
select 'Gestor de Cobrança', 'Cobrança + modelos, settings, regularização do sacado e números consolidados.'
where not exists (select 1 from public.perfis where nome = 'Gestor de Cobrança');

insert into public.perfil_modulos (perfil_id, modulo_id)
select p.id, 'cobranca' from public.perfis p
where p.nome in ('Admin', 'Cobrança', 'Gestor de Cobrança', 'Jurídico')
on conflict do nothing;

-- ─── §13 Settings ───────────────────────────────────────────────────────────

insert into public.cobranca_config (chave, valor) values
  ('cobranca', jsonb_build_object(
    'dias_inicio_cobranca', 15,
    'prazo_pagamento_dias', 5,
    'prazo_pagamento_uteis', true,
    'dias_para_reiteracao', 15,
    'estagio_que_bloqueia', 'notificada',
    'motivos_encerramento', jsonb_build_array(
      'Devedor sem patrimônio localizável', 'Custo de cobrança maior que o saldo',
      'Indenizado pela seguradora', 'Prescrição', 'Acordo judicial homologado', 'Outro'),
    'canais_padrao', jsonb_build_array('email', 'correio_ar'))),
  ('calculo', jsonb_build_object(
    'juros_mora_mes', 1, 'multa_pct', 2, 'honorarios_pct', 10, 'indice', 'igpm', 'juros_pro_rata', true)),
  ('apolice', jsonb_build_object(
    -- dias depois do vencimento ORIGINAL em que cada aviso sai (§6.3)
    'alertas_dias', jsonb_build_object(
      'parada_cobertura', 45, 'notificacao_seguradora', 75, 'notificacao_critica', 85,
      'data_perda', 150, 'envio_sinistro', jsonb_build_array(300, 345)),
    'alertar_titulos_fora_de_cobranca', true,
    'contato_seguradora', jsonb_build_object('nome', null, 'email', null),
    'modo_envio', 'manual')),
  ('protesto', jsonb_build_object(
    'convenios', '[]'::jsonb,
    'custas_padrao', null,
    'retirar_protesto_ao_quitar', true,
    'justificativa_nao_retirar', null)),
  ('regularizacao', jsonb_build_object('restaurar_limite_automaticamente', false)),
  ('credor', jsonb_build_object(
    'razao_social', 'CONSTRUCREDIT SECURITIZADORA S/A',
    'cnpj', '43738268000138',
    'dados_pagamento', null))
on conflict (chave) do nothing;

-- ─── §6 A apólice vigente (9000373_SUSEP) ───────────────────────────────────
-- Números da apólice, não da casa: a renovação anual muda parâmetro, e é por isso
-- que eles vivem aqui e não no código.
insert into public.apolices (
  seguradora, numero, segurado_cnpj, vigencia_inicio, vigencia_fim, percentagem_segurada,
  periodo_espera_dias, prazo_maximo_credito_dias, periodo_max_prorrogacao_dias,
  prazo_notificacao_apos_prorrogacao_dias, prazo_envio_sinistro_meses,
  prazo_documentos_complementares_dias, franquia, responsabilidade_maxima)
values (
  'Atradius Crédito y Caución', '9000373_SUSEP', '43738268000138', '2026-06-01', '2027-05-31', 0.90,
  180, 180, 60, 30, 6, 30, 20000.00, 11520000.00)
on conflict (numero, vigencia_inicio) do nothing;

-- ─── §5 e §9.3 Modelos de partida ───────────────────────────────────────────

insert into public.cobranca_modelos (tipo, nome, corpo_markdown)
select v.tipo, v.nome, v.corpo from (values
('notificacao_sacado', 'Notificação extrajudicial ao sacado',
$md$# NOTIFICAÇÃO EXTRAJUDICIAL

**Notificante:** {{credor.razao_social}}, inscrita no CNPJ sob o nº {{credor.cnpj}}, na qualidade de cessionária dos créditos abaixo relacionados.

**Notificada:** {{destinatario.razao_social}}, CNPJ {{destinatario.cnpj}}, com endereço em {{destinatario.endereco}}.

**Referência:** {{cobranca.codigo}} · {{data_hoje}}

## 1. Origem do crédito

A Notificante é titular, por contrato de cessão de direitos creditórios celebrado com o fornecedor (cedente) de V.Sas., dos títulos representados pelas notas fiscais/duplicatas relacionadas no item 2, emitidos contra V.Sas. em razão do fornecimento de bens e serviços. A cessão foi regularmente comunicada, e o pagamento dos títulos passou a ser devido à Notificante.

## 2. Títulos vencidos e não pagos

{{tabela_titulos}}

**Valor de face:** {{valor_total_face}}
**Valor atualizado até {{data_base}}:** {{valor_total_atualizado}}

## 3. Memória de cálculo

{{memoria_calculo}}

## 4. Prazo e forma de pagamento

Fica V.Sas. NOTIFICADA a efetuar o pagamento do valor atualizado no prazo de **{{prazo_dias}}**, isto é, até **{{prazo_data}}**, pelos seguintes meios:

{{dados_pagamento}}

## 5. Consequências do não pagamento

Decorrido o prazo sem o pagamento ou sem a apresentação de proposta formal de regularização, a Notificante adotará, sem novo aviso, as medidas cabíveis para a satisfação do crédito, incluindo: (i) o **protesto** dos títulos; (ii) a **inclusão do débito em cadastros de inadimplentes**; (iii) a **execução judicial** da dívida, acrescida de custas, despesas processuais e honorários advocatícios; e (iv) a **comunicação do inadimplemento à seguradora de crédito**, com as consequências cadastrais daí decorrentes.

Esta notificação não constitui novação, renúncia ou prorrogação de prazo, nem prejudica os direitos da Notificante contra quaisquer coobrigados.

Atenciosamente,

{{credor.razao_social}}
$md$),
('notificacao_cedente', 'Notificação ao cedente pela inadimplência',
$md$# NOTIFICAÇÃO EXTRAJUDICIAL — INADIMPLEMENTO DE TÍTULOS CEDIDOS

**Notificante:** {{credor.razao_social}}, CNPJ {{credor.cnpj}}, cessionária.

**Notificada:** {{destinatario.razao_social}}, CNPJ {{destinatario.cnpj}}, com endereço em {{destinatario.endereco}}, na qualidade de cedente.

**Referência:** {{cobranca.codigo}} · {{data_hoje}}

## 1. Objeto

Os títulos abaixo, cedidos por V.Sas. à Notificante nos termos do contrato de cessão de direitos creditórios firmado entre as partes, encontram-se **vencidos e não pagos pelo devedor (sacado)**:

{{tabela_titulos}}

**Valor de face:** {{valor_total_face}}
**Valor atualizado até {{data_base}}:** {{valor_total_atualizado}}

## 2. Providências

Comunicamos o inadimplemento para os fins do contrato de cessão, inclusive quanto às obrigações de colaboração do cedente na cobrança e na prova do crédito (documentos de origem, comprovantes de entrega e correspondências), e às demais responsabilidades nele previstas.

Solicitamos que, no prazo de **{{prazo_dias}}** (até {{prazo_data}}), V.Sas. nos encaminhem qualquer informação relevante sobre o relacionamento comercial com o devedor, bem como eventual comprovação de pagamento que tenha sido feito diretamente a V.Sas., o qual deverá ser repassado à Notificante.

Atenciosamente,

{{credor.razao_social}}
$md$),
('reiteracao', 'Reiteração de notificação',
$md$# REITERAÇÃO DE NOTIFICAÇÃO EXTRAJUDICIAL — {{rodada}}ª RODADA

**Notificante:** {{credor.razao_social}}, CNPJ {{credor.cnpj}}.

**Notificada:** {{destinatario.razao_social}}, CNPJ {{destinatario.cnpj}}, {{destinatario.endereco}}.

**Referência:** {{cobranca.codigo}} · {{data_hoje}}

Reiteramos os termos da notificação anterior, que permanece sem atendimento. Os títulos abaixo seguem vencidos e não pagos:

{{tabela_titulos}}

**Valor atualizado até {{data_base}}:** {{valor_total_atualizado}}

{{memoria_calculo}}

Concedemos o prazo final de **{{prazo_dias}}** (até {{prazo_data}}) para pagamento, pelos meios abaixo:

{{dados_pagamento}}

Vencido este prazo, a Notificante procederá ao protesto dos títulos, à negativação e à execução judicial da dívida, além da comunicação do inadimplemento à seguradora de crédito, independentemente de novo aviso.

{{credor.razao_social}}
$md$),
('confissao_divida_simples', 'Confissão de dívida — simples',
$md$# INSTRUMENTO PARTICULAR DE CONFISSÃO DE DÍVIDA E PARCELAMENTO

**CREDORA:** {{credor.razao_social}}, CNPJ {{credor.cnpj}}.

**DEVEDORA:** {{destinatario.razao_social}}, CNPJ {{destinatario.cnpj}}, com sede em {{destinatario.endereco}}.

## Cláusula 1ª — Da confissão

A DEVEDORA reconhece e confessa dever à CREDORA, de forma irrevogável e irretratável, a quantia líquida, certa e exigível de **{{valor_confessado}}**, atualizada até {{data_base}}, originada dos títulos abaixo relacionados, cedidos à CREDORA:

{{tabela_titulos}}

## Cláusula 2ª — Da memória de cálculo

{{memoria_calculo}}

## Cláusula 3ª — Do pagamento

O valor confessado será pago da seguinte forma:

{{tabela_parcelas}}

## Cláusula 4ª — Do vencimento antecipado

O atraso de qualquer parcela por mais de 5 (cinco) dias implica o vencimento antecipado de todo o saldo, acrescido de multa de 2%, juros de mora de 1% ao mês e honorários de 10%, autorizando a CREDORA a promover desde logo a execução deste instrumento, que constitui título executivo extrajudicial (art. 784, III, do CPC).

## Cláusula 5ª — Da ausência de novação

Este instrumento não importa novação. Quitado integralmente o acordo, a CREDORA dará plena quitação dos títulos relacionados.

## Cláusula 6ª — Do foro

Fica eleito o foro de {{foro}}.

Local e data: ____________________, {{data_hoje}}.

_____________________________ CREDORA

_____________________________ DEVEDORA

**Testemunhas:**

{{testemunhas}}
$md$),
('confissao_divida_aval', 'Confissão de dívida — com aval',
$md$# INSTRUMENTO PARTICULAR DE CONFISSÃO DE DÍVIDA COM AVAL

**CREDORA:** {{credor.razao_social}}, CNPJ {{credor.cnpj}}.

**DEVEDORA:** {{destinatario.razao_social}}, CNPJ {{destinatario.cnpj}}, com sede em {{destinatario.endereco}}.

**AVALISTA(S):**

{{avalistas}}

## Cláusula 1ª — Da confissão

A DEVEDORA reconhece e confessa dever à CREDORA a quantia líquida, certa e exigível de **{{valor_confessado}}**, atualizada até {{data_base}}, originada dos títulos abaixo:

{{tabela_titulos}}

{{memoria_calculo}}

## Cláusula 2ª — Do pagamento

{{tabela_parcelas}}

## Cláusula 3ª — Do aval

O(s) AVALISTA(S) acima qualificado(s) garante(m) solidariamente o pagamento integral das obrigações deste instrumento, renunciando ao benefício de ordem, e declara(m) ter pleno conhecimento de seus termos. Quando casado(s), o(s) cônjuge(s) assina(m) em anuência.

## Cláusula 4ª — Do vencimento antecipado

O atraso de qualquer parcela por mais de 5 (cinco) dias implica o vencimento antecipado de todo o saldo, com multa de 2%, juros de 1% ao mês e honorários de 10%, exigível da DEVEDORA e do(s) AVALISTA(S).

## Cláusula 5ª — Do foro

Fica eleito o foro de {{foro}}.

Local e data: ____________________, {{data_hoje}}.

_____________________________ CREDORA

_____________________________ DEVEDORA

_____________________________ AVALISTA(S)

**Testemunhas:**

{{testemunhas}}
$md$),
('confissao_divida_af', 'Confissão de dívida — com alienação fiduciária',
$md$# INSTRUMENTO PARTICULAR DE CONFISSÃO DE DÍVIDA COM ALIENAÇÃO FIDUCIÁRIA EM GARANTIA

**CREDORA FIDUCIÁRIA:** {{credor.razao_social}}, CNPJ {{credor.cnpj}}.

**DEVEDORA FIDUCIANTE:** {{destinatario.razao_social}}, CNPJ {{destinatario.cnpj}}, com sede em {{destinatario.endereco}}.

## Cláusula 1ª — Da confissão

A DEVEDORA confessa dever à CREDORA a quantia de **{{valor_confessado}}**, atualizada até {{data_base}}, originada dos títulos:

{{tabela_titulos}}

{{memoria_calculo}}

## Cláusula 2ª — Do pagamento

{{tabela_parcelas}}

## Cláusula 3ª — Da alienação fiduciária

Em garantia do cumprimento integral deste instrumento, a DEVEDORA aliena fiduciariamente à CREDORA o bem abaixo descrito, transferindo-lhe a propriedade resolúvel e a posse indireta, e permanecendo como depositária da posse direta:

{{bem_garantia}}

O registro da garantia no órgão competente é condição de eficácia perante terceiros, às expensas da DEVEDORA.

## Cláusula 4ª — Do vencimento antecipado e da consolidação

O atraso de qualquer parcela por mais de 5 (cinco) dias implica o vencimento antecipado do saldo e autoriza a consolidação da propriedade em favor da CREDORA, na forma da lei.

## Cláusula 5ª — Do foro

Fica eleito o foro de {{foro}}.

Local e data: ____________________, {{data_hoje}}.

_____________________________ CREDORA FIDUCIÁRIA

_____________________________ DEVEDORA FIDUCIANTE

**Testemunhas:**

{{testemunhas}}
$md$),
('confissao_divida_garantia_real', 'Confissão de dívida — com garantia real',
$md$# INSTRUMENTO PARTICULAR DE CONFISSÃO DE DÍVIDA COM GARANTIA REAL

**CREDORA:** {{credor.razao_social}}, CNPJ {{credor.cnpj}}.

**DEVEDORA:** {{destinatario.razao_social}}, CNPJ {{destinatario.cnpj}}, com sede em {{destinatario.endereco}}.

## Cláusula 1ª — Da confissão

A DEVEDORA confessa dever à CREDORA a quantia de **{{valor_confessado}}**, atualizada até {{data_base}}, originada dos títulos:

{{tabela_titulos}}

{{memoria_calculo}}

## Cláusula 2ª — Do pagamento

{{tabela_parcelas}}

## Cláusula 3ª — Da garantia real (hipoteca/penhor)

Em garantia do pagamento integral, a DEVEDORA constitui em favor da CREDORA garantia real sobre o bem a seguir, com a respectiva matrícula/identificação:

{{bem_garantia}}

A garantia será levada a registro no cartório competente, às expensas da DEVEDORA, sendo este instrumento título hábil para tanto.

## Cláusula 4ª — Do vencimento antecipado

O atraso de qualquer parcela por mais de 5 (cinco) dias implica o vencimento antecipado do saldo e autoriza a excussão da garantia.

## Cláusula 5ª — Do foro

Fica eleito o foro de {{foro}}.

Local e data: ____________________, {{data_hoje}}.

_____________________________ CREDORA

_____________________________ DEVEDORA

**Testemunhas:**

{{testemunhas}}
$md$)
) as v(tipo, nome, corpo)
where not exists (select 1 from public.cobranca_modelos m where m.tipo = v.tipo);

-- ─── §14 Avisos (motor 0262) ────────────────────────────────────────────────

insert into public.notificacao_tipos (tipo, modulo, nome, descricao, gravidade) values
  ('cobranca.criada', 'cobranca', 'Cobrança criada', null, 'normal'),
  ('cobranca.notificacao_gerada', 'cobranca', 'Minutas de notificação geradas', null, 'normal'),
  ('cobranca.notificacao_enviada', 'cobranca', 'Notificação extrajudicial enviada', null, 'normal'),
  ('cobranca.notificacao_entregue', 'cobranca', 'Notificação entregue', null, 'normal'),
  ('cobranca.notificacao_devolvida', 'cobranca', 'Notificação devolvida', 'AR devolvido ou recusado: o endereço precisa ser revisto.', 'normal'),
  ('cobranca.reiteracao', 'cobranca', 'Reiteração gerada', null, 'normal'),
  ('cobranca.reiteracao_devida', 'cobranca', 'Reiteração devida', 'Lembrete: a notificação passou do prazo de reiteração.', 'normal'),
  ('cobranca.titulo_quitado', 'cobranca', 'Título quitado em cobrança', null, 'normal'),
  ('cobranca.acordo_simulado', 'cobranca', 'Acordo simulado', null, 'normal'),
  ('cobranca.acordo_assinado', 'cobranca', 'Acordo assinado', null, 'normal'),
  ('cobranca.convertida_em_processo', 'cobranca', 'Cobrança convertida em processo', null, 'normal'),
  ('cobranca.encerrada', 'cobranca', 'Cobrança encerrada', null, 'normal'),
  ('cobranca.sacado_bloqueado', 'cobranca', 'Sacado bloqueado por cobrança', null, 'normal'),
  ('cobranca.sacado_regularizado', 'cobranca', 'Sacado regularizado', null, 'normal'),
  ('cobranca.aviso_apolice_aceito', 'cobranca', 'Aviso de efeito na apólice aceito', null, 'normal'),
  ('cobranca.contato_registrado', 'cobranca', 'Contato de cobrança registrado', null, 'normal'),
  ('protesto.remessa_enviada', 'cobranca', 'Remessa de protesto enviada', null, 'normal'),
  ('protesto.instrucao_cancelamento', 'cobranca', 'Instrução de cancelamento de protesto enviada', null, 'normal'),
  ('protesto.apontado', 'cobranca', 'Protesto apontado', null, 'normal'),
  ('protesto.protestado', 'cobranca', 'Título protestado', null, 'normal'),
  ('protesto.retirado', 'cobranca', 'Protesto retirado', null, 'normal'),
  ('protesto.retirada_pendente', 'cobranca', 'Protesto a retirar', 'Título quitado com protesto sem instrução de cancelamento.', 'critica'),
  ('sinistro.criado', 'cobranca', 'Sinistro aberto', null, 'normal'),
  ('sinistro.notificado', 'cobranca', 'Seguradora notificada', null, 'normal'),
  ('sinistro.enviado', 'cobranca', 'Sinistro enviado', null, 'normal'),
  ('sinistro.doc_solicitado', 'cobranca', 'Seguradora pediu documento', null, 'critica'),
  ('sinistro.doc_prazo', 'cobranca', 'Prazo de documento complementar', 'Pedido da seguradora perto do vencimento.', 'critica'),
  ('sinistro.aceito', 'cobranca', 'Sinistro aceito', null, 'normal'),
  ('sinistro.recusado', 'cobranca', 'Sinistro recusado', null, 'critica'),
  ('sinistro.indenizado', 'cobranca', 'Indenização recebida', null, 'normal'),
  ('apolice.prazo_alerta', 'cobranca', 'Prazo da apólice se aproximando', 'Relógio da apólice Atradius (§6.3).', 'normal'),
  ('apolice.prazo_critico', 'cobranca', 'Prazo da apólice crítico', 'D+85: cinco dias para perder o direito à indenização. Repete diariamente até resolver.', 'critica'),
  ('apolice.prazo_perdido', 'cobranca', 'Prazo da apólice perdido', null, 'critica'),
  ('apolice.insolvencia_registrada', 'cobranca', 'Insolvência registrada', null, 'critica'),
  ('apolice.insolvencia_detectada', 'cobranca', 'Possível insolvência detectada', 'Processo de falência/recuperação do sacado no Jurídico.', 'critica')
on conflict (tipo) do nothing;

-- Gestores recebem os marcos de apólice e os fatos que mudam dinheiro; o
-- responsável da cobrança recebe o que cai na fila dele (payload.destinatarios).
insert into public.notificacao_regras (tipo_evento, perfil_id, canais, dedup_horas, fallback_admin)
select r.tipo, pf.id, r.canais::text[], r.dedup, true
from (values
  ('apolice.prazo_alerta',            '{sino,push,email}', 20),
  ('apolice.prazo_critico',           '{sino,push,email}', 20),
  ('apolice.prazo_perdido',           '{sino,push,email}', 0),
  ('apolice.insolvencia_registrada',  '{sino,push,email}', 0),
  ('apolice.insolvencia_detectada',   '{sino,push,email}', 0),
  ('cobranca.sacado_bloqueado',       '{sino}',            0),
  ('cobranca.sacado_regularizado',    '{sino,push}',       0),
  ('cobranca.titulo_quitado',         '{sino}',            0),
  ('cobranca.acordo_assinado',        '{sino,push}',       0),
  ('protesto.protestado',             '{sino}',            0),
  ('protesto.retirada_pendente',      '{sino,push,email}', 20),
  ('sinistro.doc_solicitado',         '{sino,push,email}', 0),
  ('sinistro.doc_prazo',              '{sino,push,email}', 20),
  ('sinistro.aceito',                 '{sino,push}',       0),
  ('sinistro.recusado',               '{sino,push,email}', 0),
  ('sinistro.indenizado',             '{sino,push}',       0)
) as r(tipo, canais, dedup)
join public.perfis pf on pf.nome = 'Gestor de Cobrança'
where not exists (select 1 from public.notificacao_regras x where x.tipo_evento = r.tipo and x.perfil_id = pf.id);

insert into public.notificacao_regras
  (tipo_evento, papel, canais, frequencia, dedup_horas, fallback_admin, respeita_silencio)
select r.tipo, 'nomeados', r.canais::text[], 'imediato', r.dedup, false, r.silencio
from (values
  ('apolice.prazo_alerta',             '{sino,push,email}', 20, true),
  ('apolice.prazo_critico',            '{sino,push,email}', 20, false),
  ('apolice.prazo_perdido',            '{sino,push,email}', 0,  false),
  ('cobranca.notificacao_entregue',    '{sino}',            0,  true),
  ('cobranca.notificacao_devolvida',   '{sino,push}',       0,  true),
  ('cobranca.reiteracao_devida',       '{sino}',            20, true),
  ('cobranca.titulo_quitado',          '{sino,push}',       0,  true),
  ('cobranca.acordo_assinado',         '{sino,push}',       0,  true),
  ('protesto.apontado',                '{sino}',            0,  true),
  ('protesto.protestado',              '{sino,push}',       0,  true),
  ('protesto.retirado',                '{sino}',            0,  true),
  ('protesto.retirada_pendente',       '{sino,push}',       20, true),
  ('sinistro.doc_solicitado',          '{sino,push,email}', 0,  false),
  ('sinistro.doc_prazo',               '{sino,push,email}', 20, false),
  ('sinistro.aceito',                  '{sino,push}',       0,  true),
  ('sinistro.recusado',                '{sino,push}',       0,  true),
  ('sinistro.indenizado',              '{sino,push}',       0,  true)
) as r(tipo, canais, dedup, silencio)
where not exists (select 1 from public.notificacao_regras x where x.tipo_evento = r.tipo and x.papel = 'nomeados');
