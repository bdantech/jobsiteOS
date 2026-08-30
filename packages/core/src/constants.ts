/**
 * ONE OS navy. The single brand colour across web (shadcn) and mobile (NativeWind).
 *
 * It is very dark — hsl(220, 35%, 18%) — which is why it is the SIDEBAR surface in
 * both themes rather than a primary element in dark mode: against the dark-mode
 * background it contrasts at 1.37:1, and the WCAG floor for a UI element is 3:1.
 * The dark theme keeps the hue (220°) and lifts the lightness to 66%. See
 * apps/web/src/app/globals.css.
 */
export const BRAND_ACCENT = '#1e293f'

/** Anthropic model behind the AI Bar on both platforms. */
export const AI_MODEL = 'claude-sonnet-4-6'

/** Cap on tool-use round trips in one AI turn, so a tool loop can't run away. */
export const AI_MAX_TOOL_ROUNDS = 8

/** Event types emitted so far. Each module appends its own. */
export const EVENTO_TIPOS = {
  // Fundação
  EMPRESA_CRIADA: 'empresa.criada',
  ESTAGIO_ALTERADO: 'estagio.alterado',
  NOTA_CRIADA: 'nota.criada',

  // Mercado
  CAMADA_ALTERADA: 'camada.alterada',
  EMPRESA_PROMOVIDA: 'empresa.promovida',
  MERCADO_INGESTAO_CONCLUIDA: 'mercado.ingestao_concluida',
  MERCADO_INGESTAO_FALHOU: 'mercado.ingestao_falhou',
  IMPORTACAO_CONCLUIDA: 'importacao.concluida',
  IMPORTACAO_REVISAO_PENDENTE: 'importacao.revisao_pendente',

  // Radar (enriquecimento)
  DOMINIO_RESOLVIDO: 'dominio.resolvido',
  CONTATOS_ENRIQUECIDOS: 'contatos.enriquecidos',
  PROTESTO_DETECTADO: 'protesto.detectado',
  PROTESTO_AGRAVADO: 'protesto.agravado',
  GRUPO_PROTESTO_AGRAVADO: 'grupo.protesto_agravado',
  LOTE_AGUARDANDO_APROVACAO: 'lote.aguardando_aprovacao',
  LOTE_CONCLUIDO: 'lote.concluido',
  ORCAMENTO_ALERTA: 'orcamento.alerta',
  ORCAMENTO_ESTOURADO: 'orcamento.estourado',
  CLIENTE_NOVO_DETECTADO: 'cliente.novo_detectado',
  CLIENTE_DORMENTE: 'cliente.dormente',
  CLIENTE_LIMITE_QUASE_ESGOTADO: 'cliente.limite_quase_esgotado',
  CLIENTE_STATUS_OPERACIONAL_ALTERADO: 'cliente.status_operacional_alterado',
  CLIENTE_REATIVADO: 'cliente.reativado',

  // Faturamento & funcionários (04c)
  METRICA_DECLARADA: 'metrica.declarada',
  METRICA_IMPORTADA: 'metrica.importada',
  FUNCIONARIOS_ATUALIZADO: 'funcionarios.atualizado',
  FATURAMENTO_REESTIMADO: 'faturamento.reestimado',
  ESTIMADOR_RECALIBRADO: 'estimador.recalibrado',

  // Antecipação (funil de NFs)
  NF_SINCRONIZADA: 'nf.sincronizada',
  NF_FAIXA_ALTERADA: 'nf.faixa_alterada',
  NF_EXPIRADA: 'nf.expirada',
  NF_ESTAGIO_ALTERADO: 'nf.estagio_alterado',
  NF_CONVERTIDA: 'nf.convertida',
  NF_PERDIDA: 'nf.perdida',
  FORNECEDOR_SEM_INTERESSE: 'fornecedor.sem_interesse',
  FORNECEDOR_TIPAGEM_ALTERADA: 'fornecedor.tipagem_alterada',
  SACADO_LIMITE_INSUFICIENTE: 'sacado.limite_insuficiente',
  SACADO_CREDITO_ALTERADO: 'sacado.credito_alterado',
  OUTBOX_MENSAGEM_GERADA: 'outbox.mensagem_gerada',
  TOQUE_MANUAL: 'toque.manual',
  CONTATO_PONTO_FOCAL_DEFINIDO: 'contato.ponto_focal_definido',
  CNPJ_LOOKUP_NAO_ENCONTRADO: 'cnpj.lookup_nao_encontrado',

  // Sync de antecipações e conversão automática (04e)
  ANTECIPACAO_SINCRONIZADA: 'antecipacao.sincronizada',
  ANTECIPACAO_STATUS_ALTERADO: 'antecipacao.status_alterado',
  ANTECIPACAO_CASADA: 'antecipacao.casada',
  ANTECIPACAO_SEM_NF: 'antecipacao.sem_nf',
  /**
   * Uma antecipação já convertida voltou atrás (status não-conversor ou NF
   * cancelada). NÃO reverte estágio — é evento próprio porque regressão
   * financeira merece olho humano, não automação (04e §4.5).
   */
  ANTECIPACAO_REGREDIU: 'antecipacao.regrediu',

  // Certificados digitais (04b)
  CERTIFICADO_VENCENDO: 'certificado.vencendo',
  CERTIFICADO_VENCIDO: 'certificado.vencido',
  CERTIFICADO_RENOVADO: 'certificado.renovado',

  // Crédito: potencial, scorecard e esteira (04d)
  ANALISE_SOLICITADA: 'analise.solicitada',
  ANALISE_MOVIDA: 'analise.movida',
  ANALISE_ENVIADA: 'analise.enviada',
  ANALISE_APROVADA: 'analise.aprovada',
  ANALISE_APROVADA_PARCIAL: 'analise.aprovada_parcial',
  ANALISE_NEGADA: 'analise.negada',
  ANALISE_EXPIRADA: 'analise.expirada',
  // Sinal de risco de primeira grandeza: a seguradora CORTOU um limite que já tinha
  // dado. Notifica Admin além de Crédito, e por isso é um evento próprio em vez de um
  // caso dentro de "análise atualizada".
  ANALISE_LIMITE_REDUZIDO: 'analise.limite_reduzido',
  SCORE_RECALCULADO: 'score.recalculado',
  CREDITO_POTENCIAL_ATUALIZADO: 'credito.potencial_atualizado',

  // Perfil de Quem Opera (04f)
  PERFIL_RECALCULADO: 'perfil.recalculado',
  PERFIL_SUGESTAO_ACEITA: 'perfil.sugestao_aceita',
  PERFIL_SUGESTAO_DESCARTADA: 'perfil.sugestao_descartada',

  // Estrutura Comercial (04g)
  CLIENTE_GESTAO_ALTERADA: 'cliente.gestao_alterada',
  SDR_LEAD_DISTRIBUIDO: 'sdr.lead_distribuido',
  SDR_SEM_FIT: 'sdr.sem_fit',
  SDR_REUNIAO_AGENDADA: 'sdr.reuniao_agendada',
  SDR_NO_SHOW: 'sdr.no_show',
  SDR_LEAD_EXPIRADO: 'sdr.lead_expirado',
  VENDA_ESTAGIO_ALTERADO: 'venda.estagio_alterado',
  VENDA_PERDIDA: 'venda.perdida',
  VENDA_GANHA: 'venda.ganha',
  COMISSAO_APURADA: 'comissao.apurada',
  COMISSAO_APROVADA: 'comissao.aprovada',
  VENDEDOR_SEM_ATIVIDADE: 'vendedor.sem_atividade',

  // Motor de comissões v2 (04k)
  COMISSAO_LANCADA: 'comissao.lancada',
  /**
   * A cessão deixou de existir (status regrediu ou NF cancelada) e os lançamentos dela
   * foram espelhados em negativo. Evento próprio, e não um caso de "lançada": é dinheiro
   * saindo de alguém, e a única coisa pior que isso acontecer é acontecer em silêncio.
   */
  COMISSAO_ESTORNADA: 'comissao.estornada',
  COMPETENCIA_FECHADA: 'competencia.fechada',
  COMPETENCIA_APROVADA: 'competencia.aprovada',
  TITULARIDADE_ATRIBUIDA: 'titularidade.atribuida',
  TITULARIDADE_LIBERADA: 'titularidade.liberada',
  /** Sinalizador, nunca automação: a conta passiva desabou e merece ser OLHADA. */
  CONTA_REVISAO_SUGERIDA: 'conta.revisao_sugerida',
  SDR_ACEITE_PENDENTE: 'sdr.aceite_pendente',

  /*
   * Funil de cadastro de fornecedores (04l).
   *
   * `fornecedor.sem_interesse` NÃO está aqui: ele já existe desde a Antecipação, e é
   * o mesmo fato — alguém disse não e a supressão passou a valer. Um segundo tipo
   * para o mesmo evento partiria a timeline da empresa em duas metades que ninguém
   * cruzaria.
   */
  FORNECEDOR_ENTROU_FUNIL: 'fornecedor.entrou_funil',
  FORNECEDOR_CONTATOS_ENCONTRADOS: 'fornecedor.contatos_encontrados',
  FORNECEDOR_SEM_CONTATO: 'fornecedor.sem_contato',
  FORNECEDOR_CADASTRADO: 'fornecedor.cadastrado',
  APRESENTACAO_SOLICITADA: 'apresentacao.solicitada',
  ORCAMENTO_DESCOBERTA_ALERTA: 'orcamento_descoberta.alerta',

  // Ex-clientes pelas análises da plataforma (04h)
  CLIENTE_TORNOU_EX: 'cliente.tornou_ex',
  EXCLIENTE_CONFLITO_DADOS: 'excliente.conflito_dados',
  EXCLIENTE_MOTIVO_DEFINIDO: 'excliente.motivo_definido',
  ANALISE_PLATAFORMA_STATUS_ALTERADO: 'analise_plataforma.status_alterado',
  ANALISE_SEM_CADASTRO: 'analise.sem_cadastro',

  // Análise de crédito proprietária (04j)
  ANALISE_PROPRIA_INICIADA: 'analise_propria.iniciada',
  ANALISE_PROPRIA_AGUARDANDO_REVISAO: 'analise_propria.aguardando_revisao',
  ANALISE_PROPRIA_CONCLUIDA: 'analise_propria.concluida',
  ANALISE_PROPRIA_FALHOU: 'analise_propria.falhou',
  // Evento próprio, e não um caso de "concluída": duas leituras independentes
  // discordaram sobre o mesmo sacado, e isso é o que Crédito e Admin precisam ver antes
  // de qualquer número.
  ANALISE_PROPRIA_DIVERGENCIA: 'analise_propria.divergencia_seguradora',
  CREDITO_DECISAO_REGISTRADA: 'credito.decisao_registrada',
  REANALISE_SUGERIDA: 'reanalise.sugerida',

  /*
   * Jurídico (08).
   *
   * `processo.importado` e `processo.novo_detectado` NÃO são o mesmo fato, e a
   * distinção decide quem é avisado: o primeiro é a varredura por CNPJ trazendo
   * uma ação que já existia (rotina de importação), o segundo é o callback do
   * Escavador dizendo que apareceu uma ação NOVA contra nós — que é notícia para
   * os gestores, não para a fila de trabalho do jurídico.
   */
  PROCESSO_IMPORTADO: 'processo.importado',
  PROCESSO_NOVO_DETECTADO: 'processo.novo_detectado',
  PROCESSO_MOVIMENTACAO_RELEVANTE: 'processo.movimentacao_relevante',
  PROCESSO_FASE_ALTERADA: 'processo.fase_alterada',
  PROCESSO_FASE_LENTA: 'processo.fase_lenta',
  PROCESSO_SEM_MOVIMENTACAO: 'processo.sem_movimentacao',
  PROCESSO_ENCERRADO: 'processo.encerrado',
  CALCULO_GERADO: 'calculo.gerado',
  PARECER_GERADO: 'parecer.gerado',
  RECUPERACAO_REGISTRADA: 'recuperacao.registrada',

  /*
   * Comunicação (05A).
   *
   * `comunicacao.recebida` é evento de TIMELINE, não de sino: quem precisa saber
   * que chegou mensagem é o dono da thread, e o destinatário por linha sai por
   * `notify()` no worker. Uma regra de fan-out por perfil aqui daria a todo o
   * time comercial todas as conversas de todo mundo.
   *
   * `toque.manual` continua onde sempre esteve, na Antecipação: é o mesmo fato, e
   * um segundo tipo para ele partiria a timeline da empresa em duas metades.
   */
  COMUNICACAO_ENVIADA: 'comunicacao.enviada',
  COMUNICACAO_RECEBIDA: 'comunicacao.recebida',
  COMUNICACAO_FALHOU: 'comunicacao.falhou',
  CONVERSA_NAO_VINCULADA: 'conversa.nao_vinculada',
  CONVERSA_VINCULADA: 'conversa.vinculada',
  CONTATO_INDICADO: 'contato.indicado',
  // ─── Campanhas (05B) ──────────────────────────────────────────────────────
  CAMPANHA_APROVADA: 'campanha.aprovada',
  CAMPANHA_INICIADA: 'campanha.iniciada',
  CAMPANHA_PAUSADA: 'campanha.pausada',
  CAMPANHA_CONCLUIDA: 'campanha.concluida',
  CAMPANHA_DESTINATARIO_RESPONDEU: 'campanha.destinatario_respondeu',
  CAMPANHA_ALERTA_SAUDE: 'campanha.alerta_saude',

  AGENTE_DECIDIU: 'agente.decidiu',
  AGENTE_ESCALOU: 'agente.escalou',
  AGENTE_EXECUTOU: 'agente.executou',
  OPTOUT_REGISTRADO: 'optout.registrado',
} as const

export type EventoTipo = (typeof EVENTO_TIPOS)[keyof typeof EVENTO_TIPOS]

/**
 * pt-BR labels for the Company 360 timeline and the notifications bell.
 *
 * The Mercado events with no empresa_id (ingestão, importação) are SYSTEM events:
 * they carry `payload.titulo` and `payload.url`, which the fan-out trigger
 * (migration 0014) prefers over the company-derived title.
 */
export const EVENTO_LABELS: Record<string, string> = {
  'empresa.criada': 'Empresa criada',
  'estagio.alterado': 'Estágio alterado',
  'nota.criada': 'Nota adicionada',
  'camada.alterada': 'Camada alterada',
  'empresa.promovida': 'Promovida do universo',
  'mercado.ingestao_concluida': 'Ingestão concluída',
  'mercado.ingestao_falhou': 'Ingestão falhou',
  'importacao.concluida': 'Importação concluída',
  'importacao.revisao_pendente': 'Importação aguardando revisão',
  'dominio.resolvido': 'Domínio resolvido',
  'contatos.enriquecidos': 'Contatos enriquecidos',
  'protesto.detectado': 'Protesto detectado',
  'protesto.agravado': 'Protesto agravado',
  'grupo.protesto_agravado': 'Protesto do grupo agravado',
  'lote.aguardando_aprovacao': 'Lote aguardando aprovação',
  'lote.concluido': 'Lote concluído',
  'orcamento.alerta': 'Orçamento em alerta',
  'orcamento.estourado': 'Orçamento estourado',
  'cliente.novo_detectado': 'Novo cliente detectado',
  'cliente.dormente': 'Cliente dormente',
  'cliente.limite_quase_esgotado': 'Limite quase esgotado',
  'cliente.status_operacional_alterado': 'Status operacional alterado',
  'cliente.reativado': 'Cliente reativado',
  'metrica.declarada': 'Métrica declarada pelo cliente',
  'metrica.importada': 'Métrica de lista importada',
  'funcionarios.atualizado': 'Funcionários atualizados',
  'faturamento.reestimado': 'Faturamento reestimado',
  'estimador.recalibrado': 'Estimador recalibrado',
  'nf.sincronizada': 'Nota fiscal sincronizada',
  'nf.faixa_alterada': 'Faixa da nota alterada',
  'nf.expirada': 'Nota expirada',
  'nf.estagio_alterado': 'Estágio da nota alterado',
  'nf.convertida': 'Nota convertida',
  'nf.perdida': 'Nota perdida',
  'fornecedor.sem_interesse': 'Fornecedor sem interesse',
  'fornecedor.tipagem_alterada': 'Tipagem do fornecedor alterada',
  'sacado.limite_insuficiente': 'Limite do sacado insuficiente',
  'sacado.credito_alterado': 'Crédito do sacado alterado',
  'outbox.mensagem_gerada': 'Mensagem gerada na outbox',
  'toque.manual': 'Toque manual',
  'contato.ponto_focal_definido': 'Ponto focal definido',
  'cnpj.lookup_nao_encontrado': 'CNPJ não encontrado no lookup cadastral',
  'antecipacao.sincronizada': 'Antecipação sincronizada',
  'antecipacao.status_alterado': 'Status da antecipação alterado',
  'antecipacao.casada': 'Antecipação casada com a nota',
  'antecipacao.sem_nf': 'Antecipação sem nota correspondente',
  'antecipacao.regrediu': 'Antecipação regrediu — conversão em disputa',
  'certificado.vencendo': 'Certificado digital vencendo',
  'certificado.vencido': 'Certificado digital vencido',
  'certificado.renovado': 'Certificado digital renovado',
  'analise.solicitada': 'Análise de crédito solicitada',
  'analise.movida': 'Análise de crédito movida',
  'analise.enviada': 'Análise enviada à seguradora',
  'analise.aprovada': 'Análise de crédito aprovada',
  'analise.aprovada_parcial': 'Análise aprovada parcialmente',
  'analise.negada': 'Análise de crédito negada',
  'analise.expirada': 'Análise de crédito expirada',
  'analise.limite_reduzido': 'Limite reduzido pela seguradora',
  'score.recalculado': 'Score de crédito recalculado',
  'credito.potencial_atualizado': 'Potencial de crédito atualizado',
  'perfil.recalculado': 'Perfil dos Clientes recalculado',
  'perfil.sugestao_aceita': 'Sugestão do perfil aceita',
  'perfil.sugestao_descartada': 'Sugestão do perfil descartada',
  'cliente.gestao_alterada': 'Gestão da conta alterada',
  'sdr.lead_distribuido': 'Lead distribuído',
  'sdr.sem_fit': 'Lead sem fit',
  'sdr.reuniao_agendada': 'Reunião agendada',
  'sdr.no_show': 'No-show na reunião',
  'sdr.lead_expirado': 'Lead expirado e devolvido ao pool',
  'venda.estagio_alterado': 'Venda mudou de estágio',
  'venda.perdida': 'Venda perdida',
  'venda.ganha': 'Venda ganha',
  'comissao.apurada': 'Comissão apurada',
  'comissao.aprovada': 'Comissão aprovada',
  'vendedor.sem_atividade': 'Vendedor sem atividade',
  'comissao.lancada': 'Comissão lançada',
  'comissao.estornada': 'Comissão estornada',
  'competencia.fechada': 'Competência fechada',
  'competencia.aprovada': 'Competência aprovada',
  'titularidade.atribuida': 'Titularidade atribuída',
  'titularidade.liberada': 'Titularidade liberada',
  'conta.revisao_sugerida': 'Revisão de classificação sugerida',
  'sdr.aceite_pendente': 'Reunião aguardando aceite',
  'fornecedor.entrou_funil': 'Fornecedor entrou no funil de cadastro',
  'fornecedor.contatos_encontrados': 'Contatos do fornecedor encontrados',
  'fornecedor.sem_contato': 'Fornecedor sem contato encontrado',
  'fornecedor.cadastrado': 'Fornecedor cadastrado na plataforma',
  'apresentacao.solicitada': 'Apresentação pedida ao sacado',
  'orcamento_descoberta.alerta': 'Orçamento de descoberta em alerta',
  'cliente.tornou_ex': 'Virou ex-cliente',
  'excliente.conflito_dados': 'Ex-cliente com dado conflitante',
  'excliente.motivo_definido': 'Motivo de saída definido',
  'analise_plataforma.status_alterado': 'Análise da plataforma mudou de status',
  'analise.sem_cadastro': 'Análise aprovada sem cadastro',
  'analise_propria.iniciada': 'Análise proprietária iniciada',
  'analise_propria.aguardando_revisao': 'Extração aguardando revisão',
  'analise_propria.concluida': 'Análise proprietária concluída',
  'analise_propria.falhou': 'Análise proprietária falhou',
  'analise_propria.divergencia_seguradora': 'Divergência com a seguradora',
  'credito.decisao_registrada': 'Decisão de crédito registrada',
  'reanalise.sugerida': 'Reanálise sugerida',
  'processo.importado': 'Processo judicial importado',
  'processo.novo_detectado': 'Novo processo detectado contra nós',
  'processo.movimentacao_relevante': 'Movimentação relevante no processo',
  'processo.fase_alterada': 'Processo mudou de fase',
  'processo.fase_lenta': 'Fase do processo estourou o prazo esperado',
  'processo.sem_movimentacao': 'Processo parado',
  'processo.encerrado': 'Processo encerrado',
  'calculo.gerado': 'Cálculo da dívida gerado',
  'parecer.gerado': 'Parecer jurídico gerado',
  'recuperacao.registrada': 'Recuperação registrada',
  'comunicacao.enviada': 'Mensagem enviada',
  'comunicacao.recebida': 'Mensagem recebida',
  'comunicacao.falhou': 'Falha ao enviar mensagem',
  'conversa.nao_vinculada': 'Conversa aguardando identificação',
  'conversa.vinculada': 'Conversa identificada',
  'contato.indicado': 'Outro contato foi indicado',
  'agente.decidiu': 'Agente sugeriu um próximo passo',
  'agente.escalou': 'Agente escalou para humano',
  'agente.executou': 'Agente executou o próximo passo',
  'optout.registrado': 'Pedido de descadastro registrado',
}

/** Which layer auto-promotes into `empresas`. Settings override it (§5.1). */
export const CAMADA_PROMOCAO_PADRAO = 'sam'
