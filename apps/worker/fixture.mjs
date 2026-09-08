const ind = (m, semana, mes, mediaSem, varSem, pior = false, un = 'brl') => ({
  metrica: m, unidade: un, subir_e_pior: pior, semana, mes,
  doze_total: mediaSem * 13, doze_media_mensal: mediaSem * 4.33, doze_media_semanal: mediaSem,
  meses_com_dado: 3, var_semana_pct: varSem, var_mes_pct: -41.4,
})
export const r = {
  periodo: {
    inicio: '2026-08-31', fim: '2026-09-06', semana_iso: 36, ano: 2026,
    mes_inicio: '2026-09-01', mes_dias_decorridos: 6, mes_dias_total: 30,
    base_12m_de: '2025-10-01', base_12m_ate: '2026-09-01', gerado_em: '2026-09-06T22:00:00Z',
  },
  operacao: {
    kpis: {
      volume_convertido: ind('volume_convertido', 9771906, 7617274, 3000516, 225.7),
      vop_operado: ind('vop_operado', 16849085, 14339111, 5968015, 182.3),
      receita: ind('receita', 533909, 451752, 187418, 184.9),
      limite_ocioso: { metrica: 'limite_ocioso', unidade: 'brl', subir_e_pior: true, foto: 59684416, sem_serie: true },
    },
    antecipacao: {
      volume: ind('volume_convertido', 9771906, 7617274, 3000516, 225.7),
      vop: ind('vop_operado', 16849085, 14339111, 5968015, 182.3),
      receita: ind('receita', 533909, 451752, 187418, 184.9),
      operacoes_semana: 232, operacoes_mes: 203, cedentes_semana: 198, cedentes_mes: 174,
      ticket_medio_semana: 42120.29, ticket_medio_mes: 37523.52,
      prazo_medio_semana: 51.7, prazo_medio_mes: 56.5, prazo_medio_12m: 59.7,
      top_cedentes: [],
    },
    nf: {
      capturadas: ind('nfs_capturadas', 8360, 6947, 4687, 78.4, false, 'unidades'),
      valor_capturado: ind('nf_valor_capturado', 165042490, 144554715, 79680979, 107.1),
      valor_expirado: ind('nf_valor_expirado', 116040503, 110620875, 56576803, 105.1, true),
      por_faixa: [
        { faixa: 'alta', entradas_semana: 93, valor_semana: 2702623, convertidas_semana: 9, conversao_semana_pct: 9.7, entradas_mes: 72, conversao_mes_pct: 9.7, entradas_12m: 249, conversao_12m_pct: 47.0 },
        { faixa: 'boa', entradas_semana: 717, valor_semana: 7664430, convertidas_semana: 0, conversao_semana_pct: 0, entradas_mes: 630, conversao_mes_pct: 0, entradas_12m: 1325, conversao_12m_pct: 0.1 },
        { faixa: 'media', entradas_semana: 3492, valor_semana: 63869575, convertidas_semana: 0, conversao_semana_pct: 0, entradas_mes: 2911, conversao_mes_pct: 0, entradas_12m: 6929, conversao_12m_pct: 0.1 },
        { faixa: 'sem_faixa', entradas_semana: 4058, valor_semana: 90805860, convertidas_semana: 7, conversao_semana_pct: 0.2, entradas_mes: 3334, conversao_mes_pct: 0.2, entradas_12m: 52450, conversao_12m_pct: 0.1 },
      ],
      travadas: { total: 60, valor: 1348412, itens: [] },
    },
  },
  comercial: {
    funil: {
      semana: { distribuidos: 15, contatados: 0, com_fit: 0, agendados: 0, realizados: 0, ganhos: 0,
        passagem: { contato_pct: 0, fit_pct: null, agenda_pct: null, realiza_pct: null, ganho_pct: null } },
      doze: { distribuidos: 19, contatados: 1, com_fit: 0, agendados: 1, realizados: 0, ganhos: 0,
        passagem: { contato_pct: 5.3, fit_pct: 0, agenda_pct: null, realiza_pct: 0, ganho_pct: null } },
    },
    comercial: {
      leads_semana: 15, leads_inbound: 14, leads_outbound: 1, fit_avaliados: 0, fit_pct: null,
      reunioes_agendadas: ind('reunioes_agendadas', 0, 0, 0.23, -100, false, 'unidades'),
      reunioes_realizadas: 0, no_shows_nao_remarcados: 0, mous: 0,
      ciclo_medio_dias: null, ciclo_medio_base: 0,
    },
    credito: {
      solicitadas_semana: 1, aprovadas_semana: 1, negadas_semana: 0,
      limite_concedido: ind('limite_concedido', 0, 0, 1011820, -100),
      aprovacao_pct: 100, esteira_dias: 18.9, esteira_base: 1,
      esteira_gargalo: 'solicitada', divergencias_seguradora: 1,
    },
    time: {
      vendedores: [
        { vendedor_id: '1', nome: 'Fabio Pagliarani', tipo: 'vendedor', reunioes: 0, conversoes: 42, vop: 6220471, comissao: 2412.5 },
        { vendedor_id: '2', nome: 'Rodrigo Alves', tipo: 'originador', reunioes: 0, conversoes: 6, vop: 196232, comissao: 117.75 },
        { vendedor_id: '3', nome: 'Pamela Oliveira', tipo: 'auxiliar', reunioes: 0, conversoes: 0, vop: 0, comissao: 0 },
      ],
      filas: { inbound_sem_contato: 15, docs_parados: 1, conversas_sem_resposta: 32 },
    },
  },
  carteira: {
    carteira: { clientes: 55, operaram_semana: 198, limite_total: 104881937, limite_ocioso: 59684416,
      utilizacao_pct: 43.1, inoperantes: 6, novos_semana: 1, sairam_semana: 0 },
    listas: {
      nao_performando: [
        { cliente: 'RIBEIRO CARAM', gestor: 'Fabio Pagliarani', ocioso: 6361447, dias_sem_operar: 4 },
        { cliente: 'VL CONSTRUTORA LTDA', gestor: 'Fabio Pagliarani', ocioso: 2756156, dias_sem_operar: 2 },
        { cliente: 'ONE CONSTRUCTION LTDA', gestor: null, ocioso: 2668343, dias_sem_operar: 2 },
        { cliente: 'VALKA CONSTRUCOES S.A.', gestor: null, ocioso: 2256033, dias_sem_operar: 604 },
      ],
      novos_clientes: [], sairam: [],
    },
    certificados: {
      cnpjs: 1030, cobertos: 20, vencendo_30d: 0, sem_certificado: 1010, cobertura_pct: 1.9,
      matrizes: 51, matrizes_cobertas: 8, spes: 979, spes_cobertas: 12,
      invisivel: {
        razao: 0.1011, razao_base: 16, grupos_cegos: 30, total_mes_do_topo: 33689622, topo: 15,
        itens: [
          { grupo: 'COSAMPA CONSTRUÇÕES', cnpjs_no_grupo: 38, faturamento_estimado: 1130985000, invisivel_mes: 9524947 },
          { grupo: 'CONSTRUTORA ATERPA S/A.', cnpjs_no_grupo: 20, faturamento_estimado: 816307000, invisivel_mes: 6874787 },
          { grupo: 'CONSTRUTORA E INCORPORADORA PRIDE S.A.', cnpjs_no_grupo: 371, faturamento_estimado: 357506000, invisivel_mes: 3010849 },
        ],
      },
    },
    atencao: { protestos_novos: 21, lotes_aguardando: 1, limites_reduzidos: 0, antecipacoes_travadas: 60,
      ex_clientes_sem_motivo: 0, processos_com_movimento: 12, fornecedores_sem_contato: 6,
      certificados_vencendo_30d: 0, sugestoes_perfil_pendentes: 0 },
  },
}
