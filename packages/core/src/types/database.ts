export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      acordos: {
        Row: {
          cobranca_id: string
          criado_em: string
          criado_por: string | null
          dados_minuta: Json
          documento_assinado_path: string | null
          entrada: number
          id: string
          juros_parcelamento_mes: number
          memoria_calculo: Json
          minuta_hash: string | null
          minuta_path: string | null
          modelo_minuta_id: string | null
          parcelas: Json
          periodicidade: string
          primeira_parcela: string | null
          qtd_parcelas: number
          sistema: string
          status: string
          valor_atualizado: number
          valor_total_projetado: number | null
        }
        Insert: {
          cobranca_id: string
          criado_em?: string
          criado_por?: string | null
          dados_minuta?: Json
          documento_assinado_path?: string | null
          entrada?: number
          id?: string
          juros_parcelamento_mes?: number
          memoria_calculo: Json
          minuta_hash?: string | null
          minuta_path?: string | null
          modelo_minuta_id?: string | null
          parcelas: Json
          periodicidade?: string
          primeira_parcela?: string | null
          qtd_parcelas?: number
          sistema?: string
          status?: string
          valor_atualizado: number
          valor_total_projetado?: number | null
        }
        Update: {
          cobranca_id?: string
          criado_em?: string
          criado_por?: string | null
          dados_minuta?: Json
          documento_assinado_path?: string | null
          entrada?: number
          id?: string
          juros_parcelamento_mes?: number
          memoria_calculo?: Json
          minuta_hash?: string | null
          minuta_path?: string | null
          modelo_minuta_id?: string | null
          parcelas?: Json
          periodicidade?: string
          primeira_parcela?: string | null
          qtd_parcelas?: number
          sistema?: string
          status?: string
          valor_atualizado?: number
          valor_total_projetado?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "acordos_cobranca_id_fkey"
            columns: ["cobranca_id"]
            isOneToOne: false
            referencedRelation: "cobranca_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acordos_cobranca_id_fkey"
            columns: ["cobranca_id"]
            isOneToOne: false
            referencedRelation: "cobrancas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acordos_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acordos_modelo_minuta_id_fkey"
            columns: ["modelo_minuta_id"]
            isOneToOne: false
            referencedRelation: "cobranca_modelos"
            referencedColumns: ["id"]
          },
        ]
      }
      advogados: {
        Row: {
          ativo: boolean
          atualizado_em: string
          criado_em: string
          email: string | null
          escritorio: string | null
          id: string
          nome: string
          oab_numero: string | null
          oab_uf: string | null
          telefone: string | null
          tipo: string
          usuario_id: string | null
        }
        Insert: {
          ativo?: boolean
          atualizado_em?: string
          criado_em?: string
          email?: string | null
          escritorio?: string | null
          id?: string
          nome: string
          oab_numero?: string | null
          oab_uf?: string | null
          telefone?: string | null
          tipo: string
          usuario_id?: string | null
        }
        Update: {
          ativo?: boolean
          atualizado_em?: string
          criado_em?: string
          email?: string | null
          escritorio?: string | null
          id?: string
          nome?: string
          oab_numero?: string | null
          oab_uf?: string | null
          telefone?: string | null
          tipo?: string
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "advogados_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      agenda_reservas: {
        Row: {
          closer_id: string
          confirmada_em: string | null
          criada_em: string
          expira_em: string
          fim: string
          id: string
          inicio: string
          mandato_id: string | null
        }
        Insert: {
          closer_id: string
          confirmada_em?: string | null
          criada_em?: string
          expira_em: string
          fim: string
          id?: string
          inicio: string
          mandato_id?: string | null
        }
        Update: {
          closer_id?: string
          confirmada_em?: string | null
          criada_em?: string
          expira_em?: string
          fim?: string
          id?: string
          inicio?: string
          mandato_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agenda_reservas_closer_id_fkey"
            columns: ["closer_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agenda_reservas_mandato_id_fkey"
            columns: ["mandato_id"]
            isOneToOne: false
            referencedRelation: "mandatos"
            referencedColumns: ["id"]
          },
        ]
      }
      agente_decisoes: {
        Row: {
          acao: string
          aceita_por: string | null
          canal: string | null
          confianca: number | null
          conteudo_sugerido: string | null
          contexto_resumo: Json
          conversa_id: string | null
          criado_em: string
          descartada: boolean
          desfecho: string | null
          desfecho_em: string | null
          executada: boolean
          executada_em: string | null
          gatilho: string
          id: string
          justificativa: string | null
          modelo: string | null
          modo: string
          playbook_id: string | null
          quando: string | null
          tokens: number | null
        }
        Insert: {
          acao: string
          aceita_por?: string | null
          canal?: string | null
          confianca?: number | null
          conteudo_sugerido?: string | null
          contexto_resumo?: Json
          conversa_id?: string | null
          criado_em?: string
          descartada?: boolean
          desfecho?: string | null
          desfecho_em?: string | null
          executada?: boolean
          executada_em?: string | null
          gatilho: string
          id?: string
          justificativa?: string | null
          modelo?: string | null
          modo: string
          playbook_id?: string | null
          quando?: string | null
          tokens?: number | null
        }
        Update: {
          acao?: string
          aceita_por?: string | null
          canal?: string | null
          confianca?: number | null
          conteudo_sugerido?: string | null
          contexto_resumo?: Json
          conversa_id?: string | null
          criado_em?: string
          descartada?: boolean
          desfecho?: string | null
          desfecho_em?: string | null
          executada?: boolean
          executada_em?: string | null
          gatilho?: string
          id?: string
          justificativa?: string | null
          modelo?: string | null
          modo?: string
          playbook_id?: string | null
          quando?: string | null
          tokens?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "agente_decisoes_aceita_por_fkey"
            columns: ["aceita_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agente_decisoes_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "conversas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agente_decisoes_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "inbox_conversas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agente_decisoes_playbook_id_fkey"
            columns: ["playbook_id"]
            isOneToOne: false
            referencedRelation: "agente_playbooks"
            referencedColumns: ["id"]
          },
        ]
      }
      agente_playbooks: {
        Row: {
          acoes_permitidas: string[]
          ativo: boolean
          atualizado_em: string
          criado_em: string
          funil: string
          id: string
          instrucoes: string
          nome: string
          objetivo: string
          prazos: Json
          templates_disponiveis: string[]
          tipo_mandato: string | null
          versao: number
        }
        Insert: {
          acoes_permitidas: string[]
          ativo?: boolean
          atualizado_em?: string
          criado_em?: string
          funil: string
          id?: string
          instrucoes: string
          nome: string
          objetivo: string
          prazos?: Json
          templates_disponiveis?: string[]
          tipo_mandato?: string | null
          versao?: number
        }
        Update: {
          acoes_permitidas?: string[]
          ativo?: boolean
          atualizado_em?: string
          criado_em?: string
          funil?: string
          id?: string
          instrucoes?: string
          nome?: string
          objetivo?: string
          prazos?: Json
          templates_disponiveis?: string[]
          tipo_mandato?: string | null
          versao?: number
        }
        Relationships: []
      }
      agentes_config: {
        Row: {
          atualizado_em: string
          atualizado_por: string | null
          chave: string
          valor: Json
        }
        Insert: {
          atualizado_em?: string
          atualizado_por?: string | null
          chave: string
          valor: Json
        }
        Update: {
          atualizado_em?: string
          atualizado_por?: string | null
          chave?: string
          valor?: Json
        }
        Relationships: [
          {
            foreignKeyName: "agentes_config_atualizado_por_fkey"
            columns: ["atualizado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      agentes_disjuntor: {
        Row: {
          aberto_detalhe: Json | null
          aberto_em: string | null
          aberto_motivo: string | null
          agente_id: string
          avaliado_em: string | null
          estado: string
          janela_acoes: number
          janela_desde: string
          limiar_escalacao: number
          limiar_falha_tecnica: number
          limiar_sem_interesse: number
          limiar_supressao: number
          reaberto_em: string | null
          reaberto_por: string | null
        }
        Insert: {
          aberto_detalhe?: Json | null
          aberto_em?: string | null
          aberto_motivo?: string | null
          agente_id: string
          avaliado_em?: string | null
          estado?: string
          janela_acoes?: number
          janela_desde?: string
          limiar_escalacao?: number
          limiar_falha_tecnica?: number
          limiar_sem_interesse?: number
          limiar_supressao?: number
          reaberto_em?: string | null
          reaberto_por?: string | null
        }
        Update: {
          aberto_detalhe?: Json | null
          aberto_em?: string | null
          aberto_motivo?: string | null
          agente_id?: string
          avaliado_em?: string | null
          estado?: string
          janela_acoes?: number
          janela_desde?: string
          limiar_escalacao?: number
          limiar_falha_tecnica?: number
          limiar_sem_interesse?: number
          limiar_supressao?: number
          reaberto_em?: string | null
          reaberto_por?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agentes_disjuntor_agente_id_fkey"
            columns: ["agente_id"]
            isOneToOne: true
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agentes_disjuntor_reaberto_por_fkey"
            columns: ["reaberto_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      agentes_orcamento: {
        Row: {
          alertas_enviados: number[]
          atualizado_em: string
          consumido_centavos: number
          id: string
          mes: string
          reservado_centavos: number
          teto_centavos: number
        }
        Insert: {
          alertas_enviados?: number[]
          atualizado_em?: string
          consumido_centavos?: number
          id?: string
          mes: string
          reservado_centavos?: number
          teto_centavos: number
        }
        Update: {
          alertas_enviados?: number[]
          atualizado_em?: string
          consumido_centavos?: number
          id?: string
          mes?: string
          reservado_centavos?: number
          teto_centavos?: number
        }
        Relationships: []
      }
      agentes_orcamento_movimentos: {
        Row: {
          acao_id: string | null
          agente_id: string | null
          criado_em: string
          ferramenta: string | null
          id: string
          liquidada: boolean
          mandato_id: string | null
          mes: string
          reserva_id: string | null
          tipo: string
          valor_centavos: number
        }
        Insert: {
          acao_id?: string | null
          agente_id?: string | null
          criado_em?: string
          ferramenta?: string | null
          id?: string
          liquidada?: boolean
          mandato_id?: string | null
          mes: string
          reserva_id?: string | null
          tipo: string
          valor_centavos: number
        }
        Update: {
          acao_id?: string | null
          agente_id?: string | null
          criado_em?: string
          ferramenta?: string | null
          id?: string
          liquidada?: boolean
          mandato_id?: string | null
          mes?: string
          reserva_id?: string | null
          tipo?: string
          valor_centavos?: number
        }
        Relationships: [
          {
            foreignKeyName: "agentes_orcamento_movimentos_acao_id_fkey"
            columns: ["acao_id"]
            isOneToOne: false
            referencedRelation: "mandato_acoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agentes_orcamento_movimentos_agente_id_fkey"
            columns: ["agente_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agentes_orcamento_movimentos_mandato_id_fkey"
            columns: ["mandato_id"]
            isOneToOne: false
            referencedRelation: "mandatos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agentes_orcamento_movimentos_reserva_id_fkey"
            columns: ["reserva_id"]
            isOneToOne: false
            referencedRelation: "agentes_orcamento_movimentos"
            referencedColumns: ["id"]
          },
        ]
      }
      analise_contestacoes: {
        Row: {
          analise_id: string
          analise_item_id: string
          contestado_por: string
          criada_em: string
          id: string
          justificativa: string | null
          resposta_gestor: string | null
          revisada_em: string | null
          revisada_por: string | null
          rotulo_humano: string | null
          veredito: string | null
        }
        Insert: {
          analise_id: string
          analise_item_id: string
          contestado_por: string
          criada_em?: string
          id?: string
          justificativa?: string | null
          resposta_gestor?: string | null
          revisada_em?: string | null
          revisada_por?: string | null
          rotulo_humano?: string | null
          veredito?: string | null
        }
        Update: {
          analise_id?: string
          analise_item_id?: string
          contestado_por?: string
          criada_em?: string
          id?: string
          justificativa?: string | null
          resposta_gestor?: string | null
          revisada_em?: string | null
          revisada_por?: string | null
          rotulo_humano?: string | null
          veredito?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "analise_contestacoes_analise_id_fkey"
            columns: ["analise_id"]
            isOneToOne: false
            referencedRelation: "analises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analise_contestacoes_analise_item_id_fkey"
            columns: ["analise_item_id"]
            isOneToOne: false
            referencedRelation: "analise_itens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analise_contestacoes_contestado_por_fkey"
            columns: ["contestado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analise_contestacoes_revisada_por_fkey"
            columns: ["revisada_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      analise_docs: {
        Row: {
          analise_id: string
          arquivo_url: string
          enviado_em: string
          enviado_por: string | null
          enviado_seguradora_em: string | null
          envio_seguradora_erro: string | null
          exercicio: number | null
          external_id: string | null
          extraido_em: string | null
          id: string
          nome_arquivo: string | null
          origem: string
          paginas: number | null
          tipo: string
        }
        Insert: {
          analise_id: string
          arquivo_url: string
          enviado_em?: string
          enviado_por?: string | null
          enviado_seguradora_em?: string | null
          envio_seguradora_erro?: string | null
          exercicio?: number | null
          external_id?: string | null
          extraido_em?: string | null
          id?: string
          nome_arquivo?: string | null
          origem?: string
          paginas?: number | null
          tipo: string
        }
        Update: {
          analise_id?: string
          arquivo_url?: string
          enviado_em?: string
          enviado_por?: string | null
          enviado_seguradora_em?: string | null
          envio_seguradora_erro?: string | null
          exercicio?: number | null
          external_id?: string | null
          extraido_em?: string | null
          id?: string
          nome_arquivo?: string | null
          origem?: string
          paginas?: number | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "analise_docs_analise_id_fkey"
            columns: ["analise_id"]
            isOneToOne: false
            referencedRelation: "analise_vigente"
            referencedColumns: ["analise_id"]
          },
          {
            foreignKeyName: "analise_docs_analise_id_fkey"
            columns: ["analise_id"]
            isOneToOne: false
            referencedRelation: "analises_credito"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analise_docs_enviado_por_fkey"
            columns: ["enviado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      analise_itens: {
        Row: {
          analise_id: string
          aplicabilidade_prob: number | null
          aplicavel: boolean
          atendido: boolean | null
          atendido_original: boolean | null
          banda_cinzenta: boolean
          chave: string
          citacao: string | null
          contestado: boolean
          corrigido_em: string | null
          divergente: boolean
          em_sombra: boolean
          id: string
          item_id: string
          limiar_usado: number | null
          orientacao: string | null
          peso: number
          prob_atendido: number | null
          probabilidade: number | null
          provedor: string | null
          resultado: string | null
          revisao_pendente: boolean
        }
        Insert: {
          analise_id: string
          aplicabilidade_prob?: number | null
          aplicavel: boolean
          atendido?: boolean | null
          atendido_original?: boolean | null
          banda_cinzenta?: boolean
          chave: string
          citacao?: string | null
          contestado?: boolean
          corrigido_em?: string | null
          divergente?: boolean
          em_sombra?: boolean
          id?: string
          item_id: string
          limiar_usado?: number | null
          orientacao?: string | null
          peso: number
          prob_atendido?: number | null
          probabilidade?: number | null
          provedor?: string | null
          resultado?: string | null
          revisao_pendente?: boolean
        }
        Update: {
          analise_id?: string
          aplicabilidade_prob?: number | null
          aplicavel?: boolean
          atendido?: boolean | null
          atendido_original?: boolean | null
          banda_cinzenta?: boolean
          chave?: string
          citacao?: string | null
          contestado?: boolean
          corrigido_em?: string | null
          divergente?: boolean
          em_sombra?: boolean
          id?: string
          item_id?: string
          limiar_usado?: number | null
          orientacao?: string | null
          peso?: number
          prob_atendido?: number | null
          probabilidade?: number | null
          provedor?: string | null
          resultado?: string | null
          revisao_pendente?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "analise_itens_analise_id_fkey"
            columns: ["analise_id"]
            isOneToOne: false
            referencedRelation: "analises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analise_itens_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "rubrica_itens"
            referencedColumns: ["id"]
          },
        ]
      }
      analise_fila: {
        Row: {
          analise_id: string | null
          conversa_id: string | null
          criada_em: string
          erro: string | null
          escopo: string
          id: string
          janela_fim: string | null
          janela_inicio: string | null
          janela_mensagens: number | null
          processada_em: string | null
          reuniao_id: string | null
          status: string
          tentar_apos: string
          tentativas: number
          voz_ligacao_id: string | null
        }
        Insert: {
          analise_id?: string | null
          conversa_id?: string | null
          criada_em?: string
          erro?: string | null
          escopo: string
          id?: string
          janela_fim?: string | null
          janela_inicio?: string | null
          janela_mensagens?: number | null
          processada_em?: string | null
          reuniao_id?: string | null
          status?: string
          tentar_apos?: string
          tentativas?: number
          voz_ligacao_id?: string | null
        }
        Update: {
          analise_id?: string | null
          conversa_id?: string | null
          criada_em?: string
          erro?: string | null
          escopo?: string
          id?: string
          janela_fim?: string | null
          janela_inicio?: string | null
          janela_mensagens?: number | null
          processada_em?: string | null
          reuniao_id?: string | null
          status?: string
          tentar_apos?: string
          tentativas?: number
          voz_ligacao_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "analise_fila_analise_id_fkey"
            columns: ["analise_id"]
            isOneToOne: false
            referencedRelation: "analises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analise_fila_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "conversas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analise_fila_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "inbox_conversas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analise_fila_reuniao_id_fkey"
            columns: ["reuniao_id"]
            isOneToOne: false
            referencedRelation: "reunioes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analise_fila_voz_ligacao_id_fkey"
            columns: ["voz_ligacao_id"]
            isOneToOne: false
            referencedRelation: "voz_ligacoes"
            referencedColumns: ["id"]
          },
        ]
      }
      analise_parametros: {
        Row: {
          ativa: boolean
          criada_em: string
          criada_por: string | null
          definicao: Json
          nome: string | null
          versao: number
        }
        Insert: {
          ativa?: boolean
          criada_em?: string
          criada_por?: string | null
          definicao: Json
          nome?: string | null
          versao: number
        }
        Update: {
          ativa?: boolean
          criada_em?: string
          criada_por?: string | null
          definicao?: Json
          nome?: string | null
          versao?: number
        }
        Relationships: [
          {
            foreignKeyName: "analise_parametros_criada_por_fkey"
            columns: ["criada_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      analises: {
        Row: {
          agente_id: string | null
          analisada_em: string
          caiu_para_claude: boolean
          contato_id: string | null
          conversa_id: string | null
          custo_centavos: number
          custo_claude_centavos: number
          custo_jev_centavos: number
          empresa_id: string | null
          escopo: string
          explicacao: string | null
          id: string
          itens_aplicaveis: number | null
          itens_atendidos: number | null
          janela_fim: string | null
          janela_inicio: string | null
          janela_mensagens: number | null
          modo: string
          provedor: string
          publicada_em: string | null
          reuniao_id: string | null
          rubrica_id: string
          rubrica_versao: number
          score: number | null
          score_sombra: number | null
          tokens_entrada: number | null
          tokens_saida: number | null
          vendedor_id: string | null
          voz_ligacao_id: string | null
        }
        Insert: {
          agente_id?: string | null
          analisada_em?: string
          caiu_para_claude?: boolean
          contato_id?: string | null
          conversa_id?: string | null
          custo_centavos?: number
          custo_claude_centavos?: number
          custo_jev_centavos?: number
          empresa_id?: string | null
          escopo: string
          explicacao?: string | null
          id?: string
          itens_aplicaveis?: number | null
          itens_atendidos?: number | null
          janela_fim?: string | null
          janela_inicio?: string | null
          janela_mensagens?: number | null
          modo?: string
          provedor: string
          publicada_em?: string | null
          reuniao_id?: string | null
          rubrica_id: string
          rubrica_versao: number
          score?: number | null
          score_sombra?: number | null
          tokens_entrada?: number | null
          tokens_saida?: number | null
          vendedor_id?: string | null
          voz_ligacao_id?: string | null
        }
        Update: {
          agente_id?: string | null
          analisada_em?: string
          caiu_para_claude?: boolean
          contato_id?: string | null
          conversa_id?: string | null
          custo_centavos?: number
          custo_claude_centavos?: number
          custo_jev_centavos?: number
          empresa_id?: string | null
          escopo?: string
          explicacao?: string | null
          id?: string
          itens_aplicaveis?: number | null
          itens_atendidos?: number | null
          janela_fim?: string | null
          janela_inicio?: string | null
          janela_mensagens?: number | null
          modo?: string
          provedor?: string
          publicada_em?: string | null
          reuniao_id?: string | null
          rubrica_id?: string
          rubrica_versao?: number
          score?: number | null
          score_sombra?: number | null
          tokens_entrada?: number | null
          tokens_saida?: number | null
          vendedor_id?: string | null
          voz_ligacao_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "analises_agente_id_fkey"
            columns: ["agente_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analises_contato_id_fkey"
            columns: ["contato_id"]
            isOneToOne: false
            referencedRelation: "contatos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analises_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "conversas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analises_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "inbox_conversas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analises_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "analises_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "analises_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "analises_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "analises_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analises_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "analises_reuniao_id_fkey"
            columns: ["reuniao_id"]
            isOneToOne: false
            referencedRelation: "reunioes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analises_rubrica_id_fkey"
            columns: ["rubrica_id"]
            isOneToOne: false
            referencedRelation: "rubricas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analises_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analises_voz_ligacao_id_fkey"
            columns: ["voz_ligacao_id"]
            isOneToOne: false
            referencedRelation: "voz_ligacoes"
            referencedColumns: ["id"]
          },
        ]
      }
      analises_credito: {
        Row: {
          analise_propria_id: string | null
          atradius_buyer_id: string | null
          atradius_case_id: string | null
          atualizada_em: string
          cnpj: string
          codigo_decisao: string | null
          codigo_historico: string | null
          contato_externo: Json | null
          criada_em: string
          decidida_em: string | null
          decisao_interna: string | null
          decisao_interna_em: string | null
          empresa_id: string | null
          envio_manual_em: string | null
          envio_manual_por: string | null
          estagio: string
          expira_em: string | null
          expirada_em: string | null
          external_id: string | null
          id: string
          limite_aprovado: number | null
          limite_operacional: number | null
          limite_solicitado: number | null
          moeda: string
          motivo: string | null
          observacoes: string | null
          origem: string
          origem_externa: string | null
          origem_motivo: string | null
          rating_classe_seguradora: string | null
          rating_seguradora: string | null
          seguradora: string
          solicitada_por: string | null
          substituida_em: string | null
          substituida_por: string | null
        }
        Insert: {
          analise_propria_id?: string | null
          atradius_buyer_id?: string | null
          atradius_case_id?: string | null
          atualizada_em?: string
          cnpj: string
          codigo_decisao?: string | null
          codigo_historico?: string | null
          contato_externo?: Json | null
          criada_em?: string
          decidida_em?: string | null
          decisao_interna?: string | null
          decisao_interna_em?: string | null
          empresa_id?: string | null
          envio_manual_em?: string | null
          envio_manual_por?: string | null
          estagio?: string
          expira_em?: string | null
          expirada_em?: string | null
          external_id?: string | null
          id?: string
          limite_aprovado?: number | null
          limite_operacional?: number | null
          limite_solicitado?: number | null
          moeda?: string
          motivo?: string | null
          observacoes?: string | null
          origem?: string
          origem_externa?: string | null
          origem_motivo?: string | null
          rating_classe_seguradora?: string | null
          rating_seguradora?: string | null
          seguradora?: string
          solicitada_por?: string | null
          substituida_em?: string | null
          substituida_por?: string | null
        }
        Update: {
          analise_propria_id?: string | null
          atradius_buyer_id?: string | null
          atradius_case_id?: string | null
          atualizada_em?: string
          cnpj?: string
          codigo_decisao?: string | null
          codigo_historico?: string | null
          contato_externo?: Json | null
          criada_em?: string
          decidida_em?: string | null
          decisao_interna?: string | null
          decisao_interna_em?: string | null
          empresa_id?: string | null
          envio_manual_em?: string | null
          envio_manual_por?: string | null
          estagio?: string
          expira_em?: string | null
          expirada_em?: string | null
          external_id?: string | null
          id?: string
          limite_aprovado?: number | null
          limite_operacional?: number | null
          limite_solicitado?: number | null
          moeda?: string
          motivo?: string | null
          observacoes?: string | null
          origem?: string
          origem_externa?: string | null
          origem_motivo?: string | null
          rating_classe_seguradora?: string | null
          rating_seguradora?: string | null
          seguradora?: string
          solicitada_por?: string | null
          substituida_em?: string | null
          substituida_por?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "analises_credito_analise_propria_id_fkey"
            columns: ["analise_propria_id"]
            isOneToOne: false
            referencedRelation: "analises_proprietarias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analises_credito_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "analises_credito_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "analises_credito_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "analises_credito_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "analises_credito_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analises_credito_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "analises_credito_envio_manual_por_fkey"
            columns: ["envio_manual_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analises_credito_solicitada_por_fkey"
            columns: ["solicitada_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analises_credito_substituida_por_fkey"
            columns: ["substituida_por"]
            isOneToOne: false
            referencedRelation: "analise_vigente"
            referencedColumns: ["analise_id"]
          },
          {
            foreignKeyName: "analises_credito_substituida_por_fkey"
            columns: ["substituida_por"]
            isOneToOne: false
            referencedRelation: "analises_credito"
            referencedColumns: ["id"]
          },
        ]
      }
      analises_plataforma: {
        Row: {
          available_limit: number | null
          bill_fine: number | null
          cnpj: string
          commission_percent: number | null
          company_name: string | null
          company_type: string | null
          consumed_limit: number | null
          credit_limit: number | null
          empresa_cadastrada: boolean
          ever_approved: boolean | null
          expiration_date: string | null
          fee_d0: number | null
          fee_d1: number | null
          fidc_ready: boolean | null
          has_insurance: boolean | null
          has_referral: boolean | null
          id_externo: number
          invest_back: Json | null
          max_anticipation_value: number | null
          max_invoice_deadline_days: number | null
          min_fee_d0: number | null
          min_fee_d1: number | null
          monthly_rate_d0: number | null
          monthly_rate_d1: number | null
          onepay_company_id: number | null
          raw: Json | null
          role: string
          sincronizada_em: string
          status: string
        }
        Insert: {
          available_limit?: number | null
          bill_fine?: number | null
          cnpj: string
          commission_percent?: number | null
          company_name?: string | null
          company_type?: string | null
          consumed_limit?: number | null
          credit_limit?: number | null
          empresa_cadastrada: boolean
          ever_approved?: boolean | null
          expiration_date?: string | null
          fee_d0?: number | null
          fee_d1?: number | null
          fidc_ready?: boolean | null
          has_insurance?: boolean | null
          has_referral?: boolean | null
          id_externo: number
          invest_back?: Json | null
          max_anticipation_value?: number | null
          max_invoice_deadline_days?: number | null
          min_fee_d0?: number | null
          min_fee_d1?: number | null
          monthly_rate_d0?: number | null
          monthly_rate_d1?: number | null
          onepay_company_id?: number | null
          raw?: Json | null
          role?: string
          sincronizada_em?: string
          status: string
        }
        Update: {
          available_limit?: number | null
          bill_fine?: number | null
          cnpj?: string
          commission_percent?: number | null
          company_name?: string | null
          company_type?: string | null
          consumed_limit?: number | null
          credit_limit?: number | null
          empresa_cadastrada?: boolean
          ever_approved?: boolean | null
          expiration_date?: string | null
          fee_d0?: number | null
          fee_d1?: number | null
          fidc_ready?: boolean | null
          has_insurance?: boolean | null
          has_referral?: boolean | null
          id_externo?: number
          invest_back?: Json | null
          max_anticipation_value?: number | null
          max_invoice_deadline_days?: number | null
          min_fee_d0?: number | null
          min_fee_d1?: number | null
          monthly_rate_d0?: number | null
          monthly_rate_d1?: number | null
          onepay_company_id?: number | null
          raw?: Json | null
          role?: string
          sincronizada_em?: string
          status?: string
        }
        Relationships: []
      }
      analises_proprietarias: {
        Row: {
          analise_credito_id: string | null
          atradius_limite: number | null
          atradius_status: string | null
          cenarios: Json | null
          cnpj: string
          concluida_em: string | null
          criada_em: string
          criada_por: string | null
          dados_extraidos: Json | null
          decidida_em: string | null
          decidida_por: string | null
          decisao_final: string | null
          decisao_limite: number | null
          decisao_motivo: string | null
          empresa_id: string | null
          erro: string | null
          etapa: string | null
          extracao_revisada_em: string | null
          extracao_revisada_por: string | null
          gatilho: string
          id: string
          indicadores: Json | null
          lacunas_calculo: Json
          limite_recomendado: number | null
          motivos_nao_operar: Json
          parametros_versao: number
          parecer_editado: string | null
          parecer_editado_em: string | null
          parecer_editado_por: string | null
          parecer_markdown: string | null
          parecer_modelo: string | null
          parecer_tokens: number | null
          protestos_opcoes: Json | null
          protestos_resultado: Json | null
          quadrante: string | null
          recomendacao: string | null
          status: string
          tetos: Json | null
          tipo: string
        }
        Insert: {
          analise_credito_id?: string | null
          atradius_limite?: number | null
          atradius_status?: string | null
          cenarios?: Json | null
          cnpj: string
          concluida_em?: string | null
          criada_em?: string
          criada_por?: string | null
          dados_extraidos?: Json | null
          decidida_em?: string | null
          decidida_por?: string | null
          decisao_final?: string | null
          decisao_limite?: number | null
          decisao_motivo?: string | null
          empresa_id?: string | null
          erro?: string | null
          etapa?: string | null
          extracao_revisada_em?: string | null
          extracao_revisada_por?: string | null
          gatilho?: string
          id?: string
          indicadores?: Json | null
          lacunas_calculo?: Json
          limite_recomendado?: number | null
          motivos_nao_operar?: Json
          parametros_versao: number
          parecer_editado?: string | null
          parecer_editado_em?: string | null
          parecer_editado_por?: string | null
          parecer_markdown?: string | null
          parecer_modelo?: string | null
          parecer_tokens?: number | null
          protestos_opcoes?: Json | null
          protestos_resultado?: Json | null
          quadrante?: string | null
          recomendacao?: string | null
          status?: string
          tetos?: Json | null
          tipo?: string
        }
        Update: {
          analise_credito_id?: string | null
          atradius_limite?: number | null
          atradius_status?: string | null
          cenarios?: Json | null
          cnpj?: string
          concluida_em?: string | null
          criada_em?: string
          criada_por?: string | null
          dados_extraidos?: Json | null
          decidida_em?: string | null
          decidida_por?: string | null
          decisao_final?: string | null
          decisao_limite?: number | null
          decisao_motivo?: string | null
          empresa_id?: string | null
          erro?: string | null
          etapa?: string | null
          extracao_revisada_em?: string | null
          extracao_revisada_por?: string | null
          gatilho?: string
          id?: string
          indicadores?: Json | null
          lacunas_calculo?: Json
          limite_recomendado?: number | null
          motivos_nao_operar?: Json
          parametros_versao?: number
          parecer_editado?: string | null
          parecer_editado_em?: string | null
          parecer_editado_por?: string | null
          parecer_markdown?: string | null
          parecer_modelo?: string | null
          parecer_tokens?: number | null
          protestos_opcoes?: Json | null
          protestos_resultado?: Json | null
          quadrante?: string | null
          recomendacao?: string | null
          status?: string
          tetos?: Json | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "analises_proprietarias_analise_credito_id_fkey"
            columns: ["analise_credito_id"]
            isOneToOne: false
            referencedRelation: "analise_vigente"
            referencedColumns: ["analise_id"]
          },
          {
            foreignKeyName: "analises_proprietarias_analise_credito_id_fkey"
            columns: ["analise_credito_id"]
            isOneToOne: false
            referencedRelation: "analises_credito"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analises_proprietarias_criada_por_fkey"
            columns: ["criada_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analises_proprietarias_decidida_por_fkey"
            columns: ["decidida_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analises_proprietarias_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "analises_proprietarias_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "analises_proprietarias_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "analises_proprietarias_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "analises_proprietarias_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analises_proprietarias_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "analises_proprietarias_extracao_revisada_por_fkey"
            columns: ["extracao_revisada_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analises_proprietarias_parametros_versao_fkey"
            columns: ["parametros_versao"]
            isOneToOne: false
            referencedRelation: "analise_parametros"
            referencedColumns: ["versao"]
          },
          {
            foreignKeyName: "analises_proprietarias_parecer_editado_por_fkey"
            columns: ["parecer_editado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      antecipacao_config: {
        Row: {
          atualizado_em: string
          atualizado_por: string | null
          chave: string
          valor: Json
        }
        Insert: {
          atualizado_em?: string
          atualizado_por?: string | null
          chave: string
          valor: Json
        }
        Update: {
          atualizado_em?: string
          atualizado_por?: string | null
          chave?: string
          valor?: Json
        }
        Relationships: [
          {
            foreignKeyName: "antecipacao_config_atualizado_por_fkey"
            columns: ["atualizado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      antecipacao_fornecedor_sem_interesse: {
        Row: {
          cnpj: string
          fornecedor_nome: string | null
          marcado_em: string
          marcado_por: string | null
          motivo: string
          observacao: string | null
        }
        Insert: {
          cnpj: string
          fornecedor_nome?: string | null
          marcado_em?: string
          marcado_por?: string | null
          motivo: string
          observacao?: string | null
        }
        Update: {
          cnpj?: string
          fornecedor_nome?: string | null
          marcado_em?: string
          marcado_por?: string | null
          motivo?: string
          observacao?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "antecipacao_fornecedor_sem_interesse_marcado_por_fkey"
            columns: ["marcado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      antecipacoes: {
        Row: {
          access_key_casada: string | null
          anticipation_days: number | null
          anticipation_type: string | null
          approval_with_automation: boolean | null
          atualizada_em: string
          completion_date: string | null
          convertida_em: string | null
          created_at_plataforma: string | null
          discounted_amount: number | null
          document_number: string | null
          fornecedor_cnpj: string
          fornecedor_nome: string | null
          gross_value: number | null
          id_externo: number
          invoice_cancelled_at: string | null
          match_candidatas: Json
          match_confianca: string | null
          match_em: string | null
          match_motivo: string | null
          match_observacao: string | null
          match_por: string | null
          match_status: string
          monthly_interest_rate: number | null
          net_value: number | null
          numero_normalizado: string | null
          original_due_date: string | null
          raw: Json | null
          regrediu_em: string | null
          request_date: string | null
          sacado_cnpj: string
          sacado_nome: string | null
          sem_nf_definitivo_em: string | null
          sincronizada_em: string
          status: string
          status_anterior: string | null
          total_spread: number | null
          withhold_tax: number | null
        }
        Insert: {
          access_key_casada?: string | null
          anticipation_days?: number | null
          anticipation_type?: string | null
          approval_with_automation?: boolean | null
          atualizada_em?: string
          completion_date?: string | null
          convertida_em?: string | null
          created_at_plataforma?: string | null
          discounted_amount?: number | null
          document_number?: string | null
          fornecedor_cnpj: string
          fornecedor_nome?: string | null
          gross_value?: number | null
          id_externo: number
          invoice_cancelled_at?: string | null
          match_candidatas?: Json
          match_confianca?: string | null
          match_em?: string | null
          match_motivo?: string | null
          match_observacao?: string | null
          match_por?: string | null
          match_status?: string
          monthly_interest_rate?: number | null
          net_value?: number | null
          numero_normalizado?: string | null
          original_due_date?: string | null
          raw?: Json | null
          regrediu_em?: string | null
          request_date?: string | null
          sacado_cnpj: string
          sacado_nome?: string | null
          sem_nf_definitivo_em?: string | null
          sincronizada_em?: string
          status: string
          status_anterior?: string | null
          total_spread?: number | null
          withhold_tax?: number | null
        }
        Update: {
          access_key_casada?: string | null
          anticipation_days?: number | null
          anticipation_type?: string | null
          approval_with_automation?: boolean | null
          atualizada_em?: string
          completion_date?: string | null
          convertida_em?: string | null
          created_at_plataforma?: string | null
          discounted_amount?: number | null
          document_number?: string | null
          fornecedor_cnpj?: string
          fornecedor_nome?: string | null
          gross_value?: number | null
          id_externo?: number
          invoice_cancelled_at?: string | null
          match_candidatas?: Json
          match_confianca?: string | null
          match_em?: string | null
          match_motivo?: string | null
          match_observacao?: string | null
          match_por?: string | null
          match_status?: string
          monthly_interest_rate?: number | null
          net_value?: number | null
          numero_normalizado?: string | null
          original_due_date?: string | null
          raw?: Json | null
          regrediu_em?: string | null
          request_date?: string | null
          sacado_cnpj?: string
          sacado_nome?: string | null
          sem_nf_definitivo_em?: string | null
          sincronizada_em?: string
          status?: string
          status_anterior?: string | null
          total_spread?: number | null
          withhold_tax?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "antecipacoes_access_key_casada_fkey"
            columns: ["access_key_casada"]
            isOneToOne: false
            referencedRelation: "funil_oportunidades_nf"
            referencedColumns: ["access_key"]
          },
          {
            foreignKeyName: "antecipacoes_access_key_casada_fkey"
            columns: ["access_key_casada"]
            isOneToOne: false
            referencedRelation: "funil_oportunidades_nf"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "antecipacoes_access_key_casada_fkey"
            columns: ["access_key_casada"]
            isOneToOne: false
            referencedRelation: "notas_fiscais"
            referencedColumns: ["access_key"]
          },
          {
            foreignKeyName: "antecipacoes_access_key_casada_fkey"
            columns: ["access_key_casada"]
            isOneToOne: false
            referencedRelation: "notas_funil"
            referencedColumns: ["access_key"]
          },
          {
            foreignKeyName: "antecipacoes_match_por_fkey"
            columns: ["match_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      api_idempotencia: {
        Row: {
          api_key_id: string
          chave: string
          criada_em: string
          id: string
          resposta: Json
          rota: string
          status_http: number
        }
        Insert: {
          api_key_id: string
          chave: string
          criada_em?: string
          id?: string
          resposta: Json
          rota: string
          status_http: number
        }
        Update: {
          api_key_id?: string
          chave?: string
          criada_em?: string
          id?: string
          resposta?: Json
          rota?: string
          status_http?: number
        }
        Relationships: [
          {
            foreignKeyName: "api_idempotencia_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          ativa: boolean
          criada_em: string
          criada_por: string | null
          escopos: string[]
          id: string
          key_hash: string
          nome: string
          prefixo: string
          revogada_em: string | null
          ultimo_uso_em: string | null
        }
        Insert: {
          ativa?: boolean
          criada_em?: string
          criada_por?: string | null
          escopos?: string[]
          id?: string
          key_hash: string
          nome: string
          prefixo: string
          revogada_em?: string | null
          ultimo_uso_em?: string | null
        }
        Update: {
          ativa?: boolean
          criada_em?: string
          criada_por?: string | null
          escopos?: string[]
          id?: string
          key_hash?: string
          nome?: string
          prefixo?: string
          revogada_em?: string | null
          ultimo_uso_em?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_criada_por_fkey"
            columns: ["criada_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      api_requests_log: {
        Row: {
          api_key_id: string | null
          criado_em: string
          duracao_ms: number | null
          erro: string | null
          id: string
          idempotency_key: string | null
          metodo: string
          rota: string
          status_http: number
        }
        Insert: {
          api_key_id?: string | null
          criado_em?: string
          duracao_ms?: number | null
          erro?: string | null
          id?: string
          idempotency_key?: string | null
          metodo: string
          rota: string
          status_http: number
        }
        Update: {
          api_key_id?: string | null
          criado_em?: string
          duracao_ms?: number | null
          erro?: string | null
          id?: string
          idempotency_key?: string | null
          metodo?: string
          rota?: string
          status_http?: number
        }
        Relationships: [
          {
            foreignKeyName: "api_requests_log_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      apolice_prazos: {
        Row: {
          alertas_emitidos: Json
          apolice_id: string
          calculado_em: string
          causa: string
          cobertura_volta_em: string | null
          cobranca_id: string | null
          data_limite_notificacao: string
          data_limite_sinistro: string
          data_parada_cobertura: string
          data_perda: string
          id: string
          notificado_seguradora_em: string | null
          pago_em: string | null
          restabelecimento_retroativo: boolean | null
          sinistro_id: string | null
          status: string
          titulo_id: string
          vencimento_original: string
        }
        Insert: {
          alertas_emitidos?: Json
          apolice_id: string
          calculado_em?: string
          causa?: string
          cobertura_volta_em?: string | null
          cobranca_id?: string | null
          data_limite_notificacao: string
          data_limite_sinistro: string
          data_parada_cobertura: string
          data_perda: string
          id?: string
          notificado_seguradora_em?: string | null
          pago_em?: string | null
          restabelecimento_retroativo?: boolean | null
          sinistro_id?: string | null
          status?: string
          titulo_id: string
          vencimento_original: string
        }
        Update: {
          alertas_emitidos?: Json
          apolice_id?: string
          calculado_em?: string
          causa?: string
          cobertura_volta_em?: string | null
          cobranca_id?: string | null
          data_limite_notificacao?: string
          data_limite_sinistro?: string
          data_parada_cobertura?: string
          data_perda?: string
          id?: string
          notificado_seguradora_em?: string | null
          pago_em?: string | null
          restabelecimento_retroativo?: boolean | null
          sinistro_id?: string | null
          status?: string
          titulo_id?: string
          vencimento_original?: string
        }
        Relationships: [
          {
            foreignKeyName: "apolice_prazos_apolice_id_fkey"
            columns: ["apolice_id"]
            isOneToOne: false
            referencedRelation: "apolices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apolice_prazos_cobranca_id_fkey"
            columns: ["cobranca_id"]
            isOneToOne: false
            referencedRelation: "cobranca_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apolice_prazos_cobranca_id_fkey"
            columns: ["cobranca_id"]
            isOneToOne: false
            referencedRelation: "cobrancas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apolice_prazos_sinistro_id_fkey"
            columns: ["sinistro_id"]
            isOneToOne: false
            referencedRelation: "sinistros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apolice_prazos_titulo_id_fkey"
            columns: ["titulo_id"]
            isOneToOne: false
            referencedRelation: "cobranca_titulos_abertos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apolice_prazos_titulo_id_fkey"
            columns: ["titulo_id"]
            isOneToOne: false
            referencedRelation: "titulos"
            referencedColumns: ["id"]
          },
        ]
      }
      apolices: {
        Row: {
          ativa: boolean
          atualizado_em: string
          criado_em: string
          franquia: number
          id: string
          numero: string
          percentagem_segurada: number
          periodo_espera_dias: number
          periodo_max_prorrogacao_dias: number
          prazo_documentos_complementares_dias: number
          prazo_envio_sinistro_meses: number
          prazo_maximo_credito_dias: number
          prazo_notificacao_apos_prorrogacao_dias: number
          responsabilidade_maxima: number | null
          segurado_cnpj: string
          seguradora: string
          vigencia_fim: string
          vigencia_inicio: string
        }
        Insert: {
          ativa?: boolean
          atualizado_em?: string
          criado_em?: string
          franquia: number
          id?: string
          numero: string
          percentagem_segurada: number
          periodo_espera_dias: number
          periodo_max_prorrogacao_dias: number
          prazo_documentos_complementares_dias: number
          prazo_envio_sinistro_meses: number
          prazo_maximo_credito_dias: number
          prazo_notificacao_apos_prorrogacao_dias: number
          responsabilidade_maxima?: number | null
          segurado_cnpj: string
          seguradora?: string
          vigencia_fim: string
          vigencia_inicio: string
        }
        Update: {
          ativa?: boolean
          atualizado_em?: string
          criado_em?: string
          franquia?: number
          id?: string
          numero?: string
          percentagem_segurada?: number
          periodo_espera_dias?: number
          periodo_max_prorrogacao_dias?: number
          prazo_documentos_complementares_dias?: number
          prazo_envio_sinistro_meses?: number
          prazo_maximo_credito_dias?: number
          prazo_notificacao_apos_prorrogacao_dias?: number
          responsabilidade_maxima?: number | null
          segurado_cnpj?: string
          seguradora?: string
          vigencia_fim?: string
          vigencia_inicio?: string
        }
        Relationships: []
      }
      app_config: {
        Row: {
          atualizado_em: string
          atualizado_por: string | null
          chave: string
          descricao: string | null
          valor: Json
        }
        Insert: {
          atualizado_em?: string
          atualizado_por?: string | null
          chave: string
          descricao?: string | null
          valor: Json
        }
        Update: {
          atualizado_em?: string
          atualizado_por?: string | null
          chave?: string
          descricao?: string | null
          valor?: Json
        }
        Relationships: [
          {
            foreignKeyName: "app_config_atualizado_por_fkey"
            columns: ["atualizado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          acao: string
          criado_em: string
          entidade: string | null
          entidade_id: string | null
          id: string
          payload: Json | null
          usuario_id: string | null
        }
        Insert: {
          acao: string
          criado_em?: string
          entidade?: string | null
          entidade_id?: string | null
          id?: string
          payload?: Json | null
          usuario_id?: string | null
        }
        Update: {
          acao?: string
          criado_em?: string
          entidade?: string | null
          entidade_id?: string | null
          id?: string
          payload?: Json | null
          usuario_id?: string | null
        }
        Relationships: []
      }
      calibracao_rotulos: {
        Row: {
          analise_id: string
          aplicavel: boolean
          atendido: boolean | null
          chave: string
          contestacao_id: string | null
          id: string
          origem: string
          resultado: string | null
          rotulado_em: string
          rotulado_por: string | null
          tipo_interacao: string
        }
        Insert: {
          analise_id: string
          aplicavel: boolean
          atendido?: boolean | null
          chave: string
          contestacao_id?: string | null
          id?: string
          origem: string
          resultado?: string | null
          rotulado_em?: string
          rotulado_por?: string | null
          tipo_interacao: string
        }
        Update: {
          analise_id?: string
          aplicavel?: boolean
          atendido?: boolean | null
          chave?: string
          contestacao_id?: string | null
          id?: string
          origem?: string
          resultado?: string | null
          rotulado_em?: string
          rotulado_por?: string | null
          tipo_interacao?: string
        }
        Relationships: [
          {
            foreignKeyName: "calibracao_rotulos_analise_id_fkey"
            columns: ["analise_id"]
            isOneToOne: false
            referencedRelation: "analises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calibracao_rotulos_contestacao_id_fkey"
            columns: ["contestacao_id"]
            isOneToOne: false
            referencedRelation: "analise_contestacoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calibracao_rotulos_rotulado_por_fkey"
            columns: ["rotulado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      calibracao_execucoes: {
        Row: {
          custo_centavos: number
          executada_em: string
          executada_por: string | null
          gatilho: string
          id: string
          resultado: Json
          rubrica_id: string
          saiu_de_sombra: boolean
        }
        Insert: {
          custo_centavos?: number
          executada_em?: string
          executada_por?: string | null
          gatilho: string
          id?: string
          resultado: Json
          rubrica_id: string
          saiu_de_sombra?: boolean
        }
        Update: {
          custo_centavos?: number
          executada_em?: string
          executada_por?: string | null
          gatilho?: string
          id?: string
          resultado?: Json
          rubrica_id?: string
          saiu_de_sombra?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "calibracao_execucoes_executada_por_fkey"
            columns: ["executada_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calibracao_execucoes_rubrica_id_fkey"
            columns: ["rubrica_id"]
            isOneToOne: false
            referencedRelation: "rubricas"
            referencedColumns: ["id"]
          },
        ]
      }
      calibracao_amostras: {
        Row: {
          analise_id: string
          criada_em: string
          item_id: string
          prob_aplicavel: number | null
          prob_atendido: number | null
          provedor: string
        }
        Insert: {
          analise_id: string
          criada_em?: string
          item_id: string
          prob_aplicavel?: number | null
          prob_atendido?: number | null
          provedor: string
        }
        Update: {
          analise_id?: string
          criada_em?: string
          item_id?: string
          prob_aplicavel?: number | null
          prob_atendido?: number | null
          provedor?: string
        }
        Relationships: [
          {
            foreignKeyName: "calibracao_amostras_analise_id_fkey"
            columns: ["analise_id"]
            isOneToOne: false
            referencedRelation: "analises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calibracao_amostras_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "rubrica_itens"
            referencedColumns: ["id"]
          },
        ]
      }
      camada_regras: {
        Row: {
          ativa: boolean
          camada: string
          criada_em: string
          criada_por: string | null
          definicao: Json
          id: string
          versao: number
        }
        Insert: {
          ativa?: boolean
          camada: string
          criada_em?: string
          criada_por?: string | null
          definicao: Json
          id?: string
          versao: number
        }
        Update: {
          ativa?: boolean
          camada?: string
          criada_em?: string
          criada_por?: string | null
          definicao?: Json
          id?: string
          versao?: number
        }
        Relationships: [
          {
            foreignKeyName: "camada_regras_criada_por_fkey"
            columns: ["criada_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      campanha_destinatarios: {
        Row: {
          agendada_para: string | null
          atualizado_em: string
          campanha_id: string
          comunicacao_id: string | null
          contato_id: string | null
          conversa_id: string | null
          criado_em: string
          empresa_id: string | null
          enviada_em: string | null
          erro: string | null
          id: string
          motivo_exclusao: string | null
          passo: number
          respondida_em: string | null
          status: string
          variante_id: string | null
        }
        Insert: {
          agendada_para?: string | null
          atualizado_em?: string
          campanha_id: string
          comunicacao_id?: string | null
          contato_id?: string | null
          conversa_id?: string | null
          criado_em?: string
          empresa_id?: string | null
          enviada_em?: string | null
          erro?: string | null
          id?: string
          motivo_exclusao?: string | null
          passo?: number
          respondida_em?: string | null
          status?: string
          variante_id?: string | null
        }
        Update: {
          agendada_para?: string | null
          atualizado_em?: string
          campanha_id?: string
          comunicacao_id?: string | null
          contato_id?: string | null
          conversa_id?: string | null
          criado_em?: string
          empresa_id?: string | null
          enviada_em?: string | null
          erro?: string | null
          id?: string
          motivo_exclusao?: string | null
          passo?: number
          respondida_em?: string | null
          status?: string
          variante_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campanha_destinatarios_campanha_id_fkey"
            columns: ["campanha_id"]
            isOneToOne: false
            referencedRelation: "campanhas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanha_destinatarios_campanha_id_fkey"
            columns: ["campanha_id"]
            isOneToOne: false
            referencedRelation: "campanhas_lista"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanha_destinatarios_comunicacao_id_fkey"
            columns: ["comunicacao_id"]
            isOneToOne: false
            referencedRelation: "comunicacoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanha_destinatarios_comunicacao_id_fkey"
            columns: ["comunicacao_id"]
            isOneToOne: false
            referencedRelation: "comunicacoes_thread"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanha_destinatarios_contato_id_fkey"
            columns: ["contato_id"]
            isOneToOne: false
            referencedRelation: "contatos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanha_destinatarios_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "conversas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanha_destinatarios_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "inbox_conversas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanha_destinatarios_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "campanha_destinatarios_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "campanha_destinatarios_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "campanha_destinatarios_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "campanha_destinatarios_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanha_destinatarios_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      campanhas: {
        Row: {
          aprovada_em: string | null
          aprovada_por: string | null
          atualizada_em: string
          canal: string
          concluida_em: string | null
          contas_remetentes: string[]
          criada_em: string
          criada_por: string | null
          definicao_filtro: Json | null
          empresas_manuais: string[]
          excluir_contatados_dias: number
          excluir_conversa_aberta: boolean
          id: string
          inicio_em: string | null
          modo_agente_ao_responder: string
          nome: string
          objetivo: string | null
          origem_publico: string
          pausa_motivo: string | null
          preset: string | null
          preset_params: Json
          respeitar_janela: boolean
          ritmo_por_dia: number
          segmento_id: string | null
          simulacao: Json | null
          simulada_em: string | null
          status: string
          tipo: string
          variantes: Json
          vendedor_id: string | null
        }
        Insert: {
          aprovada_em?: string | null
          aprovada_por?: string | null
          atualizada_em?: string
          canal: string
          concluida_em?: string | null
          contas_remetentes?: string[]
          criada_em?: string
          criada_por?: string | null
          definicao_filtro?: Json | null
          empresas_manuais?: string[]
          excluir_contatados_dias?: number
          excluir_conversa_aberta?: boolean
          id?: string
          inicio_em?: string | null
          modo_agente_ao_responder?: string
          nome: string
          objetivo?: string | null
          origem_publico: string
          pausa_motivo?: string | null
          preset?: string | null
          preset_params?: Json
          respeitar_janela?: boolean
          ritmo_por_dia?: number
          segmento_id?: string | null
          simulacao?: Json | null
          simulada_em?: string | null
          status?: string
          tipo: string
          variantes?: Json
          vendedor_id?: string | null
        }
        Update: {
          aprovada_em?: string | null
          aprovada_por?: string | null
          atualizada_em?: string
          canal?: string
          concluida_em?: string | null
          contas_remetentes?: string[]
          criada_em?: string
          criada_por?: string | null
          definicao_filtro?: Json | null
          empresas_manuais?: string[]
          excluir_contatados_dias?: number
          excluir_conversa_aberta?: boolean
          id?: string
          inicio_em?: string | null
          modo_agente_ao_responder?: string
          nome?: string
          objetivo?: string | null
          origem_publico?: string
          pausa_motivo?: string | null
          preset?: string | null
          preset_params?: Json
          respeitar_janela?: boolean
          ritmo_por_dia?: number
          segmento_id?: string | null
          simulacao?: Json | null
          simulada_em?: string | null
          status?: string
          tipo?: string
          variantes?: Json
          vendedor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campanhas_aprovada_por_fkey"
            columns: ["aprovada_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanhas_criada_por_fkey"
            columns: ["criada_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanhas_segmento_id_fkey"
            columns: ["segmento_id"]
            isOneToOne: false
            referencedRelation: "segmentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanhas_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
        ]
      }
      campanhas_config: {
        Row: {
          atualizado_em: string
          atualizado_por: string | null
          chave: string
          valor: Json
        }
        Insert: {
          atualizado_em?: string
          atualizado_por?: string | null
          chave: string
          valor: Json
        }
        Update: {
          atualizado_em?: string
          atualizado_por?: string | null
          chave?: string
          valor?: Json
        }
        Relationships: [
          {
            foreignKeyName: "campanhas_config_atualizado_por_fkey"
            columns: ["atualizado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      certificado_card_eventos: {
        Row: {
          automatico: boolean
          card_id: string
          criado_em: string
          de: string | null
          detalhe: string | null
          id: number
          motivo: string | null
          para: string
          usuario_id: string | null
        }
        Insert: {
          automatico?: boolean
          card_id: string
          criado_em?: string
          de?: string | null
          detalhe?: string | null
          id?: number
          motivo?: string | null
          para: string
          usuario_id?: string | null
        }
        Update: {
          automatico?: boolean
          card_id?: string
          criado_em?: string
          de?: string | null
          detalhe?: string | null
          id?: number
          motivo?: string | null
          para?: string
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "certificado_card_eventos_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "certificado_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificado_card_eventos_motivo_fkey"
            columns: ["motivo"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["motivo_sugerido"]
          },
          {
            foreignKeyName: "certificado_card_eventos_motivo_fkey"
            columns: ["motivo"]
            isOneToOne: false
            referencedRelation: "motivos_perda"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificado_card_eventos_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      certificado_cards: {
        Row: {
          aberto_em: string
          atualizado_em: string
          atualizado_por: string | null
          empresa_id: string
          estagio: string
          estagio_anterior: string | null
          fechado_cobertos: number | null
          fechado_matriz_coberta: boolean | null
          ganho_em: string | null
          id: string
          observacao: string | null
          perdido_em: string | null
          perdido_motivo: string | null
        }
        Insert: {
          aberto_em?: string
          atualizado_em?: string
          atualizado_por?: string | null
          empresa_id: string
          estagio?: string
          estagio_anterior?: string | null
          fechado_cobertos?: number | null
          fechado_matriz_coberta?: boolean | null
          ganho_em?: string | null
          id?: string
          observacao?: string | null
          perdido_em?: string | null
          perdido_motivo?: string | null
        }
        Update: {
          aberto_em?: string
          atualizado_em?: string
          atualizado_por?: string | null
          empresa_id?: string
          estagio?: string
          estagio_anterior?: string | null
          fechado_cobertos?: number | null
          fechado_matriz_coberta?: boolean | null
          ganho_em?: string | null
          id?: string
          observacao?: string | null
          perdido_em?: string | null
          perdido_motivo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "certificado_cards_atualizado_por_fkey"
            columns: ["atualizado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificado_cards_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: true
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "certificado_cards_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: true
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "certificado_cards_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: true
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "certificado_cards_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: true
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "certificado_cards_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: true
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificado_cards_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: true
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "certificado_cards_perdido_motivo_fkey"
            columns: ["perdido_motivo"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["motivo_sugerido"]
          },
          {
            foreignKeyName: "certificado_cards_perdido_motivo_fkey"
            columns: ["perdido_motivo"]
            isOneToOne: false
            referencedRelation: "motivos_perda"
            referencedColumns: ["id"]
          },
        ]
      }
      certificados: {
        Row: {
          cnpj: string
          company_name: string | null
          expires_at: string | null
          expires_at_anterior: string | null
          sincronizado_em: string
          status: string | null
          ultimo_alerta: string | null
        }
        Insert: {
          cnpj: string
          company_name?: string | null
          expires_at?: string | null
          expires_at_anterior?: string | null
          sincronizado_em?: string
          status?: string | null
          ultimo_alerta?: string | null
        }
        Update: {
          cnpj?: string
          company_name?: string | null
          expires_at?: string | null
          expires_at_anterior?: string | null
          sincronizado_em?: string
          status?: string | null
          ultimo_alerta?: string | null
        }
        Relationships: []
      }
      certificados_ocultos: {
        Row: {
          cnpj: string
          oculto_em: string
          oculto_por: string | null
        }
        Insert: {
          cnpj: string
          oculto_em?: string
          oculto_por?: string | null
        }
        Update: {
          cnpj?: string
          oculto_em?: string
          oculto_por?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "certificados_spe_ocultas_oculto_por_fkey"
            columns: ["oculto_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      clientes_onepay: {
        Row: {
          anticipations_last_2m: number | null
          atualizado_em: string
          available_limit: number | null
          cnpj: string
          consumed_limit: number | null
          consumed_pct: number | null
          consumed_pct_2m: number | null
          credit_limit: number | null
          days_without_anticipation: number | null
          empresa_id: string | null
          gross_value_last_2m: number | null
          last_anticipation: string | null
          nome: string | null
          onepay_company_id: number
          operation_status: string | null
          primeira_vez_visto: string
          status: string | null
        }
        Insert: {
          anticipations_last_2m?: number | null
          atualizado_em?: string
          available_limit?: number | null
          cnpj: string
          consumed_limit?: number | null
          consumed_pct?: number | null
          consumed_pct_2m?: number | null
          credit_limit?: number | null
          days_without_anticipation?: number | null
          empresa_id?: string | null
          gross_value_last_2m?: number | null
          last_anticipation?: string | null
          nome?: string | null
          onepay_company_id: number
          operation_status?: string | null
          primeira_vez_visto?: string
          status?: string | null
        }
        Update: {
          anticipations_last_2m?: number | null
          atualizado_em?: string
          available_limit?: number | null
          cnpj?: string
          consumed_limit?: number | null
          consumed_pct?: number | null
          consumed_pct_2m?: number | null
          credit_limit?: number | null
          days_without_anticipation?: number | null
          empresa_id?: string | null
          gross_value_last_2m?: number | null
          last_anticipation?: string | null
          nome?: string | null
          onepay_company_id?: number
          operation_status?: string | null
          primeira_vez_visto?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clientes_onepay_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "clientes_onepay_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "clientes_onepay_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "clientes_onepay_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "clientes_onepay_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_onepay_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      clientes_onepay_snapshots: {
        Row: {
          capturado_em: string
          cnpj: string
          dados: Json
          id: string
        }
        Insert: {
          capturado_em: string
          cnpj: string
          dados: Json
          id?: string
        }
        Update: {
          capturado_em?: string
          cnpj?: string
          dados?: Json
          id?: string
        }
        Relationships: []
      }
      cnpj_lookup_fila: {
        Row: {
          cnpj: string
          criado_em: string
          motivo: string
          resolvido_em: string | null
          status: string
          tentativas: number
          ultimo_erro: string | null
          ultimo_provedor: string | null
        }
        Insert: {
          cnpj: string
          criado_em?: string
          motivo?: string
          resolvido_em?: string | null
          status?: string
          tentativas?: number
          ultimo_erro?: string | null
          ultimo_provedor?: string | null
        }
        Update: {
          cnpj?: string
          criado_em?: string
          motivo?: string
          resolvido_em?: string | null
          status?: string
          tentativas?: number
          ultimo_erro?: string | null
          ultimo_provedor?: string | null
        }
        Relationships: []
      }
      cobranca_bloqueios_cnpj: {
        Row: {
          cnpj: string
          cobranca_id: string | null
          desde: string
          sacado_matriz_cnpj: string
        }
        Insert: {
          cnpj: string
          cobranca_id?: string | null
          desde?: string
          sacado_matriz_cnpj: string
        }
        Update: {
          cnpj?: string
          cobranca_id?: string | null
          desde?: string
          sacado_matriz_cnpj?: string
        }
        Relationships: [
          {
            foreignKeyName: "cobranca_bloqueios_cnpj_cobranca_id_fkey"
            columns: ["cobranca_id"]
            isOneToOne: false
            referencedRelation: "cobranca_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cobranca_bloqueios_cnpj_cobranca_id_fkey"
            columns: ["cobranca_id"]
            isOneToOne: false
            referencedRelation: "cobrancas"
            referencedColumns: ["id"]
          },
        ]
      }
      cobranca_config: {
        Row: {
          atualizado_em: string
          atualizado_por: string | null
          chave: string
          valor: Json
        }
        Insert: {
          atualizado_em?: string
          atualizado_por?: string | null
          chave: string
          valor: Json
        }
        Update: {
          atualizado_em?: string
          atualizado_por?: string | null
          chave?: string
          valor?: Json
        }
        Relationships: [
          {
            foreignKeyName: "cobranca_config_atualizado_por_fkey"
            columns: ["atualizado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      cobranca_insolvencias: {
        Row: {
          confirmada: boolean
          criado_em: string
          criado_por: string | null
          data_decisao: string
          fonte: string
          id: string
          numero_cnj: string | null
          observacao: string | null
          sacado_matriz_cnpj: string
          tipo: string
        }
        Insert: {
          confirmada?: boolean
          criado_em?: string
          criado_por?: string | null
          data_decisao: string
          fonte?: string
          id?: string
          numero_cnj?: string | null
          observacao?: string | null
          sacado_matriz_cnpj: string
          tipo: string
        }
        Update: {
          confirmada?: boolean
          criado_em?: string
          criado_por?: string | null
          data_decisao?: string
          fonte?: string
          id?: string
          numero_cnj?: string | null
          observacao?: string | null
          sacado_matriz_cnpj?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "cobranca_insolvencias_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cobranca_insolvencias_numero_cnj_fkey"
            columns: ["numero_cnj"]
            isOneToOne: false
            referencedRelation: "juridico_carteira"
            referencedColumns: ["numero_cnj"]
          },
          {
            foreignKeyName: "cobranca_insolvencias_numero_cnj_fkey"
            columns: ["numero_cnj"]
            isOneToOne: false
            referencedRelation: "processos"
            referencedColumns: ["numero_cnj"]
          },
        ]
      }
      cobranca_interacoes: {
        Row: {
          cobranca_id: string
          criado_em: string
          id: string
          ocorrida_em: string
          resumo: string
          tipo: string
          usuario_id: string | null
        }
        Insert: {
          cobranca_id: string
          criado_em?: string
          id?: string
          ocorrida_em?: string
          resumo: string
          tipo: string
          usuario_id?: string | null
        }
        Update: {
          cobranca_id?: string
          criado_em?: string
          id?: string
          ocorrida_em?: string
          resumo?: string
          tipo?: string
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cobranca_interacoes_cobranca_id_fkey"
            columns: ["cobranca_id"]
            isOneToOne: false
            referencedRelation: "cobranca_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cobranca_interacoes_cobranca_id_fkey"
            columns: ["cobranca_id"]
            isOneToOne: false
            referencedRelation: "cobrancas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cobranca_interacoes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      cobranca_modelos: {
        Row: {
          ativo: boolean
          corpo_markdown: string
          criado_em: string
          criado_por: string | null
          familia_id: string
          id: string
          nome: string
          tipo: string
          versao: number
        }
        Insert: {
          ativo?: boolean
          corpo_markdown: string
          criado_em?: string
          criado_por?: string | null
          familia_id?: string
          id?: string
          nome: string
          tipo: string
          versao?: number
        }
        Update: {
          ativo?: boolean
          corpo_markdown?: string
          criado_em?: string
          criado_por?: string | null
          familia_id?: string
          id?: string
          nome?: string
          tipo?: string
          versao?: number
        }
        Relationships: [
          {
            foreignKeyName: "cobranca_modelos_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      cobranca_notificacao_entregas: {
        Row: {
          canal: string
          codigo_rastreio: string | null
          comprovante_path: string | null
          comunicacao_id: string | null
          confirmado_em: string | null
          contato_id: string | null
          criado_em: string
          criado_por: string | null
          destino: string | null
          enviado_em: string | null
          id: string
          notificacao_id: string
          observacao: string | null
          outbox_id: string | null
          status: string
        }
        Insert: {
          canal: string
          codigo_rastreio?: string | null
          comprovante_path?: string | null
          comunicacao_id?: string | null
          confirmado_em?: string | null
          contato_id?: string | null
          criado_em?: string
          criado_por?: string | null
          destino?: string | null
          enviado_em?: string | null
          id?: string
          notificacao_id: string
          observacao?: string | null
          outbox_id?: string | null
          status?: string
        }
        Update: {
          canal?: string
          codigo_rastreio?: string | null
          comprovante_path?: string | null
          comunicacao_id?: string | null
          confirmado_em?: string | null
          contato_id?: string | null
          criado_em?: string
          criado_por?: string | null
          destino?: string | null
          enviado_em?: string | null
          id?: string
          notificacao_id?: string
          observacao?: string | null
          outbox_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "cobranca_notificacao_entregas_comunicacao_id_fkey"
            columns: ["comunicacao_id"]
            isOneToOne: false
            referencedRelation: "comunicacoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cobranca_notificacao_entregas_comunicacao_id_fkey"
            columns: ["comunicacao_id"]
            isOneToOne: false
            referencedRelation: "comunicacoes_thread"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cobranca_notificacao_entregas_contato_id_fkey"
            columns: ["contato_id"]
            isOneToOne: false
            referencedRelation: "contatos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cobranca_notificacao_entregas_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cobranca_notificacao_entregas_notificacao_id_fkey"
            columns: ["notificacao_id"]
            isOneToOne: false
            referencedRelation: "cobranca_notificacoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cobranca_notificacao_entregas_outbox_id_fkey"
            columns: ["outbox_id"]
            isOneToOne: false
            referencedRelation: "mensagens_outbox"
            referencedColumns: ["id"]
          },
        ]
      }
      cobranca_notificacao_titulos: {
        Row: {
          cobranca_titulo_id: string
          notificacao_id: string
        }
        Insert: {
          cobranca_titulo_id: string
          notificacao_id: string
        }
        Update: {
          cobranca_titulo_id?: string
          notificacao_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cobranca_notificacao_titulos_cobranca_titulo_id_fkey"
            columns: ["cobranca_titulo_id"]
            isOneToOne: false
            referencedRelation: "cobranca_titulos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cobranca_notificacao_titulos_notificacao_id_fkey"
            columns: ["notificacao_id"]
            isOneToOne: false
            referencedRelation: "cobranca_notificacoes"
            referencedColumns: ["id"]
          },
        ]
      }
      cobranca_notificacoes: {
        Row: {
          cobranca_id: string
          destinatario_cnpj: string
          destinatario_empresa_id: string | null
          destinatario_endereco: Json | null
          destinatario_razao_social: string
          documento_hash: string | null
          documento_path: string | null
          enviada_em: string | null
          gerada_em: string
          id: string
          memoria_calculo: Json | null
          modelo_id: string | null
          papel: string
          prazo_expira_em: string | null
          prazo_pagamento_dias: number
          qtd_titulos: number
          rodada: number
          status: string
          valor_total: number
          valor_total_atualizado: number | null
        }
        Insert: {
          cobranca_id: string
          destinatario_cnpj: string
          destinatario_empresa_id?: string | null
          destinatario_endereco?: Json | null
          destinatario_razao_social: string
          documento_hash?: string | null
          documento_path?: string | null
          enviada_em?: string | null
          gerada_em?: string
          id?: string
          memoria_calculo?: Json | null
          modelo_id?: string | null
          papel: string
          prazo_expira_em?: string | null
          prazo_pagamento_dias: number
          qtd_titulos: number
          rodada?: number
          status?: string
          valor_total: number
          valor_total_atualizado?: number | null
        }
        Update: {
          cobranca_id?: string
          destinatario_cnpj?: string
          destinatario_empresa_id?: string | null
          destinatario_endereco?: Json | null
          destinatario_razao_social?: string
          documento_hash?: string | null
          documento_path?: string | null
          enviada_em?: string | null
          gerada_em?: string
          id?: string
          memoria_calculo?: Json | null
          modelo_id?: string | null
          papel?: string
          prazo_expira_em?: string | null
          prazo_pagamento_dias?: number
          qtd_titulos?: number
          rodada?: number
          status?: string
          valor_total?: number
          valor_total_atualizado?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cobranca_notificacoes_cobranca_id_fkey"
            columns: ["cobranca_id"]
            isOneToOne: false
            referencedRelation: "cobranca_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cobranca_notificacoes_cobranca_id_fkey"
            columns: ["cobranca_id"]
            isOneToOne: false
            referencedRelation: "cobrancas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cobranca_notificacoes_destinatario_empresa_id_fkey"
            columns: ["destinatario_empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "cobranca_notificacoes_destinatario_empresa_id_fkey"
            columns: ["destinatario_empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "cobranca_notificacoes_destinatario_empresa_id_fkey"
            columns: ["destinatario_empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "cobranca_notificacoes_destinatario_empresa_id_fkey"
            columns: ["destinatario_empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "cobranca_notificacoes_destinatario_empresa_id_fkey"
            columns: ["destinatario_empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cobranca_notificacoes_destinatario_empresa_id_fkey"
            columns: ["destinatario_empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "cobranca_notificacoes_modelo_id_fkey"
            columns: ["modelo_id"]
            isOneToOne: false
            referencedRelation: "cobranca_modelos"
            referencedColumns: ["id"]
          },
        ]
      }
      cobranca_sequencias: {
        Row: {
          ano: number
          prefixo: string
          ultimo: number
        }
        Insert: {
          ano: number
          prefixo: string
          ultimo?: number
        }
        Update: {
          ano?: number
          prefixo?: string
          ultimo?: number
        }
        Relationships: []
      }
      cobranca_titulos: {
        Row: {
          cedente_cnpj_snapshot: string
          cobranca_id: string
          dias_atraso_snapshot: number
          id: string
          quitado_em: string | null
          quitado_origem: string | null
          sacado_cnpj_snapshot: string
          situacao: string
          titulo_id: string
          valor_cedido_snapshot: number | null
          valor_face_snapshot: number
          valor_recebido: number | null
          vencimento_snapshot: string
        }
        Insert: {
          cedente_cnpj_snapshot: string
          cobranca_id: string
          dias_atraso_snapshot: number
          id?: string
          quitado_em?: string | null
          quitado_origem?: string | null
          sacado_cnpj_snapshot: string
          situacao?: string
          titulo_id: string
          valor_cedido_snapshot?: number | null
          valor_face_snapshot: number
          valor_recebido?: number | null
          vencimento_snapshot: string
        }
        Update: {
          cedente_cnpj_snapshot?: string
          cobranca_id?: string
          dias_atraso_snapshot?: number
          id?: string
          quitado_em?: string | null
          quitado_origem?: string | null
          sacado_cnpj_snapshot?: string
          situacao?: string
          titulo_id?: string
          valor_cedido_snapshot?: number | null
          valor_face_snapshot?: number
          valor_recebido?: number | null
          vencimento_snapshot?: string
        }
        Relationships: [
          {
            foreignKeyName: "cobranca_titulos_cobranca_id_fkey"
            columns: ["cobranca_id"]
            isOneToOne: false
            referencedRelation: "cobranca_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cobranca_titulos_cobranca_id_fkey"
            columns: ["cobranca_id"]
            isOneToOne: false
            referencedRelation: "cobrancas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cobranca_titulos_titulo_id_fkey"
            columns: ["titulo_id"]
            isOneToOne: false
            referencedRelation: "cobranca_titulos_abertos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cobranca_titulos_titulo_id_fkey"
            columns: ["titulo_id"]
            isOneToOne: false
            referencedRelation: "titulos"
            referencedColumns: ["id"]
          },
        ]
      }
      cobrancas: {
        Row: {
          aceite_apolice_em: string | null
          aceite_apolice_por: string | null
          codigo: string | null
          convertida_em_processo_em: string | null
          criada_em: string
          criada_por: string | null
          data_base: string | null
          encerrada_em: string | null
          escopo_notificacao: string
          estagio: string
          honorarios_pct: number | null
          id: string
          indice_correcao: string | null
          juros_mora_mes: number | null
          juros_pro_rata: boolean
          motivo_encerramento: string | null
          multa_pct: number | null
          notificada_em: string | null
          notificar_matriz_cedente: boolean
          observacoes: string | null
          processo_cnj: string | null
          responsavel_id: string | null
          sacado_empresa_id: string | null
          sacado_matriz_cnpj: string
          valor_atualizado: number | null
          valor_atualizado_em: string | null
        }
        Insert: {
          aceite_apolice_em?: string | null
          aceite_apolice_por?: string | null
          codigo?: string | null
          convertida_em_processo_em?: string | null
          criada_em?: string
          criada_por?: string | null
          data_base?: string | null
          encerrada_em?: string | null
          escopo_notificacao?: string
          estagio?: string
          honorarios_pct?: number | null
          id?: string
          indice_correcao?: string | null
          juros_mora_mes?: number | null
          juros_pro_rata?: boolean
          motivo_encerramento?: string | null
          multa_pct?: number | null
          notificada_em?: string | null
          notificar_matriz_cedente?: boolean
          observacoes?: string | null
          processo_cnj?: string | null
          responsavel_id?: string | null
          sacado_empresa_id?: string | null
          sacado_matriz_cnpj: string
          valor_atualizado?: number | null
          valor_atualizado_em?: string | null
        }
        Update: {
          aceite_apolice_em?: string | null
          aceite_apolice_por?: string | null
          codigo?: string | null
          convertida_em_processo_em?: string | null
          criada_em?: string
          criada_por?: string | null
          data_base?: string | null
          encerrada_em?: string | null
          escopo_notificacao?: string
          estagio?: string
          honorarios_pct?: number | null
          id?: string
          indice_correcao?: string | null
          juros_mora_mes?: number | null
          juros_pro_rata?: boolean
          motivo_encerramento?: string | null
          multa_pct?: number | null
          notificada_em?: string | null
          notificar_matriz_cedente?: boolean
          observacoes?: string | null
          processo_cnj?: string | null
          responsavel_id?: string | null
          sacado_empresa_id?: string | null
          sacado_matriz_cnpj?: string
          valor_atualizado?: number | null
          valor_atualizado_em?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cobrancas_aceite_apolice_por_fkey"
            columns: ["aceite_apolice_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cobrancas_criada_por_fkey"
            columns: ["criada_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cobrancas_processo_cnj_fkey"
            columns: ["processo_cnj"]
            isOneToOne: false
            referencedRelation: "juridico_carteira"
            referencedColumns: ["numero_cnj"]
          },
          {
            foreignKeyName: "cobrancas_processo_cnj_fkey"
            columns: ["processo_cnj"]
            isOneToOne: false
            referencedRelation: "processos"
            referencedColumns: ["numero_cnj"]
          },
          {
            foreignKeyName: "cobrancas_responsavel_id_fkey"
            columns: ["responsavel_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cobrancas_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "cobrancas_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "cobrancas_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "cobrancas_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "cobrancas_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cobrancas_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      comercial_config: {
        Row: {
          atualizado_em: string
          atualizado_por: string | null
          chave: string
          valor: Json
        }
        Insert: {
          atualizado_em?: string
          atualizado_por?: string | null
          chave: string
          valor: Json
        }
        Update: {
          atualizado_em?: string
          atualizado_por?: string | null
          chave?: string
          valor?: Json
        }
        Relationships: [
          {
            foreignKeyName: "comercial_config_atualizado_por_fkey"
            columns: ["atualizado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      comissao_competencias: {
        Row: {
          aprovada_em: string | null
          aprovada_por: string | null
          competencia: string
          fechada_em: string
          lancamentos: number
          paga_em: string | null
          paga_por: string | null
          status: string
          total: number
        }
        Insert: {
          aprovada_em?: string | null
          aprovada_por?: string | null
          competencia: string
          fechada_em?: string
          lancamentos?: number
          paga_em?: string | null
          paga_por?: string | null
          status?: string
          total?: number
        }
        Update: {
          aprovada_em?: string | null
          aprovada_por?: string | null
          competencia?: string
          fechada_em?: string
          lancamentos?: number
          paga_em?: string | null
          paga_por?: string | null
          status?: string
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "comissao_competencias_aprovada_por_fkey"
            columns: ["aprovada_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comissao_competencias_paga_por_fkey"
            columns: ["paga_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      comissao_lancamentos: {
        Row: {
          aprovado_em: string | null
          aprovado_por: string | null
          competencia: string
          criado_em: string
          descricao: string | null
          id: string
          origem_id: string
          origem_tipo: string
          regra_id: string | null
          status: string
          valor: number
          vendedor_id: string
        }
        Insert: {
          aprovado_em?: string | null
          aprovado_por?: string | null
          competencia: string
          criado_em?: string
          descricao?: string | null
          id?: string
          origem_id: string
          origem_tipo: string
          regra_id?: string | null
          status?: string
          valor: number
          vendedor_id: string
        }
        Update: {
          aprovado_em?: string | null
          aprovado_por?: string | null
          competencia?: string
          criado_em?: string
          descricao?: string | null
          id?: string
          origem_id?: string
          origem_tipo?: string
          regra_id?: string | null
          status?: string
          valor?: number
          vendedor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comissao_lancamentos_aprovado_por_fkey"
            columns: ["aprovado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comissao_lancamentos_regra_id_fkey"
            columns: ["regra_id"]
            isOneToOne: false
            referencedRelation: "comissao_regras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comissao_lancamentos_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
        ]
      }
      comissao_lancamentos_v2: {
        Row: {
          anticipation_days: number | null
          aprovado_em: string | null
          aprovado_por: string | null
          cedente_cnpj: string | null
          cedente_nome: string | null
          competencia: string
          criado_em: string
          descricao: string | null
          empresa_id: string | null
          evento_em: string
          fase: string | null
          gestao_operacao: string | null
          id: string
          nf_numero: string | null
          origem_id: string
          origem_tipo: string
          papel: string
          params_snapshot: Json
          share_pct: number
          status: string
          taxa_brl_por_mm: number | null
          valor: number
          valor_cedido: number | null
          vendedor_id: string
          vop: number | null
        }
        Insert: {
          anticipation_days?: number | null
          aprovado_em?: string | null
          aprovado_por?: string | null
          cedente_cnpj?: string | null
          cedente_nome?: string | null
          competencia: string
          criado_em?: string
          descricao?: string | null
          empresa_id?: string | null
          evento_em?: string
          fase?: string | null
          gestao_operacao?: string | null
          id?: string
          nf_numero?: string | null
          origem_id: string
          origem_tipo: string
          papel: string
          params_snapshot?: Json
          share_pct?: number
          status?: string
          taxa_brl_por_mm?: number | null
          valor: number
          valor_cedido?: number | null
          vendedor_id: string
          vop?: number | null
        }
        Update: {
          anticipation_days?: number | null
          aprovado_em?: string | null
          aprovado_por?: string | null
          cedente_cnpj?: string | null
          cedente_nome?: string | null
          competencia?: string
          criado_em?: string
          descricao?: string | null
          empresa_id?: string | null
          evento_em?: string
          fase?: string | null
          gestao_operacao?: string | null
          id?: string
          nf_numero?: string | null
          origem_id?: string
          origem_tipo?: string
          papel?: string
          params_snapshot?: Json
          share_pct?: number
          status?: string
          taxa_brl_por_mm?: number | null
          valor?: number
          valor_cedido?: number | null
          vendedor_id?: string
          vop?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "comissao_lancamentos_v2_aprovado_por_fkey"
            columns: ["aprovado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comissao_lancamentos_v2_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "comissao_lancamentos_v2_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "comissao_lancamentos_v2_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "comissao_lancamentos_v2_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "comissao_lancamentos_v2_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comissao_lancamentos_v2_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "comissao_lancamentos_v2_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
        ]
      }
      comissao_regras: {
        Row: {
          criada_em: string
          criada_por: string | null
          id: string
          parametros: Json
          tipo_vendedor: string
          vendedor_id: string | null
          vigente_ate: string | null
          vigente_de: string
        }
        Insert: {
          criada_em?: string
          criada_por?: string | null
          id?: string
          parametros: Json
          tipo_vendedor: string
          vendedor_id?: string | null
          vigente_ate?: string | null
          vigente_de: string
        }
        Update: {
          criada_em?: string
          criada_por?: string | null
          id?: string
          parametros?: Json
          tipo_vendedor?: string
          vendedor_id?: string | null
          vigente_ate?: string | null
          vigente_de?: string
        }
        Relationships: [
          {
            foreignKeyName: "comissao_regras_criada_por_fkey"
            columns: ["criada_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comissao_regras_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_params: {
        Row: {
          chave: string
          criado_em: string
          criado_por: string | null
          id: string
          unidade: string
          valor: number
          vendedor_id: string | null
          vigente_ate: string | null
          vigente_de: string
        }
        Insert: {
          chave: string
          criado_em?: string
          criado_por?: string | null
          id?: string
          unidade: string
          valor: number
          vendedor_id?: string | null
          vigente_ate?: string | null
          vigente_de: string
        }
        Update: {
          chave?: string
          criado_em?: string
          criado_por?: string | null
          id?: string
          unidade?: string
          valor?: number
          vendedor_id?: string | null
          vigente_ate?: string | null
          vigente_de?: string
        }
        Relationships: [
          {
            foreignKeyName: "commission_params_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_params_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
        ]
      }
      comunicacao_config: {
        Row: {
          atualizado_em: string
          atualizado_por: string | null
          chave: string
          valor: Json
        }
        Insert: {
          atualizado_em?: string
          atualizado_por?: string | null
          chave: string
          valor: Json
        }
        Update: {
          atualizado_em?: string
          atualizado_por?: string | null
          chave?: string
          valor?: Json
        }
        Relationships: [
          {
            foreignKeyName: "comunicacao_config_atualizado_por_fkey"
            columns: ["atualizado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      comunicacoes: {
        Row: {
          anexos: Json
          assunto: string | null
          campanha_id: string | null
          canal: string
          conta_remetente: string | null
          contato_id: string | null
          conversa_id: string | null
          corpo: string | null
          criado_em: string
          direcao: string
          empresa_id: string | null
          enviado_em: string | null
          erro: string | null
          funil: string | null
          funil_card_id: string | null
          id: string
          id_externo: string | null
          origem: string | null
          por_ia: boolean
          preview: string | null
          provedor: string | null
          status_envio: string | null
          template_id: string | null
          tentativas: number
          thread_externa: string | null
          triagem: Json | null
          usuario_id: string | null
          vendedor_id: string | null
        }
        Insert: {
          anexos?: Json
          assunto?: string | null
          campanha_id?: string | null
          canal: string
          conta_remetente?: string | null
          contato_id?: string | null
          conversa_id?: string | null
          corpo?: string | null
          criado_em?: string
          direcao: string
          empresa_id?: string | null
          enviado_em?: string | null
          erro?: string | null
          funil?: string | null
          funil_card_id?: string | null
          id?: string
          id_externo?: string | null
          origem?: string | null
          por_ia?: boolean
          preview?: string | null
          provedor?: string | null
          status_envio?: string | null
          template_id?: string | null
          tentativas?: number
          thread_externa?: string | null
          triagem?: Json | null
          usuario_id?: string | null
          vendedor_id?: string | null
        }
        Update: {
          anexos?: Json
          assunto?: string | null
          campanha_id?: string | null
          canal?: string
          conta_remetente?: string | null
          contato_id?: string | null
          conversa_id?: string | null
          corpo?: string | null
          criado_em?: string
          direcao?: string
          empresa_id?: string | null
          enviado_em?: string | null
          erro?: string | null
          funil?: string | null
          funil_card_id?: string | null
          id?: string
          id_externo?: string | null
          origem?: string | null
          por_ia?: boolean
          preview?: string | null
          provedor?: string | null
          status_envio?: string | null
          template_id?: string | null
          tentativas?: number
          thread_externa?: string | null
          triagem?: Json | null
          usuario_id?: string | null
          vendedor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "comunicacoes_campanha_id_fkey"
            columns: ["campanha_id"]
            isOneToOne: false
            referencedRelation: "campanhas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comunicacoes_campanha_id_fkey"
            columns: ["campanha_id"]
            isOneToOne: false
            referencedRelation: "campanhas_lista"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comunicacoes_contato_id_fkey"
            columns: ["contato_id"]
            isOneToOne: false
            referencedRelation: "contatos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comunicacoes_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "conversas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comunicacoes_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "inbox_conversas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comunicacoes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "comunicacoes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "comunicacoes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "comunicacoes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "comunicacoes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comunicacoes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "comunicacoes_template_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "templates_mensagem"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comunicacoes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comunicacoes_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
        ]
      }
      condicoes_comerciais: {
        Row: {
          ajustes: Json | null
          analise_credito_id: string
          bill_fine_percent: number
          cnpj: string
          commission_percent: number
          credit_limit: number
          criada_em: string
          definida_por: string | null
          empresa_id: string | null
          erro_validacao: string | null
          expires_at: string
          extension_rate_percent: number
          fee_d0: number
          fee_d1: number
          fee_min_d0: number
          fee_min_d1: number
          fidc_ready: boolean
          has_insurance: boolean
          has_referral: boolean
          id: string
          invest_back_commission_percent: number
          invest_back_limit: number
          matriz_versao: number
          max_due_date_days: number
          max_invoice_amount: number
          monthly_rate_d0: number
          monthly_rate_d1: number
          publicada_em: string | null
          status: string
          sugestao: Json
        }
        Insert: {
          ajustes?: Json | null
          analise_credito_id: string
          bill_fine_percent: number
          cnpj: string
          commission_percent: number
          credit_limit: number
          criada_em?: string
          definida_por?: string | null
          empresa_id?: string | null
          erro_validacao?: string | null
          expires_at: string
          extension_rate_percent: number
          fee_d0: number
          fee_d1: number
          fee_min_d0: number
          fee_min_d1: number
          fidc_ready?: boolean
          has_insurance: boolean
          has_referral?: boolean
          id?: string
          invest_back_commission_percent?: number
          invest_back_limit?: number
          matriz_versao: number
          max_due_date_days: number
          max_invoice_amount: number
          monthly_rate_d0: number
          monthly_rate_d1: number
          publicada_em?: string | null
          status?: string
          sugestao: Json
        }
        Update: {
          ajustes?: Json | null
          analise_credito_id?: string
          bill_fine_percent?: number
          cnpj?: string
          commission_percent?: number
          credit_limit?: number
          criada_em?: string
          definida_por?: string | null
          empresa_id?: string | null
          erro_validacao?: string | null
          expires_at?: string
          extension_rate_percent?: number
          fee_d0?: number
          fee_d1?: number
          fee_min_d0?: number
          fee_min_d1?: number
          fidc_ready?: boolean
          has_insurance?: boolean
          has_referral?: boolean
          id?: string
          invest_back_commission_percent?: number
          invest_back_limit?: number
          matriz_versao?: number
          max_due_date_days?: number
          max_invoice_amount?: number
          monthly_rate_d0?: number
          monthly_rate_d1?: number
          publicada_em?: string | null
          status?: string
          sugestao?: Json
        }
        Relationships: [
          {
            foreignKeyName: "condicoes_comerciais_analise_credito_id_fkey"
            columns: ["analise_credito_id"]
            isOneToOne: false
            referencedRelation: "analise_vigente"
            referencedColumns: ["analise_id"]
          },
          {
            foreignKeyName: "condicoes_comerciais_analise_credito_id_fkey"
            columns: ["analise_credito_id"]
            isOneToOne: false
            referencedRelation: "analises_credito"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "condicoes_comerciais_definida_por_fkey"
            columns: ["definida_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "condicoes_comerciais_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "condicoes_comerciais_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "condicoes_comerciais_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "condicoes_comerciais_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "condicoes_comerciais_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "condicoes_comerciais_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "condicoes_comerciais_matriz_versao_fkey"
            columns: ["matriz_versao"]
            isOneToOne: false
            referencedRelation: "precificacao_matriz"
            referencedColumns: ["versao"]
          },
        ]
      }
      conta_fase_historico: {
        Row: {
          alterado_em: string
          alterado_por: string | null
          empresa_id: string
          fase_anterior: string | null
          fase_nova: string | null
          id: string
          marco_anterior: string | null
          marco_novo: string | null
          motivo: string
        }
        Insert: {
          alterado_em?: string
          alterado_por?: string | null
          empresa_id: string
          fase_anterior?: string | null
          fase_nova?: string | null
          id?: string
          marco_anterior?: string | null
          marco_novo?: string | null
          motivo: string
        }
        Update: {
          alterado_em?: string
          alterado_por?: string | null
          empresa_id?: string
          fase_anterior?: string | null
          fase_nova?: string | null
          id?: string
          marco_anterior?: string | null
          marco_novo?: string | null
          motivo?: string
        }
        Relationships: [
          {
            foreignKeyName: "conta_fase_historico_alterado_por_fkey"
            columns: ["alterado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conta_fase_historico_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "conta_fase_historico_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "conta_fase_historico_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "conta_fase_historico_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "conta_fase_historico_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conta_fase_historico_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      contatos: {
        Row: {
          apollo_person_id: string | null
          base_legal: string | null
          base_legal_detalhe: string | null
          base_legal_em: string | null
          cargo: string | null
          criado_em: string
          departamento: string | null
          email: string | null
          email_status: string | null
          empresa_id: string
          enriquecido_em: string | null
          id: string
          linkedin_url: string | null
          nao_e_o_decisor: boolean
          nome: string | null
          origem: string | null
          origem_interacao: Json | null
          ponto_focal: boolean
          senioridade: string | null
          telefone: string | null
          telefone_status: string | null
          whatsapp: string | null
        }
        Insert: {
          apollo_person_id?: string | null
          base_legal?: string | null
          base_legal_detalhe?: string | null
          base_legal_em?: string | null
          cargo?: string | null
          criado_em?: string
          departamento?: string | null
          email?: string | null
          email_status?: string | null
          empresa_id: string
          enriquecido_em?: string | null
          id?: string
          linkedin_url?: string | null
          nao_e_o_decisor?: boolean
          nome?: string | null
          origem?: string | null
          origem_interacao?: Json | null
          ponto_focal?: boolean
          senioridade?: string | null
          telefone?: string | null
          telefone_status?: string | null
          whatsapp?: string | null
        }
        Update: {
          apollo_person_id?: string | null
          base_legal?: string | null
          base_legal_detalhe?: string | null
          base_legal_em?: string | null
          cargo?: string | null
          criado_em?: string
          departamento?: string | null
          email?: string | null
          email_status?: string | null
          empresa_id?: string
          enriquecido_em?: string | null
          id?: string
          linkedin_url?: string | null
          nao_e_o_decisor?: boolean
          nome?: string | null
          origem?: string | null
          origem_interacao?: Json | null
          ponto_focal?: boolean
          senioridade?: string | null
          telefone?: string | null
          telefone_status?: string | null
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contatos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "contatos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "contatos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "contatos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "contatos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contatos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      contatos_descobertos: {
        Row: {
          atualizado_em: string
          cargo: string | null
          confianca: string
          descoberto_em: string
          evidencia: string | null
          fonte: string
          fornecedor_cnpj: string
          frequencia: number
          id: string
          nome_pessoa: string | null
          promovido_contato_id: string | null
          tipo: string
          ultima_vez_visto: string | null
          validado: Json
          valor: string
          valor_original: string | null
        }
        Insert: {
          atualizado_em?: string
          cargo?: string | null
          confianca: string
          descoberto_em?: string
          evidencia?: string | null
          fonte: string
          fornecedor_cnpj: string
          frequencia?: number
          id?: string
          nome_pessoa?: string | null
          promovido_contato_id?: string | null
          tipo: string
          ultima_vez_visto?: string | null
          validado?: Json
          valor: string
          valor_original?: string | null
        }
        Update: {
          atualizado_em?: string
          cargo?: string | null
          confianca?: string
          descoberto_em?: string
          evidencia?: string | null
          fonte?: string
          fornecedor_cnpj?: string
          frequencia?: number
          id?: string
          nome_pessoa?: string | null
          promovido_contato_id?: string | null
          tipo?: string
          ultima_vez_visto?: string | null
          validado?: Json
          valor?: string
          valor_original?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contatos_descobertos_promovido_contato_id_fkey"
            columns: ["promovido_contato_id"]
            isOneToOne: false
            referencedRelation: "contatos"
            referencedColumns: ["id"]
          },
        ]
      }
      conversas: {
        Row: {
          atualizada_em: string
          canal: string
          conta_remetente: string | null
          contato_id: string | null
          criada_em: string
          empresa_id: string | null
          id: string
          identificador_externo: string
          lid: string | null
          modo_agente: string
          nao_lidas: number
          objetivo: string | null
          playbook_id: string | null
          proxima_acao_em: string | null
          responsavel_vendedor_id: string | null
          status: string
          ultima_direcao: string | null
          ultima_mensagem_em: string | null
        }
        Insert: {
          atualizada_em?: string
          canal: string
          conta_remetente?: string | null
          contato_id?: string | null
          criada_em?: string
          empresa_id?: string | null
          id?: string
          identificador_externo: string
          lid?: string | null
          modo_agente?: string
          nao_lidas?: number
          objetivo?: string | null
          playbook_id?: string | null
          proxima_acao_em?: string | null
          responsavel_vendedor_id?: string | null
          status?: string
          ultima_direcao?: string | null
          ultima_mensagem_em?: string | null
        }
        Update: {
          atualizada_em?: string
          canal?: string
          conta_remetente?: string | null
          contato_id?: string | null
          criada_em?: string
          empresa_id?: string | null
          id?: string
          identificador_externo?: string
          lid?: string | null
          modo_agente?: string
          nao_lidas?: number
          objetivo?: string | null
          playbook_id?: string | null
          proxima_acao_em?: string | null
          responsavel_vendedor_id?: string | null
          status?: string
          ultima_direcao?: string | null
          ultima_mensagem_em?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversas_contato_id_fkey"
            columns: ["contato_id"]
            isOneToOne: false
            referencedRelation: "contatos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "conversas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "conversas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "conversas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "conversas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "conversas_playbook_fkey"
            columns: ["playbook_id"]
            isOneToOne: false
            referencedRelation: "agente_playbooks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversas_responsavel_vendedor_id_fkey"
            columns: ["responsavel_vendedor_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
        ]
      }
      conversas_nao_vinculadas: {
        Row: {
          canal: string
          conta_recebedora: string | null
          id: string
          identificador_externo: string
          lid: string | null
          nome_sugerido: string | null
          primeira_mensagem_em: string
          qtd_mensagens: number
          resolvida_em: string | null
          resolvida_por: string | null
          status: string
          ultima_mensagem_em: string
          vendedor_sugerido_id: string | null
          vinculada_contato_id: string | null
        }
        Insert: {
          canal: string
          conta_recebedora?: string | null
          id?: string
          identificador_externo: string
          lid?: string | null
          nome_sugerido?: string | null
          primeira_mensagem_em?: string
          qtd_mensagens?: number
          resolvida_em?: string | null
          resolvida_por?: string | null
          status?: string
          ultima_mensagem_em?: string
          vendedor_sugerido_id?: string | null
          vinculada_contato_id?: string | null
        }
        Update: {
          canal?: string
          conta_recebedora?: string | null
          id?: string
          identificador_externo?: string
          lid?: string | null
          nome_sugerido?: string | null
          primeira_mensagem_em?: string
          qtd_mensagens?: number
          resolvida_em?: string | null
          resolvida_por?: string | null
          status?: string
          ultima_mensagem_em?: string
          vendedor_sugerido_id?: string | null
          vinculada_contato_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversas_nao_vinculadas_resolvida_por_fkey"
            columns: ["resolvida_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversas_nao_vinculadas_vendedor_sugerido_id_fkey"
            columns: ["vendedor_sugerido_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversas_nao_vinculadas_vinculada_contato_id_fkey"
            columns: ["vinculada_contato_id"]
            isOneToOne: false
            referencedRelation: "contatos"
            referencedColumns: ["id"]
          },
        ]
      }
      conversas_ocultas: {
        Row: {
          conversa_id: string
          motivo: string | null
          ocultada_em: string
          usuario_id: string
        }
        Insert: {
          conversa_id: string
          motivo?: string | null
          ocultada_em?: string
          usuario_id: string
        }
        Update: {
          conversa_id?: string
          motivo?: string | null
          ocultada_em?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversas_ocultas_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "conversas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversas_ocultas_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "inbox_conversas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversas_ocultas_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      credito_config: {
        Row: {
          atualizado_em: string
          atualizado_por: string | null
          chave: string
          valor: Json
        }
        Insert: {
          atualizado_em?: string
          atualizado_por?: string | null
          chave: string
          valor: Json
        }
        Update: {
          atualizado_em?: string
          atualizado_por?: string | null
          chave?: string
          valor?: Json
        }
        Relationships: [
          {
            foreignKeyName: "credito_config_atualizado_por_fkey"
            columns: ["atualizado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      credito_snapshots: {
        Row: {
          analisado_cnpj: string | null
          available_limit: number | null
          capturado_em: string
          cnpj: string
          consumed_limit: number | null
          credit_limit: number | null
          expiration_date: string | null
          id: string
          monthly_rate_d0: number | null
          monthly_rate_d1: number | null
          origem: string
          role: string | null
          status: string | null
          via_headquarters: boolean | null
        }
        Insert: {
          analisado_cnpj?: string | null
          available_limit?: number | null
          capturado_em?: string
          cnpj: string
          consumed_limit?: number | null
          credit_limit?: number | null
          expiration_date?: string | null
          id?: string
          monthly_rate_d0?: number | null
          monthly_rate_d1?: number | null
          origem?: string
          role?: string | null
          status?: string | null
          via_headquarters?: boolean | null
        }
        Update: {
          analisado_cnpj?: string | null
          available_limit?: number | null
          capturado_em?: string
          cnpj?: string
          consumed_limit?: number | null
          credit_limit?: number | null
          expiration_date?: string | null
          id?: string
          monthly_rate_d0?: number | null
          monthly_rate_d1?: number | null
          origem?: string
          role?: string | null
          status?: string | null
          via_headquarters?: boolean | null
        }
        Relationships: []
      }
      credito_versoes: {
        Row: {
          ativa: boolean
          calibrado_em: string
          coeficientes: Json
          id: string
          n_amostras_por_tipo: Json
          versao: number
        }
        Insert: {
          ativa?: boolean
          calibrado_em?: string
          coeficientes: Json
          id?: string
          n_amostras_por_tipo?: Json
          versao: number
        }
        Update: {
          ativa?: boolean
          calibrado_em?: string
          coeficientes?: Json
          id?: string
          n_amostras_por_tipo?: Json
          versao?: number
        }
        Relationships: []
      }
      cron_execucoes: {
        Row: {
          acompanhado: boolean
          aviso: string | null
          erro: string | null
          esperado_em: string | null
          id: string
          iniciado_em: string
          job_id: string | null
          notificado_em: string | null
          path: string
          status: string
          terminado_em: string | null
        }
        Insert: {
          acompanhado?: boolean
          aviso?: string | null
          erro?: string | null
          esperado_em?: string | null
          id?: string
          iniciado_em?: string
          job_id?: string | null
          notificado_em?: string | null
          path: string
          status?: string
          terminado_em?: string | null
        }
        Update: {
          acompanhado?: boolean
          aviso?: string | null
          erro?: string | null
          esperado_em?: string | null
          id?: string
          iniciado_em?: string
          job_id?: string | null
          notificado_em?: string | null
          path?: string
          status?: string
          terminado_em?: string | null
        }
        Relationships: []
      }
      descoberta_execucoes: {
        Row: {
          camada: string
          contatos_novos: number
          custo: number
          executado_em: string
          fornecedor_cnpj: string
          id: string
          motivo: string | null
          originador_id: string | null
          provedor: string
          solicitado_por: string | null
          status: string
        }
        Insert: {
          camada: string
          contatos_novos?: number
          custo?: number
          executado_em?: string
          fornecedor_cnpj: string
          id?: string
          motivo?: string | null
          originador_id?: string | null
          provedor: string
          solicitado_por?: string | null
          status: string
        }
        Update: {
          camada?: string
          contatos_novos?: number
          custo?: number
          executado_em?: string
          fornecedor_cnpj?: string
          id?: string
          motivo?: string | null
          originador_id?: string | null
          provedor?: string
          solicitado_por?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "descoberta_execucoes_originador_id_fkey"
            columns: ["originador_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "descoberta_execucoes_solicitado_por_fkey"
            columns: ["solicitado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      email_caixas: {
        Row: {
          access_token_expira_em: string | null
          access_token_secret_id: string | null
          ativa: boolean
          conectada_em: string | null
          conectada_por: string | null
          criada_em: string
          endereco: string
          escopos: string[]
          history_id: string | null
          id: string
          identificador_externo: string | null
          provedor: string
          refresh_token_secret_id: string | null
          ultimo_erro: string | null
          ultimo_sync_em: string | null
          watch_expira_em: string | null
        }
        Insert: {
          access_token_expira_em?: string | null
          access_token_secret_id?: string | null
          ativa?: boolean
          conectada_em?: string | null
          conectada_por?: string | null
          criada_em?: string
          endereco: string
          escopos?: string[]
          history_id?: string | null
          id?: string
          identificador_externo?: string | null
          provedor: string
          refresh_token_secret_id?: string | null
          ultimo_erro?: string | null
          ultimo_sync_em?: string | null
          watch_expira_em?: string | null
        }
        Update: {
          access_token_expira_em?: string | null
          access_token_secret_id?: string | null
          ativa?: boolean
          conectada_em?: string | null
          conectada_por?: string | null
          criada_em?: string
          endereco?: string
          escopos?: string[]
          history_id?: string | null
          id?: string
          identificador_externo?: string | null
          provedor?: string
          refresh_token_secret_id?: string | null
          ultimo_erro?: string | null
          ultimo_sync_em?: string | null
          watch_expira_em?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_caixas_conectada_por_fkey"
            columns: ["conectada_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      empresa_eventos: {
        Row: {
          ator_usuario_id: string | null
          criado_em: string
          empresa_id: string | null
          id: string
          payload: Json
          tipo: string
        }
        Insert: {
          ator_usuario_id?: string | null
          criado_em?: string
          empresa_id?: string | null
          id?: string
          payload?: Json
          tipo: string
        }
        Update: {
          ator_usuario_id?: string | null
          criado_em?: string
          empresa_id?: string | null
          id?: string
          payload?: Json
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "empresa_eventos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "empresa_eventos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "empresa_eventos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "empresa_eventos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "empresa_eventos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "empresa_eventos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      empresa_metricas: {
        Row: {
          capturado_em: string
          cnpj: string
          confianca: string | null
          detalhes: Json
          empresa_id: string | null
          id: string
          metrica: string
          origem: string
          valor: number
        }
        Insert: {
          capturado_em?: string
          cnpj: string
          confianca?: string | null
          detalhes?: Json
          empresa_id?: string | null
          id?: string
          metrica: string
          origem: string
          valor: number
        }
        Update: {
          capturado_em?: string
          cnpj?: string
          confianca?: string | null
          detalhes?: Json
          empresa_id?: string | null
          id?: string
          metrica?: string
          origem?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "empresa_metricas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "empresa_metricas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "empresa_metricas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "empresa_metricas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "empresa_metricas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "empresa_metricas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      empresa_notas: {
        Row: {
          autor_usuario_id: string
          conteudo: string
          criado_em: string
          empresa_id: string
          id: string
        }
        Insert: {
          autor_usuario_id: string
          conteudo: string
          criado_em?: string
          empresa_id: string
          id?: string
        }
        Update: {
          autor_usuario_id?: string
          conteudo?: string
          criado_em?: string
          empresa_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "empresa_notas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "empresa_notas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "empresa_notas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "empresa_notas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "empresa_notas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "empresa_notas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      empresa_scores: {
        Row: {
          breakdown: Json
          calculado_em: string
          cnpj: string
          completude: number
          empresa_id: string | null
          faixa: string
          id: string
          knockout: string | null
          score: number | null
          scorecard_versao: number | null
        }
        Insert: {
          breakdown?: Json
          calculado_em?: string
          cnpj: string
          completude: number
          empresa_id?: string | null
          faixa: string
          id?: string
          knockout?: string | null
          score?: number | null
          scorecard_versao?: number | null
        }
        Update: {
          breakdown?: Json
          calculado_em?: string
          cnpj?: string
          completude?: number
          empresa_id?: string | null
          faixa?: string
          id?: string
          knockout?: string | null
          score?: number | null
          scorecard_versao?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "empresa_scores_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "empresa_scores_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "empresa_scores_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "empresa_scores_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "empresa_scores_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "empresa_scores_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      empresa_sugestoes_cadastro: {
        Row: {
          analise_id: string | null
          campo: string
          contato_id: string | null
          criada_em: string
          decidida_em: string | null
          decidida_por: string | null
          empresa_id: string
          id: string
          origem: string
          status: string
          valor_atual: string | null
          valor_sugerido: string
        }
        Insert: {
          analise_id?: string | null
          campo: string
          contato_id?: string | null
          criada_em?: string
          decidida_em?: string | null
          decidida_por?: string | null
          empresa_id: string
          id?: string
          origem?: string
          status?: string
          valor_atual?: string | null
          valor_sugerido: string
        }
        Update: {
          analise_id?: string | null
          campo?: string
          contato_id?: string | null
          criada_em?: string
          decidida_em?: string | null
          decidida_por?: string | null
          empresa_id?: string
          id?: string
          origem?: string
          status?: string
          valor_atual?: string | null
          valor_sugerido?: string
        }
        Relationships: [
          {
            foreignKeyName: "empresa_sugestoes_cadastro_analise_id_fkey"
            columns: ["analise_id"]
            isOneToOne: false
            referencedRelation: "analises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "empresa_sugestoes_cadastro_contato_id_fkey"
            columns: ["contato_id"]
            isOneToOne: false
            referencedRelation: "contatos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "empresa_sugestoes_cadastro_decidida_por_fkey"
            columns: ["decidida_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "empresa_sugestoes_cadastro_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "empresa_sugestoes_cadastro_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "empresa_sugestoes_cadastro_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "empresa_sugestoes_cadastro_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "empresa_sugestoes_cadastro_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "empresa_sugestoes_cadastro_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      empresas: {
        Row: {
          atualizado_em: string
          bloqueio_cobranca: boolean
          bloqueio_cobranca_cobranca_id: string | null
          bloqueio_cobranca_em: string | null
          bloqueio_cobranca_motivo: string | null
          camada: string | null
          chance_concessao: number | null
          churn_erp_concorrente: boolean
          cnae_principal: string | null
          cnpj: string
          credito_calculado_em: string | null
          credito_revisao_desde: string | null
          credito_revisao_pos_inadimplencia: boolean
          credito_versao: number | null
          criado_em: string
          dados_apollo: Json | null
          dominio: string | null
          dominio_confianca: string | null
          dominio_evidencia: string | null
          dominio_origem: string | null
          dominio_validado_em: string | null
          erp_atual: string | null
          erp_canal_venda: string | null
          erp_detalhes: Json
          erp_mrr: number | null
          estagio: string
          ex_cliente_desde: string | null
          ex_cliente_motivo: string | null
          ex_cliente_motivo_obs: string | null
          fase_manual: string | null
          faturamento_anual: number | null
          faturamento_atualizado_em: string | null
          faturamento_confianca: string | null
          faturamento_origem: string | null
          funcionarios: number | null
          funcionarios_atualizado_em: string | null
          funcionarios_crescimento_12m: number | null
          funcionarios_origem: string | null
          gestao_definida_em: string | null
          gestao_definida_por: string | null
          gestao_operacao: string | null
          grafo_sefaz: boolean
          grupo_id: string | null
          id: string
          is_spe: boolean
          limite_confianca: string | null
          limite_potencial: number | null
          marco_ativacao: string | null
          municipio: string | null
          nome_fantasia: string | null
          origem: string | null
          patrimonio_atualizado_em: string | null
          patrimonio_liquido: number | null
          patrimonio_origem: string | null
          porte: string | null
          razao_social: string | null
          receita_mensal_prevista: number | null
          receita_taxa_am: number | null
          regime_tributario: string | null
          score_calculado_em: string | null
          score_completude: number | null
          score_credito: number | null
          score_faixa: string | null
          tem_processo_nosso_ativo: boolean
          teve_analise_sem_cadastro: boolean
          tipagem_antecipacao: string | null
          tipo: string
          uf: string | null
          ultima_antecipacao: string | null
          ultima_conversa_em: string | null
          valor_esperado_mensal: number | null
        }
        Insert: {
          atualizado_em?: string
          bloqueio_cobranca?: boolean
          bloqueio_cobranca_cobranca_id?: string | null
          bloqueio_cobranca_em?: string | null
          bloqueio_cobranca_motivo?: string | null
          camada?: string | null
          chance_concessao?: number | null
          churn_erp_concorrente?: boolean
          cnae_principal?: string | null
          cnpj: string
          credito_calculado_em?: string | null
          credito_revisao_desde?: string | null
          credito_revisao_pos_inadimplencia?: boolean
          credito_versao?: number | null
          criado_em?: string
          dados_apollo?: Json | null
          dominio?: string | null
          dominio_confianca?: string | null
          dominio_evidencia?: string | null
          dominio_origem?: string | null
          dominio_validado_em?: string | null
          erp_atual?: string | null
          erp_canal_venda?: string | null
          erp_detalhes?: Json
          erp_mrr?: number | null
          estagio?: string
          ex_cliente_desde?: string | null
          ex_cliente_motivo?: string | null
          ex_cliente_motivo_obs?: string | null
          fase_manual?: string | null
          faturamento_anual?: number | null
          faturamento_atualizado_em?: string | null
          faturamento_confianca?: string | null
          faturamento_origem?: string | null
          funcionarios?: number | null
          funcionarios_atualizado_em?: string | null
          funcionarios_crescimento_12m?: number | null
          funcionarios_origem?: string | null
          gestao_definida_em?: string | null
          gestao_definida_por?: string | null
          gestao_operacao?: string | null
          grafo_sefaz?: boolean
          grupo_id?: string | null
          id?: string
          is_spe?: boolean
          limite_confianca?: string | null
          limite_potencial?: number | null
          marco_ativacao?: string | null
          municipio?: string | null
          nome_fantasia?: string | null
          origem?: string | null
          patrimonio_atualizado_em?: string | null
          patrimonio_liquido?: number | null
          patrimonio_origem?: string | null
          porte?: string | null
          razao_social?: string | null
          receita_mensal_prevista?: number | null
          receita_taxa_am?: number | null
          regime_tributario?: string | null
          score_calculado_em?: string | null
          score_completude?: number | null
          score_credito?: number | null
          score_faixa?: string | null
          tem_processo_nosso_ativo?: boolean
          teve_analise_sem_cadastro?: boolean
          tipagem_antecipacao?: string | null
          tipo?: string
          uf?: string | null
          ultima_antecipacao?: string | null
          ultima_conversa_em?: string | null
          valor_esperado_mensal?: number | null
        }
        Update: {
          atualizado_em?: string
          bloqueio_cobranca?: boolean
          bloqueio_cobranca_cobranca_id?: string | null
          bloqueio_cobranca_em?: string | null
          bloqueio_cobranca_motivo?: string | null
          camada?: string | null
          chance_concessao?: number | null
          churn_erp_concorrente?: boolean
          cnae_principal?: string | null
          cnpj?: string
          credito_calculado_em?: string | null
          credito_revisao_desde?: string | null
          credito_revisao_pos_inadimplencia?: boolean
          credito_versao?: number | null
          criado_em?: string
          dados_apollo?: Json | null
          dominio?: string | null
          dominio_confianca?: string | null
          dominio_evidencia?: string | null
          dominio_origem?: string | null
          dominio_validado_em?: string | null
          erp_atual?: string | null
          erp_canal_venda?: string | null
          erp_detalhes?: Json
          erp_mrr?: number | null
          estagio?: string
          ex_cliente_desde?: string | null
          ex_cliente_motivo?: string | null
          ex_cliente_motivo_obs?: string | null
          fase_manual?: string | null
          faturamento_anual?: number | null
          faturamento_atualizado_em?: string | null
          faturamento_confianca?: string | null
          faturamento_origem?: string | null
          funcionarios?: number | null
          funcionarios_atualizado_em?: string | null
          funcionarios_crescimento_12m?: number | null
          funcionarios_origem?: string | null
          gestao_definida_em?: string | null
          gestao_definida_por?: string | null
          gestao_operacao?: string | null
          grafo_sefaz?: boolean
          grupo_id?: string | null
          id?: string
          is_spe?: boolean
          limite_confianca?: string | null
          limite_potencial?: number | null
          marco_ativacao?: string | null
          municipio?: string | null
          nome_fantasia?: string | null
          origem?: string | null
          patrimonio_atualizado_em?: string | null
          patrimonio_liquido?: number | null
          patrimonio_origem?: string | null
          porte?: string | null
          razao_social?: string | null
          receita_mensal_prevista?: number | null
          receita_taxa_am?: number | null
          regime_tributario?: string | null
          score_calculado_em?: string | null
          score_completude?: number | null
          score_credito?: number | null
          score_faixa?: string | null
          tem_processo_nosso_ativo?: boolean
          teve_analise_sem_cadastro?: boolean
          tipagem_antecipacao?: string | null
          tipo?: string
          uf?: string | null
          ultima_antecipacao?: string | null
          ultima_conversa_em?: string | null
          valor_esperado_mensal?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "empresas_bloqueio_cobranca_cobranca_id_fkey"
            columns: ["bloqueio_cobranca_cobranca_id"]
            isOneToOne: false
            referencedRelation: "cobranca_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "empresas_bloqueio_cobranca_cobranca_id_fkey"
            columns: ["bloqueio_cobranca_cobranca_id"]
            isOneToOne: false
            referencedRelation: "cobrancas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "empresas_ex_cliente_motivo_fkey"
            columns: ["ex_cliente_motivo"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["motivo_sugerido"]
          },
          {
            foreignKeyName: "empresas_ex_cliente_motivo_fkey"
            columns: ["ex_cliente_motivo"]
            isOneToOne: false
            referencedRelation: "motivos_perda"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "empresas_gestao_definida_por_fkey"
            columns: ["gestao_definida_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "empresas_grupo_id_fkey"
            columns: ["grupo_id"]
            isOneToOne: false
            referencedRelation: "grupos_economicos"
            referencedColumns: ["id"]
          },
        ]
      }
      enriquecimentos: {
        Row: {
          cnpj: string | null
          custo_estimado: number | null
          custo_real: number | null
          dominio: string | null
          empresa_id: string | null
          erro: string | null
          executado_em: string
          fonte: string
          id: string
          lote_id: string | null
          payload: Json | null
          status: string
          tipo: string
          unidades_retornadas: number | null
        }
        Insert: {
          cnpj?: string | null
          custo_estimado?: number | null
          custo_real?: number | null
          dominio?: string | null
          empresa_id?: string | null
          erro?: string | null
          executado_em?: string
          fonte: string
          id?: string
          lote_id?: string | null
          payload?: Json | null
          status: string
          tipo: string
          unidades_retornadas?: number | null
        }
        Update: {
          cnpj?: string | null
          custo_estimado?: number | null
          custo_real?: number | null
          dominio?: string | null
          empresa_id?: string | null
          erro?: string | null
          executado_em?: string
          fonte?: string
          id?: string
          lote_id?: string | null
          payload?: Json | null
          status?: string
          tipo?: string
          unidades_retornadas?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "enriquecimentos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "enriquecimentos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "enriquecimentos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "enriquecimentos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "enriquecimentos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enriquecimentos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "enriquecimentos_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "lotes_enriquecimento"
            referencedColumns: ["id"]
          },
        ]
      }
      estimador_versoes: {
        Row: {
          ativa: boolean
          calibrado_em: string
          coeficientes: Json
          erro_mediano_por_modelo: Json
          id: string
          n_amostras_por_tipo: Json
          versao: number
        }
        Insert: {
          ativa?: boolean
          calibrado_em?: string
          coeficientes: Json
          erro_mediano_por_modelo?: Json
          id?: string
          n_amostras_por_tipo?: Json
          versao: number
        }
        Update: {
          ativa?: boolean
          calibrado_em?: string
          coeficientes?: Json
          erro_mediano_por_modelo?: Json
          id?: string
          n_amostras_por_tipo?: Json
          versao?: number
        }
        Relationships: []
      }
      ex_clientes_ocultos: {
        Row: {
          cnpj: string
          oculto_em: string
          oculto_por: string | null
        }
        Insert: {
          cnpj: string
          oculto_em?: string
          oculto_por?: string | null
        }
        Update: {
          cnpj?: string
          oculto_em?: string
          oculto_por?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ex_clientes_ocultos_oculto_por_fkey"
            columns: ["oculto_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      faixa_disparos: {
        Row: {
          assunto_email: string | null
          atualizado_em: string
          atualizado_por: string | null
          cooldown_dias: number
          email_habilitado: boolean
          faixa: string
          template_email: string | null
          template_whatsapp: string | null
          whatsapp_contas: string[]
          whatsapp_habilitado: boolean
        }
        Insert: {
          assunto_email?: string | null
          atualizado_em?: string
          atualizado_por?: string | null
          cooldown_dias?: number
          email_habilitado?: boolean
          faixa: string
          template_email?: string | null
          template_whatsapp?: string | null
          whatsapp_contas?: string[]
          whatsapp_habilitado?: boolean
        }
        Update: {
          assunto_email?: string | null
          atualizado_em?: string
          atualizado_por?: string | null
          cooldown_dias?: number
          email_habilitado?: boolean
          faixa?: string
          template_email?: string | null
          template_whatsapp?: string | null
          whatsapp_contas?: string[]
          whatsapp_habilitado?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "faixa_disparos_atualizado_por_fkey"
            columns: ["atualizado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      faixa_regras: {
        Row: {
          ativa: boolean
          criada_em: string
          criada_por: string | null
          definicao: Json
          faixa: string
          id: string
          versao: number
        }
        Insert: {
          ativa?: boolean
          criada_em?: string
          criada_por?: string | null
          definicao: Json
          faixa: string
          id?: string
          versao: number
        }
        Update: {
          ativa?: boolean
          criada_em?: string
          criada_por?: string | null
          definicao?: Json
          faixa?: string
          id?: string
          versao?: number
        }
        Relationships: [
          {
            foreignKeyName: "faixa_regras_criada_por_fkey"
            columns: ["criada_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      fireflies_webhooks: {
        Row: {
          assinatura_ok: boolean
          chave: string | null
          client_reference_id: string | null
          conhecido: boolean
          corpo: Json | null
          corpo_texto: string | null
          erro: string | null
          evento: string | null
          id: string
          meeting_id: string | null
          processado_em: string | null
          recebido_em: string
          reuniao_id: string | null
          status_http: number | null
          tentativas: number
        }
        Insert: {
          assinatura_ok: boolean
          chave?: string | null
          client_reference_id?: string | null
          conhecido?: boolean
          corpo?: Json | null
          corpo_texto?: string | null
          erro?: string | null
          evento?: string | null
          id?: string
          meeting_id?: string | null
          processado_em?: string | null
          recebido_em?: string
          reuniao_id?: string | null
          status_http?: number | null
          tentativas?: number
        }
        Update: {
          assinatura_ok?: boolean
          chave?: string | null
          client_reference_id?: string | null
          conhecido?: boolean
          corpo?: Json | null
          corpo_texto?: string | null
          erro?: string | null
          evento?: string | null
          id?: string
          meeting_id?: string | null
          processado_em?: string | null
          recebido_em?: string
          reuniao_id?: string | null
          status_http?: number | null
          tentativas?: number
        }
        Relationships: [
          {
            foreignKeyName: "fireflies_webhooks_reuniao_id_fkey"
            columns: ["reuniao_id"]
            isOneToOne: false
            referencedRelation: "reunioes"
            referencedColumns: ["id"]
          },
        ]
      }
      fireflies_resgates: {
        Row: {
          enviado_em: string | null
          erro: string | null
          id: string
          pedido_em: string
          pedido_por: string | null
          reuniao_id: string
          status: string
        }
        Insert: {
          enviado_em?: string | null
          erro?: string | null
          id?: string
          pedido_em?: string
          pedido_por?: string | null
          reuniao_id: string
          status?: string
        }
        Update: {
          enviado_em?: string | null
          erro?: string | null
          id?: string
          pedido_em?: string
          pedido_por?: string | null
          reuniao_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "fireflies_resgates_pedido_por_fkey"
            columns: ["pedido_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fireflies_resgates_reuniao_id_fkey"
            columns: ["reuniao_id"]
            isOneToOne: false
            referencedRelation: "reunioes"
            referencedColumns: ["id"]
          },
        ]
      }
      formulario_submissoes: {
        Row: {
          campos_snapshot: Json
          cnpj: string | null
          consentimento_aceito: boolean | null
          consentimento_em: string | null
          contato_id: string | null
          criada_em: string
          dados: Json
          divergencia_papel: boolean
          empresa_id: string | null
          enriquecimento_resultado: Json | null
          erro: string | null
          formulario_id: string | null
          id: string
          intencao: string | null
          ip_hash: string | null
          motivo_revisao: string | null
          pagina_url: string | null
          processada_em: string | null
          referrer: string | null
          sdr_lead_id: string | null
          status: string
          user_agent: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          campos_snapshot: Json
          cnpj?: string | null
          consentimento_aceito?: boolean | null
          consentimento_em?: string | null
          contato_id?: string | null
          criada_em?: string
          dados: Json
          divergencia_papel?: boolean
          empresa_id?: string | null
          enriquecimento_resultado?: Json | null
          erro?: string | null
          formulario_id?: string | null
          id?: string
          intencao?: string | null
          ip_hash?: string | null
          motivo_revisao?: string | null
          pagina_url?: string | null
          processada_em?: string | null
          referrer?: string | null
          sdr_lead_id?: string | null
          status?: string
          user_agent?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          campos_snapshot?: Json
          cnpj?: string | null
          consentimento_aceito?: boolean | null
          consentimento_em?: string | null
          contato_id?: string | null
          criada_em?: string
          dados?: Json
          divergencia_papel?: boolean
          empresa_id?: string | null
          enriquecimento_resultado?: Json | null
          erro?: string | null
          formulario_id?: string | null
          id?: string
          intencao?: string | null
          ip_hash?: string | null
          motivo_revisao?: string | null
          pagina_url?: string | null
          processada_em?: string | null
          referrer?: string | null
          sdr_lead_id?: string | null
          status?: string
          user_agent?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "formulario_submissoes_contato_id_fkey"
            columns: ["contato_id"]
            isOneToOne: false
            referencedRelation: "contatos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "formulario_submissoes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "formulario_submissoes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "formulario_submissoes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "formulario_submissoes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "formulario_submissoes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "formulario_submissoes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "formulario_submissoes_formulario_id_fkey"
            columns: ["formulario_id"]
            isOneToOne: false
            referencedRelation: "formularios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "formulario_submissoes_sdr_lead_id_fkey"
            columns: ["sdr_lead_id"]
            isOneToOne: false
            referencedRelation: "sdr_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      formulario_visualizacoes: {
        Row: {
          formulario_id: string | null
          id: number
          pagina_url: string | null
          utm_campaign: string | null
          utm_source: string | null
          visto_em: string
        }
        Insert: {
          formulario_id?: string | null
          id?: number
          pagina_url?: string | null
          utm_campaign?: string | null
          utm_source?: string | null
          visto_em?: string
        }
        Update: {
          formulario_id?: string | null
          id?: number
          pagina_url?: string | null
          utm_campaign?: string | null
          utm_source?: string | null
          visto_em?: string
        }
        Relationships: [
          {
            foreignKeyName: "formulario_visualizacoes_formulario_id_fkey"
            columns: ["formulario_id"]
            isOneToOne: false
            referencedRelation: "formularios"
            referencedColumns: ["id"]
          },
        ]
      }
      formularios: {
        Row: {
          ajuda_cnpj: string | null
          ativo: boolean
          atualizado_em: string
          auto_resposta_assunto: string | null
          auto_resposta_corpo: string | null
          auto_resposta_habilitada: boolean
          campos: Json
          consentimento_obrigatorio: boolean
          consentimento_texto: string | null
          criado_em: string
          criado_por: string | null
          descricao: string | null
          enriquecimento_pago: boolean
          id: string
          mensagem_sucesso: string | null
          nome: string
          pergunta_intencao: Json | null
          slug: string
          subtitulo: string | null
          texto_botao: string
          titulo: string | null
          vendedor_destino_id: string | null
        }
        Insert: {
          ajuda_cnpj?: string | null
          ativo?: boolean
          atualizado_em?: string
          auto_resposta_assunto?: string | null
          auto_resposta_corpo?: string | null
          auto_resposta_habilitada?: boolean
          campos: Json
          consentimento_obrigatorio?: boolean
          consentimento_texto?: string | null
          criado_em?: string
          criado_por?: string | null
          descricao?: string | null
          enriquecimento_pago?: boolean
          id?: string
          mensagem_sucesso?: string | null
          nome: string
          pergunta_intencao?: Json | null
          slug: string
          subtitulo?: string | null
          texto_botao?: string
          titulo?: string | null
          vendedor_destino_id?: string | null
        }
        Update: {
          ajuda_cnpj?: string | null
          ativo?: boolean
          atualizado_em?: string
          auto_resposta_assunto?: string | null
          auto_resposta_corpo?: string | null
          auto_resposta_habilitada?: boolean
          campos?: Json
          consentimento_obrigatorio?: boolean
          consentimento_texto?: string | null
          criado_em?: string
          criado_por?: string | null
          descricao?: string | null
          enriquecimento_pago?: boolean
          id?: string
          mensagem_sucesso?: string | null
          nome?: string
          pergunta_intencao?: Json | null
          slug?: string
          subtitulo?: string | null
          texto_botao?: string
          titulo?: string | null
          vendedor_destino_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "formularios_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "formularios_vendedor_destino_id_fkey"
            columns: ["vendedor_destino_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
        ]
      }
      fornecedores_config: {
        Row: {
          atualizado_em: string
          atualizado_por: string | null
          chave: string
          valor: Json
        }
        Insert: {
          atualizado_em?: string
          atualizado_por?: string | null
          chave: string
          valor: Json
        }
        Update: {
          atualizado_em?: string
          atualizado_por?: string | null
          chave?: string
          valor?: Json
        }
        Relationships: [
          {
            foreignKeyName: "fornecedores_config_atualizado_por_fkey"
            columns: ["atualizado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      fornecedores_funil: {
        Row: {
          atualizado_em: string
          contatos_encontrados: number
          descoberta_automatica_em: string | null
          empresa_id: string | null
          entrou_em: string
          estagio: string
          estagio_alterado_em: string | null
          estagio_alterado_por: string | null
          fornecedor_cnpj: string
          id: string
          melhor_confianca: string | null
          originador_id: string | null
          originador_origem: string
          potencial_mensal: number | null
          prazo_medio_dias: number | null
          qtd_nfs_90d: number | null
          sacados_principais: Json
          sem_interesse_ate: string | null
          sem_interesse_motivo: string | null
          sem_interesse_observacao: string | null
          sem_interesse_origem: string | null
          ultima_busca_em: string | null
          ultima_nf_em: string | null
          volume_90d: number | null
        }
        Insert: {
          atualizado_em?: string
          contatos_encontrados?: number
          descoberta_automatica_em?: string | null
          empresa_id?: string | null
          entrou_em?: string
          estagio?: string
          estagio_alterado_em?: string | null
          estagio_alterado_por?: string | null
          fornecedor_cnpj: string
          id?: string
          melhor_confianca?: string | null
          originador_id?: string | null
          originador_origem?: string
          potencial_mensal?: number | null
          prazo_medio_dias?: number | null
          qtd_nfs_90d?: number | null
          sacados_principais?: Json
          sem_interesse_ate?: string | null
          sem_interesse_motivo?: string | null
          sem_interesse_observacao?: string | null
          sem_interesse_origem?: string | null
          ultima_busca_em?: string | null
          ultima_nf_em?: string | null
          volume_90d?: number | null
        }
        Update: {
          atualizado_em?: string
          contatos_encontrados?: number
          descoberta_automatica_em?: string | null
          empresa_id?: string | null
          entrou_em?: string
          estagio?: string
          estagio_alterado_em?: string | null
          estagio_alterado_por?: string | null
          fornecedor_cnpj?: string
          id?: string
          melhor_confianca?: string | null
          originador_id?: string | null
          originador_origem?: string
          potencial_mensal?: number | null
          prazo_medio_dias?: number | null
          qtd_nfs_90d?: number | null
          sacados_principais?: Json
          sem_interesse_ate?: string | null
          sem_interesse_motivo?: string | null
          sem_interesse_observacao?: string | null
          sem_interesse_origem?: string | null
          ultima_busca_em?: string | null
          ultima_nf_em?: string | null
          volume_90d?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fornecedores_funil_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "fornecedores_funil_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "fornecedores_funil_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "fornecedores_funil_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "fornecedores_funil_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fornecedores_funil_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "fornecedores_funil_estagio_alterado_por_fkey"
            columns: ["estagio_alterado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fornecedores_funil_originador_id_fkey"
            columns: ["originador_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
        ]
      }
      fornecedores_seguidos: {
        Row: {
          ate: string | null
          criado_por: string | null
          desde: string
          fornecedor_cnpj: string
          id: string
          origem: string
          originador_id: string
        }
        Insert: {
          ate?: string | null
          criado_por?: string | null
          desde?: string
          fornecedor_cnpj: string
          id?: string
          origem?: string
          originador_id: string
        }
        Update: {
          ate?: string | null
          criado_por?: string | null
          desde?: string
          fornecedor_cnpj?: string
          id?: string
          origem?: string
          originador_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fornecedores_seguidos_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fornecedores_seguidos_originador_id_fkey"
            columns: ["originador_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
        ]
      }
      funil_notas: {
        Row: {
          anexos: Json
          autor_usuario_id: string
          card_id: string
          conteudo: string
          criado_em: string
          empresa_id: string | null
          funil: string
          id: string
        }
        Insert: {
          anexos?: Json
          autor_usuario_id: string
          card_id: string
          conteudo: string
          criado_em?: string
          empresa_id?: string | null
          funil: string
          id?: string
        }
        Update: {
          anexos?: Json
          autor_usuario_id?: string
          card_id?: string
          conteudo?: string
          criado_em?: string
          empresa_id?: string | null
          funil?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "funil_notas_autor_usuario_id_fkey"
            columns: ["autor_usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funil_notas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "funil_notas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "funil_notas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "funil_notas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "funil_notas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funil_notas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      funil_ocultacoes: {
        Row: {
          criado_em: string
          motivo: string
          original_id: string | null
          original_tipo: string | null
          referencia_id: string
          tipo: string
        }
        Insert: {
          criado_em?: string
          motivo: string
          original_id?: string | null
          original_tipo?: string | null
          referencia_id: string
          tipo: string
        }
        Update: {
          criado_em?: string
          motivo?: string
          original_id?: string | null
          original_tipo?: string | null
          referencia_id?: string
          tipo?: string
        }
        Relationships: []
      }
      funil_selos_preauth: {
        Row: {
          atualizado_em: string
          criada_em: string | null
          pre_autorizacao_id: number
          referencia_id: string
          status: string
          tipo: string
        }
        Insert: {
          atualizado_em?: string
          criada_em?: string | null
          pre_autorizacao_id: number
          referencia_id: string
          status: string
          tipo: string
        }
        Update: {
          atualizado_em?: string
          criada_em?: string | null
          pre_autorizacao_id?: number
          referencia_id?: string
          status?: string
          tipo?: string
        }
        Relationships: []
      }
      funil_transicoes: {
        Row: {
          de: string | null
          em: string
          funil: string
          id: string
          item_id: string
          para: string
          vendedor_id: string
        }
        Insert: {
          de?: string | null
          em?: string
          funil: string
          id?: string
          item_id: string
          para: string
          vendedor_id: string
        }
        Update: {
          de?: string | null
          em?: string
          funil?: string
          id?: string
          item_id?: string
          para?: string
          vendedor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "funil_transicoes_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
        ]
      }
      gestao_operacao_historico: {
        Row: {
          alterado_em: string
          alterado_por: string
          empresa_id: string
          id: string
          motivo: string
          valor_anterior: string | null
          valor_novo: string
        }
        Insert: {
          alterado_em?: string
          alterado_por: string
          empresa_id: string
          id?: string
          motivo: string
          valor_anterior?: string | null
          valor_novo: string
        }
        Update: {
          alterado_em?: string
          alterado_por?: string
          empresa_id?: string
          id?: string
          motivo?: string
          valor_anterior?: string | null
          valor_novo?: string
        }
        Relationships: [
          {
            foreignKeyName: "gestao_operacao_historico_alterado_por_fkey"
            columns: ["alterado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gestao_operacao_historico_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "gestao_operacao_historico_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "gestao_operacao_historico_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "gestao_operacao_historico_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "gestao_operacao_historico_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gestao_operacao_historico_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      gmail_contas: {
        Row: {
          access_token_expira_em: string | null
          access_token_secret_id: string | null
          ativo: boolean
          atualizado_em: string
          conectado_em: string
          endereco: string
          escopos: string[]
          history_id: string | null
          refresh_token_secret_id: string | null
          ultimo_erro: string | null
          ultimo_sync_em: string | null
          usuario_id: string
          watch_expira_em: string | null
        }
        Insert: {
          access_token_expira_em?: string | null
          access_token_secret_id?: string | null
          ativo?: boolean
          atualizado_em?: string
          conectado_em?: string
          endereco: string
          escopos?: string[]
          history_id?: string | null
          refresh_token_secret_id?: string | null
          ultimo_erro?: string | null
          ultimo_sync_em?: string | null
          usuario_id: string
          watch_expira_em?: string | null
        }
        Update: {
          access_token_expira_em?: string | null
          access_token_secret_id?: string | null
          ativo?: boolean
          atualizado_em?: string
          conectado_em?: string
          endereco?: string
          escopos?: string[]
          history_id?: string | null
          refresh_token_secret_id?: string | null
          ultimo_erro?: string | null
          ultimo_sync_em?: string | null
          usuario_id?: string
          watch_expira_em?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gmail_contas_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: true
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      grupos_economicos: {
        Row: {
          cnpj_cabeca: string | null
          criado_em: string
          id: string
          nome: string | null
        }
        Insert: {
          cnpj_cabeca?: string | null
          criado_em?: string
          id?: string
          nome?: string | null
        }
        Update: {
          cnpj_cabeca?: string | null
          criado_em?: string
          id?: string
          nome?: string | null
        }
        Relationships: []
      }
      importacoes_linhas: {
        Row: {
          candidatos: Json | null
          cnpj_resolvido: string | null
          dados: Json
          id: string
          importacao_id: string
          status: string
        }
        Insert: {
          candidatos?: Json | null
          cnpj_resolvido?: string | null
          dados: Json
          id?: string
          importacao_id: string
          status?: string
        }
        Update: {
          candidatos?: Json | null
          cnpj_resolvido?: string | null
          dados?: Json
          id?: string
          importacao_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "importacoes_linhas_importacao_id_fkey"
            columns: ["importacao_id"]
            isOneToOne: false
            referencedRelation: "importacoes_listas"
            referencedColumns: ["id"]
          },
        ]
      }
      importacoes_listas: {
        Row: {
          anos_colunas: Json
          arquivo_url: string | null
          criado_em: string
          criado_por: string | null
          id: string
          mapeamento: Json | null
          nome: string
          status: string
        }
        Insert: {
          anos_colunas?: Json
          arquivo_url?: string | null
          criado_em?: string
          criado_por?: string | null
          id?: string
          mapeamento?: Json | null
          nome: string
          status?: string
        }
        Update: {
          anos_colunas?: Json
          arquivo_url?: string | null
          criado_em?: string
          criado_por?: string | null
          id?: string
          mapeamento?: Json | null
          nome?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "importacoes_listas_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      integracao_tokens: {
        Row: {
          atualizado_em: string
          expira_em: string
          provedor: string
          token: string
        }
        Insert: {
          atualizado_em?: string
          expira_em: string
          provedor: string
          token: string
        }
        Update: {
          atualizado_em?: string
          expira_em?: string
          provedor?: string
          token?: string
        }
        Relationships: []
      }
      juridico_callbacks: {
        Row: {
          erro: string | null
          evento: string
          numero_cnj: string | null
          payload: Json
          processado_em: string | null
          recebido_em: string
          uuid: string
        }
        Insert: {
          erro?: string | null
          evento: string
          numero_cnj?: string | null
          payload: Json
          processado_em?: string | null
          recebido_em?: string
          uuid: string
        }
        Update: {
          erro?: string | null
          evento?: string
          numero_cnj?: string | null
          payload?: Json
          processado_em?: string | null
          recebido_em?: string
          uuid?: string
        }
        Relationships: []
      }
      juridico_config: {
        Row: {
          atualizado_em: string
          atualizado_por: string | null
          chave: string
          valor: Json
        }
        Insert: {
          atualizado_em?: string
          atualizado_por?: string | null
          chave: string
          valor: Json
        }
        Update: {
          atualizado_em?: string
          atualizado_por?: string | null
          chave?: string
          valor?: Json
        }
        Relationships: [
          {
            foreignKeyName: "juridico_config_atualizado_por_fkey"
            columns: ["atualizado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      juridico_indices: {
        Row: {
          atualizado_em: string
          atualizado_por: string | null
          competencia: string
          indice: string
          valor: number
        }
        Insert: {
          atualizado_em?: string
          atualizado_por?: string | null
          competencia: string
          indice: string
          valor: number
        }
        Update: {
          atualizado_em?: string
          atualizado_por?: string | null
          competencia?: string
          indice?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "juridico_indices_atualizado_por_fkey"
            columns: ["atualizado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      juridico_sync_log: {
        Row: {
          cnpj: string | null
          creditos_utilizados: number
          erro: string | null
          executado_em: string
          id: string
          numero_cnj: string | null
          status: string | null
          tipo: string
        }
        Insert: {
          cnpj?: string | null
          creditos_utilizados?: number
          erro?: string | null
          executado_em?: string
          id?: string
          numero_cnj?: string | null
          status?: string | null
          tipo: string
        }
        Update: {
          cnpj?: string | null
          creditos_utilizados?: number
          erro?: string | null
          executado_em?: string
          id?: string
          numero_cnj?: string | null
          status?: string | null
          tipo?: string
        }
        Relationships: []
      }
      lote_itens: {
        Row: {
          atualizado_em: string
          cnpj: string | null
          custo_real: number | null
          dominio: string | null
          empresa_id: string | null
          erro: string | null
          id: string
          lote_id: string
          resultado: Json | null
          status: string
        }
        Insert: {
          atualizado_em?: string
          cnpj?: string | null
          custo_real?: number | null
          dominio?: string | null
          empresa_id?: string | null
          erro?: string | null
          id?: string
          lote_id: string
          resultado?: Json | null
          status?: string
        }
        Update: {
          atualizado_em?: string
          cnpj?: string | null
          custo_real?: number | null
          dominio?: string | null
          empresa_id?: string | null
          erro?: string | null
          id?: string
          lote_id?: string
          resultado?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "lote_itens_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "lote_itens_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "lote_itens_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "lote_itens_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "lote_itens_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lote_itens_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "lote_itens_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "lotes_enriquecimento"
            referencedColumns: ["id"]
          },
        ]
      }
      lotes_enriquecimento: {
        Row: {
          aprovado_em: string | null
          aprovado_por: string | null
          atualizado_em: string
          concluido_em: string | null
          criado_em: string
          criado_por: string | null
          custo_estimado_esperado: number | null
          custo_estimado_min: number | null
          custo_real: number
          definicao_filtro: Json
          id: string
          nome: string | null
          parametros: Json
          status: string
          tipo: string
          total_itens: number | null
        }
        Insert: {
          aprovado_em?: string | null
          aprovado_por?: string | null
          atualizado_em?: string
          concluido_em?: string | null
          criado_em?: string
          criado_por?: string | null
          custo_estimado_esperado?: number | null
          custo_estimado_min?: number | null
          custo_real?: number
          definicao_filtro: Json
          id?: string
          nome?: string | null
          parametros?: Json
          status?: string
          tipo: string
          total_itens?: number | null
        }
        Update: {
          aprovado_em?: string | null
          aprovado_por?: string | null
          atualizado_em?: string
          concluido_em?: string | null
          criado_em?: string
          criado_por?: string | null
          custo_estimado_esperado?: number | null
          custo_estimado_min?: number | null
          custo_real?: number
          definicao_filtro?: Json
          id?: string
          nome?: string | null
          parametros?: Json
          status?: string
          tipo?: string
          total_itens?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lotes_enriquecimento_aprovado_por_fkey"
            columns: ["aprovado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lotes_enriquecimento_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      mandato_acoes: {
        Row: {
          agente_id: string
          argumentos: Json | null
          ciclo_id: string | null
          comunicacao_id: string | null
          contato_id: string | null
          conversa_id: string | null
          custo_centavos: number
          duracao_ms: number | null
          empresa_id: string | null
          erro: string | null
          executada_em: string
          ferramenta: string
          id: string
          intencao: string
          mandato_id: string
          outbox_id: string | null
          resultado: Json | null
          sequencia: number
          sinal: string
          sucesso: boolean | null
          tokens_entrada: number | null
          tokens_saida: number | null
          voz_ligacao_id: string | null
        }
        Insert: {
          agente_id: string
          argumentos?: Json | null
          ciclo_id?: string | null
          comunicacao_id?: string | null
          contato_id?: string | null
          conversa_id?: string | null
          custo_centavos?: number
          duracao_ms?: number | null
          empresa_id?: string | null
          erro?: string | null
          executada_em?: string
          ferramenta: string
          id?: string
          intencao: string
          mandato_id: string
          outbox_id?: string | null
          resultado?: Json | null
          sequencia?: number
          sinal?: string
          sucesso?: boolean | null
          tokens_entrada?: number | null
          tokens_saida?: number | null
          voz_ligacao_id?: string | null
        }
        Update: {
          agente_id?: string
          argumentos?: Json | null
          ciclo_id?: string | null
          comunicacao_id?: string | null
          contato_id?: string | null
          conversa_id?: string | null
          custo_centavos?: number
          duracao_ms?: number | null
          empresa_id?: string | null
          erro?: string | null
          executada_em?: string
          ferramenta?: string
          id?: string
          intencao?: string
          mandato_id?: string
          outbox_id?: string | null
          resultado?: Json | null
          sequencia?: number
          sinal?: string
          sucesso?: boolean | null
          tokens_entrada?: number | null
          tokens_saida?: number | null
          voz_ligacao_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mandato_acoes_agente_id_fkey"
            columns: ["agente_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mandato_acoes_comunicacao_id_fkey"
            columns: ["comunicacao_id"]
            isOneToOne: false
            referencedRelation: "comunicacoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mandato_acoes_comunicacao_id_fkey"
            columns: ["comunicacao_id"]
            isOneToOne: false
            referencedRelation: "comunicacoes_thread"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mandato_acoes_contato_id_fkey"
            columns: ["contato_id"]
            isOneToOne: false
            referencedRelation: "contatos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mandato_acoes_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "conversas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mandato_acoes_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "inbox_conversas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mandato_acoes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "mandato_acoes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "mandato_acoes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "mandato_acoes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "mandato_acoes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mandato_acoes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "mandato_acoes_mandato_id_fkey"
            columns: ["mandato_id"]
            isOneToOne: false
            referencedRelation: "mandatos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mandato_acoes_outbox_id_fkey"
            columns: ["outbox_id"]
            isOneToOne: false
            referencedRelation: "mensagens_outbox"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mandato_acoes_voz_ligacao_id_fkey"
            columns: ["voz_ligacao_id"]
            isOneToOne: false
            referencedRelation: "voz_ligacoes"
            referencedColumns: ["id"]
          },
        ]
      }
      mandato_conversas: {
        Row: {
          conversa_id: string
          mandato_id: string
          vinculada_em: string
        }
        Insert: {
          conversa_id: string
          mandato_id: string
          vinculada_em?: string
        }
        Update: {
          conversa_id?: string
          mandato_id?: string
          vinculada_em?: string
        }
        Relationships: [
          {
            foreignKeyName: "mandato_conversas_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "conversas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mandato_conversas_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "inbox_conversas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mandato_conversas_mandato_id_fkey"
            columns: ["mandato_id"]
            isOneToOne: false
            referencedRelation: "mandatos"
            referencedColumns: ["id"]
          },
        ]
      }
      mandato_plano_versoes: {
        Row: {
          acao_id: string | null
          criado_em: string
          id: string
          mandato_id: string
          motivo: string
          plano: Json
          versao: number
        }
        Insert: {
          acao_id?: string | null
          criado_em?: string
          id?: string
          mandato_id: string
          motivo: string
          plano: Json
          versao: number
        }
        Update: {
          acao_id?: string | null
          criado_em?: string
          id?: string
          mandato_id?: string
          motivo?: string
          plano?: Json
          versao?: number
        }
        Relationships: [
          {
            foreignKeyName: "mandato_plano_versoes_acao_id_fkey"
            columns: ["acao_id"]
            isOneToOne: false
            referencedRelation: "mandato_acoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mandato_plano_versoes_mandato_id_fkey"
            columns: ["mandato_id"]
            isOneToOne: false
            referencedRelation: "mandatos"
            referencedColumns: ["id"]
          },
        ]
      }
      mandato_propostas: {
        Row: {
          agente_id: string
          criado_em: string
          decidido_em: string | null
          decidido_por: string | null
          empresa_id: string
          estado: string
          id: string
          justificativa: string
          mandato_criado_id: string | null
          mandato_origem_id: string
          motivo_recusa: string | null
          objetivo: string
          tipo: string
        }
        Insert: {
          agente_id: string
          criado_em?: string
          decidido_em?: string | null
          decidido_por?: string | null
          empresa_id: string
          estado?: string
          id?: string
          justificativa: string
          mandato_criado_id?: string | null
          mandato_origem_id: string
          motivo_recusa?: string | null
          objetivo: string
          tipo: string
        }
        Update: {
          agente_id?: string
          criado_em?: string
          decidido_em?: string | null
          decidido_por?: string | null
          empresa_id?: string
          estado?: string
          id?: string
          justificativa?: string
          mandato_criado_id?: string | null
          mandato_origem_id?: string
          motivo_recusa?: string | null
          objetivo?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "mandato_propostas_agente_id_fkey"
            columns: ["agente_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mandato_propostas_decidido_por_fkey"
            columns: ["decidido_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mandato_propostas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "mandato_propostas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "mandato_propostas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "mandato_propostas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "mandato_propostas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mandato_propostas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "mandato_propostas_mandato_criado_id_fkey"
            columns: ["mandato_criado_id"]
            isOneToOne: false
            referencedRelation: "mandatos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mandato_propostas_mandato_origem_id_fkey"
            columns: ["mandato_origem_id"]
            isOneToOne: false
            referencedRelation: "mandatos"
            referencedColumns: ["id"]
          },
        ]
      }
      mandato_regras: {
        Row: {
          agente_id: string | null
          ativa: boolean
          atualizada_em: string
          criada_em: string
          criada_por: string | null
          filtro: Json
          id: string
          max_acoes: number
          nome: string
          objetivo_template: string
          orcamento_centavos: number
          playbook_id: string | null
          prazo_dias: number
          prioridade: number
          teto_mandatos_ativos: number | null
          tipo_mandato: string
          ultima_avaliacao_em: string | null
          ultima_previa: Json | null
        }
        Insert: {
          agente_id?: string | null
          ativa?: boolean
          atualizada_em?: string
          criada_em?: string
          criada_por?: string | null
          filtro: Json
          id?: string
          max_acoes: number
          nome: string
          objetivo_template: string
          orcamento_centavos: number
          playbook_id?: string | null
          prazo_dias: number
          prioridade?: number
          teto_mandatos_ativos?: number | null
          tipo_mandato: string
          ultima_avaliacao_em?: string | null
          ultima_previa?: Json | null
        }
        Update: {
          agente_id?: string | null
          ativa?: boolean
          atualizada_em?: string
          criada_em?: string
          criada_por?: string | null
          filtro?: Json
          id?: string
          max_acoes?: number
          nome?: string
          objetivo_template?: string
          orcamento_centavos?: number
          playbook_id?: string | null
          prazo_dias?: number
          prioridade?: number
          teto_mandatos_ativos?: number | null
          tipo_mandato?: string
          ultima_avaliacao_em?: string | null
          ultima_previa?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "mandato_regras_agente_id_fkey"
            columns: ["agente_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mandato_regras_criada_por_fkey"
            columns: ["criada_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mandato_regras_playbook_id_fkey"
            columns: ["playbook_id"]
            isOneToOne: false
            referencedRelation: "agente_playbooks"
            referencedColumns: ["id"]
          },
        ]
      }
      mandato_sequencias: {
        Row: {
          ano: number
          ultimo: number
        }
        Insert: {
          ano: number
          ultimo?: number
        }
        Update: {
          ano?: number
          ultimo?: number
        }
        Relationships: []
      }
      mandatos: {
        Row: {
          acoes_executadas: number
          agente_id: string
          assumido_por: string | null
          atualizado_em: string
          codigo: string | null
          contatos_tentados: Json
          criado_em: string
          criado_por: string | null
          empresa_id: string
          encerrado_em: string | null
          estado: string
          expira_em: string
          gasto_centavos: number
          id: string
          max_acoes: number
          motivo_encerramento: string | null
          nota_access_key: string | null
          objetivo: string
          orcamento_centavos: number
          origem: string
          pausado_motivo: string | null
          plano: Json | null
          plano_versao: number
          playbook_id: string | null
          prioridade: number
          proposta_id: string | null
          proxima_acao_em: string | null
          regra_id: string | null
          resultado: string | null
          reuniao_id: string | null
          sdr_lead_id: string | null
          tipo: string
          ultima_acao_em: string | null
          ultimo_ciclo_em: string | null
          ultimo_ciclo_erro: string | null
        }
        Insert: {
          acoes_executadas?: number
          agente_id: string
          assumido_por?: string | null
          atualizado_em?: string
          codigo?: string | null
          contatos_tentados?: Json
          criado_em?: string
          criado_por?: string | null
          empresa_id: string
          encerrado_em?: string | null
          estado?: string
          expira_em: string
          gasto_centavos?: number
          id?: string
          max_acoes: number
          motivo_encerramento?: string | null
          nota_access_key?: string | null
          objetivo: string
          orcamento_centavos: number
          origem: string
          pausado_motivo?: string | null
          plano?: Json | null
          plano_versao?: number
          playbook_id?: string | null
          prioridade?: number
          proposta_id?: string | null
          proxima_acao_em?: string | null
          regra_id?: string | null
          resultado?: string | null
          reuniao_id?: string | null
          sdr_lead_id?: string | null
          tipo: string
          ultima_acao_em?: string | null
          ultimo_ciclo_em?: string | null
          ultimo_ciclo_erro?: string | null
        }
        Update: {
          acoes_executadas?: number
          agente_id?: string
          assumido_por?: string | null
          atualizado_em?: string
          codigo?: string | null
          contatos_tentados?: Json
          criado_em?: string
          criado_por?: string | null
          empresa_id?: string
          encerrado_em?: string | null
          estado?: string
          expira_em?: string
          gasto_centavos?: number
          id?: string
          max_acoes?: number
          motivo_encerramento?: string | null
          nota_access_key?: string | null
          objetivo?: string
          orcamento_centavos?: number
          origem?: string
          pausado_motivo?: string | null
          plano?: Json | null
          plano_versao?: number
          playbook_id?: string | null
          prioridade?: number
          proposta_id?: string | null
          proxima_acao_em?: string | null
          regra_id?: string | null
          resultado?: string | null
          reuniao_id?: string | null
          sdr_lead_id?: string | null
          tipo?: string
          ultima_acao_em?: string | null
          ultimo_ciclo_em?: string | null
          ultimo_ciclo_erro?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mandatos_agente_id_fkey"
            columns: ["agente_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mandatos_assumido_por_fkey"
            columns: ["assumido_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mandatos_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mandatos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "mandatos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "mandatos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "mandatos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "mandatos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mandatos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "mandatos_nota_access_key_fkey"
            columns: ["nota_access_key"]
            isOneToOne: false
            referencedRelation: "funil_oportunidades_nf"
            referencedColumns: ["access_key"]
          },
          {
            foreignKeyName: "mandatos_nota_access_key_fkey"
            columns: ["nota_access_key"]
            isOneToOne: false
            referencedRelation: "funil_oportunidades_nf"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mandatos_nota_access_key_fkey"
            columns: ["nota_access_key"]
            isOneToOne: false
            referencedRelation: "notas_fiscais"
            referencedColumns: ["access_key"]
          },
          {
            foreignKeyName: "mandatos_nota_access_key_fkey"
            columns: ["nota_access_key"]
            isOneToOne: false
            referencedRelation: "notas_funil"
            referencedColumns: ["access_key"]
          },
          {
            foreignKeyName: "mandatos_playbook_id_fkey"
            columns: ["playbook_id"]
            isOneToOne: false
            referencedRelation: "agente_playbooks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mandatos_proposta_fk"
            columns: ["proposta_id"]
            isOneToOne: false
            referencedRelation: "mandato_propostas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mandatos_regra_id_fkey"
            columns: ["regra_id"]
            isOneToOne: false
            referencedRelation: "mandato_regras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mandatos_reuniao_id_fkey"
            columns: ["reuniao_id"]
            isOneToOne: false
            referencedRelation: "vendedor_eventos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mandatos_sdr_lead_id_fkey"
            columns: ["sdr_lead_id"]
            isOneToOne: false
            referencedRelation: "sdr_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      materiais: {
        Row: {
          arquivo_path: string | null
          ativo: boolean
          atualizado_em: string
          canais: string[]
          corpo: string | null
          criado_em: string
          criado_por: string | null
          descricao: string
          id: string
          nome: string
          quando_usar: string
          tags: string[]
          tipo: string
          url: string | null
          vezes_usado: number
        }
        Insert: {
          arquivo_path?: string | null
          ativo?: boolean
          atualizado_em?: string
          canais?: string[]
          corpo?: string | null
          criado_em?: string
          criado_por?: string | null
          descricao: string
          id?: string
          nome: string
          quando_usar: string
          tags?: string[]
          tipo: string
          url?: string | null
          vezes_usado?: number
        }
        Update: {
          arquivo_path?: string | null
          ativo?: boolean
          atualizado_em?: string
          canais?: string[]
          corpo?: string | null
          criado_em?: string
          criado_por?: string | null
          descricao?: string
          id?: string
          nome?: string
          quando_usar?: string
          tags?: string[]
          tipo?: string
          url?: string | null
          vezes_usado?: number
        }
        Relationships: [
          {
            foreignKeyName: "materiais_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      mensagens_outbox: {
        Row: {
          access_keys: string[]
          agendada_para: string | null
          anexos: Json
          assunto: string | null
          atualizada_em: string
          campanha_destinatario_id: string | null
          campanha_id: string | null
          canal: string
          comunicacao_id: string | null
          conversa_id: string | null
          corpo: string | null
          criada_em: string
          criada_por: string | null
          descartada_por: string | null
          destinatario: string | null
          destinatario_contato_id: string | null
          destinatario_ponto_focal: boolean
          empresa_id: string | null
          erro: string | null
          faixa: string | null
          forcar_janela: boolean
          fornecedor_cnpj: string | null
          fornecedor_empresa_id: string | null
          fornecedor_nome: string | null
          funil: string | null
          funil_card_id: string | null
          id: string
          mandato_acao_id: string | null
          mandato_id: string | null
          motivo_descarte: string | null
          oportunidades: string[] | null
          origem: string
          por_ia: boolean
          status: string
          template_id: string | null
          tentativas: number
          ultima_tentativa_em: string | null
          valor_total: number | null
          vendedor_id: string | null
          whatsapp_conta_id: string | null
        }
        Insert: {
          access_keys?: string[]
          agendada_para?: string | null
          anexos?: Json
          assunto?: string | null
          atualizada_em?: string
          campanha_destinatario_id?: string | null
          campanha_id?: string | null
          canal: string
          comunicacao_id?: string | null
          conversa_id?: string | null
          corpo?: string | null
          criada_em?: string
          criada_por?: string | null
          descartada_por?: string | null
          destinatario?: string | null
          destinatario_contato_id?: string | null
          destinatario_ponto_focal?: boolean
          empresa_id?: string | null
          erro?: string | null
          faixa?: string | null
          forcar_janela?: boolean
          fornecedor_cnpj?: string | null
          fornecedor_empresa_id?: string | null
          fornecedor_nome?: string | null
          funil?: string | null
          funil_card_id?: string | null
          id?: string
          mandato_acao_id?: string | null
          mandato_id?: string | null
          motivo_descarte?: string | null
          oportunidades?: string[] | null
          origem?: string
          por_ia?: boolean
          status?: string
          template_id?: string | null
          tentativas?: number
          ultima_tentativa_em?: string | null
          valor_total?: number | null
          vendedor_id?: string | null
          whatsapp_conta_id?: string | null
        }
        Update: {
          access_keys?: string[]
          agendada_para?: string | null
          anexos?: Json
          assunto?: string | null
          atualizada_em?: string
          campanha_destinatario_id?: string | null
          campanha_id?: string | null
          canal?: string
          comunicacao_id?: string | null
          conversa_id?: string | null
          corpo?: string | null
          criada_em?: string
          criada_por?: string | null
          descartada_por?: string | null
          destinatario?: string | null
          destinatario_contato_id?: string | null
          destinatario_ponto_focal?: boolean
          empresa_id?: string | null
          erro?: string | null
          faixa?: string | null
          forcar_janela?: boolean
          fornecedor_cnpj?: string | null
          fornecedor_empresa_id?: string | null
          fornecedor_nome?: string | null
          funil?: string | null
          funil_card_id?: string | null
          id?: string
          mandato_acao_id?: string | null
          mandato_id?: string | null
          motivo_descarte?: string | null
          oportunidades?: string[] | null
          origem?: string
          por_ia?: boolean
          status?: string
          template_id?: string | null
          tentativas?: number
          ultima_tentativa_em?: string | null
          valor_total?: number | null
          vendedor_id?: string | null
          whatsapp_conta_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mensagens_outbox_campanha_destinatario_id_fkey"
            columns: ["campanha_destinatario_id"]
            isOneToOne: false
            referencedRelation: "campanha_destinatarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensagens_outbox_campanha_destinatario_id_fkey"
            columns: ["campanha_destinatario_id"]
            isOneToOne: false
            referencedRelation: "campanha_destinatarios_lista"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensagens_outbox_campanha_id_fkey"
            columns: ["campanha_id"]
            isOneToOne: false
            referencedRelation: "campanhas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensagens_outbox_campanha_id_fkey"
            columns: ["campanha_id"]
            isOneToOne: false
            referencedRelation: "campanhas_lista"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensagens_outbox_comunicacao_id_fkey"
            columns: ["comunicacao_id"]
            isOneToOne: false
            referencedRelation: "comunicacoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensagens_outbox_comunicacao_id_fkey"
            columns: ["comunicacao_id"]
            isOneToOne: false
            referencedRelation: "comunicacoes_thread"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensagens_outbox_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "conversas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensagens_outbox_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "inbox_conversas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensagens_outbox_criada_por_fkey"
            columns: ["criada_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensagens_outbox_descartada_por_fkey"
            columns: ["descartada_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensagens_outbox_destinatario_contato_id_fkey"
            columns: ["destinatario_contato_id"]
            isOneToOne: false
            referencedRelation: "contatos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensagens_outbox_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "mensagens_outbox_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "mensagens_outbox_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "mensagens_outbox_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "mensagens_outbox_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensagens_outbox_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "mensagens_outbox_fornecedor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "mensagens_outbox_fornecedor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "mensagens_outbox_fornecedor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "mensagens_outbox_fornecedor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "mensagens_outbox_fornecedor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensagens_outbox_fornecedor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "mensagens_outbox_mandato_acao_id_fkey"
            columns: ["mandato_acao_id"]
            isOneToOne: false
            referencedRelation: "mandato_acoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensagens_outbox_mandato_id_fkey"
            columns: ["mandato_id"]
            isOneToOne: false
            referencedRelation: "mandatos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensagens_outbox_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "templates_mensagem"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensagens_outbox_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensagens_outbox_whatsapp_conta_id_fkey"
            columns: ["whatsapp_conta_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_contas"
            referencedColumns: ["id"]
          },
        ]
      }
      mercado_ingestoes: {
        Row: {
          erro: string | null
          fonte: string
          id: string
          iniciado_em: string
          linhas_atualizadas: number | null
          linhas_novas: number | null
          linhas_processadas: number | null
          meta: Json
          status: string
          tentativa: number
          terminado_em: string | null
        }
        Insert: {
          erro?: string | null
          fonte: string
          id?: string
          iniciado_em?: string
          linhas_atualizadas?: number | null
          linhas_novas?: number | null
          linhas_processadas?: number | null
          meta?: Json
          status?: string
          tentativa?: number
          terminado_em?: string | null
        }
        Update: {
          erro?: string | null
          fonte?: string
          id?: string
          iniciado_em?: string
          linhas_atualizadas?: number | null
          linhas_novas?: number | null
          linhas_processadas?: number | null
          meta?: Json
          status?: string
          tentativa?: number
          terminado_em?: string | null
        }
        Relationships: []
      }
      mercado_metricas: {
        Row: {
          atualizado_em: string
          cnpj: string
          grupo_capital_agregado: number | null
          grupo_spes_24m: number
          grupo_spes_total: number
          grupo_ufs: string[]
          m2_em_execucao: number
          obras_ativas: number
          obras_iniciadas_24m: number
          qtd_filiais: number
          tem_contato: boolean
        }
        Insert: {
          atualizado_em?: string
          cnpj: string
          grupo_capital_agregado?: number | null
          grupo_spes_24m?: number
          grupo_spes_total?: number
          grupo_ufs?: string[]
          m2_em_execucao?: number
          obras_ativas?: number
          obras_iniciadas_24m?: number
          qtd_filiais?: number
          tem_contato?: boolean
        }
        Update: {
          atualizado_em?: string
          cnpj?: string
          grupo_capital_agregado?: number | null
          grupo_spes_24m?: number
          grupo_spes_total?: number
          grupo_ufs?: string[]
          m2_em_execucao?: number
          obras_ativas?: number
          obras_iniciadas_24m?: number
          qtd_filiais?: number
          tem_contato?: boolean
        }
        Relationships: []
      }
      mercado_obras: {
        Row: {
          atualizado_em: string
          bairro: string | null
          categoria: string | null
          cep: string | null
          cno: string
          cno_vinculado: string | null
          data_inicio_obra: string | null
          data_situacao: string | null
          destinacao: string | null
          metragem_m2: number | null
          municipio: string | null
          ni_responsavel: string
          raw: Json | null
          situacao: string | null
          tipo_obra: string | null
          tipo_responsabilidade: string | null
          uf: string | null
        }
        Insert: {
          atualizado_em?: string
          bairro?: string | null
          categoria?: string | null
          cep?: string | null
          cno: string
          cno_vinculado?: string | null
          data_inicio_obra?: string | null
          data_situacao?: string | null
          destinacao?: string | null
          metragem_m2?: number | null
          municipio?: string | null
          ni_responsavel: string
          raw?: Json | null
          situacao?: string | null
          tipo_obra?: string | null
          tipo_responsabilidade?: string | null
          uf?: string | null
        }
        Update: {
          atualizado_em?: string
          bairro?: string | null
          categoria?: string | null
          cep?: string | null
          cno?: string
          cno_vinculado?: string | null
          data_inicio_obra?: string | null
          data_situacao?: string | null
          destinacao?: string | null
          metragem_m2?: number | null
          municipio?: string | null
          ni_responsavel?: string
          raw?: Json | null
          situacao?: string | null
          tipo_obra?: string | null
          tipo_responsabilidade?: string | null
          uf?: string | null
        }
        Relationships: []
      }
      mercado_socios: {
        Row: {
          cnpj: string
          cpf_cnpj_socio: string | null
          data_entrada: string | null
          faixa_etaria: string | null
          id: string
          nome_socio: string | null
          qualificacao: string | null
          tipo_socio: string | null
        }
        Insert: {
          cnpj: string
          cpf_cnpj_socio?: string | null
          data_entrada?: string | null
          faixa_etaria?: string | null
          id?: string
          nome_socio?: string | null
          qualificacao?: string | null
          tipo_socio?: string | null
        }
        Update: {
          cnpj?: string
          cpf_cnpj_socio?: string | null
          data_entrada?: string | null
          faixa_etaria?: string | null
          id?: string
          nome_socio?: string | null
          qualificacao?: string | null
          tipo_socio?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mercado_socios_cnpj_fkey"
            columns: ["cnpj"]
            isOneToOne: false
            referencedRelation: "mercado_explorador"
            referencedColumns: ["cnpj"]
          },
          {
            foreignKeyName: "mercado_socios_cnpj_fkey"
            columns: ["cnpj"]
            isOneToOne: false
            referencedRelation: "mercado_universo"
            referencedColumns: ["cnpj"]
          },
        ]
      }
      mercado_universo: {
        Row: {
          atualizado_em: string
          bairro: string | null
          camada: string
          camada_atualizada_em: string | null
          camada_regra_versao: number | null
          capital_social: number | null
          cep: string | null
          cnae_grupos: string[] | null
          cnae_principal: string | null
          cnaes_secundarios: string[] | null
          cnaes_todos: string[] | null
          cnpj: string
          cnpj_raiz: string
          data_exclusao_simples: string | null
          data_inicio_atividade: string | null
          data_opcao_simples: string | null
          dominio: string | null
          dominio_confianca: string | null
          dominio_origem: string | null
          email_rfb: string | null
          empresa_id: string | null
          fora_recorte_cnae: boolean
          grafo_sefaz: boolean
          grupo_id: string | null
          is_spe: boolean
          logradouro: string | null
          matriz_filial: string | null
          municipio: string | null
          natureza_juridica: string | null
          nome_fantasia: string | null
          numero: string | null
          opcao_mei: boolean | null
          opcao_simples: boolean | null
          origem_ingestao: string
          porte_rfb: string | null
          razao_social: string | null
          situacao_cadastral: string | null
          situacao_data: string | null
          situacao_motivo: string | null
          telefone1_rfb: string | null
          telefone2_rfb: string | null
          uf: string | null
        }
        Insert: {
          atualizado_em?: string
          bairro?: string | null
          camada?: string
          camada_atualizada_em?: string | null
          camada_regra_versao?: number | null
          capital_social?: number | null
          cep?: string | null
          cnae_grupos?: string[] | null
          cnae_principal?: string | null
          cnaes_secundarios?: string[] | null
          cnaes_todos?: string[] | null
          cnpj: string
          cnpj_raiz: string
          data_exclusao_simples?: string | null
          data_inicio_atividade?: string | null
          data_opcao_simples?: string | null
          dominio?: string | null
          dominio_confianca?: string | null
          dominio_origem?: string | null
          email_rfb?: string | null
          empresa_id?: string | null
          fora_recorte_cnae?: boolean
          grafo_sefaz?: boolean
          grupo_id?: string | null
          is_spe?: boolean
          logradouro?: string | null
          matriz_filial?: string | null
          municipio?: string | null
          natureza_juridica?: string | null
          nome_fantasia?: string | null
          numero?: string | null
          opcao_mei?: boolean | null
          opcao_simples?: boolean | null
          origem_ingestao?: string
          porte_rfb?: string | null
          razao_social?: string | null
          situacao_cadastral?: string | null
          situacao_data?: string | null
          situacao_motivo?: string | null
          telefone1_rfb?: string | null
          telefone2_rfb?: string | null
          uf?: string | null
        }
        Update: {
          atualizado_em?: string
          bairro?: string | null
          camada?: string
          camada_atualizada_em?: string | null
          camada_regra_versao?: number | null
          capital_social?: number | null
          cep?: string | null
          cnae_grupos?: string[] | null
          cnae_principal?: string | null
          cnaes_secundarios?: string[] | null
          cnaes_todos?: string[] | null
          cnpj?: string
          cnpj_raiz?: string
          data_exclusao_simples?: string | null
          data_inicio_atividade?: string | null
          data_opcao_simples?: string | null
          dominio?: string | null
          dominio_confianca?: string | null
          dominio_origem?: string | null
          email_rfb?: string | null
          empresa_id?: string | null
          fora_recorte_cnae?: boolean
          grafo_sefaz?: boolean
          grupo_id?: string | null
          is_spe?: boolean
          logradouro?: string | null
          matriz_filial?: string | null
          municipio?: string | null
          natureza_juridica?: string | null
          nome_fantasia?: string | null
          numero?: string | null
          opcao_mei?: boolean | null
          opcao_simples?: boolean | null
          origem_ingestao?: string
          porte_rfb?: string | null
          razao_social?: string | null
          situacao_cadastral?: string | null
          situacao_data?: string | null
          situacao_motivo?: string | null
          telefone1_rfb?: string | null
          telefone2_rfb?: string | null
          uf?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mercado_universo_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "mercado_universo_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "mercado_universo_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "mercado_universo_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "mercado_universo_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mercado_universo_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "mercado_universo_grupo_fk"
            columns: ["grupo_id"]
            isOneToOne: false
            referencedRelation: "grupos_economicos"
            referencedColumns: ["id"]
          },
        ]
      }
      meu_dia_config: {
        Row: {
          atualizado_em: string
          atualizado_por: string | null
          blocos: Json
          id: string
          tipo_vendedor: string
        }
        Insert: {
          atualizado_em?: string
          atualizado_por?: string | null
          blocos?: Json
          id?: string
          tipo_vendedor: string
        }
        Update: {
          atualizado_em?: string
          atualizado_por?: string | null
          blocos?: Json
          id?: string
          tipo_vendedor?: string
        }
        Relationships: [
          {
            foreignKeyName: "meu_dia_config_atualizado_por_fkey"
            columns: ["atualizado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      meu_dia_itens_ocultos: {
        Row: {
          acao: string
          adiado_ate: string | null
          criado_em: string
          id: string
          motivo: string | null
          referencia_id: string
          tipo_item: string
          vendedor_id: string
        }
        Insert: {
          acao: string
          adiado_ate?: string | null
          criado_em?: string
          id?: string
          motivo?: string | null
          referencia_id: string
          tipo_item: string
          vendedor_id: string
        }
        Update: {
          acao?: string
          adiado_ate?: string | null
          criado_em?: string
          id?: string
          motivo?: string | null
          referencia_id?: string
          tipo_item?: string
          vendedor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meu_dia_itens_ocultos_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
        ]
      }
      meu_dia_tarefas: {
        Row: {
          concluida_em: string | null
          criada_em: string
          criada_por: string | null
          detalhe: string | null
          empresa_id: string | null
          id: string
          titulo: string
          vence_em: string | null
          vendedor_id: string
        }
        Insert: {
          concluida_em?: string | null
          criada_em?: string
          criada_por?: string | null
          detalhe?: string | null
          empresa_id?: string | null
          id?: string
          titulo: string
          vence_em?: string | null
          vendedor_id: string
        }
        Update: {
          concluida_em?: string | null
          criada_em?: string
          criada_por?: string | null
          detalhe?: string | null
          empresa_id?: string | null
          id?: string
          titulo?: string
          vence_em?: string | null
          vendedor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meu_dia_tarefas_criada_por_fkey"
            columns: ["criada_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meu_dia_tarefas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "meu_dia_tarefas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "meu_dia_tarefas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "meu_dia_tarefas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "meu_dia_tarefas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meu_dia_tarefas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "meu_dia_tarefas_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
        ]
      }
      motivos_perda: {
        Row: {
          ativo: boolean
          contexto: string
          id: string
          motivo: string
          ordem: number
          retorno_possivel: boolean | null
        }
        Insert: {
          ativo?: boolean
          contexto: string
          id?: string
          motivo: string
          ordem?: number
          retorno_possivel?: boolean | null
        }
        Update: {
          ativo?: boolean
          contexto?: string
          id?: string
          motivo?: string
          ordem?: number
          retorno_possivel?: boolean | null
        }
        Relationships: []
      }
      nota_itens: {
        Row: {
          access_key: string
          cfop: string | null
          codigo: string | null
          descricao: string | null
          id: string
          ncm: string | null
          ordem: number | null
          quantidade: number | null
          unidade: string | null
          valor_total: number | null
          valor_unitario: number | null
        }
        Insert: {
          access_key: string
          cfop?: string | null
          codigo?: string | null
          descricao?: string | null
          id?: string
          ncm?: string | null
          ordem?: number | null
          quantidade?: number | null
          unidade?: string | null
          valor_total?: number | null
          valor_unitario?: number | null
        }
        Update: {
          access_key?: string
          cfop?: string | null
          codigo?: string | null
          descricao?: string | null
          id?: string
          ncm?: string | null
          ordem?: number | null
          quantidade?: number | null
          unidade?: string | null
          valor_total?: number | null
          valor_unitario?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "nota_itens_access_key_fkey"
            columns: ["access_key"]
            isOneToOne: false
            referencedRelation: "funil_oportunidades_nf"
            referencedColumns: ["access_key"]
          },
          {
            foreignKeyName: "nota_itens_access_key_fkey"
            columns: ["access_key"]
            isOneToOne: false
            referencedRelation: "funil_oportunidades_nf"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nota_itens_access_key_fkey"
            columns: ["access_key"]
            isOneToOne: false
            referencedRelation: "notas_fiscais"
            referencedColumns: ["access_key"]
          },
          {
            foreignKeyName: "nota_itens_access_key_fkey"
            columns: ["access_key"]
            isOneToOne: false
            referencedRelation: "notas_funil"
            referencedColumns: ["access_key"]
          },
        ]
      }
      notas_fiscais: {
        Row: {
          access_key: string
          atualizada_em: string
          bilateral: boolean
          cancelada_em: string | null
          contato_fornecedor: Json | null
          contato_sacado: Json | null
          conversao_antecipacao_id: number | null
          conversao_em_disputa: boolean
          credit_disponivel: number | null
          credit_limite: number | null
          credit_role: string | null
          credit_status: string | null
          criada_em: string
          dias_para_vencimento: number | null
          direction: string
          emitida_em: string | null
          estagio_alterado_em: string | null
          estagio_alterado_por: string | null
          estagio_funil: string
          faixa: string | null
          faixa_alterada_em: string | null
          faixa_motivo: string | null
          faixa_regra_versao: number | null
          fornecedor_cadastrado: boolean | null
          fornecedor_cnpj: string
          fornecedor_empresa_id: string | null
          fornecedor_nome: string | null
          limite_disponivel_sacado: number | null
          limite_sacado_origem: string | null
          link_antecipacao: string | null
          nao_operavel_motivo: string | null
          natureza_operacao: string | null
          nf_id_externo: string | null
          numero: string | null
          operavel: boolean
          operavel_manual: boolean | null
          parcelas: Json | null
          perda_motivo: string | null
          raw_xml: string | null
          receita_esperada: number | null
          resumo_relido_em: string | null
          sacado_cadastrado: boolean | null
          sacado_cnpj: string
          sacado_empresa_id: string | null
          sacado_nome: string | null
          seguro_estimado: number | null
          serie: string | null
          sincronizada_em: string | null
          situacao: string
          status_sync: string | null
          tac_estimada: number | null
          taxa_analise_am: number | null
          taxa_analise_origem: string | null
          taxa_usada: number | null
          tipo: string
          valor: number
          vencimento: string | null
          vencimento_origem: string | null
          vendedor_definido_em: string | null
          vendedor_id: string | null
          vendedor_origem: string | null
          xml_parse_erro: string | null
          xml_resumo: boolean
        }
        Insert: {
          access_key: string
          atualizada_em?: string
          bilateral?: boolean
          cancelada_em?: string | null
          contato_fornecedor?: Json | null
          contato_sacado?: Json | null
          conversao_antecipacao_id?: number | null
          conversao_em_disputa?: boolean
          credit_disponivel?: number | null
          credit_limite?: number | null
          credit_role?: string | null
          credit_status?: string | null
          criada_em?: string
          dias_para_vencimento?: number | null
          direction: string
          emitida_em?: string | null
          estagio_alterado_em?: string | null
          estagio_alterado_por?: string | null
          estagio_funil?: string
          faixa?: string | null
          faixa_alterada_em?: string | null
          faixa_motivo?: string | null
          faixa_regra_versao?: number | null
          fornecedor_cadastrado?: boolean | null
          fornecedor_cnpj: string
          fornecedor_empresa_id?: string | null
          fornecedor_nome?: string | null
          limite_disponivel_sacado?: number | null
          limite_sacado_origem?: string | null
          link_antecipacao?: string | null
          nao_operavel_motivo?: string | null
          natureza_operacao?: string | null
          nf_id_externo?: string | null
          numero?: string | null
          operavel?: boolean
          operavel_manual?: boolean | null
          parcelas?: Json | null
          perda_motivo?: string | null
          raw_xml?: string | null
          receita_esperada?: number | null
          resumo_relido_em?: string | null
          sacado_cadastrado?: boolean | null
          sacado_cnpj: string
          sacado_empresa_id?: string | null
          sacado_nome?: string | null
          seguro_estimado?: number | null
          serie?: string | null
          sincronizada_em?: string | null
          situacao?: string
          status_sync?: string | null
          tac_estimada?: number | null
          taxa_analise_am?: number | null
          taxa_analise_origem?: string | null
          taxa_usada?: number | null
          tipo: string
          valor: number
          vencimento?: string | null
          vencimento_origem?: string | null
          vendedor_definido_em?: string | null
          vendedor_id?: string | null
          vendedor_origem?: string | null
          xml_parse_erro?: string | null
          xml_resumo?: boolean
        }
        Update: {
          access_key?: string
          atualizada_em?: string
          bilateral?: boolean
          cancelada_em?: string | null
          contato_fornecedor?: Json | null
          contato_sacado?: Json | null
          conversao_antecipacao_id?: number | null
          conversao_em_disputa?: boolean
          credit_disponivel?: number | null
          credit_limite?: number | null
          credit_role?: string | null
          credit_status?: string | null
          criada_em?: string
          dias_para_vencimento?: number | null
          direction?: string
          emitida_em?: string | null
          estagio_alterado_em?: string | null
          estagio_alterado_por?: string | null
          estagio_funil?: string
          faixa?: string | null
          faixa_alterada_em?: string | null
          faixa_motivo?: string | null
          faixa_regra_versao?: number | null
          fornecedor_cadastrado?: boolean | null
          fornecedor_cnpj?: string
          fornecedor_empresa_id?: string | null
          fornecedor_nome?: string | null
          limite_disponivel_sacado?: number | null
          limite_sacado_origem?: string | null
          link_antecipacao?: string | null
          nao_operavel_motivo?: string | null
          natureza_operacao?: string | null
          nf_id_externo?: string | null
          numero?: string | null
          operavel?: boolean
          operavel_manual?: boolean | null
          parcelas?: Json | null
          perda_motivo?: string | null
          raw_xml?: string | null
          receita_esperada?: number | null
          resumo_relido_em?: string | null
          sacado_cadastrado?: boolean | null
          sacado_cnpj?: string
          sacado_empresa_id?: string | null
          sacado_nome?: string | null
          seguro_estimado?: number | null
          serie?: string | null
          sincronizada_em?: string | null
          situacao?: string
          status_sync?: string | null
          tac_estimada?: number | null
          taxa_analise_am?: number | null
          taxa_analise_origem?: string | null
          taxa_usada?: number | null
          tipo?: string
          valor?: number
          vencimento?: string | null
          vencimento_origem?: string | null
          vendedor_definido_em?: string | null
          vendedor_id?: string | null
          vendedor_origem?: string | null
          xml_parse_erro?: string | null
          xml_resumo?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "notas_fiscais_conversao_antecipacao_id_fkey"
            columns: ["conversao_antecipacao_id"]
            isOneToOne: false
            referencedRelation: "antecipacoes"
            referencedColumns: ["id_externo"]
          },
          {
            foreignKeyName: "notas_fiscais_estagio_alterado_por_fkey"
            columns: ["estagio_alterado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notas_fiscais_fornecedor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "notas_fiscais_fornecedor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "notas_fiscais_fornecedor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "notas_fiscais_fornecedor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "notas_fiscais_fornecedor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notas_fiscais_fornecedor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "notas_fiscais_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "notas_fiscais_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "notas_fiscais_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "notas_fiscais_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "notas_fiscais_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notas_fiscais_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "notas_fiscais_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
        ]
      }
      notificacao_config: {
        Row: {
          atualizado_em: string
          fuso: string
          id: boolean
          silencio_fim: number
          silencio_inicio: number
        }
        Insert: {
          atualizado_em?: string
          fuso?: string
          id?: boolean
          silencio_fim?: number
          silencio_inicio?: number
        }
        Update: {
          atualizado_em?: string
          fuso?: string
          id?: boolean
          silencio_fim?: number
          silencio_inicio?: number
        }
        Relationships: []
      }
      notificacao_historico: {
        Row: {
          acao: string
          antes: Json | null
          criado_em: string
          depois: Json | null
          id: string
          registro: string
          tabela: string
          usuario_id: string | null
        }
        Insert: {
          acao: string
          antes?: Json | null
          criado_em?: string
          depois?: Json | null
          id?: string
          registro: string
          tabela: string
          usuario_id?: string | null
        }
        Update: {
          acao?: string
          antes?: Json | null
          criado_em?: string
          depois?: Json | null
          id?: string
          registro?: string
          tabela?: string
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notificacao_historico_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      notificacao_regras: {
        Row: {
          ativo: boolean
          atualizado_em: string | null
          canais: string[]
          criado_em: string
          dedup_horas: number
          fallback_admin: boolean
          frequencia: string
          id: string
          papel: string | null
          perfil_id: string | null
          respeita_silencio: boolean
          tipo_evento: string
          usuario_id: string | null
        }
        Insert: {
          ativo?: boolean
          atualizado_em?: string | null
          canais?: string[]
          criado_em?: string
          dedup_horas?: number
          fallback_admin?: boolean
          frequencia?: string
          id?: string
          papel?: string | null
          perfil_id?: string | null
          respeita_silencio?: boolean
          tipo_evento: string
          usuario_id?: string | null
        }
        Update: {
          ativo?: boolean
          atualizado_em?: string | null
          canais?: string[]
          criado_em?: string
          dedup_horas?: number
          fallback_admin?: boolean
          frequencia?: string
          id?: string
          papel?: string | null
          perfil_id?: string | null
          respeita_silencio?: boolean
          tipo_evento?: string
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notificacao_regras_perfil_id_fkey"
            columns: ["perfil_id"]
            isOneToOne: false
            referencedRelation: "perfis"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notificacao_regras_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      notificacao_tipos: {
        Row: {
          ativo: boolean
          atualizado_em: string
          atualizado_por: string | null
          corpo_modelo: string | null
          criado_em: string
          descricao: string | null
          gravidade: string
          modulo: string
          nome: string
          tipo: string
          titulo_modelo: string | null
          ultimo_em: string | null
          ultimo_payload: Json | null
          url_modelo: string | null
        }
        Insert: {
          ativo?: boolean
          atualizado_em?: string
          atualizado_por?: string | null
          corpo_modelo?: string | null
          criado_em?: string
          descricao?: string | null
          gravidade?: string
          modulo?: string
          nome: string
          tipo: string
          titulo_modelo?: string | null
          ultimo_em?: string | null
          ultimo_payload?: Json | null
          url_modelo?: string | null
        }
        Update: {
          ativo?: boolean
          atualizado_em?: string
          atualizado_por?: string | null
          corpo_modelo?: string | null
          criado_em?: string
          descricao?: string | null
          gravidade?: string
          modulo?: string
          nome?: string
          tipo?: string
          titulo_modelo?: string | null
          ultimo_em?: string | null
          ultimo_payload?: Json | null
          url_modelo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notificacao_tipos_atualizado_por_fkey"
            columns: ["atualizado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      notificacoes: {
        Row: {
          chave: string | null
          corpo: string | null
          criado_em: string
          id: string
          lida: boolean
          tipo: string | null
          titulo: string
          url: string | null
          usuario_id: string
        }
        Insert: {
          chave?: string | null
          corpo?: string | null
          criado_em?: string
          id?: string
          lida?: boolean
          tipo?: string | null
          titulo: string
          url?: string | null
          usuario_id: string
        }
        Update: {
          chave?: string | null
          corpo?: string | null
          criado_em?: string
          id?: string
          lida?: boolean
          tipo?: string | null
          titulo?: string
          url?: string | null
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notificacoes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      notificacoes_envios: {
        Row: {
          agendado_para: string
          canal: string
          criado_em: string
          enviado_em: string | null
          erro: string | null
          id: string
          notificacao_id: string
          status: string
          tentativas: number
          usuario_id: string
        }
        Insert: {
          agendado_para?: string
          canal: string
          criado_em?: string
          enviado_em?: string | null
          erro?: string | null
          id?: string
          notificacao_id: string
          status?: string
          tentativas?: number
          usuario_id: string
        }
        Update: {
          agendado_para?: string
          canal?: string
          criado_em?: string
          enviado_em?: string | null
          erro?: string | null
          id?: string
          notificacao_id?: string
          status?: string
          tentativas?: number
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notificacoes_envios_notificacao_id_fkey"
            columns: ["notificacao_id"]
            isOneToOne: false
            referencedRelation: "notificacoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notificacoes_envios_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      notificacoes_resumo: {
        Row: {
          canais: string[]
          chave: string | null
          corpo: string | null
          criado_em: string
          entregue_em: string | null
          id: string
          tipo: string
          titulo: string
          url: string | null
          usuario_id: string
        }
        Insert: {
          canais?: string[]
          chave?: string | null
          corpo?: string | null
          criado_em?: string
          entregue_em?: string | null
          id?: string
          tipo: string
          titulo: string
          url?: string | null
          usuario_id: string
        }
        Update: {
          canais?: string[]
          chave?: string | null
          corpo?: string | null
          criado_em?: string
          entregue_em?: string | null
          id?: string
          tipo?: string
          titulo?: string
          url?: string | null
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notificacoes_resumo_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      pedidos_apresentacao: {
        Row: {
          comunicacao_id: string | null
          contato_fornecedor_id: string | null
          contato_sacado_id: string | null
          criado_em: string
          direcao: string
          fornecedor_cnpj: string
          id: string
          mensagem: string | null
          respondido_em: string | null
          sacado_cnpj: string
          solicitado_por: string | null
          status: string
        }
        Insert: {
          comunicacao_id?: string | null
          contato_fornecedor_id?: string | null
          contato_sacado_id?: string | null
          criado_em?: string
          direcao?: string
          fornecedor_cnpj: string
          id?: string
          mensagem?: string | null
          respondido_em?: string | null
          sacado_cnpj: string
          solicitado_por?: string | null
          status?: string
        }
        Update: {
          comunicacao_id?: string | null
          contato_fornecedor_id?: string | null
          contato_sacado_id?: string | null
          criado_em?: string
          direcao?: string
          fornecedor_cnpj?: string
          id?: string
          mensagem?: string | null
          respondido_em?: string | null
          sacado_cnpj?: string
          solicitado_por?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "pedidos_apresentacao_comunicacao_id_fkey"
            columns: ["comunicacao_id"]
            isOneToOne: false
            referencedRelation: "comunicacoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_apresentacao_comunicacao_id_fkey"
            columns: ["comunicacao_id"]
            isOneToOne: false
            referencedRelation: "comunicacoes_thread"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_apresentacao_contato_fornecedor_id_fkey"
            columns: ["contato_fornecedor_id"]
            isOneToOne: false
            referencedRelation: "contatos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_apresentacao_contato_sacado_id_fkey"
            columns: ["contato_sacado_id"]
            isOneToOne: false
            referencedRelation: "contatos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_apresentacao_solicitado_por_fkey"
            columns: ["solicitado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      perfil_config: {
        Row: {
          atualizado_em: string
          atualizado_por: string | null
          chave: string
          valor: Json
        }
        Insert: {
          atualizado_em?: string
          atualizado_por?: string | null
          chave: string
          valor: Json
        }
        Update: {
          atualizado_em?: string
          atualizado_por?: string | null
          chave?: string
          valor?: Json
        }
        Relationships: [
          {
            foreignKeyName: "perfil_config_atualizado_por_fkey"
            columns: ["atualizado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      perfil_modulos: {
        Row: {
          modulo_id: string
          perfil_id: string
        }
        Insert: {
          modulo_id: string
          perfil_id: string
        }
        Update: {
          modulo_id?: string
          perfil_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "perfil_modulos_perfil_id_fkey"
            columns: ["perfil_id"]
            isOneToOne: false
            referencedRelation: "perfis"
            referencedColumns: ["id"]
          },
        ]
      }
      perfil_snapshots: {
        Row: {
          auditoria: Json | null
          calculado_em: string
          comparacao: string
          coorte_a: number
          coorte_b: number
          id: string
          resultados: Json
          sugestoes: Json | null
          trilha: string
          versao_regras: Json | null
        }
        Insert: {
          auditoria?: Json | null
          calculado_em?: string
          comparacao: string
          coorte_a?: number
          coorte_b?: number
          id?: string
          resultados: Json
          sugestoes?: Json | null
          trilha: string
          versao_regras?: Json | null
        }
        Update: {
          auditoria?: Json | null
          calculado_em?: string
          comparacao?: string
          coorte_a?: number
          coorte_b?: number
          id?: string
          resultados?: Json
          sugestoes?: Json | null
          trilha?: string
          versao_regras?: Json | null
        }
        Relationships: []
      }
      perfil_sugestoes_log: {
        Row: {
          acao: string
          em: string
          id: string
          motivo: string | null
          regra_chave: string | null
          regra_tipo: string | null
          regra_versao_criada: number | null
          snapshot_id: string | null
          sugestao: Json
          sugestao_id: string
          usuario_id: string | null
        }
        Insert: {
          acao: string
          em?: string
          id?: string
          motivo?: string | null
          regra_chave?: string | null
          regra_tipo?: string | null
          regra_versao_criada?: number | null
          snapshot_id?: string | null
          sugestao: Json
          sugestao_id: string
          usuario_id?: string | null
        }
        Update: {
          acao?: string
          em?: string
          id?: string
          motivo?: string | null
          regra_chave?: string | null
          regra_tipo?: string | null
          regra_versao_criada?: number | null
          snapshot_id?: string | null
          sugestao?: Json
          sugestao_id?: string
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "perfil_sugestoes_log_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "perfil_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "perfil_sugestoes_log_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      perfis: {
        Row: {
          criado_em: string
          descricao: string | null
          id: string
          nome: string
        }
        Insert: {
          criado_em?: string
          descricao?: string | null
          id?: string
          nome: string
        }
        Update: {
          criado_em?: string
          descricao?: string | null
          id?: string
          nome?: string
        }
        Relationships: []
      }
      plantao_enviados: {
        Row: {
          enviado_em: string
          evento_id: string
        }
        Insert: {
          enviado_em?: string
          evento_id: string
        }
        Update: {
          enviado_em?: string
          evento_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plantao_enviados_evento_id_fkey"
            columns: ["evento_id"]
            isOneToOne: true
            referencedRelation: "empresa_eventos"
            referencedColumns: ["id"]
          },
        ]
      }
      pre_autorizacoes: {
        Row: {
          anticipation_id_externo: number | null
          credit_status: string | null
          criada_em: string | null
          dias_para_vencimento: number | null
          estagio_alterado_em: string | null
          estagio_funil: string
          expira_em: string | null
          faixa: string | null
          faixa_alterada_em: string | null
          faixa_motivo: string | null
          faixa_regra_versao: number | null
          fornecedor_cadastrado: boolean | null
          fornecedor_cnpj: string
          fornecedor_empresa_id: string | null
          fornecedor_nome: string | null
          id_externo: number
          identification: string | null
          invoice_number: string | null
          limite_disponivel_sacado: number | null
          limite_sacado_origem: string | null
          migrated: boolean | null
          numero_normalizado: string | null
          origem_exibida: boolean
          origin: string
          original_id: string | null
          original_tipo: string | null
          perda_motivo: string | null
          raw: Json | null
          receita_esperada: number | null
          revoked_reason: string | null
          sacado_cnpj: string
          sacado_empresa_id: string | null
          sacado_matriz_cnpj: string
          sacado_nome: string | null
          seguro_estimado: number | null
          sienge_bill_id: number | null
          sienge_document_number: string | null
          sienge_installment_id: number | null
          sienge_installment_number: number | null
          sincronizada_em: string
          solicitada_em: string | null
          status: string
          status_anterior: string | null
          tac_estimada: number | null
          taxa_analise_am: number | null
          taxa_analise_origem: string | null
          taxa_usada: number | null
          valor: number
          vencimento: string | null
          vendedor_definido_em: string | null
          vendedor_id: string | null
          vendedor_origem: string | null
        }
        Insert: {
          anticipation_id_externo?: number | null
          credit_status?: string | null
          criada_em?: string | null
          dias_para_vencimento?: number | null
          estagio_alterado_em?: string | null
          estagio_funil?: string
          expira_em?: string | null
          faixa?: string | null
          faixa_alterada_em?: string | null
          faixa_motivo?: string | null
          faixa_regra_versao?: number | null
          fornecedor_cadastrado?: boolean | null
          fornecedor_cnpj: string
          fornecedor_empresa_id?: string | null
          fornecedor_nome?: string | null
          id_externo: number
          identification?: string | null
          invoice_number?: string | null
          limite_disponivel_sacado?: number | null
          limite_sacado_origem?: string | null
          migrated?: boolean | null
          numero_normalizado?: string | null
          origem_exibida?: boolean
          origin: string
          original_id?: string | null
          original_tipo?: string | null
          perda_motivo?: string | null
          raw?: Json | null
          receita_esperada?: number | null
          revoked_reason?: string | null
          sacado_cnpj: string
          sacado_empresa_id?: string | null
          sacado_matriz_cnpj: string
          sacado_nome?: string | null
          seguro_estimado?: number | null
          sienge_bill_id?: number | null
          sienge_document_number?: string | null
          sienge_installment_id?: number | null
          sienge_installment_number?: number | null
          sincronizada_em?: string
          solicitada_em?: string | null
          status: string
          status_anterior?: string | null
          tac_estimada?: number | null
          taxa_analise_am?: number | null
          taxa_analise_origem?: string | null
          taxa_usada?: number | null
          valor: number
          vencimento?: string | null
          vendedor_definido_em?: string | null
          vendedor_id?: string | null
          vendedor_origem?: string | null
        }
        Update: {
          anticipation_id_externo?: number | null
          credit_status?: string | null
          criada_em?: string | null
          dias_para_vencimento?: number | null
          estagio_alterado_em?: string | null
          estagio_funil?: string
          expira_em?: string | null
          faixa?: string | null
          faixa_alterada_em?: string | null
          faixa_motivo?: string | null
          faixa_regra_versao?: number | null
          fornecedor_cadastrado?: boolean | null
          fornecedor_cnpj?: string
          fornecedor_empresa_id?: string | null
          fornecedor_nome?: string | null
          id_externo?: number
          identification?: string | null
          invoice_number?: string | null
          limite_disponivel_sacado?: number | null
          limite_sacado_origem?: string | null
          migrated?: boolean | null
          numero_normalizado?: string | null
          origem_exibida?: boolean
          origin?: string
          original_id?: string | null
          original_tipo?: string | null
          perda_motivo?: string | null
          raw?: Json | null
          receita_esperada?: number | null
          revoked_reason?: string | null
          sacado_cnpj?: string
          sacado_empresa_id?: string | null
          sacado_matriz_cnpj?: string
          sacado_nome?: string | null
          seguro_estimado?: number | null
          sienge_bill_id?: number | null
          sienge_document_number?: string | null
          sienge_installment_id?: number | null
          sienge_installment_number?: number | null
          sincronizada_em?: string
          solicitada_em?: string | null
          status?: string
          status_anterior?: string | null
          tac_estimada?: number | null
          taxa_analise_am?: number | null
          taxa_analise_origem?: string | null
          taxa_usada?: number | null
          valor?: number
          vencimento?: string | null
          vendedor_definido_em?: string | null
          vendedor_id?: string | null
          vendedor_origem?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pre_autorizacoes_fornecedor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "pre_autorizacoes_fornecedor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "pre_autorizacoes_fornecedor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "pre_autorizacoes_fornecedor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "pre_autorizacoes_fornecedor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pre_autorizacoes_fornecedor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "pre_autorizacoes_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "pre_autorizacoes_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "pre_autorizacoes_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "pre_autorizacoes_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "pre_autorizacoes_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pre_autorizacoes_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "pre_autorizacoes_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
        ]
      }
      precificacao_matriz: {
        Row: {
          ativa: boolean
          criada_em: string
          criada_por: string | null
          definicao: Json
          versao: number
        }
        Insert: {
          ativa?: boolean
          criada_em?: string
          criada_por?: string | null
          definicao: Json
          versao: number
        }
        Update: {
          ativa?: boolean
          criada_em?: string
          criada_por?: string | null
          definicao?: Json
          versao?: number
        }
        Relationships: [
          {
            foreignKeyName: "precificacao_matriz_criada_por_fkey"
            columns: ["criada_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      processo_briefings: {
        Row: {
          ate_movimentacao_em: string | null
          criado_em: string
          modelo: string | null
          numero_cnj: string
          proxima_acao: string
          qtd_movimentacoes_lidas: number
          resumo_fase: string
          resumo_movimentacoes: string
          tokens: number | null
          urgencia: string | null
        }
        Insert: {
          ate_movimentacao_em?: string | null
          criado_em?: string
          modelo?: string | null
          numero_cnj: string
          proxima_acao: string
          qtd_movimentacoes_lidas?: number
          resumo_fase: string
          resumo_movimentacoes: string
          tokens?: number | null
          urgencia?: string | null
        }
        Update: {
          ate_movimentacao_em?: string | null
          criado_em?: string
          modelo?: string | null
          numero_cnj?: string
          proxima_acao?: string
          qtd_movimentacoes_lidas?: number
          resumo_fase?: string
          resumo_movimentacoes?: string
          tokens?: number | null
          urgencia?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "processo_briefings_numero_cnj_fkey"
            columns: ["numero_cnj"]
            isOneToOne: true
            referencedRelation: "juridico_carteira"
            referencedColumns: ["numero_cnj"]
          },
          {
            foreignKeyName: "processo_briefings_numero_cnj_fkey"
            columns: ["numero_cnj"]
            isOneToOne: true
            referencedRelation: "processos"
            referencedColumns: ["numero_cnj"]
          },
        ]
      }
      processo_calculos: {
        Row: {
          correcao: number | null
          criado_em: string
          custas: number | null
          data_base: string
          data_calculo: string
          gerado_por: string | null
          honorarios: number | null
          id: string
          juros: number | null
          memoria: Json
          multa: number | null
          numero_cnj: string
          parametros: Json
          principal: number | null
          total: number
        }
        Insert: {
          correcao?: number | null
          criado_em?: string
          custas?: number | null
          data_base: string
          data_calculo?: string
          gerado_por?: string | null
          honorarios?: number | null
          id?: string
          juros?: number | null
          memoria: Json
          multa?: number | null
          numero_cnj: string
          parametros: Json
          principal?: number | null
          total: number
        }
        Update: {
          correcao?: number | null
          criado_em?: string
          custas?: number | null
          data_base?: string
          data_calculo?: string
          gerado_por?: string | null
          honorarios?: number | null
          id?: string
          juros?: number | null
          memoria?: Json
          multa?: number | null
          numero_cnj?: string
          parametros?: Json
          principal?: number | null
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "processo_calculos_gerado_por_fkey"
            columns: ["gerado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "processo_calculos_numero_cnj_fkey"
            columns: ["numero_cnj"]
            isOneToOne: false
            referencedRelation: "juridico_carteira"
            referencedColumns: ["numero_cnj"]
          },
          {
            foreignKeyName: "processo_calculos_numero_cnj_fkey"
            columns: ["numero_cnj"]
            isOneToOne: false
            referencedRelation: "processos"
            referencedColumns: ["numero_cnj"]
          },
        ]
      }
      processo_custos: {
        Row: {
          comprovante_url: string | null
          criado_em: string
          data: string
          descricao: string | null
          id: string
          numero_cnj: string
          registrado_por: string | null
          tipo: string
          valor: number
        }
        Insert: {
          comprovante_url?: string | null
          criado_em?: string
          data: string
          descricao?: string | null
          id?: string
          numero_cnj: string
          registrado_por?: string | null
          tipo: string
          valor: number
        }
        Update: {
          comprovante_url?: string | null
          criado_em?: string
          data?: string
          descricao?: string | null
          id?: string
          numero_cnj?: string
          registrado_por?: string | null
          tipo?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "processo_custos_numero_cnj_fkey"
            columns: ["numero_cnj"]
            isOneToOne: false
            referencedRelation: "juridico_carteira"
            referencedColumns: ["numero_cnj"]
          },
          {
            foreignKeyName: "processo_custos_numero_cnj_fkey"
            columns: ["numero_cnj"]
            isOneToOne: false
            referencedRelation: "processos"
            referencedColumns: ["numero_cnj"]
          },
          {
            foreignKeyName: "processo_custos_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      processo_envolvidos: {
        Row: {
          advogados: Json
          atualizado_em: string
          cpf_cnpj: string | null
          id: string
          nome: string
          numero_cnj: string
          polo: string | null
          tipo: string | null
          tipo_normalizado: string | null
          tipo_pessoa: string | null
        }
        Insert: {
          advogados?: Json
          atualizado_em?: string
          cpf_cnpj?: string | null
          id?: string
          nome: string
          numero_cnj: string
          polo?: string | null
          tipo?: string | null
          tipo_normalizado?: string | null
          tipo_pessoa?: string | null
        }
        Update: {
          advogados?: Json
          atualizado_em?: string
          cpf_cnpj?: string | null
          id?: string
          nome?: string
          numero_cnj?: string
          polo?: string | null
          tipo?: string | null
          tipo_normalizado?: string | null
          tipo_pessoa?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "processo_envolvidos_numero_cnj_fkey"
            columns: ["numero_cnj"]
            isOneToOne: false
            referencedRelation: "juridico_carteira"
            referencedColumns: ["numero_cnj"]
          },
          {
            foreignKeyName: "processo_envolvidos_numero_cnj_fkey"
            columns: ["numero_cnj"]
            isOneToOne: false
            referencedRelation: "processos"
            referencedColumns: ["numero_cnj"]
          },
        ]
      }
      processo_movimentacoes: {
        Row: {
          conteudo: string
          criado_em: string
          data: string
          fase_detectada: string | null
          fonte_nome: string | null
          fonte_sigla: string | null
          grau: number | null
          id: number
          numero_cnj: string
          relevante: boolean
          termo_detectado: string | null
          tipo: string | null
        }
        Insert: {
          conteudo: string
          criado_em?: string
          data: string
          fase_detectada?: string | null
          fonte_nome?: string | null
          fonte_sigla?: string | null
          grau?: number | null
          id: number
          numero_cnj: string
          relevante?: boolean
          termo_detectado?: string | null
          tipo?: string | null
        }
        Update: {
          conteudo?: string
          criado_em?: string
          data?: string
          fase_detectada?: string | null
          fonte_nome?: string | null
          fonte_sigla?: string | null
          grau?: number | null
          id?: number
          numero_cnj?: string
          relevante?: boolean
          termo_detectado?: string | null
          tipo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "processo_movimentacoes_numero_cnj_fkey"
            columns: ["numero_cnj"]
            isOneToOne: false
            referencedRelation: "juridico_carteira"
            referencedColumns: ["numero_cnj"]
          },
          {
            foreignKeyName: "processo_movimentacoes_numero_cnj_fkey"
            columns: ["numero_cnj"]
            isOneToOne: false
            referencedRelation: "processos"
            referencedColumns: ["numero_cnj"]
          },
        ]
      }
      processo_operacoes: {
        Row: {
          access_key: string | null
          antecipacao_id_externo: number | null
          criado_em: string
          criado_por: string | null
          descricao: string | null
          id: string
          numero_cnj: string
          valor_original: number
          vencimento: string
        }
        Insert: {
          access_key?: string | null
          antecipacao_id_externo?: number | null
          criado_em?: string
          criado_por?: string | null
          descricao?: string | null
          id?: string
          numero_cnj: string
          valor_original: number
          vencimento: string
        }
        Update: {
          access_key?: string | null
          antecipacao_id_externo?: number | null
          criado_em?: string
          criado_por?: string | null
          descricao?: string | null
          id?: string
          numero_cnj?: string
          valor_original?: number
          vencimento?: string
        }
        Relationships: [
          {
            foreignKeyName: "processo_operacoes_access_key_fkey"
            columns: ["access_key"]
            isOneToOne: false
            referencedRelation: "funil_oportunidades_nf"
            referencedColumns: ["access_key"]
          },
          {
            foreignKeyName: "processo_operacoes_access_key_fkey"
            columns: ["access_key"]
            isOneToOne: false
            referencedRelation: "funil_oportunidades_nf"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "processo_operacoes_access_key_fkey"
            columns: ["access_key"]
            isOneToOne: false
            referencedRelation: "notas_fiscais"
            referencedColumns: ["access_key"]
          },
          {
            foreignKeyName: "processo_operacoes_access_key_fkey"
            columns: ["access_key"]
            isOneToOne: false
            referencedRelation: "notas_funil"
            referencedColumns: ["access_key"]
          },
          {
            foreignKeyName: "processo_operacoes_antecipacao_id_externo_fkey"
            columns: ["antecipacao_id_externo"]
            isOneToOne: false
            referencedRelation: "antecipacoes"
            referencedColumns: ["id_externo"]
          },
          {
            foreignKeyName: "processo_operacoes_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "processo_operacoes_numero_cnj_fkey"
            columns: ["numero_cnj"]
            isOneToOne: false
            referencedRelation: "juridico_carteira"
            referencedColumns: ["numero_cnj"]
          },
          {
            foreignKeyName: "processo_operacoes_numero_cnj_fkey"
            columns: ["numero_cnj"]
            isOneToOne: false
            referencedRelation: "processos"
            referencedColumns: ["numero_cnj"]
          },
        ]
      }
      processo_pareceres: {
        Row: {
          criado_em: string
          editado: boolean
          gerado_por: string | null
          id: string
          modelo: string | null
          numero_cnj: string
          parecer_markdown: string
          proximo_passo: string
          risco: string | null
          tokens: number | null
        }
        Insert: {
          criado_em?: string
          editado?: boolean
          gerado_por?: string | null
          id?: string
          modelo?: string | null
          numero_cnj: string
          parecer_markdown: string
          proximo_passo: string
          risco?: string | null
          tokens?: number | null
        }
        Update: {
          criado_em?: string
          editado?: boolean
          gerado_por?: string | null
          id?: string
          modelo?: string | null
          numero_cnj?: string
          parecer_markdown?: string
          proximo_passo?: string
          risco?: string | null
          tokens?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "processo_pareceres_gerado_por_fkey"
            columns: ["gerado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "processo_pareceres_numero_cnj_fkey"
            columns: ["numero_cnj"]
            isOneToOne: false
            referencedRelation: "juridico_carteira"
            referencedColumns: ["numero_cnj"]
          },
          {
            foreignKeyName: "processo_pareceres_numero_cnj_fkey"
            columns: ["numero_cnj"]
            isOneToOne: false
            referencedRelation: "processos"
            referencedColumns: ["numero_cnj"]
          },
        ]
      }
      processo_prazos: {
        Row: {
          avisado_d1_em: string | null
          avisado_d3_em: string | null
          concluido: boolean
          concluido_em: string | null
          criado_em: string
          criado_por: string | null
          data: string
          descricao: string
          id: string
          numero_cnj: string
          responsavel_id: string | null
          tipo: string
        }
        Insert: {
          avisado_d1_em?: string | null
          avisado_d3_em?: string | null
          concluido?: boolean
          concluido_em?: string | null
          criado_em?: string
          criado_por?: string | null
          data: string
          descricao: string
          id?: string
          numero_cnj: string
          responsavel_id?: string | null
          tipo: string
        }
        Update: {
          avisado_d1_em?: string | null
          avisado_d3_em?: string | null
          concluido?: boolean
          concluido_em?: string | null
          criado_em?: string
          criado_por?: string | null
          data?: string
          descricao?: string
          id?: string
          numero_cnj?: string
          responsavel_id?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "processo_prazos_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "processo_prazos_numero_cnj_fkey"
            columns: ["numero_cnj"]
            isOneToOne: false
            referencedRelation: "juridico_carteira"
            referencedColumns: ["numero_cnj"]
          },
          {
            foreignKeyName: "processo_prazos_numero_cnj_fkey"
            columns: ["numero_cnj"]
            isOneToOne: false
            referencedRelation: "processos"
            referencedColumns: ["numero_cnj"]
          },
          {
            foreignKeyName: "processo_prazos_responsavel_id_fkey"
            columns: ["responsavel_id"]
            isOneToOne: false
            referencedRelation: "advogados"
            referencedColumns: ["id"]
          },
        ]
      }
      processo_recuperacoes: {
        Row: {
          criado_em: string
          data: string
          id: string
          numero_cnj: string
          observacao: string | null
          origem: string
          registrado_por: string | null
          valor: number
        }
        Insert: {
          criado_em?: string
          data: string
          id?: string
          numero_cnj: string
          observacao?: string | null
          origem: string
          registrado_por?: string | null
          valor: number
        }
        Update: {
          criado_em?: string
          data?: string
          id?: string
          numero_cnj?: string
          observacao?: string | null
          origem?: string
          registrado_por?: string | null
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "processo_recuperacoes_numero_cnj_fkey"
            columns: ["numero_cnj"]
            isOneToOne: false
            referencedRelation: "juridico_carteira"
            referencedColumns: ["numero_cnj"]
          },
          {
            foreignKeyName: "processo_recuperacoes_numero_cnj_fkey"
            columns: ["numero_cnj"]
            isOneToOne: false
            referencedRelation: "processos"
            referencedColumns: ["numero_cnj"]
          },
          {
            foreignKeyName: "processo_recuperacoes_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      processos: {
        Row: {
          advogado_id: string | null
          area: string | null
          arquivado: boolean | null
          assunto: string | null
          atualizado_em: string
          classe: string | null
          cnpj_devedor: string | null
          comarca: string | null
          criado_em: string
          data_arquivamento: string | null
          data_distribuicao: string | null
          data_inicio: string | null
          data_ultima_movimentacao: string | null
          data_ultima_verificacao: string | null
          empresa_devedora_id: string | null
          fase_atual: string | null
          fase_desde: string | null
          fisico: boolean | null
          grau: number | null
          nosso_cnpj: string | null
          numero_cnj: string
          observacoes: string | null
          orgao_julgador: string | null
          polo_nosso: string | null
          qtd_movimentacoes: number | null
          raw: Json | null
          segredo_justica: boolean | null
          sistema: string | null
          situacao_interna: string
          status_predito: string | null
          titulo_polo_ativo: string | null
          titulo_polo_passivo: string | null
          tribunal_nome: string | null
          tribunal_sigla: string | null
          uf: string | null
          ultima_sincronizacao: string | null
          url_tribunal: string | null
          valor_causa: number | null
          vinculo_cobranca_id: string | null
        }
        Insert: {
          advogado_id?: string | null
          area?: string | null
          arquivado?: boolean | null
          assunto?: string | null
          atualizado_em?: string
          classe?: string | null
          cnpj_devedor?: string | null
          comarca?: string | null
          criado_em?: string
          data_arquivamento?: string | null
          data_distribuicao?: string | null
          data_inicio?: string | null
          data_ultima_movimentacao?: string | null
          data_ultima_verificacao?: string | null
          empresa_devedora_id?: string | null
          fase_atual?: string | null
          fase_desde?: string | null
          fisico?: boolean | null
          grau?: number | null
          nosso_cnpj?: string | null
          numero_cnj: string
          observacoes?: string | null
          orgao_julgador?: string | null
          polo_nosso?: string | null
          qtd_movimentacoes?: number | null
          raw?: Json | null
          segredo_justica?: boolean | null
          sistema?: string | null
          situacao_interna?: string
          status_predito?: string | null
          titulo_polo_ativo?: string | null
          titulo_polo_passivo?: string | null
          tribunal_nome?: string | null
          tribunal_sigla?: string | null
          uf?: string | null
          ultima_sincronizacao?: string | null
          url_tribunal?: string | null
          valor_causa?: number | null
          vinculo_cobranca_id?: string | null
        }
        Update: {
          advogado_id?: string | null
          area?: string | null
          arquivado?: boolean | null
          assunto?: string | null
          atualizado_em?: string
          classe?: string | null
          cnpj_devedor?: string | null
          comarca?: string | null
          criado_em?: string
          data_arquivamento?: string | null
          data_distribuicao?: string | null
          data_inicio?: string | null
          data_ultima_movimentacao?: string | null
          data_ultima_verificacao?: string | null
          empresa_devedora_id?: string | null
          fase_atual?: string | null
          fase_desde?: string | null
          fisico?: boolean | null
          grau?: number | null
          nosso_cnpj?: string | null
          numero_cnj?: string
          observacoes?: string | null
          orgao_julgador?: string | null
          polo_nosso?: string | null
          qtd_movimentacoes?: number | null
          raw?: Json | null
          segredo_justica?: boolean | null
          sistema?: string | null
          situacao_interna?: string
          status_predito?: string | null
          titulo_polo_ativo?: string | null
          titulo_polo_passivo?: string | null
          tribunal_nome?: string | null
          tribunal_sigla?: string | null
          uf?: string | null
          ultima_sincronizacao?: string | null
          url_tribunal?: string | null
          valor_causa?: number | null
          vinculo_cobranca_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "processos_advogado_id_fkey"
            columns: ["advogado_id"]
            isOneToOne: false
            referencedRelation: "advogados"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "processos_empresa_devedora_id_fkey"
            columns: ["empresa_devedora_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "processos_empresa_devedora_id_fkey"
            columns: ["empresa_devedora_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "processos_empresa_devedora_id_fkey"
            columns: ["empresa_devedora_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "processos_empresa_devedora_id_fkey"
            columns: ["empresa_devedora_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "processos_empresa_devedora_id_fkey"
            columns: ["empresa_devedora_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "processos_empresa_devedora_id_fkey"
            columns: ["empresa_devedora_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "processos_vinculo_cobranca_fk"
            columns: ["vinculo_cobranca_id"]
            isOneToOne: false
            referencedRelation: "cobranca_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "processos_vinculo_cobranca_fk"
            columns: ["vinculo_cobranca_id"]
            isOneToOne: false
            referencedRelation: "cobrancas"
            referencedColumns: ["id"]
          },
        ]
      }
      prospeccao_config: {
        Row: {
          atualizado_em: string
          atualizado_por: string | null
          chave: string
          valor: Json
        }
        Insert: {
          atualizado_em?: string
          atualizado_por?: string | null
          chave: string
          valor: Json
        }
        Update: {
          atualizado_em?: string
          atualizado_por?: string | null
          chave?: string
          valor?: Json
        }
        Relationships: [
          {
            foreignKeyName: "prospeccao_config_atualizado_por_fkey"
            columns: ["atualizado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      prospeccao_enriquecimentos: {
        Row: {
          cnpj_sacado: string
          custo: number
          erro: string | null
          executado_em: string
          fonte: string
          id: string
          lote_id: string | null
          originador_id: string | null
          solicitado_por: string | null
          status: string
        }
        Insert: {
          cnpj_sacado: string
          custo?: number
          erro?: string | null
          executado_em?: string
          fonte: string
          id?: string
          lote_id?: string | null
          originador_id?: string | null
          solicitado_por?: string | null
          status: string
        }
        Update: {
          cnpj_sacado?: string
          custo?: number
          erro?: string | null
          executado_em?: string
          fonte?: string
          id?: string
          lote_id?: string | null
          originador_id?: string | null
          solicitado_por?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospeccao_enriquecimentos_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "lotes_enriquecimento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospeccao_enriquecimentos_originador_id_fkey"
            columns: ["originador_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospeccao_enriquecimentos_solicitado_por_fkey"
            columns: ["solicitado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      protesto_monitoramento: {
        Row: {
          cnpj: string
          criado_em: string
          criado_por: string | null
          empresa_id: string | null
          grupo_id: string | null
        }
        Insert: {
          cnpj: string
          criado_em?: string
          criado_por?: string | null
          empresa_id?: string | null
          grupo_id?: string | null
        }
        Update: {
          cnpj?: string
          criado_em?: string
          criado_por?: string | null
          empresa_id?: string | null
          grupo_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "protesto_monitoramento_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "protesto_monitoramento_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "protesto_monitoramento_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "protesto_monitoramento_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "protesto_monitoramento_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "protesto_monitoramento_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      protesto_remessas: {
        Row: {
          arquivo_path: string | null
          cobranca_id: string | null
          cra: string
          criado_em: string
          criado_por: string | null
          enviada_em: string | null
          id: string
          modo: string
          protocolo: string | null
          retorno_path: string | null
          retorno_processado_em: string | null
          status: string
          tipo: string
          uf: string
        }
        Insert: {
          arquivo_path?: string | null
          cobranca_id?: string | null
          cra: string
          criado_em?: string
          criado_por?: string | null
          enviada_em?: string | null
          id?: string
          modo?: string
          protocolo?: string | null
          retorno_path?: string | null
          retorno_processado_em?: string | null
          status?: string
          tipo?: string
          uf: string
        }
        Update: {
          arquivo_path?: string | null
          cobranca_id?: string | null
          cra?: string
          criado_em?: string
          criado_por?: string | null
          enviada_em?: string | null
          id?: string
          modo?: string
          protocolo?: string | null
          retorno_path?: string | null
          retorno_processado_em?: string | null
          status?: string
          tipo?: string
          uf?: string
        }
        Relationships: [
          {
            foreignKeyName: "protesto_remessas_cobranca_id_fkey"
            columns: ["cobranca_id"]
            isOneToOne: false
            referencedRelation: "cobranca_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "protesto_remessas_cobranca_id_fkey"
            columns: ["cobranca_id"]
            isOneToOne: false
            referencedRelation: "cobrancas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "protesto_remessas_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      protesto_titulos: {
        Row: {
          atualizado_em: string
          cartorio: string | null
          certidao_path: string | null
          cobranca_titulo_id: string | null
          custas: number | null
          data_protesto: string | null
          id: string
          instrucao_cancelamento_em: string | null
          instrucao_nao_aplicavel_motivo: string | null
          motivo_rejeicao: string | null
          protocolo_cartorio: string | null
          remessa_id: string | null
          situacao: string
        }
        Insert: {
          atualizado_em?: string
          cartorio?: string | null
          certidao_path?: string | null
          cobranca_titulo_id?: string | null
          custas?: number | null
          data_protesto?: string | null
          id?: string
          instrucao_cancelamento_em?: string | null
          instrucao_nao_aplicavel_motivo?: string | null
          motivo_rejeicao?: string | null
          protocolo_cartorio?: string | null
          remessa_id?: string | null
          situacao?: string
        }
        Update: {
          atualizado_em?: string
          cartorio?: string | null
          certidao_path?: string | null
          cobranca_titulo_id?: string | null
          custas?: number | null
          data_protesto?: string | null
          id?: string
          instrucao_cancelamento_em?: string | null
          instrucao_nao_aplicavel_motivo?: string | null
          motivo_rejeicao?: string | null
          protocolo_cartorio?: string | null
          remessa_id?: string | null
          situacao?: string
        }
        Relationships: [
          {
            foreignKeyName: "protesto_titulos_cobranca_titulo_id_fkey"
            columns: ["cobranca_titulo_id"]
            isOneToOne: false
            referencedRelation: "cobranca_titulos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "protesto_titulos_remessa_id_fkey"
            columns: ["remessa_id"]
            isOneToOne: false
            referencedRelation: "protesto_remessas"
            referencedColumns: ["id"]
          },
        ]
      }
      protestos_consultas: {
        Row: {
          cartorios: Json | null
          cnpj: string
          consultado_em: string
          custo: number | null
          empresa_id: string | null
          fonte: string
          id: string
          payload: Json | null
          qtd_protestos: number | null
          tem_protesto: boolean | null
          valor_total: number | null
        }
        Insert: {
          cartorios?: Json | null
          cnpj: string
          consultado_em?: string
          custo?: number | null
          empresa_id?: string | null
          fonte: string
          id?: string
          payload?: Json | null
          qtd_protestos?: number | null
          tem_protesto?: boolean | null
          valor_total?: number | null
        }
        Update: {
          cartorios?: Json | null
          cnpj?: string
          consultado_em?: string
          custo?: number | null
          empresa_id?: string | null
          fonte?: string
          id?: string
          payload?: Json | null
          qtd_protestos?: number | null
          tem_protesto?: boolean | null
          valor_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "protestos_consultas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "protestos_consultas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "protestos_consultas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "protestos_consultas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "protestos_consultas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "protestos_consultas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      qualidade_segredos: {
        Row: {
          chave: string
          definido_em: string
          definido_por: string | null
          secret_id: string
        }
        Insert: {
          chave: string
          definido_em?: string
          definido_por?: string | null
          secret_id: string
        }
        Update: {
          chave?: string
          definido_em?: string
          definido_por?: string | null
          secret_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qualidade_segredos_definido_por_fkey"
            columns: ["definido_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      qualidade_pessoas: {
        Row: {
          analise_ativa: boolean
          atualizado_em: string
          atualizado_por: string | null
          captura_ativa: boolean
          vendedor_id: string
        }
        Insert: {
          analise_ativa?: boolean
          atualizado_em?: string
          atualizado_por?: string | null
          captura_ativa?: boolean
          vendedor_id: string
        }
        Update: {
          analise_ativa?: boolean
          atualizado_em?: string
          atualizado_por?: string | null
          captura_ativa?: boolean
          vendedor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qualidade_pessoas_atualizado_por_fkey"
            columns: ["atualizado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qualidade_pessoas_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: true
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
        ]
      }
      qualidade_pendencias: {
        Row: {
          analise_id: string
          analise_item_id: string | null
          citacao: string | null
          conversa_id: string | null
          criada_em: string
          descricao: string
          empresa_id: string | null
          id: string
          prazo_em: string | null
          resolvida_em: string | null
          resolvida_por: string | null
          reuniao_id: string | null
          status: string
          tipo: string
          vendedor_id: string
        }
        Insert: {
          analise_id: string
          analise_item_id?: string | null
          citacao?: string | null
          conversa_id?: string | null
          criada_em?: string
          descricao: string
          empresa_id?: string | null
          id?: string
          prazo_em?: string | null
          resolvida_em?: string | null
          resolvida_por?: string | null
          reuniao_id?: string | null
          status?: string
          tipo: string
          vendedor_id: string
        }
        Update: {
          analise_id?: string
          analise_item_id?: string | null
          citacao?: string | null
          conversa_id?: string | null
          criada_em?: string
          descricao?: string
          empresa_id?: string | null
          id?: string
          prazo_em?: string | null
          resolvida_em?: string | null
          resolvida_por?: string | null
          reuniao_id?: string | null
          status?: string
          tipo?: string
          vendedor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qualidade_pendencias_analise_id_fkey"
            columns: ["analise_id"]
            isOneToOne: false
            referencedRelation: "analises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qualidade_pendencias_analise_item_id_fkey"
            columns: ["analise_item_id"]
            isOneToOne: false
            referencedRelation: "analise_itens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qualidade_pendencias_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "conversas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qualidade_pendencias_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "inbox_conversas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qualidade_pendencias_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "qualidade_pendencias_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "qualidade_pendencias_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "qualidade_pendencias_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "qualidade_pendencias_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qualidade_pendencias_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "qualidade_pendencias_resolvida_por_fkey"
            columns: ["resolvida_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qualidade_pendencias_reuniao_id_fkey"
            columns: ["reuniao_id"]
            isOneToOne: false
            referencedRelation: "reunioes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qualidade_pendencias_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
        ]
      }
      qualidade_config: {
        Row: {
          atualizado_em: string
          atualizado_por: string | null
          chave: string
          valor: Json
        }
        Insert: {
          atualizado_em?: string
          atualizado_por?: string | null
          chave: string
          valor: Json
        }
        Update: {
          atualizado_em?: string
          atualizado_por?: string | null
          chave?: string
          valor?: Json
        }
        Relationships: [
          {
            foreignKeyName: "qualidade_config_atualizado_por_fkey"
            columns: ["atualizado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      radar_config: {
        Row: {
          atualizado_em: string
          atualizado_por: string | null
          chave: string
          valor: Json
        }
        Insert: {
          atualizado_em?: string
          atualizado_por?: string | null
          chave: string
          valor: Json
        }
        Update: {
          atualizado_em?: string
          atualizado_por?: string | null
          chave?: string
          valor?: Json
        }
        Relationships: [
          {
            foreignKeyName: "radar_config_atualizado_por_fkey"
            columns: ["atualizado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      report_comentarios: {
        Row: {
          autor_id: string
          criado_em: string
          id: string
          interno: boolean
          report_id: string
          texto: string
        }
        Insert: {
          autor_id: string
          criado_em?: string
          id?: string
          interno?: boolean
          report_id: string
          texto: string
        }
        Update: {
          autor_id?: string
          criado_em?: string
          id?: string
          interno?: boolean
          report_id?: string
          texto?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_comentarios_autor_id_fkey"
            columns: ["autor_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_comentarios_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      report_config: {
        Row: {
          assunto_template: string | null
          ativo: boolean
          atualizado_em: string
          atualizado_por: string | null
          destinatarios: Json
          dias_semana: number[]
          horario: string
          id: string
          timezone: string
          tipo: string
        }
        Insert: {
          assunto_template?: string | null
          ativo?: boolean
          atualizado_em?: string
          atualizado_por?: string | null
          destinatarios?: Json
          dias_semana?: number[]
          horario?: string
          id?: string
          timezone?: string
          tipo?: string
        }
        Update: {
          assunto_template?: string | null
          ativo?: boolean
          atualizado_em?: string
          atualizado_por?: string | null
          destinatarios?: Json
          dias_semana?: number[]
          horario?: string
          id?: string
          timezone?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_config_atualizado_por_fkey"
            columns: ["atualizado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      report_execucoes: {
        Row: {
          criado_em: string
          criado_por: string | null
          dados: Json
          destinatarios_enviados: Json | null
          enviado_em: string | null
          erro: string | null
          id: string
          pdf_url: string | null
          periodo_fim: string
          periodo_inicio: string
          resumo_ia: string | null
          status: string
          tentativas: number
          tipo: string
        }
        Insert: {
          criado_em?: string
          criado_por?: string | null
          dados?: Json
          destinatarios_enviados?: Json | null
          enviado_em?: string | null
          erro?: string | null
          id?: string
          pdf_url?: string | null
          periodo_fim: string
          periodo_inicio: string
          resumo_ia?: string | null
          status?: string
          tentativas?: number
          tipo?: string
        }
        Update: {
          criado_em?: string
          criado_por?: string | null
          dados?: Json
          destinatarios_enviados?: Json | null
          enviado_em?: string | null
          erro?: string | null
          id?: string
          pdf_url?: string | null
          periodo_fim?: string
          periodo_inicio?: string
          resumo_ia?: string | null
          status?: string
          tentativas?: number
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_execucoes_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      report_historico: {
        Row: {
          alterado_em: string
          alterado_por: string
          id: string
          report_id: string
          status_anterior: string | null
          status_novo: string
        }
        Insert: {
          alterado_em?: string
          alterado_por: string
          id?: string
          report_id: string
          status_anterior?: string | null
          status_novo: string
        }
        Update: {
          alterado_em?: string
          alterado_por?: string
          id?: string
          report_id?: string
          status_anterior?: string | null
          status_novo?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_historico_alterado_por_fkey"
            columns: ["alterado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_historico_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      report_series: {
        Row: {
          atualizado_em: string
          competencia: string
          metrica: string
          peso: number
          valor: number
        }
        Insert: {
          atualizado_em?: string
          competencia: string
          metrica: string
          peso?: number
          valor?: number
        }
        Update: {
          atualizado_em?: string
          competencia?: string
          metrica?: string
          peso?: number
          valor?: number
        }
        Relationships: []
      }
      reports: {
        Row: {
          anexo_url: string | null
          atualizado_em: string
          contexto: Json
          criado_em: string
          criado_por: string
          descricao: string
          duplicado_de: string | null
          id: string
          numero: number
          prioridade: string | null
          resolvido_em: string | null
          status: string
          tipo: string
          titulo: string
        }
        Insert: {
          anexo_url?: string | null
          atualizado_em?: string
          contexto?: Json
          criado_em?: string
          criado_por: string
          descricao: string
          duplicado_de?: string | null
          id?: string
          numero?: number
          prioridade?: string | null
          resolvido_em?: string | null
          status?: string
          tipo: string
          titulo: string
        }
        Update: {
          anexo_url?: string | null
          atualizado_em?: string
          contexto?: Json
          criado_em?: string
          criado_por?: string
          descricao?: string
          duplicado_de?: string | null
          id?: string
          numero?: number
          prioridade?: string | null
          resolvido_em?: string | null
          status?: string
          tipo?: string
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_duplicado_de_fkey"
            columns: ["duplicado_de"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      rubricas: {
        Row: {
          ativa: boolean
          ativada_em: string | null
          calibrada_em: string | null
          criada_em: string
          criada_por: string | null
          descricao: string | null
          id: string
          nome: string
          recalibrar_pedido_em: string | null
          tipo_interacao: string
          versao: number
        }
        Insert: {
          ativa?: boolean
          ativada_em?: string | null
          calibrada_em?: string | null
          criada_em?: string
          criada_por?: string | null
          descricao?: string | null
          id?: string
          nome: string
          recalibrar_pedido_em?: string | null
          tipo_interacao: string
          versao: number
        }
        Update: {
          ativa?: boolean
          ativada_em?: string | null
          calibrada_em?: string | null
          criada_em?: string
          criada_por?: string | null
          descricao?: string | null
          id?: string
          nome?: string
          recalibrar_pedido_em?: string | null
          tipo_interacao?: string
          versao?: number
        }
        Relationships: [
          {
            foreignKeyName: "rubricas_criada_por_fkey"
            columns: ["criada_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      rubrica_itens: {
        Row: {
          atende: string[] | null
          ativo: boolean
          calibracao: Json | null
          calibrado_em: string | null
          chave: string
          condicao_aplicabilidade: string | null
          etapa: string | null
          f1: number | null
          gera_pendencia: string | null
          id: string
          limiar: number | null
          limiar_origem: string | null
          limiar_override_em: string | null
          limiar_override_motivo: string | null
          limiar_override_por: string | null
          n_amostras: number | null
          opcoes: Json | null
          ordem: number
          orientacao: string
          pergunta: string
          peso: number
          precisa_revisao: boolean
          precisao: number | null
          recall: number | null
          rotulo: string
          rubrica_id: string
          status_calibracao: string
          tipo_resposta: string
        }
        Insert: {
          atende?: string[] | null
          ativo?: boolean
          calibracao?: Json | null
          calibrado_em?: string | null
          chave: string
          condicao_aplicabilidade?: string | null
          etapa?: string | null
          f1?: number | null
          gera_pendencia?: string | null
          id?: string
          limiar?: number | null
          limiar_origem?: string | null
          limiar_override_em?: string | null
          limiar_override_motivo?: string | null
          limiar_override_por?: string | null
          n_amostras?: number | null
          opcoes?: Json | null
          ordem: number
          orientacao: string
          pergunta: string
          peso?: number
          precisa_revisao?: boolean
          precisao?: number | null
          recall?: number | null
          rotulo: string
          rubrica_id: string
          status_calibracao?: string
          tipo_resposta: string
        }
        Update: {
          atende?: string[] | null
          ativo?: boolean
          calibracao?: Json | null
          calibrado_em?: string | null
          chave?: string
          condicao_aplicabilidade?: string | null
          etapa?: string | null
          f1?: number | null
          gera_pendencia?: string | null
          id?: string
          limiar?: number | null
          limiar_origem?: string | null
          limiar_override_em?: string | null
          limiar_override_motivo?: string | null
          limiar_override_por?: string | null
          n_amostras?: number | null
          opcoes?: Json | null
          ordem?: number
          orientacao?: string
          pergunta?: string
          peso?: number
          precisa_revisao?: boolean
          precisao?: number | null
          recall?: number | null
          rotulo?: string
          rubrica_id?: string
          status_calibracao?: string
          tipo_resposta?: string
        }
        Relationships: [
          {
            foreignKeyName: "rubrica_itens_limiar_override_por_fkey"
            columns: ["limiar_override_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rubrica_itens_rubrica_id_fkey"
            columns: ["rubrica_id"]
            isOneToOne: false
            referencedRelation: "rubricas"
            referencedColumns: ["id"]
          },
        ]
      }
      reunioes: {
        Row: {
          agente_id: string | null
          alerta_sem_bot_em: string | null
          atualizada_em: string
          bot_entrou_em: string | null
          captura_status: string
          contato_id: string | null
          criada_em: string
          dispensada_motivo: string | null
          dispensada_por: string | null
          duracao_s: number | null
          empresa_id: string | null
          evento_id: string
          fireflies_client_reference_id: string | null
          fireflies_meeting_id: string | null
          id: string
          mandato_id: string | null
          participantes_detectados: Json | null
          proximos_passos: Json
          resumo: string | null
          resumo_origem: string | null
          resumo_recebido_em: string | null
          transcricao: string | null
          transcricao_expurgada_em: string | null
          transcricao_recebida_em: string | null
          transcricao_segmentos: Json | null
          url_fireflies: string | null
          vendedor_id: string | null
        }
        Insert: {
          agente_id?: string | null
          alerta_sem_bot_em?: string | null
          atualizada_em?: string
          bot_entrou_em?: string | null
          captura_status?: string
          contato_id?: string | null
          criada_em?: string
          dispensada_motivo?: string | null
          dispensada_por?: string | null
          duracao_s?: number | null
          empresa_id?: string | null
          evento_id: string
          fireflies_client_reference_id?: string | null
          fireflies_meeting_id?: string | null
          id?: string
          mandato_id?: string | null
          participantes_detectados?: Json | null
          proximos_passos?: Json
          resumo?: string | null
          resumo_origem?: string | null
          resumo_recebido_em?: string | null
          transcricao?: string | null
          transcricao_expurgada_em?: string | null
          transcricao_recebida_em?: string | null
          transcricao_segmentos?: Json | null
          url_fireflies?: string | null
          vendedor_id?: string | null
        }
        Update: {
          agente_id?: string | null
          alerta_sem_bot_em?: string | null
          atualizada_em?: string
          bot_entrou_em?: string | null
          captura_status?: string
          contato_id?: string | null
          criada_em?: string
          dispensada_motivo?: string | null
          dispensada_por?: string | null
          duracao_s?: number | null
          empresa_id?: string | null
          evento_id?: string
          fireflies_client_reference_id?: string | null
          fireflies_meeting_id?: string | null
          id?: string
          mandato_id?: string | null
          participantes_detectados?: Json | null
          proximos_passos?: Json
          resumo?: string | null
          resumo_origem?: string | null
          resumo_recebido_em?: string | null
          transcricao?: string | null
          transcricao_expurgada_em?: string | null
          transcricao_recebida_em?: string | null
          transcricao_segmentos?: Json | null
          url_fireflies?: string | null
          vendedor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reunioes_agente_id_fkey"
            columns: ["agente_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reunioes_contato_id_fkey"
            columns: ["contato_id"]
            isOneToOne: false
            referencedRelation: "contatos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reunioes_dispensada_por_fkey"
            columns: ["dispensada_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reunioes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "reunioes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "reunioes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "reunioes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "reunioes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reunioes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "reunioes_evento_id_fkey"
            columns: ["evento_id"]
            isOneToOne: true
            referencedRelation: "vendedor_eventos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reunioes_mandato_id_fkey"
            columns: ["mandato_id"]
            isOneToOne: false
            referencedRelation: "mandatos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reunioes_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
        ]
      }
      sacado_vinculo: {
        Row: {
          atualizado_em: string
          cnpj: string
          criado_em: string
          criado_por: string | null
          empresa_id: string
          motivo: string
        }
        Insert: {
          atualizado_em?: string
          cnpj: string
          criado_em?: string
          criado_por?: string | null
          empresa_id: string
          motivo: string
        }
        Update: {
          atualizado_em?: string
          cnpj?: string
          criado_em?: string
          criado_por?: string | null
          empresa_id?: string
          motivo?: string
        }
        Relationships: [
          {
            foreignKeyName: "sacado_vinculo_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sacado_vinculo_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sacado_vinculo_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sacado_vinculo_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "sacado_vinculo_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sacado_vinculo_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sacado_vinculo_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      sacados_prospeccao: {
        Row: {
          analise_credito_id: string | null
          atualizado_em: string
          chance_concessao: number | null
          cnpj_sacado: string
          empresa_id: string | null
          entrou_em: string
          estagio: string
          estagio_alterado_em: string | null
          estagio_alterado_por: string | null
          faturamento_estimado: number | null
          id: string
          limite_potencial: number | null
          media_mensal_6m: number | null
          meses_com_emissao_6m: number | null
          motivo_saida: string | null
          observacao_saida: string | null
          originador_id: string | null
          originador_origem: string
          prazo_medio_dias: number | null
          prazo_minimo_operavel_dias: number | null
          prazo_minimo_origem: string | null
          qtd_fornecedores: number | null
          qtd_nfs_30d: number | null
          sacado_nome: string | null
          score_completude: number | null
          score_credito: number | null
          ultima_nf_em: string | null
          valor_esperado_mensal: number | null
          valor_operavel: number | null
          volume_30d: number | null
        }
        Insert: {
          analise_credito_id?: string | null
          atualizado_em?: string
          chance_concessao?: number | null
          cnpj_sacado: string
          empresa_id?: string | null
          entrou_em?: string
          estagio?: string
          estagio_alterado_em?: string | null
          estagio_alterado_por?: string | null
          faturamento_estimado?: number | null
          id?: string
          limite_potencial?: number | null
          media_mensal_6m?: number | null
          meses_com_emissao_6m?: number | null
          motivo_saida?: string | null
          observacao_saida?: string | null
          originador_id?: string | null
          originador_origem?: string
          prazo_medio_dias?: number | null
          prazo_minimo_operavel_dias?: number | null
          prazo_minimo_origem?: string | null
          qtd_fornecedores?: number | null
          qtd_nfs_30d?: number | null
          sacado_nome?: string | null
          score_completude?: number | null
          score_credito?: number | null
          ultima_nf_em?: string | null
          valor_esperado_mensal?: number | null
          valor_operavel?: number | null
          volume_30d?: number | null
        }
        Update: {
          analise_credito_id?: string | null
          atualizado_em?: string
          chance_concessao?: number | null
          cnpj_sacado?: string
          empresa_id?: string | null
          entrou_em?: string
          estagio?: string
          estagio_alterado_em?: string | null
          estagio_alterado_por?: string | null
          faturamento_estimado?: number | null
          id?: string
          limite_potencial?: number | null
          media_mensal_6m?: number | null
          meses_com_emissao_6m?: number | null
          motivo_saida?: string | null
          observacao_saida?: string | null
          originador_id?: string | null
          originador_origem?: string
          prazo_medio_dias?: number | null
          prazo_minimo_operavel_dias?: number | null
          prazo_minimo_origem?: string | null
          qtd_fornecedores?: number | null
          qtd_nfs_30d?: number | null
          sacado_nome?: string | null
          score_completude?: number | null
          score_credito?: number | null
          ultima_nf_em?: string | null
          valor_esperado_mensal?: number | null
          valor_operavel?: number | null
          volume_30d?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sacados_prospeccao_analise_credito_id_fkey"
            columns: ["analise_credito_id"]
            isOneToOne: false
            referencedRelation: "analise_vigente"
            referencedColumns: ["analise_id"]
          },
          {
            foreignKeyName: "sacados_prospeccao_analise_credito_id_fkey"
            columns: ["analise_credito_id"]
            isOneToOne: false
            referencedRelation: "analises_credito"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sacados_prospeccao_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sacados_prospeccao_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sacados_prospeccao_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "sacados_prospeccao_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sacados_prospeccao_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sacados_prospeccao_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sacados_prospeccao_estagio_alterado_por_fkey"
            columns: ["estagio_alterado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sacados_prospeccao_originador_id_fkey"
            columns: ["originador_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
        ]
      }
      sacados_prospeccao_fornecedores: {
        Row: {
          fornecedor_cnpj: string
          fornecedor_empresa_id: string | null
          fornecedor_nome: string | null
          id: string
          media_mensal_6m: number | null
          meses_com_emissao_6m: number | null
          na_carteira_do_originador: boolean
          qtd_nfs_30d: number | null
          sacado_prospeccao_id: string
          ultima_nf_em: string | null
          valor_30d: number | null
          valor_operavel: number | null
        }
        Insert: {
          fornecedor_cnpj: string
          fornecedor_empresa_id?: string | null
          fornecedor_nome?: string | null
          id?: string
          media_mensal_6m?: number | null
          meses_com_emissao_6m?: number | null
          na_carteira_do_originador?: boolean
          qtd_nfs_30d?: number | null
          sacado_prospeccao_id: string
          ultima_nf_em?: string | null
          valor_30d?: number | null
          valor_operavel?: number | null
        }
        Update: {
          fornecedor_cnpj?: string
          fornecedor_empresa_id?: string | null
          fornecedor_nome?: string | null
          id?: string
          media_mensal_6m?: number | null
          meses_com_emissao_6m?: number | null
          na_carteira_do_originador?: boolean
          qtd_nfs_30d?: number | null
          sacado_prospeccao_id?: string
          ultima_nf_em?: string | null
          valor_30d?: number | null
          valor_operavel?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sacados_prospeccao_fornecedores_fornecedor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sacados_prospeccao_fornecedores_fornecedor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sacados_prospeccao_fornecedores_fornecedor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "sacados_prospeccao_fornecedores_fornecedor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sacados_prospeccao_fornecedores_fornecedor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sacados_prospeccao_fornecedores_fornecedor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sacados_prospeccao_fornecedores_sacado_prospeccao_id_fkey"
            columns: ["sacado_prospeccao_id"]
            isOneToOne: false
            referencedRelation: "sacados_prospeccao"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sacados_prospeccao_fornecedores_sacado_prospeccao_id_fkey"
            columns: ["sacado_prospeccao_id"]
            isOneToOne: false
            referencedRelation: "sacados_prospeccao_view"
            referencedColumns: ["id"]
          },
        ]
      }
      scorecard_versoes: {
        Row: {
          ativa: boolean
          criada_em: string
          criada_por: string | null
          definicao: Json
          id: string
          nome: string | null
          versao: number
        }
        Insert: {
          ativa?: boolean
          criada_em?: string
          criada_por?: string | null
          definicao: Json
          id?: string
          nome?: string | null
          versao: number
        }
        Update: {
          ativa?: boolean
          criada_em?: string
          criada_por?: string | null
          definicao?: Json
          id?: string
          nome?: string | null
          versao?: number
        }
        Relationships: [
          {
            foreignKeyName: "scorecard_versoes_criada_por_fkey"
            columns: ["criada_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      sdr_aceites: {
        Row: {
          aceite_automatico: boolean
          criado_em: string
          decidido_em: string | null
          decidido_por: string | null
          empresa_id: string
          id: string
          lancado_em: string | null
          motivo_recusa: string | null
          prazo_em: string
          reuniao_em: string | null
          sdr_id: string
          sdr_lead_id: string
          status: string
          vendedor_destino_id: string
        }
        Insert: {
          aceite_automatico?: boolean
          criado_em?: string
          decidido_em?: string | null
          decidido_por?: string | null
          empresa_id: string
          id?: string
          lancado_em?: string | null
          motivo_recusa?: string | null
          prazo_em: string
          reuniao_em?: string | null
          sdr_id: string
          sdr_lead_id: string
          status?: string
          vendedor_destino_id: string
        }
        Update: {
          aceite_automatico?: boolean
          criado_em?: string
          decidido_em?: string | null
          decidido_por?: string | null
          empresa_id?: string
          id?: string
          lancado_em?: string | null
          motivo_recusa?: string | null
          prazo_em?: string
          reuniao_em?: string | null
          sdr_id?: string
          sdr_lead_id?: string
          status?: string
          vendedor_destino_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sdr_aceites_decidido_por_fkey"
            columns: ["decidido_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sdr_aceites_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sdr_aceites_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sdr_aceites_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "sdr_aceites_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sdr_aceites_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sdr_aceites_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sdr_aceites_sdr_id_fkey"
            columns: ["sdr_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sdr_aceites_sdr_lead_id_fkey"
            columns: ["sdr_lead_id"]
            isOneToOne: false
            referencedRelation: "sdr_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sdr_aceites_vendedor_destino_id_fkey"
            columns: ["vendedor_destino_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
        ]
      }
      sdr_lead_pitches: {
        Row: {
          abertura: string
          angulo: string
          contexto: string
          empresa_id: string
          fatos: Json
          gerado_em: string
          gerado_por: string | null
          jargoes: Json
          lead_id: string
          modelo: string | null
          persona: string | null
          pontos: Json
          tokens: number | null
        }
        Insert: {
          abertura: string
          angulo: string
          contexto: string
          empresa_id: string
          fatos?: Json
          gerado_em?: string
          gerado_por?: string | null
          jargoes?: Json
          lead_id: string
          modelo?: string | null
          persona?: string | null
          pontos?: Json
          tokens?: number | null
        }
        Update: {
          abertura?: string
          angulo?: string
          contexto?: string
          empresa_id?: string
          fatos?: Json
          gerado_em?: string
          gerado_por?: string | null
          jargoes?: Json
          lead_id?: string
          modelo?: string | null
          persona?: string | null
          pontos?: Json
          tokens?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sdr_lead_pitches_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sdr_lead_pitches_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sdr_lead_pitches_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "sdr_lead_pitches_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sdr_lead_pitches_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sdr_lead_pitches_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sdr_lead_pitches_gerado_por_fkey"
            columns: ["gerado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sdr_lead_pitches_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "sdr_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      sdr_leads: {
        Row: {
          atualizado_em: string
          distribuido_em: string
          empresa_id: string
          encerrado_em: string | null
          encerrado_motivo: string | null
          estagio: string
          fit: boolean | null
          fit_definido_em: string | null
          id: string
          origem: string
          reuniao_em: string | null
          sdr_id: string
          sem_fit_motivo: string | null
          ultimo_toque_em: string | null
          vendedor_destino_id: string | null
        }
        Insert: {
          atualizado_em?: string
          distribuido_em?: string
          empresa_id: string
          encerrado_em?: string | null
          encerrado_motivo?: string | null
          estagio?: string
          fit?: boolean | null
          fit_definido_em?: string | null
          id?: string
          origem: string
          reuniao_em?: string | null
          sdr_id: string
          sem_fit_motivo?: string | null
          ultimo_toque_em?: string | null
          vendedor_destino_id?: string | null
        }
        Update: {
          atualizado_em?: string
          distribuido_em?: string
          empresa_id?: string
          encerrado_em?: string | null
          encerrado_motivo?: string | null
          estagio?: string
          fit?: boolean | null
          fit_definido_em?: string | null
          id?: string
          origem?: string
          reuniao_em?: string | null
          sdr_id?: string
          sem_fit_motivo?: string | null
          ultimo_toque_em?: string | null
          vendedor_destino_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sdr_leads_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sdr_leads_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sdr_leads_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "sdr_leads_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sdr_leads_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sdr_leads_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sdr_leads_sdr_id_fkey"
            columns: ["sdr_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sdr_leads_sem_fit_motivo_fkey"
            columns: ["sem_fit_motivo"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["motivo_sugerido"]
          },
          {
            foreignKeyName: "sdr_leads_sem_fit_motivo_fkey"
            columns: ["sem_fit_motivo"]
            isOneToOne: false
            referencedRelation: "motivos_perda"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sdr_leads_vendedor_destino_id_fkey"
            columns: ["vendedor_destino_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
        ]
      }
      segmentos: {
        Row: {
          contagem_atualizada_em: string | null
          contagem_cache: number | null
          criado_em: string
          criado_por: string | null
          definicao: Json
          descricao: string | null
          id: string
          nome: string
        }
        Insert: {
          contagem_atualizada_em?: string | null
          contagem_cache?: number | null
          criado_em?: string
          criado_por?: string | null
          definicao: Json
          descricao?: string | null
          id?: string
          nome: string
        }
        Update: {
          contagem_atualizada_em?: string | null
          contagem_cache?: number | null
          criado_em?: string
          criado_por?: string | null
          definicao?: Json
          descricao?: string | null
          id?: string
          nome?: string
        }
        Relationships: [
          {
            foreignKeyName: "segmentos_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      sienge_titulos: {
        Row: {
          anticipation_id_externo: number | null
          anticipation_net: number | null
          anticipation_status: string | null
          bill_access_key: string | null
          bill_document_number: string | null
          bill_document_type: string | null
          bill_id: number
          bill_issue_date: string | null
          bill_origin: string | null
          bill_retencao_total: number | null
          bill_status: string | null
          bill_total: number | null
          connection_id: number | null
          connection_subdomain: string | null
          credit_status: string | null
          credor_cadastrado: boolean | null
          credor_cnpj: string | null
          credor_empresa_id: string | null
          credor_erp_id: number | null
          credor_nome: string | null
          credor_pessoa_fisica: boolean
          dias_para_vencimento: number | null
          enviado_banco: boolean | null
          erp_pago_em: string | null
          erp_removido_em: string | null
          erp_situacao: string | null
          estagio_alterado_em: string | null
          estagio_funil: string
          exception_code: string | null
          faixa: string | null
          faixa_alterada_em: string | null
          faixa_motivo: string | null
          faixa_regra_versao: number | null
          guard_reason: string | null
          hidratado_em: string | null
          id_externo: number
          installment_id: number | null
          installment_number: number | null
          limite_disponivel_sacado: number | null
          limite_sacado_origem: string | null
          nfe_candidate_access_key: string | null
          nfe_candidate_count: number | null
          numero_normalizado: string | null
          origem_exibida: boolean
          original_id: string | null
          original_tipo: string | null
          perda_motivo: string | null
          pre_autorizacao_id_externo: number | null
          primeira_vez_visto: string | null
          raw: Json | null
          receita_esperada: number | null
          retencao: number | null
          sacado_cnpj: string
          sacado_empresa_id: string | null
          sacado_matriz_cnpj: string
          sacado_nome: string | null
          seguro_estimado: number | null
          sincronizado_em: string
          situation: string
          situation_anterior: string | null
          tac_estimada: number | null
          taxa_analise_am: number | null
          taxa_analise_origem: string | null
          taxa_usada: number | null
          tipo_pagamento: string | null
          valor: number
          vencimento: string | null
          vendedor_definido_em: string | null
          vendedor_id: string | null
          vendedor_origem: string | null
          write_back_repointed_em: string | null
          write_back_status: string | null
        }
        Insert: {
          anticipation_id_externo?: number | null
          anticipation_net?: number | null
          anticipation_status?: string | null
          bill_access_key?: string | null
          bill_document_number?: string | null
          bill_document_type?: string | null
          bill_id: number
          bill_issue_date?: string | null
          bill_origin?: string | null
          bill_retencao_total?: number | null
          bill_status?: string | null
          bill_total?: number | null
          connection_id?: number | null
          connection_subdomain?: string | null
          credit_status?: string | null
          credor_cadastrado?: boolean | null
          credor_cnpj?: string | null
          credor_empresa_id?: string | null
          credor_erp_id?: number | null
          credor_nome?: string | null
          credor_pessoa_fisica?: boolean
          dias_para_vencimento?: number | null
          enviado_banco?: boolean | null
          erp_pago_em?: string | null
          erp_removido_em?: string | null
          erp_situacao?: string | null
          estagio_alterado_em?: string | null
          estagio_funil?: string
          exception_code?: string | null
          faixa?: string | null
          faixa_alterada_em?: string | null
          faixa_motivo?: string | null
          faixa_regra_versao?: number | null
          guard_reason?: string | null
          hidratado_em?: string | null
          id_externo: number
          installment_id?: number | null
          installment_number?: number | null
          limite_disponivel_sacado?: number | null
          limite_sacado_origem?: string | null
          nfe_candidate_access_key?: string | null
          nfe_candidate_count?: number | null
          numero_normalizado?: string | null
          origem_exibida?: boolean
          original_id?: string | null
          original_tipo?: string | null
          perda_motivo?: string | null
          pre_autorizacao_id_externo?: number | null
          primeira_vez_visto?: string | null
          raw?: Json | null
          receita_esperada?: number | null
          retencao?: number | null
          sacado_cnpj: string
          sacado_empresa_id?: string | null
          sacado_matriz_cnpj: string
          sacado_nome?: string | null
          seguro_estimado?: number | null
          sincronizado_em?: string
          situation: string
          situation_anterior?: string | null
          tac_estimada?: number | null
          taxa_analise_am?: number | null
          taxa_analise_origem?: string | null
          taxa_usada?: number | null
          tipo_pagamento?: string | null
          valor: number
          vencimento?: string | null
          vendedor_definido_em?: string | null
          vendedor_id?: string | null
          vendedor_origem?: string | null
          write_back_repointed_em?: string | null
          write_back_status?: string | null
        }
        Update: {
          anticipation_id_externo?: number | null
          anticipation_net?: number | null
          anticipation_status?: string | null
          bill_access_key?: string | null
          bill_document_number?: string | null
          bill_document_type?: string | null
          bill_id?: number
          bill_issue_date?: string | null
          bill_origin?: string | null
          bill_retencao_total?: number | null
          bill_status?: string | null
          bill_total?: number | null
          connection_id?: number | null
          connection_subdomain?: string | null
          credit_status?: string | null
          credor_cadastrado?: boolean | null
          credor_cnpj?: string | null
          credor_empresa_id?: string | null
          credor_erp_id?: number | null
          credor_nome?: string | null
          credor_pessoa_fisica?: boolean
          dias_para_vencimento?: number | null
          enviado_banco?: boolean | null
          erp_pago_em?: string | null
          erp_removido_em?: string | null
          erp_situacao?: string | null
          estagio_alterado_em?: string | null
          estagio_funil?: string
          exception_code?: string | null
          faixa?: string | null
          faixa_alterada_em?: string | null
          faixa_motivo?: string | null
          faixa_regra_versao?: number | null
          guard_reason?: string | null
          hidratado_em?: string | null
          id_externo?: number
          installment_id?: number | null
          installment_number?: number | null
          limite_disponivel_sacado?: number | null
          limite_sacado_origem?: string | null
          nfe_candidate_access_key?: string | null
          nfe_candidate_count?: number | null
          numero_normalizado?: string | null
          origem_exibida?: boolean
          original_id?: string | null
          original_tipo?: string | null
          perda_motivo?: string | null
          pre_autorizacao_id_externo?: number | null
          primeira_vez_visto?: string | null
          raw?: Json | null
          receita_esperada?: number | null
          retencao?: number | null
          sacado_cnpj?: string
          sacado_empresa_id?: string | null
          sacado_matriz_cnpj?: string
          sacado_nome?: string | null
          seguro_estimado?: number | null
          sincronizado_em?: string
          situation?: string
          situation_anterior?: string | null
          tac_estimada?: number | null
          taxa_analise_am?: number | null
          taxa_analise_origem?: string | null
          taxa_usada?: number | null
          tipo_pagamento?: string | null
          valor?: number
          vencimento?: string | null
          vendedor_definido_em?: string | null
          vendedor_id?: string | null
          vendedor_origem?: string | null
          write_back_repointed_em?: string | null
          write_back_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sienge_titulos_credor_empresa_id_fkey"
            columns: ["credor_empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sienge_titulos_credor_empresa_id_fkey"
            columns: ["credor_empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sienge_titulos_credor_empresa_id_fkey"
            columns: ["credor_empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "sienge_titulos_credor_empresa_id_fkey"
            columns: ["credor_empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sienge_titulos_credor_empresa_id_fkey"
            columns: ["credor_empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sienge_titulos_credor_empresa_id_fkey"
            columns: ["credor_empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sienge_titulos_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sienge_titulos_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sienge_titulos_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "sienge_titulos_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sienge_titulos_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sienge_titulos_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sienge_titulos_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
        ]
      }
      sinistro_custos: {
        Row: {
          aprovacao_referencia: string | null
          aprovado_pela_seguradora: boolean
          cobranca_id: string | null
          comprovante_path: string | null
          criado_em: string
          criado_por: string | null
          data: string
          descricao: string
          id: string
          sinistro_id: string | null
          valor: number
        }
        Insert: {
          aprovacao_referencia?: string | null
          aprovado_pela_seguradora?: boolean
          cobranca_id?: string | null
          comprovante_path?: string | null
          criado_em?: string
          criado_por?: string | null
          data: string
          descricao: string
          id?: string
          sinistro_id?: string | null
          valor: number
        }
        Update: {
          aprovacao_referencia?: string | null
          aprovado_pela_seguradora?: boolean
          cobranca_id?: string | null
          comprovante_path?: string | null
          criado_em?: string
          criado_por?: string | null
          data?: string
          descricao?: string
          id?: string
          sinistro_id?: string | null
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "sinistro_custos_cobranca_id_fkey"
            columns: ["cobranca_id"]
            isOneToOne: false
            referencedRelation: "cobranca_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sinistro_custos_cobranca_id_fkey"
            columns: ["cobranca_id"]
            isOneToOne: false
            referencedRelation: "cobrancas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sinistro_custos_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sinistro_custos_sinistro_id_fkey"
            columns: ["sinistro_id"]
            isOneToOne: false
            referencedRelation: "sinistros"
            referencedColumns: ["id"]
          },
        ]
      }
      sinistro_documentos: {
        Row: {
          anexado_em: string | null
          anexado_por: string | null
          arquivo_hash: string | null
          arquivo_path: string | null
          descricao: string
          id: string
          item: string
          justificativa_ausencia: string | null
          obrigatorio: boolean
          origem: string
          sinistro_id: string
          status: string
        }
        Insert: {
          anexado_em?: string | null
          anexado_por?: string | null
          arquivo_hash?: string | null
          arquivo_path?: string | null
          descricao: string
          id?: string
          item: string
          justificativa_ausencia?: string | null
          obrigatorio?: boolean
          origem?: string
          sinistro_id: string
          status?: string
        }
        Update: {
          anexado_em?: string | null
          anexado_por?: string | null
          arquivo_hash?: string | null
          arquivo_path?: string | null
          descricao?: string
          id?: string
          item?: string
          justificativa_ausencia?: string | null
          obrigatorio?: boolean
          origem?: string
          sinistro_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "sinistro_documentos_anexado_por_fkey"
            columns: ["anexado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sinistro_documentos_sinistro_id_fkey"
            columns: ["sinistro_id"]
            isOneToOne: false
            referencedRelation: "sinistros"
            referencedColumns: ["id"]
          },
        ]
      }
      sinistro_solicitacoes: {
        Row: {
          descricao: string
          id: string
          prazo_em: string
          respondida_em: string | null
          sinistro_id: string
          solicitada_em: string
          status: string
        }
        Insert: {
          descricao: string
          id?: string
          prazo_em: string
          respondida_em?: string | null
          sinistro_id: string
          solicitada_em: string
          status?: string
        }
        Update: {
          descricao?: string
          id?: string
          prazo_em?: string
          respondida_em?: string | null
          sinistro_id?: string
          solicitada_em?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "sinistro_solicitacoes_sinistro_id_fkey"
            columns: ["sinistro_id"]
            isOneToOne: false
            referencedRelation: "sinistros"
            referencedColumns: ["id"]
          },
        ]
      }
      sinistro_titulos: {
        Row: {
          sinistro_id: string
          titulo_id: string
          valor_cedido: number | null
          valor_face: number
        }
        Insert: {
          sinistro_id: string
          titulo_id: string
          valor_cedido?: number | null
          valor_face: number
        }
        Update: {
          sinistro_id?: string
          titulo_id?: string
          valor_cedido?: number | null
          valor_face?: number
        }
        Relationships: [
          {
            foreignKeyName: "sinistro_titulos_sinistro_id_fkey"
            columns: ["sinistro_id"]
            isOneToOne: false
            referencedRelation: "sinistros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sinistro_titulos_titulo_id_fkey"
            columns: ["titulo_id"]
            isOneToOne: false
            referencedRelation: "cobranca_titulos_abertos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sinistro_titulos_titulo_id_fkey"
            columns: ["titulo_id"]
            isOneToOne: false
            referencedRelation: "titulos"
            referencedColumns: ["id"]
          },
        ]
      }
      sinistros: {
        Row: {
          apolice_id: string
          causa: string
          cobranca_id: string | null
          codigo: string | null
          criado_em: string
          criado_por: string | null
          data_limite_envio: string | null
          data_perda: string
          dossie_gerado_em: string | null
          dossie_hash: string | null
          dossie_path: string | null
          enviado_em: string | null
          estagio: string
          id: string
          indenizacao_estimada: number | null
          indenizacao_recebida: number | null
          justificativa_prova_entrega: string | null
          memoria_perda: Json | null
          modo_envio: string
          motivo_recusa: string | null
          notificado_em: string | null
          perda_segurada_estimada: number | null
          protocolo_externo: string | null
          respondido_em: string | null
          responsavel_id: string | null
          resposta_prevista_em: string | null
          sacado_empresa_id: string | null
          sacado_matriz_cnpj: string
          valor_recebido_parcial: number
          valor_total_face: number
        }
        Insert: {
          apolice_id: string
          causa: string
          cobranca_id?: string | null
          codigo?: string | null
          criado_em?: string
          criado_por?: string | null
          data_limite_envio?: string | null
          data_perda: string
          dossie_gerado_em?: string | null
          dossie_hash?: string | null
          dossie_path?: string | null
          enviado_em?: string | null
          estagio?: string
          id?: string
          indenizacao_estimada?: number | null
          indenizacao_recebida?: number | null
          justificativa_prova_entrega?: string | null
          memoria_perda?: Json | null
          modo_envio?: string
          motivo_recusa?: string | null
          notificado_em?: string | null
          perda_segurada_estimada?: number | null
          protocolo_externo?: string | null
          respondido_em?: string | null
          responsavel_id?: string | null
          resposta_prevista_em?: string | null
          sacado_empresa_id?: string | null
          sacado_matriz_cnpj: string
          valor_recebido_parcial?: number
          valor_total_face: number
        }
        Update: {
          apolice_id?: string
          causa?: string
          cobranca_id?: string | null
          codigo?: string | null
          criado_em?: string
          criado_por?: string | null
          data_limite_envio?: string | null
          data_perda?: string
          dossie_gerado_em?: string | null
          dossie_hash?: string | null
          dossie_path?: string | null
          enviado_em?: string | null
          estagio?: string
          id?: string
          indenizacao_estimada?: number | null
          indenizacao_recebida?: number | null
          justificativa_prova_entrega?: string | null
          memoria_perda?: Json | null
          modo_envio?: string
          motivo_recusa?: string | null
          notificado_em?: string | null
          perda_segurada_estimada?: number | null
          protocolo_externo?: string | null
          respondido_em?: string | null
          responsavel_id?: string | null
          resposta_prevista_em?: string | null
          sacado_empresa_id?: string | null
          sacado_matriz_cnpj?: string
          valor_recebido_parcial?: number
          valor_total_face?: number
        }
        Relationships: [
          {
            foreignKeyName: "sinistros_apolice_id_fkey"
            columns: ["apolice_id"]
            isOneToOne: false
            referencedRelation: "apolices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sinistros_cobranca_id_fkey"
            columns: ["cobranca_id"]
            isOneToOne: false
            referencedRelation: "cobranca_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sinistros_cobranca_id_fkey"
            columns: ["cobranca_id"]
            isOneToOne: false
            referencedRelation: "cobrancas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sinistros_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sinistros_responsavel_id_fkey"
            columns: ["responsavel_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sinistros_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sinistros_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sinistros_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "sinistros_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sinistros_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sinistros_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      supressao: {
        Row: {
          contexto: string
          criado_em: string
          criado_por: string | null
          escopo: string
          expira_em: string | null
          id: string
          motivo: string
          observacao: string | null
          valor: string
        }
        Insert: {
          contexto?: string
          criado_em?: string
          criado_por?: string | null
          escopo: string
          expira_em?: string | null
          id?: string
          motivo: string
          observacao?: string | null
          valor: string
        }
        Update: {
          contexto?: string
          criado_em?: string
          criado_por?: string | null
          escopo?: string
          expira_em?: string | null
          id?: string
          motivo?: string
          observacao?: string | null
          valor?: string
        }
        Relationships: [
          {
            foreignKeyName: "supressao_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      templates_mensagem: {
        Row: {
          assunto: string | null
          ativo: boolean
          atualizado_em: string
          canal: string
          corpo: string
          criado_em: string
          criado_por: string | null
          funil: string | null
          id: string
          nome: string
          objetivo: string | null
          variaveis: string[]
        }
        Insert: {
          assunto?: string | null
          ativo?: boolean
          atualizado_em?: string
          canal: string
          corpo: string
          criado_em?: string
          criado_por?: string | null
          funil?: string | null
          id?: string
          nome: string
          objetivo?: string | null
          variaveis?: string[]
        }
        Update: {
          assunto?: string | null
          ativo?: boolean
          atualizado_em?: string
          canal?: string
          corpo?: string
          criado_em?: string
          criado_por?: string | null
          funil?: string | null
          id?: string
          nome?: string
          objetivo?: string | null
          variaveis?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "templates_mensagem_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      titulos: {
        Row: {
          antecipacao_id_externo: number | null
          atualizado_producao_em: string | null
          cedente_cnpj: string
          cedente_empresa_id: string | null
          cedente_matriz_cnpj: string
          cedente_nome: string | null
          coberto_apolice: boolean
          desembolsado_em: string | null
          devedor_terceiro: boolean
          emissao: string | null
          externo_id: string
          id: string
          limite_atualizado_em: string | null
          limite_credito_vigente: number | null
          limite_documento: string | null
          limite_expira_em: string | null
          liquidacao_fonte: string | null
          liquidacao_pagamentos: Json
          migrado: boolean
          nf_chave_acesso: string | null
          numero: string | null
          operacao_externo_id: string | null
          pago_em: string | null
          pago_em_origem: string | null
          retencao: number | null
          sacado_cnpj: string
          sacado_empresa_id: string | null
          sacado_matriz_cnpj: string
          sacado_nome: string | null
          sincronizado_em: string
          status: string
          status_producao: string | null
          valor_cedido: number | null
          valor_face: number
          valor_nota: number | null
          valor_pago: number | null
          vencimento: string
          vencimento_prorrogado: string | null
        }
        Insert: {
          antecipacao_id_externo?: number | null
          atualizado_producao_em?: string | null
          cedente_cnpj: string
          cedente_empresa_id?: string | null
          cedente_matriz_cnpj: string
          cedente_nome?: string | null
          coberto_apolice?: boolean
          desembolsado_em?: string | null
          devedor_terceiro?: boolean
          emissao?: string | null
          externo_id: string
          id?: string
          limite_atualizado_em?: string | null
          limite_credito_vigente?: number | null
          limite_documento?: string | null
          limite_expira_em?: string | null
          liquidacao_fonte?: string | null
          liquidacao_pagamentos?: Json
          migrado?: boolean
          nf_chave_acesso?: string | null
          numero?: string | null
          operacao_externo_id?: string | null
          pago_em?: string | null
          pago_em_origem?: string | null
          retencao?: number | null
          sacado_cnpj: string
          sacado_empresa_id?: string | null
          sacado_matriz_cnpj: string
          sacado_nome?: string | null
          sincronizado_em?: string
          status: string
          status_producao?: string | null
          valor_cedido?: number | null
          valor_face: number
          valor_nota?: number | null
          valor_pago?: number | null
          vencimento: string
          vencimento_prorrogado?: string | null
        }
        Update: {
          antecipacao_id_externo?: number | null
          atualizado_producao_em?: string | null
          cedente_cnpj?: string
          cedente_empresa_id?: string | null
          cedente_matriz_cnpj?: string
          cedente_nome?: string | null
          coberto_apolice?: boolean
          desembolsado_em?: string | null
          devedor_terceiro?: boolean
          emissao?: string | null
          externo_id?: string
          id?: string
          limite_atualizado_em?: string | null
          limite_credito_vigente?: number | null
          limite_documento?: string | null
          limite_expira_em?: string | null
          liquidacao_fonte?: string | null
          liquidacao_pagamentos?: Json
          migrado?: boolean
          nf_chave_acesso?: string | null
          numero?: string | null
          operacao_externo_id?: string | null
          pago_em?: string | null
          pago_em_origem?: string | null
          retencao?: number | null
          sacado_cnpj?: string
          sacado_empresa_id?: string | null
          sacado_matriz_cnpj?: string
          sacado_nome?: string | null
          sincronizado_em?: string
          status?: string
          status_producao?: string | null
          valor_cedido?: number | null
          valor_face?: number
          valor_nota?: number | null
          valor_pago?: number | null
          vencimento?: string
          vencimento_prorrogado?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "titulos_cedente_empresa_id_fkey"
            columns: ["cedente_empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "titulos_cedente_empresa_id_fkey"
            columns: ["cedente_empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "titulos_cedente_empresa_id_fkey"
            columns: ["cedente_empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "titulos_cedente_empresa_id_fkey"
            columns: ["cedente_empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "titulos_cedente_empresa_id_fkey"
            columns: ["cedente_empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "titulos_cedente_empresa_id_fkey"
            columns: ["cedente_empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "titulos_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "titulos_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "titulos_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "titulos_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "titulos_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "titulos_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      usuarios: {
        Row: {
          ativo: boolean
          atalhos_fixados: string[]
          criado_em: string
          email: string
          expo_push_tokens: Json
          id: string
          must_change_password: boolean
          nome: string
          perfil_id: string | null
          prefs_notificacoes: Json
          web_push_subscriptions: Json
        }
        Insert: {
          ativo?: boolean
          atalhos_fixados?: string[]
          criado_em?: string
          email: string
          expo_push_tokens?: Json
          id: string
          must_change_password?: boolean
          nome: string
          perfil_id?: string | null
          prefs_notificacoes?: Json
          web_push_subscriptions?: Json
        }
        Update: {
          ativo?: boolean
          atalhos_fixados?: string[]
          criado_em?: string
          email?: string
          expo_push_tokens?: Json
          id?: string
          must_change_password?: boolean
          nome?: string
          perfil_id?: string | null
          prefs_notificacoes?: Json
          web_push_subscriptions?: Json
        }
        Relationships: [
          {
            foreignKeyName: "usuarios_perfil_id_fkey"
            columns: ["perfil_id"]
            isOneToOne: false
            referencedRelation: "perfis"
            referencedColumns: ["id"]
          },
        ]
      }
      vendas: {
        Row: {
          analise_credito_id: string | null
          atualizada_em: string
          criada_em: string
          empresa_id: string
          estagio: string
          ganho_em: string | null
          id: string
          perdido_em: string | null
          perdido_motivo: string | null
          primeira_operacao_em: string | null
          primeira_operacao_id: number | null
          sdr_lead_id: string | null
          situacao: string
          vendedor_id: string
        }
        Insert: {
          analise_credito_id?: string | null
          atualizada_em?: string
          criada_em?: string
          empresa_id: string
          estagio?: string
          ganho_em?: string | null
          id?: string
          perdido_em?: string | null
          perdido_motivo?: string | null
          primeira_operacao_em?: string | null
          primeira_operacao_id?: number | null
          sdr_lead_id?: string | null
          situacao?: string
          vendedor_id: string
        }
        Update: {
          analise_credito_id?: string | null
          atualizada_em?: string
          criada_em?: string
          empresa_id?: string
          estagio?: string
          ganho_em?: string | null
          id?: string
          perdido_em?: string | null
          perdido_motivo?: string | null
          primeira_operacao_em?: string | null
          primeira_operacao_id?: number | null
          sdr_lead_id?: string | null
          situacao?: string
          vendedor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendas_analise_credito_id_fkey"
            columns: ["analise_credito_id"]
            isOneToOne: false
            referencedRelation: "analise_vigente"
            referencedColumns: ["analise_id"]
          },
          {
            foreignKeyName: "vendas_analise_credito_id_fkey"
            columns: ["analise_credito_id"]
            isOneToOne: false
            referencedRelation: "analises_credito"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "vendas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "vendas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "vendas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "vendas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "vendas_perdido_motivo_fkey"
            columns: ["perdido_motivo"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["motivo_sugerido"]
          },
          {
            foreignKeyName: "vendas_perdido_motivo_fkey"
            columns: ["perdido_motivo"]
            isOneToOne: false
            referencedRelation: "motivos_perda"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendas_sdr_lead_id_fkey"
            columns: ["sdr_lead_id"]
            isOneToOne: false
            referencedRelation: "sdr_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendas_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
        ]
      }
      vendedor_acessos: {
        Row: {
          pode_ver_vendedor_id: string
          vendedor_id: string
        }
        Insert: {
          pode_ver_vendedor_id: string
          vendedor_id: string
        }
        Update: {
          pode_ver_vendedor_id?: string
          vendedor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendedor_acessos_pode_ver_vendedor_id_fkey"
            columns: ["pode_ver_vendedor_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendedor_acessos_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
        ]
      }
      vendedor_carteira: {
        Row: {
          ate: string | null
          comissiona_como_cedente: boolean
          desde: string
          empresa_id: string
          id: string
          origem: string
          papel: string
          share_pct: number
          vendedor_id: string
        }
        Insert: {
          ate?: string | null
          comissiona_como_cedente?: boolean
          desde?: string
          empresa_id: string
          id?: string
          origem?: string
          papel: string
          share_pct?: number
          vendedor_id: string
        }
        Update: {
          ate?: string | null
          comissiona_como_cedente?: boolean
          desde?: string
          empresa_id?: string
          id?: string
          origem?: string
          papel?: string
          share_pct?: number
          vendedor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendedor_carteira_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "vendedor_carteira_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "vendedor_carteira_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "vendedor_carteira_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "vendedor_carteira_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendedor_carteira_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "vendedor_carteira_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
        ]
      }
      vendedor_eventos: {
        Row: {
          acompanhantes: string[]
          atualizado_em: string
          cancelado_em: string | null
          criado_em: string
          criado_por: string | null
          descricao: string | null
          duracao_min: number
          empresa_id: string | null
          google_calendar_id: string | null
          google_conta_usuario_id: string | null
          google_erro: string | null
          google_evento_id: string | null
          google_pendente_em: string | null
          google_sincronizado_em: string | null
          id: string
          inicio_em: string
          local: string | null
          meet_url: string | null
          modalidade: string
          participantes: Json
          sdr_lead_id: string | null
          tipo: string
          titulo: string
          venda_id: string | null
          vendedor_id: string
        }
        Insert: {
          acompanhantes?: string[]
          atualizado_em?: string
          cancelado_em?: string | null
          criado_em?: string
          criado_por?: string | null
          descricao?: string | null
          duracao_min?: number
          empresa_id?: string | null
          google_calendar_id?: string | null
          google_conta_usuario_id?: string | null
          google_erro?: string | null
          google_evento_id?: string | null
          google_pendente_em?: string | null
          google_sincronizado_em?: string | null
          id?: string
          inicio_em: string
          local?: string | null
          meet_url?: string | null
          modalidade?: string
          participantes?: Json
          sdr_lead_id?: string | null
          tipo?: string
          titulo: string
          venda_id?: string | null
          vendedor_id: string
        }
        Update: {
          acompanhantes?: string[]
          atualizado_em?: string
          cancelado_em?: string | null
          criado_em?: string
          criado_por?: string | null
          descricao?: string | null
          duracao_min?: number
          empresa_id?: string | null
          google_calendar_id?: string | null
          google_conta_usuario_id?: string | null
          google_erro?: string | null
          google_evento_id?: string | null
          google_pendente_em?: string | null
          google_sincronizado_em?: string | null
          id?: string
          inicio_em?: string
          local?: string | null
          meet_url?: string | null
          modalidade?: string
          participantes?: Json
          sdr_lead_id?: string | null
          tipo?: string
          titulo?: string
          venda_id?: string | null
          vendedor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendedor_eventos_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendedor_eventos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "vendedor_eventos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "vendedor_eventos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "vendedor_eventos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "vendedor_eventos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendedor_eventos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "vendedor_eventos_google_conta_usuario_id_fkey"
            columns: ["google_conta_usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendedor_eventos_sdr_lead_id_fkey"
            columns: ["sdr_lead_id"]
            isOneToOne: false
            referencedRelation: "sdr_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendedor_eventos_venda_id_fkey"
            columns: ["venda_id"]
            isOneToOne: false
            referencedRelation: "vendas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendedor_eventos_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
        ]
      }
      vendedor_ics_tokens: {
        Row: {
          criado_em: string
          revogado_em: string | null
          token: string
          vendedor_id: string
        }
        Insert: {
          criado_em?: string
          revogado_em?: string | null
          token: string
          vendedor_id: string
        }
        Update: {
          criado_em?: string
          revogado_em?: string | null
          token?: string
          vendedor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendedor_ics_tokens_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
        ]
      }
      vendedor_territorios: {
        Row: {
          faturamento_max: number | null
          faturamento_min: number | null
          ufs: string[]
          vendedor_id: string
        }
        Insert: {
          faturamento_max?: number | null
          faturamento_min?: number | null
          ufs?: string[]
          vendedor_id: string
        }
        Update: {
          faturamento_max?: number | null
          faturamento_min?: number | null
          ufs?: string[]
          vendedor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendedor_territorios_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: true
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
        ]
      }
      vendedores: {
        Row: {
          ativo: boolean
          ausente_ate: string | null
          autonomo: boolean
          closer_id: string | null
          closer_substituto_id: string | null
          criado_em: string
          email_caixa_id: string | null
          email_remetente: string | null
          escopo: Json | null
          id: string
          is_ia: boolean
          limites: Json | null
          modo_rodagem: string
          nome: string
          pausado_em: string | null
          pausado_motivo: string | null
          persona: Json | null
          settings: Json
          superior_id: string | null
          tipo: string
          usuario_id: string | null
          voz_conta_id: string | null
          whatsapp_conta_id: string | null
        }
        Insert: {
          ativo?: boolean
          ausente_ate?: string | null
          autonomo?: boolean
          closer_id?: string | null
          closer_substituto_id?: string | null
          criado_em?: string
          email_caixa_id?: string | null
          email_remetente?: string | null
          escopo?: Json | null
          id?: string
          is_ia?: boolean
          limites?: Json | null
          modo_rodagem?: string
          nome: string
          pausado_em?: string | null
          pausado_motivo?: string | null
          persona?: Json | null
          settings?: Json
          superior_id?: string | null
          tipo: string
          usuario_id?: string | null
          voz_conta_id?: string | null
          whatsapp_conta_id?: string | null
        }
        Update: {
          ativo?: boolean
          ausente_ate?: string | null
          autonomo?: boolean
          closer_id?: string | null
          closer_substituto_id?: string | null
          criado_em?: string
          email_caixa_id?: string | null
          email_remetente?: string | null
          escopo?: Json | null
          id?: string
          is_ia?: boolean
          limites?: Json | null
          modo_rodagem?: string
          nome?: string
          pausado_em?: string | null
          pausado_motivo?: string | null
          persona?: Json | null
          settings?: Json
          superior_id?: string | null
          tipo?: string
          usuario_id?: string | null
          voz_conta_id?: string | null
          whatsapp_conta_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vendedores_closer_id_fkey"
            columns: ["closer_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendedores_closer_substituto_id_fkey"
            columns: ["closer_substituto_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendedores_email_caixa_id_fkey"
            columns: ["email_caixa_id"]
            isOneToOne: false
            referencedRelation: "email_caixas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendedores_superior_id_fkey"
            columns: ["superior_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendedores_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendedores_whatsapp_conta_id_fkey"
            columns: ["whatsapp_conta_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_contas"
            referencedColumns: ["id"]
          },
        ]
      }
      vinculacao_tentativas: {
        Row: {
          aplicada: boolean
          auditada_em: string | null
          auditada_por: string | null
          auditoria_correta: boolean | null
          candidatas: Json
          criada_em: string
          custo_centavos: number
          empresa_id: string | null
          etapa: string
          id: string
          motivo: string | null
          nao_resolvivel: boolean
          nao_vinculada_id: string
          probabilidade: number | null
        }
        Insert: {
          aplicada?: boolean
          auditada_em?: string | null
          auditada_por?: string | null
          auditoria_correta?: boolean | null
          candidatas?: Json
          criada_em?: string
          custo_centavos?: number
          empresa_id?: string | null
          etapa: string
          id?: string
          motivo?: string | null
          nao_resolvivel?: boolean
          nao_vinculada_id: string
          probabilidade?: number | null
        }
        Update: {
          aplicada?: boolean
          auditada_em?: string | null
          auditada_por?: string | null
          auditoria_correta?: boolean | null
          candidatas?: Json
          criada_em?: string
          custo_centavos?: number
          empresa_id?: string | null
          etapa?: string
          id?: string
          motivo?: string | null
          nao_resolvivel?: boolean
          nao_vinculada_id?: string
          probabilidade?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vinculacao_tentativas_auditada_por_fkey"
            columns: ["auditada_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vinculacao_tentativas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "vinculacao_tentativas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "vinculacao_tentativas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "vinculacao_tentativas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "vinculacao_tentativas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vinculacao_tentativas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "vinculacao_tentativas_nao_vinculada_id_fkey"
            columns: ["nao_vinculada_id"]
            isOneToOne: false
            referencedRelation: "conversas_nao_vinculadas"
            referencedColumns: ["id"]
          },
        ]
      }
      voz_ligacoes: {
        Row: {
          access_key: string | null
          agendada_para: string | null
          atualizada_em: string
          cancelada_em: string | null
          cancelada_por: string | null
          chamada_id: string | null
          comunicacao_id: string | null
          contato_id: string | null
          criada_em: string
          custo_centavos: number | null
          duracao_s: number | null
          empresa_id: string | null
          encerrada_em: string | null
          enfileirada_por: string | null
          enviada_em: string | null
          erro: string | null
          fornecedor_cnpj: string | null
          id: string
          id_externo: string
          iniciada_em: string | null
          ligacao_id: string | null
          links: Json | null
          mandato_id: string | null
          motivo_recusa: string | null
          objetivo: string
          origem: string
          outcome: string | null
          pedido: Json | null
          resultado: Json | null
          resumo: string | null
          status: string
          telefone: string | null
          tentativa: number
          tentativas: number
          transcricao: Json | null
          ultima_tentativa_em: string | null
          versao_api: string | null
        }
        Insert: {
          access_key?: string | null
          agendada_para?: string | null
          atualizada_em?: string
          cancelada_em?: string | null
          cancelada_por?: string | null
          chamada_id?: string | null
          comunicacao_id?: string | null
          contato_id?: string | null
          criada_em?: string
          custo_centavos?: number | null
          duracao_s?: number | null
          empresa_id?: string | null
          encerrada_em?: string | null
          enfileirada_por?: string | null
          enviada_em?: string | null
          erro?: string | null
          fornecedor_cnpj?: string | null
          id?: string
          id_externo: string
          iniciada_em?: string | null
          ligacao_id?: string | null
          links?: Json | null
          mandato_id?: string | null
          motivo_recusa?: string | null
          objetivo?: string
          origem?: string
          outcome?: string | null
          pedido?: Json | null
          resultado?: Json | null
          resumo?: string | null
          status?: string
          telefone?: string | null
          tentativa?: number
          tentativas?: number
          transcricao?: Json | null
          ultima_tentativa_em?: string | null
          versao_api?: string | null
        }
        Update: {
          access_key?: string | null
          agendada_para?: string | null
          atualizada_em?: string
          cancelada_em?: string | null
          cancelada_por?: string | null
          chamada_id?: string | null
          comunicacao_id?: string | null
          contato_id?: string | null
          criada_em?: string
          custo_centavos?: number | null
          duracao_s?: number | null
          empresa_id?: string | null
          encerrada_em?: string | null
          enfileirada_por?: string | null
          enviada_em?: string | null
          erro?: string | null
          fornecedor_cnpj?: string | null
          id?: string
          id_externo?: string
          iniciada_em?: string | null
          ligacao_id?: string | null
          links?: Json | null
          mandato_id?: string | null
          motivo_recusa?: string | null
          objetivo?: string
          origem?: string
          outcome?: string | null
          pedido?: Json | null
          resultado?: Json | null
          resumo?: string | null
          status?: string
          telefone?: string | null
          tentativa?: number
          tentativas?: number
          transcricao?: Json | null
          ultima_tentativa_em?: string | null
          versao_api?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "voz_ligacoes_access_key_fkey"
            columns: ["access_key"]
            isOneToOne: false
            referencedRelation: "funil_oportunidades_nf"
            referencedColumns: ["access_key"]
          },
          {
            foreignKeyName: "voz_ligacoes_access_key_fkey"
            columns: ["access_key"]
            isOneToOne: false
            referencedRelation: "funil_oportunidades_nf"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voz_ligacoes_access_key_fkey"
            columns: ["access_key"]
            isOneToOne: false
            referencedRelation: "notas_fiscais"
            referencedColumns: ["access_key"]
          },
          {
            foreignKeyName: "voz_ligacoes_access_key_fkey"
            columns: ["access_key"]
            isOneToOne: false
            referencedRelation: "notas_funil"
            referencedColumns: ["access_key"]
          },
          {
            foreignKeyName: "voz_ligacoes_cancelada_por_fkey"
            columns: ["cancelada_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voz_ligacoes_comunicacao_id_fkey"
            columns: ["comunicacao_id"]
            isOneToOne: false
            referencedRelation: "comunicacoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voz_ligacoes_comunicacao_id_fkey"
            columns: ["comunicacao_id"]
            isOneToOne: false
            referencedRelation: "comunicacoes_thread"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voz_ligacoes_contato_id_fkey"
            columns: ["contato_id"]
            isOneToOne: false
            referencedRelation: "contatos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voz_ligacoes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "voz_ligacoes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "voz_ligacoes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "voz_ligacoes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "voz_ligacoes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voz_ligacoes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "voz_ligacoes_enfileirada_por_fkey"
            columns: ["enfileirada_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voz_ligacoes_mandato_id_fkey"
            columns: ["mandato_id"]
            isOneToOne: false
            referencedRelation: "mandatos"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_entregas: {
        Row: {
          analise_id: string | null
          criado_em: string
          entregue_em: string | null
          evento: string
          evento_id: string
          id: string
          payload: Json
          proxima_tentativa_em: string
          status: string
          tentativas: number
          ultima_resposta: string | null
          ultimo_erro: string | null
          ultimo_status_http: number | null
          webhook_id: string
        }
        Insert: {
          analise_id?: string | null
          criado_em?: string
          entregue_em?: string | null
          evento: string
          evento_id: string
          id?: string
          payload: Json
          proxima_tentativa_em?: string
          status?: string
          tentativas?: number
          ultima_resposta?: string | null
          ultimo_erro?: string | null
          ultimo_status_http?: number | null
          webhook_id: string
        }
        Update: {
          analise_id?: string | null
          criado_em?: string
          entregue_em?: string | null
          evento?: string
          evento_id?: string
          id?: string
          payload?: Json
          proxima_tentativa_em?: string
          status?: string
          tentativas?: number
          ultima_resposta?: string | null
          ultimo_erro?: string | null
          ultimo_status_http?: number | null
          webhook_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_entregas_analise_id_fkey"
            columns: ["analise_id"]
            isOneToOne: false
            referencedRelation: "analise_vigente"
            referencedColumns: ["analise_id"]
          },
          {
            foreignKeyName: "webhook_entregas_analise_id_fkey"
            columns: ["analise_id"]
            isOneToOne: false
            referencedRelation: "analises_credito"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_entregas_webhook_id_fkey"
            columns: ["webhook_id"]
            isOneToOne: false
            referencedRelation: "webhooks_saida"
            referencedColumns: ["id"]
          },
        ]
      }
      webhooks_saida: {
        Row: {
          ativo: boolean
          criado_em: string
          criado_por: string | null
          eventos: string[]
          id: string
          nome: string
          secret: string
          url: string
        }
        Insert: {
          ativo?: boolean
          criado_em?: string
          criado_por?: string | null
          eventos: string[]
          id?: string
          nome: string
          secret: string
          url: string
        }
        Update: {
          ativo?: boolean
          criado_em?: string
          criado_por?: string | null
          eventos?: string[]
          id?: string
          nome?: string
          secret?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhooks_saida_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_contas: {
        Row: {
          apelido: string
          ativo: boolean
          atualizada_em: string
          criada_em: string
          id: string
          intervalo_max_seg: number
          intervalo_min_seg: number
          mensagens_por_dia: number
          numero: string
          provedor: string
          sessao_caiu_em: string | null
          sessao_status: string | null
          sessao_verificada_em: string | null
          tipo: string
          token_definido_em: string | null
          token_secret_id: string | null
          usuario_responsavel: string | null
          warmup_iniciado_em: string | null
          webhook_secret_definido_em: string | null
          webhook_secret_hash: string | null
        }
        Insert: {
          apelido: string
          ativo?: boolean
          atualizada_em?: string
          criada_em?: string
          id?: string
          intervalo_max_seg?: number
          intervalo_min_seg?: number
          mensagens_por_dia?: number
          numero: string
          provedor?: string
          sessao_caiu_em?: string | null
          sessao_status?: string | null
          sessao_verificada_em?: string | null
          tipo?: string
          token_definido_em?: string | null
          token_secret_id?: string | null
          usuario_responsavel?: string | null
          warmup_iniciado_em?: string | null
          webhook_secret_definido_em?: string | null
          webhook_secret_hash?: string | null
        }
        Update: {
          apelido?: string
          ativo?: boolean
          atualizada_em?: string
          criada_em?: string
          id?: string
          intervalo_max_seg?: number
          intervalo_min_seg?: number
          mensagens_por_dia?: number
          numero?: string
          provedor?: string
          sessao_caiu_em?: string | null
          sessao_status?: string | null
          sessao_verificada_em?: string | null
          tipo?: string
          token_definido_em?: string | null
          token_secret_id?: string | null
          usuario_responsavel?: string | null
          warmup_iniciado_em?: string | null
          webhook_secret_definido_em?: string | null
          webhook_secret_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_contas_usuario_responsavel_fkey"
            columns: ["usuario_responsavel"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      agentes_empresas_alvo: {
        Row: {
          camada: string | null
          chance_concessao: number | null
          cnae_principal: string | null
          cnpj: string | null
          dias_sem_antecipar: number | null
          dias_sem_conversa: number | null
          e_ex_cliente: boolean | null
          em_cobranca: boolean | null
          empresa_id: string | null
          estagio: string | null
          faturamento_anual: number | null
          funcionarios: number | null
          gestao_operacao: string | null
          is_spe: boolean | null
          limite_potencial: number | null
          meses_desde_ex_cliente: number | null
          municipio: string | null
          nome_fantasia: string | null
          origem: string | null
          porte: string | null
          qtd_contatos_telefone: number | null
          razao_social: string | null
          score_credito: number | null
          score_faixa: string | null
          sdr_estagio: string | null
          sdr_fit: boolean | null
          suprimida: boolean | null
          tem_dominio: boolean | null
          tem_titular: boolean | null
          tipagem_antecipacao: string | null
          uf: string | null
        }
        Insert: {
          camada?: string | null
          chance_concessao?: number | null
          cnae_principal?: string | null
          cnpj?: string | null
          dias_sem_antecipar?: never
          dias_sem_conversa?: never
          e_ex_cliente?: never
          em_cobranca?: never
          empresa_id?: string | null
          estagio?: string | null
          faturamento_anual?: number | null
          funcionarios?: number | null
          gestao_operacao?: string | null
          is_spe?: never
          limite_potencial?: number | null
          meses_desde_ex_cliente?: never
          municipio?: string | null
          nome_fantasia?: string | null
          origem?: string | null
          porte?: never
          qtd_contatos_telefone?: never
          razao_social?: string | null
          score_credito?: number | null
          score_faixa?: string | null
          sdr_estagio?: never
          sdr_fit?: never
          suprimida?: never
          tem_dominio?: never
          tem_titular?: never
          tipagem_antecipacao?: string | null
          uf?: string | null
        }
        Update: {
          camada?: string | null
          chance_concessao?: number | null
          cnae_principal?: string | null
          cnpj?: string | null
          dias_sem_antecipar?: never
          dias_sem_conversa?: never
          e_ex_cliente?: never
          em_cobranca?: never
          empresa_id?: string | null
          estagio?: string | null
          faturamento_anual?: number | null
          funcionarios?: number | null
          gestao_operacao?: string | null
          is_spe?: never
          limite_potencial?: number | null
          meses_desde_ex_cliente?: never
          municipio?: string | null
          nome_fantasia?: string | null
          origem?: string | null
          porte?: never
          qtd_contatos_telefone?: never
          razao_social?: string | null
          score_credito?: number | null
          score_faixa?: string | null
          sdr_estagio?: never
          sdr_fit?: never
          suprimida?: never
          tem_dominio?: never
          tem_titular?: never
          tipagem_antecipacao?: string | null
          uf?: string | null
        }
        Relationships: []
      }
      analise_vigente: {
        Row: {
          analise_estagio: string | null
          analise_id: string | null
          cnpj: string | null
          decidida_em: string | null
          expira_em: string | null
          limite_aprovado: number | null
          tem_analise_vigente: boolean | null
        }
        Relationships: []
      }
      analises_plataforma_atual: {
        Row: {
          available_limit: number | null
          cnpj: string | null
          company_name: string | null
          company_type: string | null
          consumed_limit: number | null
          credit_limit: number | null
          empresa_cadastrada: boolean | null
          ever_approved: boolean | null
          expiration_date: string | null
          fee_d0: number | null
          fee_d1: number | null
          fidc_ready: boolean | null
          has_insurance: boolean | null
          id_externo: number | null
          max_anticipation_value: number | null
          monthly_rate_d0: number | null
          monthly_rate_d1: number | null
          onepay_company_id: number | null
          sincronizada_em: string | null
          status: string | null
        }
        Relationships: []
      }
      analises_sem_cadastro: {
        Row: {
          cnpj: string | null
          credit_limit: number | null
          empresa_id: string | null
          expiration_date: string | null
          monthly_rate_d0: number | null
          municipio: string | null
          nome: string | null
          sincronizada_em: string | null
          status: string | null
          uf: string | null
          vigente: boolean | null
        }
        Relationships: []
      }
      antecipacao_fornecedores: {
        Row: {
          dias_para_vencimento_min: number | null
          fornecedor_cnpj: string | null
          fornecedor_empresa_id: string | null
          fornecedor_nome: string | null
          fornecedor_suprimido: boolean | null
          fornecedor_tipagem: string | null
          melhor_faixa: string | null
          notas_vivas: number | null
          receita_esperada_total: number | null
          valor_total: number | null
        }
        Relationships: []
      }
      antecipacao_fornecedores_a_prospectar: {
        Row: {
          fornecedor_cnae_principal: string | null
          fornecedor_cnpj: string | null
          fornecedor_empresa_id: string | null
          fornecedor_municipio: string | null
          fornecedor_nome: string | null
          fornecedor_situacao_cadastral: string | null
          fornecedor_uf: string | null
          notas: number | null
          notas_operaveis: number | null
          primeira_nota_em: string | null
          sacados: number | null
          ultima_nota_em: string | null
          valor_agregado: number | null
        }
        Relationships: []
      }
      antecipacao_fornecedores_sem_interesse: {
        Row: {
          fornecedor_cnae_principal: string | null
          fornecedor_cnpj: string | null
          fornecedor_empresa_id: string | null
          fornecedor_municipio: string | null
          fornecedor_nome: string | null
          fornecedor_uf: string | null
          marcado_em: string | null
          marcado_por: string | null
          marcado_por_nome: string | null
          motivo: string | null
          notas: number | null
          observacao: string | null
          ultima_nota_em: string | null
          valor_agregado: number | null
        }
        Relationships: [
          {
            foreignKeyName: "antecipacao_fornecedor_sem_interesse_marcado_por_fkey"
            columns: ["marcado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      antecipacao_sacados: {
        Row: {
          available_limit: number | null
          credit_limit: number | null
          credito_status: string | null
          demanda_pipeline: number | null
          fornecedores: number | null
          notas_em_faixa: number | null
          receita_esperada_total: number | null
          sacado_cnpj: string | null
          sacado_empresa_id: string | null
          sacado_nome: string | null
        }
        Relationships: []
      }
      antecipacao_sacados_a_prospectar: {
        Row: {
          fornecedores: number | null
          notas: number | null
          notas_de_quem_ja_antecipou: number | null
          primeira_nota_em: string | null
          sacado_camada: string | null
          sacado_cnae_principal: string | null
          sacado_cnpj: string | null
          sacado_empresa_id: string | null
          sacado_municipio: string | null
          sacado_nome: string | null
          sacado_uf: string | null
          ultima_nota_em: string | null
          valor_agregado: number | null
        }
        Relationships: []
      }
      antecipacao_sacados_com_credito: {
        Row: {
          aprovacao_propria: boolean | null
          cnpj: string | null
        }
        Relationships: []
      }
      apolice_relogio: {
        Row: {
          apolice_id: string | null
          calculado_em: string | null
          causa: string | null
          cedente_cnpj: string | null
          cedente_nome: string | null
          cobertura_volta_em: string | null
          cobranca_codigo: string | null
          cobranca_id: string | null
          data_limite_notificacao: string | null
          data_limite_sinistro: string | null
          data_parada_cobertura: string | null
          data_perda: string | null
          dias_desde_vencimento: number | null
          dias_restantes: number | null
          id: string | null
          notificado_seguradora_em: string | null
          numero: string | null
          pago_em: string | null
          proximo_marco: string | null
          proximo_marco_em: string | null
          responsavel_id: string | null
          restabelecimento_retroativo: boolean | null
          sacado_cnpj: string | null
          sacado_matriz_cnpj: string | null
          sacado_nome: string | null
          sinistro_codigo: string | null
          sinistro_estagio: string | null
          sinistro_id: string | null
          status: string | null
          titulo_id: string | null
          titulo_status: string | null
          valor_face: number | null
          vencimento_original: string | null
        }
        Relationships: [
          {
            foreignKeyName: "apolice_prazos_apolice_id_fkey"
            columns: ["apolice_id"]
            isOneToOne: false
            referencedRelation: "apolices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apolice_prazos_cobranca_id_fkey"
            columns: ["cobranca_id"]
            isOneToOne: false
            referencedRelation: "cobranca_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apolice_prazos_cobranca_id_fkey"
            columns: ["cobranca_id"]
            isOneToOne: false
            referencedRelation: "cobrancas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apolice_prazos_sinistro_id_fkey"
            columns: ["sinistro_id"]
            isOneToOne: false
            referencedRelation: "sinistros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apolice_prazos_titulo_id_fkey"
            columns: ["titulo_id"]
            isOneToOne: false
            referencedRelation: "cobranca_titulos_abertos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apolice_prazos_titulo_id_fkey"
            columns: ["titulo_id"]
            isOneToOne: false
            referencedRelation: "titulos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cobrancas_responsavel_id_fkey"
            columns: ["responsavel_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      atividade_comunicacao: {
        Row: {
          canal: string | null
          contatos_distintos: number | null
          dia: string | null
          empresas_tocadas: number | null
          enviadas: number | null
          enviadas_por_ia: number | null
          is_ia: boolean | null
          recebidas: number | null
          vendedor_id: string | null
          vendedor_nome: string | null
        }
        Relationships: [
          {
            foreignKeyName: "comunicacoes_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
        ]
      }
      campanha_destinatarios_lista: {
        Row: {
          agendada_para: string | null
          campanha_id: string | null
          comunicacao_id: string | null
          conta_remetente: string | null
          contato_cargo: string | null
          contato_email: string | null
          contato_id: string | null
          contato_nome: string | null
          contato_whatsapp: string | null
          conversa_id: string | null
          criado_em: string | null
          empresa_cnpj: string | null
          empresa_id: string | null
          empresa_nome: string | null
          enviada_em: string | null
          erro: string | null
          id: string | null
          motivo_exclusao: string | null
          passo: number | null
          respondida_em: string | null
          status: string | null
          status_envio: string | null
          triagem: Json | null
          variante_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campanha_destinatarios_campanha_id_fkey"
            columns: ["campanha_id"]
            isOneToOne: false
            referencedRelation: "campanhas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanha_destinatarios_campanha_id_fkey"
            columns: ["campanha_id"]
            isOneToOne: false
            referencedRelation: "campanhas_lista"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanha_destinatarios_comunicacao_id_fkey"
            columns: ["comunicacao_id"]
            isOneToOne: false
            referencedRelation: "comunicacoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanha_destinatarios_comunicacao_id_fkey"
            columns: ["comunicacao_id"]
            isOneToOne: false
            referencedRelation: "comunicacoes_thread"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanha_destinatarios_contato_id_fkey"
            columns: ["contato_id"]
            isOneToOne: false
            referencedRelation: "contatos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanha_destinatarios_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "conversas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanha_destinatarios_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "inbox_conversas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanha_destinatarios_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "campanha_destinatarios_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "campanha_destinatarios_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "campanha_destinatarios_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "campanha_destinatarios_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanha_destinatarios_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      campanhas_lista: {
        Row: {
          aprovada_em: string | null
          aprovada_por_nome: string | null
          canal: string | null
          concluida_em: string | null
          criada_em: string | null
          criada_por_nome: string | null
          enviadas: number | null
          excluidas: number | null
          falhas: number | null
          id: string | null
          inicio_em: string | null
          nome: string | null
          objetivo: string | null
          optouts: number | null
          origem_publico: string | null
          pendentes: number | null
          preset: string | null
          respondidas: number | null
          ritmo_por_dia: number | null
          segmento_id: string | null
          segmento_nome: string | null
          status: string | null
          tipo: string | null
          total: number | null
          vendedor_id: string | null
          vendedor_nome: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campanhas_segmento_id_fkey"
            columns: ["segmento_id"]
            isOneToOne: false
            referencedRelation: "segmentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanhas_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
        ]
      }
      certificado_universo: {
        Row: {
          certificado_status: string | null
          cnpj: string | null
          coberto: boolean | null
          e_matriz: boolean | null
          empresa_id: string | null
          expires_at: string | null
          razao_social: string | null
        }
        Relationships: []
      }
      clientes_onepay_lista: {
        Row: {
          anticipations_last_2m: number | null
          atualizado_em: string | null
          available_limit: number | null
          cnpj: string | null
          consumed_limit: number | null
          consumed_pct: number | null
          consumed_pct_2m: number | null
          credit_limit: number | null
          days_without_anticipation: number | null
          empresa_id: string | null
          faturamento_anual: number | null
          faturamento_confianca: string | null
          gestao_operacao: string | null
          gross_value_last_2m: number | null
          grupo_id: string | null
          last_anticipation: string | null
          nome: string | null
          onepay_company_id: number | null
          operation_status: string | null
          primeira_vez_visto: string | null
          protesto_grupo_cnpjs: number | null
          protesto_grupo_valor: number | null
          status: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clientes_onepay_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "clientes_onepay_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "clientes_onepay_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "clientes_onepay_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "clientes_onepay_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_onepay_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "empresas_grupo_id_fkey"
            columns: ["grupo_id"]
            isOneToOne: false
            referencedRelation: "grupos_economicos"
            referencedColumns: ["id"]
          },
        ]
      }
      cobranca_cards: {
        Row: {
          aceite_apolice_em: string | null
          aceite_apolice_por: string | null
          codigo: string | null
          convertida_em_processo_em: string | null
          criada_em: string | null
          criada_por: string | null
          data_base: string | null
          dias_desde_notificacao: number | null
          dias_restantes: number | null
          encerrada_em: string | null
          escopo_notificacao: string | null
          estagio: string | null
          honorarios_pct: number | null
          id: string | null
          indice_correcao: string | null
          juros_mora_mes: number | null
          juros_pro_rata: boolean | null
          max_dias_atraso: number | null
          motivo_encerramento: string | null
          multa_pct: number | null
          notificada_em: string | null
          notificar_matriz_cedente: boolean | null
          observacoes: string | null
          processo_cnj: string | null
          proximo_marco: string | null
          proximo_marco_em: string | null
          qtd_ativos: number | null
          qtd_spes: number | null
          qtd_titulos: number | null
          responsavel_id: string | null
          responsavel_nome: string | null
          sacado_empresa_id: string | null
          sacado_matriz_cnpj: string | null
          sacado_razao_social: string | null
          tem_acordo: boolean | null
          tem_processo: boolean | null
          tem_protesto: boolean | null
          tem_sinistro: boolean | null
          valor_atualizado: number | null
          valor_atualizado_em: string | null
          valor_em_aberto: number | null
          valor_face: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cobrancas_aceite_apolice_por_fkey"
            columns: ["aceite_apolice_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cobrancas_criada_por_fkey"
            columns: ["criada_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cobrancas_processo_cnj_fkey"
            columns: ["processo_cnj"]
            isOneToOne: false
            referencedRelation: "juridico_carteira"
            referencedColumns: ["numero_cnj"]
          },
          {
            foreignKeyName: "cobrancas_processo_cnj_fkey"
            columns: ["processo_cnj"]
            isOneToOne: false
            referencedRelation: "processos"
            referencedColumns: ["numero_cnj"]
          },
          {
            foreignKeyName: "cobrancas_responsavel_id_fkey"
            columns: ["responsavel_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cobrancas_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "cobrancas_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "cobrancas_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "cobrancas_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "cobrancas_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cobrancas_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      cobranca_titulos_abertos: {
        Row: {
          antecipacao_id_externo: number | null
          atualizado_producao_em: string | null
          cedente_cnpj: string | null
          cedente_empresa_id: string | null
          cedente_matriz_cnpj: string | null
          cedente_nome: string | null
          coberto_apolice: boolean | null
          cobranca_ativa_codigo: string | null
          cobranca_ativa_id: string | null
          desembolsado_em: string | null
          devedor_terceiro: boolean | null
          dias_atraso: number | null
          em_atraso: boolean | null
          emissao: string | null
          externo_id: string | null
          id: string | null
          limite_atualizado_em: string | null
          limite_credito_vigente: number | null
          limite_documento: string | null
          limite_expira_em: string | null
          liquidacao_esperada: string | null
          liquidacao_fonte: string | null
          liquidacao_pagamentos: Json
          migrado: boolean | null
          nf_chave_acesso: string | null
          numero: string | null
          operacao_externo_id: string | null
          pago_em: string | null
          pago_em_origem: string | null
          retencao: number | null
          sacado_cnpj: string | null
          sacado_e_matriz: boolean | null
          sacado_empresa_id: string | null
          sacado_matriz_cnpj: string | null
          sacado_nome: string | null
          saldo_em_aberto: number | null
          sincronizado_em: string | null
          status: string | null
          status_producao: string | null
          valor_cedido: number | null
          valor_face: number | null
          valor_nota: number | null
          valor_pago: number | null
          vencimento: string | null
          vencimento_prorrogado: string | null
          vencimento_vigente: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cobranca_titulos_cobranca_id_fkey"
            columns: ["cobranca_ativa_id"]
            isOneToOne: false
            referencedRelation: "cobranca_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cobranca_titulos_cobranca_id_fkey"
            columns: ["cobranca_ativa_id"]
            isOneToOne: false
            referencedRelation: "cobrancas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "titulos_antecipacao_id_externo_fkey"
            columns: ["antecipacao_id_externo"]
            isOneToOne: true
            referencedRelation: "antecipacoes"
            referencedColumns: ["id_externo"]
          },
          {
            foreignKeyName: "titulos_cedente_empresa_id_fkey"
            columns: ["cedente_empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "titulos_cedente_empresa_id_fkey"
            columns: ["cedente_empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "titulos_cedente_empresa_id_fkey"
            columns: ["cedente_empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "titulos_cedente_empresa_id_fkey"
            columns: ["cedente_empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "titulos_cedente_empresa_id_fkey"
            columns: ["cedente_empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "titulos_cedente_empresa_id_fkey"
            columns: ["cedente_empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "titulos_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "titulos_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "titulos_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "titulos_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "titulos_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "titulos_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      comunicacoes_thread: {
        Row: {
          anexos: Json | null
          assunto: string | null
          canal: string | null
          conta_remetente: string | null
          contato_cargo: string | null
          contato_id: string | null
          contato_nome: string | null
          conversa_id: string | null
          corpo: string | null
          criado_em: string | null
          direcao: string | null
          empresa_cnpj: string | null
          empresa_id: string | null
          empresa_nome: string | null
          enviado_em: string | null
          erro: string | null
          funil: string | null
          funil_card_id: string | null
          id: string | null
          origem: string | null
          por_ia: boolean | null
          preview: string | null
          provedor: string | null
          status_envio: string | null
          triagem: Json | null
          usuario_nome: string | null
          vendedor_is_ia: boolean | null
          vendedor_nome: string | null
        }
        Relationships: [
          {
            foreignKeyName: "comunicacoes_contato_id_fkey"
            columns: ["contato_id"]
            isOneToOne: false
            referencedRelation: "contatos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comunicacoes_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "conversas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comunicacoes_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "inbox_conversas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comunicacoes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "comunicacoes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "comunicacoes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "comunicacoes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "comunicacoes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comunicacoes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      contatos_em_campanha: {
        Row: {
          agendada_para: string | null
          campanha_id: string | null
          campanha_nome: string | null
          canal: string | null
          contato_id: string | null
          destinatario_status: string | null
          empresa_id: string | null
          enviada_em: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campanha_destinatarios_campanha_id_fkey"
            columns: ["campanha_id"]
            isOneToOne: false
            referencedRelation: "campanhas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanha_destinatarios_campanha_id_fkey"
            columns: ["campanha_id"]
            isOneToOne: false
            referencedRelation: "campanhas_lista"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanha_destinatarios_contato_id_fkey"
            columns: ["contato_id"]
            isOneToOne: false
            referencedRelation: "contatos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanha_destinatarios_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "campanha_destinatarios_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "campanha_destinatarios_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "campanha_destinatarios_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "campanha_destinatarios_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanha_destinatarios_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      credito_carteira: {
        Row: {
          available_limit: number | null
          cnpj: string | null
          coberturas: number | null
          company_name: string | null
          consumed_limit: number | null
          descoberto: number | null
          empresa_id: string | null
          limite_concedido: number | null
          limite_expira_em: string | null
          limite_segurado: number | null
          plataforma_diz_ter_seguro: boolean | null
          rating: string | null
          rating_classe: string | null
          razao_social: string | null
          segurado_em: string | null
          situacao: string | null
        }
        Relationships: []
      }
      cron_execucoes_ultimas: {
        Row: {
          acompanhado: boolean | null
          erro: string | null
          esperado_em: string | null
          id: string | null
          iniciado_em: string | null
          job_id: string | null
          path: string | null
          status: string | null
          terminado_em: string | null
          ultimo_disparo_em: string | null
        }
        Relationships: []
      }
      empresas_potencial_limite: {
        Row: {
          cnpj: string | null
          consumed_pct: number | null
          days_without_anticipation: number | null
          empresa_id: string | null
          espaco: number | null
          faturamento_anual: number | null
          faturamento_confianca: string | null
          gross_value_last_2m: number | null
          limite_concedido: number | null
          limite_confianca: string | null
          limite_disponivel: number | null
          limite_potencial: number | null
          nome: string | null
          ratio_concedido: number | null
          score_completude: number | null
          score_credito: number | null
          score_faixa: string | null
          tipo: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clientes_onepay_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "clientes_onepay_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "clientes_onepay_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "clientes_onepay_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "clientes_onepay_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_onepay_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      ex_clientes: {
        Row: {
          cnpj: string | null
          consumo_historico: number | null
          e_filial: boolean | null
          e_principal: boolean | null
          e_spe: boolean | null
          empresa_id: string | null
          ex_cliente_desde: string | null
          ex_cliente_motivo: string | null
          ex_cliente_motivo_label: string | null
          ex_cliente_motivo_obs: string | null
          gestao_operacao: string | null
          meses_desde: number | null
          motivo_sugerido: string | null
          motivo_sugerido_evidencia: string | null
          motivo_sugerido_label: string | null
          municipio: string | null
          na_lista: boolean | null
          nome: string | null
          oculto: boolean | null
          origem_spe: string | null
          uf: string | null
          ultima_analise_expirou_em: string | null
          ultima_analise_status: string | null
          ultima_taxa_d0: number | null
          ultimo_limite: number | null
        }
        Relationships: [
          {
            foreignKeyName: "empresas_ex_cliente_motivo_fkey"
            columns: ["ex_cliente_motivo"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["motivo_sugerido"]
          },
          {
            foreignKeyName: "empresas_ex_cliente_motivo_fkey"
            columns: ["ex_cliente_motivo"]
            isOneToOne: false
            referencedRelation: "motivos_perda"
            referencedColumns: ["id"]
          },
        ]
      }
      fornecedores_funil_view: {
        Row: {
          cnae_principal: string | null
          contatos_encontrados: number | null
          data_inicio_atividade: string | null
          descoberta_automatica_em: string | null
          dominio: string | null
          dominio_confianca: string | null
          empresa_id: string | null
          entrou_em: string | null
          estagio: string | null
          estagio_alterado_em: string | null
          fornecedor_cnpj: string | null
          fornecedor_nome: string | null
          id: string | null
          melhor_confianca: string | null
          municipio: string | null
          nome_fantasia: string | null
          originador_id: string | null
          originador_nome: string | null
          originador_origem: string | null
          porte_rfb: string | null
          potencial_mensal: number | null
          prazo_medio_dias: number | null
          qtd_nfs_90d: number | null
          sacados_principais: Json | null
          sem_interesse_ate: string | null
          sem_interesse_motivo: string | null
          sem_interesse_observacao: string | null
          sem_interesse_origem: string | null
          situacao_cadastral: string | null
          suprimido: boolean | null
          uf: string | null
          ultima_busca_em: string | null
          ultima_nf_em: string | null
          volume_90d: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fornecedores_funil_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "fornecedores_funil_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "fornecedores_funil_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "fornecedores_funil_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "fornecedores_funil_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fornecedores_funil_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "fornecedores_funil_originador_id_fkey"
            columns: ["originador_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
        ]
      }
      funil_oportunidades: {
        Row: {
          access_key: string | null
          conversao_antecipacao_id: number | null
          conversao_em_disputa: boolean | null
          conversao_taxa: number | null
          conversao_valor: number | null
          credor_pessoa_fisica: boolean | null
          data_base: string | null
          dias_para_vencimento: number | null
          direction: string | null
          emitida_em: string | null
          estado_origem: string | null
          estagio_alterado_em: string | null
          estagio_funil: string | null
          faixa: string | null
          faixa_motivo: string | null
          fornecedor_cadastrado: boolean | null
          fornecedor_capital_social: number | null
          fornecedor_cnpj: string | null
          fornecedor_e_cliente_onepay: boolean | null
          fornecedor_empresa_id: string | null
          fornecedor_ja_antecipou: boolean | null
          fornecedor_natureza_juridica: string | null
          fornecedor_nome: string | null
          fornecedor_protesto_em: string | null
          fornecedor_protesto_valor: number | null
          fornecedor_sem_interesse: boolean | null
          fornecedor_situacao_cadastral: string | null
          fornecedor_suprimido: boolean | null
          fornecedor_tem_protesto: boolean | null
          fornecedor_tipagem: string | null
          fornecedor_uf: string | null
          fornecedor_ultimo_numero_nf: number | null
          id: string | null
          linha_contexto: string | null
          liquido_estimado: number | null
          nao_operavel_motivo: string | null
          natureza_operacao: string | null
          numero: string | null
          numero_exibicao: string | null
          operavel: boolean | null
          perda_motivo: string | null
          pre_autorizacao_em: string | null
          pre_autorizacao_id: number | null
          pre_autorizacao_status: string | null
          receita_esperada: number | null
          relogio: string | null
          sacado_cadastrado: boolean | null
          sacado_cnpj: string | null
          sacado_credito_status: string | null
          sacado_empresa_id: string | null
          sacado_limite_cobre_nota: boolean | null
          sacado_limite_cobre_valor: boolean | null
          sacado_limite_disponivel: number | null
          sacado_matriz_cnpj: string | null
          sacado_nome: string | null
          sacado_uf: string | null
          seguro_estimado: number | null
          serie: string | null
          tac_estimada: number | null
          taxa_usada: number | null
          tipo: string | null
          tipo_nf: string | null
          valor: number | null
          vencimento: string | null
          vencimento_origem: string | null
          vendedor_id: string | null
          vendedor_origem: string | null
        }
        Relationships: []
      }
      funil_oportunidades_nf: {
        Row: {
          access_key: string | null
          conversao_antecipacao_id: number | null
          conversao_em_disputa: boolean | null
          conversao_taxa: number | null
          conversao_valor: number | null
          credor_pessoa_fisica: boolean | null
          data_base: string | null
          dias_para_vencimento: number | null
          direction: string | null
          emitida_em: string | null
          estado_origem: string | null
          estagio_alterado_em: string | null
          estagio_funil: string | null
          faixa: string | null
          faixa_motivo: string | null
          fornecedor_cadastrado: boolean | null
          fornecedor_capital_social: number | null
          fornecedor_cnpj: string | null
          fornecedor_e_cliente_onepay: boolean | null
          fornecedor_empresa_id: string | null
          fornecedor_ja_antecipou: boolean | null
          fornecedor_natureza_juridica: string | null
          fornecedor_nome: string | null
          fornecedor_protesto_em: string | null
          fornecedor_protesto_valor: number | null
          fornecedor_sem_interesse: boolean | null
          fornecedor_situacao_cadastral: string | null
          fornecedor_suprimido: boolean | null
          fornecedor_tem_protesto: boolean | null
          fornecedor_tipagem: string | null
          fornecedor_uf: string | null
          fornecedor_ultimo_numero_nf: number | null
          id: string | null
          linha_contexto: string | null
          liquido_estimado: number | null
          nao_operavel_motivo: string | null
          natureza_operacao: string | null
          numero: string | null
          numero_exibicao: string | null
          operavel: boolean | null
          perda_motivo: string | null
          pre_autorizacao_em: string | null
          pre_autorizacao_id: number | null
          pre_autorizacao_status: string | null
          receita_esperada: number | null
          relogio: string | null
          sacado_cadastrado: boolean | null
          sacado_cnpj: string | null
          sacado_credito_status: string | null
          sacado_empresa_id: string | null
          sacado_limite_cobre_nota: boolean | null
          sacado_limite_cobre_valor: boolean | null
          sacado_limite_disponivel: number | null
          sacado_matriz_cnpj: string | null
          sacado_nome: string | null
          sacado_uf: string | null
          seguro_estimado: number | null
          serie: string | null
          tac_estimada: number | null
          taxa_usada: number | null
          tipo: string | null
          tipo_nf: string | null
          valor: number | null
          vencimento: string | null
          vencimento_origem: string | null
          vendedor_id: string | null
          vendedor_origem: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notas_fiscais_conversao_antecipacao_id_fkey"
            columns: ["conversao_antecipacao_id"]
            isOneToOne: false
            referencedRelation: "antecipacoes"
            referencedColumns: ["id_externo"]
          },
          {
            foreignKeyName: "notas_fiscais_fornecedor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "notas_fiscais_fornecedor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "notas_fiscais_fornecedor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "notas_fiscais_fornecedor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "notas_fiscais_fornecedor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notas_fiscais_fornecedor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "notas_fiscais_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "notas_fiscais_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "notas_fiscais_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "notas_fiscais_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "notas_fiscais_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notas_fiscais_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "notas_fiscais_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
        ]
      }
      funil_oportunidades_preauth: {
        Row: {
          access_key: string | null
          conversao_antecipacao_id: number | null
          conversao_em_disputa: boolean | null
          conversao_taxa: number | null
          conversao_valor: number | null
          credor_pessoa_fisica: boolean | null
          data_base: string | null
          dias_para_vencimento: number | null
          direction: string | null
          emitida_em: string | null
          estado_origem: string | null
          estagio_alterado_em: string | null
          estagio_funil: string | null
          faixa: string | null
          faixa_motivo: string | null
          fornecedor_cadastrado: boolean | null
          fornecedor_capital_social: number | null
          fornecedor_cnpj: string | null
          fornecedor_e_cliente_onepay: boolean | null
          fornecedor_empresa_id: string | null
          fornecedor_ja_antecipou: boolean | null
          fornecedor_natureza_juridica: string | null
          fornecedor_nome: string | null
          fornecedor_protesto_em: string | null
          fornecedor_protesto_valor: number | null
          fornecedor_sem_interesse: boolean | null
          fornecedor_situacao_cadastral: string | null
          fornecedor_suprimido: boolean | null
          fornecedor_tem_protesto: boolean | null
          fornecedor_tipagem: string | null
          fornecedor_uf: string | null
          fornecedor_ultimo_numero_nf: number | null
          id: string | null
          linha_contexto: string | null
          liquido_estimado: number | null
          nao_operavel_motivo: string | null
          natureza_operacao: string | null
          numero: string | null
          numero_exibicao: string | null
          operavel: boolean | null
          perda_motivo: string | null
          pre_autorizacao_em: string | null
          pre_autorizacao_id: number | null
          pre_autorizacao_status: string | null
          receita_esperada: number | null
          relogio: string | null
          sacado_cadastrado: boolean | null
          sacado_cnpj: string | null
          sacado_credito_status: string | null
          sacado_empresa_id: string | null
          sacado_limite_cobre_nota: boolean | null
          sacado_limite_cobre_valor: boolean | null
          sacado_limite_disponivel: number | null
          sacado_matriz_cnpj: string | null
          sacado_nome: string | null
          sacado_uf: string | null
          seguro_estimado: number | null
          serie: string | null
          tac_estimada: number | null
          taxa_usada: number | null
          tipo: string | null
          tipo_nf: string | null
          valor: number | null
          vencimento: string | null
          vencimento_origem: string | null
          vendedor_id: string | null
          vendedor_origem: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pre_autorizacoes_fornecedor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "pre_autorizacoes_fornecedor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "pre_autorizacoes_fornecedor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "pre_autorizacoes_fornecedor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "pre_autorizacoes_fornecedor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pre_autorizacoes_fornecedor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "pre_autorizacoes_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "pre_autorizacoes_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "pre_autorizacoes_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "pre_autorizacoes_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "pre_autorizacoes_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pre_autorizacoes_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "pre_autorizacoes_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
        ]
      }
      funil_oportunidades_titulo: {
        Row: {
          access_key: string | null
          conversao_antecipacao_id: number | null
          conversao_em_disputa: boolean | null
          conversao_taxa: number | null
          conversao_valor: number | null
          credor_pessoa_fisica: boolean | null
          data_base: string | null
          dias_para_vencimento: number | null
          direction: string | null
          emitida_em: string | null
          estado_origem: string | null
          estagio_alterado_em: string | null
          estagio_funil: string | null
          faixa: string | null
          faixa_motivo: string | null
          fornecedor_cadastrado: boolean | null
          fornecedor_capital_social: number | null
          fornecedor_cnpj: string | null
          fornecedor_e_cliente_onepay: boolean | null
          fornecedor_empresa_id: string | null
          fornecedor_ja_antecipou: boolean | null
          fornecedor_natureza_juridica: string | null
          fornecedor_nome: string | null
          fornecedor_protesto_em: string | null
          fornecedor_protesto_valor: number | null
          fornecedor_sem_interesse: boolean | null
          fornecedor_situacao_cadastral: string | null
          fornecedor_suprimido: boolean | null
          fornecedor_tem_protesto: boolean | null
          fornecedor_tipagem: string | null
          fornecedor_uf: string | null
          fornecedor_ultimo_numero_nf: number | null
          id: string | null
          linha_contexto: string | null
          liquido_estimado: number | null
          nao_operavel_motivo: string | null
          natureza_operacao: string | null
          numero: string | null
          numero_exibicao: string | null
          operavel: boolean | null
          perda_motivo: string | null
          pre_autorizacao_em: string | null
          pre_autorizacao_id: number | null
          pre_autorizacao_status: string | null
          receita_esperada: number | null
          relogio: string | null
          sacado_cadastrado: boolean | null
          sacado_cnpj: string | null
          sacado_credito_status: string | null
          sacado_empresa_id: string | null
          sacado_limite_cobre_nota: boolean | null
          sacado_limite_cobre_valor: boolean | null
          sacado_limite_disponivel: number | null
          sacado_matriz_cnpj: string | null
          sacado_nome: string | null
          sacado_uf: string | null
          seguro_estimado: number | null
          serie: string | null
          tac_estimada: number | null
          taxa_usada: number | null
          tipo: string | null
          tipo_nf: string | null
          valor: number | null
          vencimento: string | null
          vencimento_origem: string | null
          vendedor_id: string | null
          vendedor_origem: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sienge_titulos_credor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sienge_titulos_credor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sienge_titulos_credor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "sienge_titulos_credor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sienge_titulos_credor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sienge_titulos_credor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sienge_titulos_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sienge_titulos_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sienge_titulos_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "sienge_titulos_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sienge_titulos_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sienge_titulos_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sienge_titulos_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
        ]
      }
      inbox_conversas: {
        Row: {
          canal: string | null
          conta_remetente: string | null
          conta_rotulo: string | null
          contato_base_legal: string | null
          contato_cargo: string | null
          contato_id: string | null
          contato_nao_e_o_decisor: boolean | null
          contato_nome: string | null
          empresa_cnpj: string | null
          empresa_id: string | null
          empresa_nome: string | null
          id: string | null
          identificador_externo: string | null
          lid: string | null
          modo_agente: string | null
          nao_lidas: number | null
          nome_sugerido: string | null
          objetivo: string | null
          playbook_id: string | null
          proxima_acao_em: string | null
          responsavel_is_ia: boolean | null
          responsavel_nome: string | null
          responsavel_vendedor_id: string | null
          status: string | null
          sugestao_acao: string | null
          sugestao_confianca: number | null
          sugestao_conteudo: string | null
          sugestao_id: string | null
          sugestao_justificativa: string | null
          ultima_direcao: string | null
          ultima_mensagem_em: string | null
          ultima_origem: string | null
          ultima_por_ia: boolean | null
          ultima_preview: string | null
          ultima_triagem: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "conversas_contato_id_fkey"
            columns: ["contato_id"]
            isOneToOne: false
            referencedRelation: "contatos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "conversas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "conversas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "conversas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "conversas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "conversas_playbook_fkey"
            columns: ["playbook_id"]
            isOneToOne: false
            referencedRelation: "agente_playbooks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversas_responsavel_vendedor_id_fkey"
            columns: ["responsavel_vendedor_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
        ]
      }
      juridico_agenda: {
        Row: {
          concluido: boolean | null
          devedor_nome: string | null
          empresa_devedora_id: string | null
          id: string | null
          inicio_em: string | null
          numero_cnj: string | null
          responsavel_id: string | null
          responsavel_nome: string | null
          responsavel_usuario_id: string | null
          tipo: string | null
          titulo: string | null
        }
        Relationships: [
          {
            foreignKeyName: "advogados_usuario_id_fkey"
            columns: ["responsavel_usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "processo_prazos_numero_cnj_fkey"
            columns: ["numero_cnj"]
            isOneToOne: false
            referencedRelation: "juridico_carteira"
            referencedColumns: ["numero_cnj"]
          },
          {
            foreignKeyName: "processo_prazos_numero_cnj_fkey"
            columns: ["numero_cnj"]
            isOneToOne: false
            referencedRelation: "processos"
            referencedColumns: ["numero_cnj"]
          },
          {
            foreignKeyName: "processo_prazos_responsavel_id_fkey"
            columns: ["responsavel_id"]
            isOneToOne: false
            referencedRelation: "advogados"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "processos_empresa_devedora_id_fkey"
            columns: ["empresa_devedora_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "processos_empresa_devedora_id_fkey"
            columns: ["empresa_devedora_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "processos_empresa_devedora_id_fkey"
            columns: ["empresa_devedora_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "processos_empresa_devedora_id_fkey"
            columns: ["empresa_devedora_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "processos_empresa_devedora_id_fkey"
            columns: ["empresa_devedora_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "processos_empresa_devedora_id_fkey"
            columns: ["empresa_devedora_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      juridico_carteira: {
        Row: {
          advogado_id: string | null
          advogado_nome: string | null
          advogado_usuario_id: string | null
          arquivado: boolean | null
          assunto: string | null
          calculo_em: string | null
          classe: string | null
          cnpj_devedor: string | null
          comarca: string | null
          custo_acumulado: number | null
          data_distribuicao: string | null
          data_ultima_movimentacao: string | null
          devedor_nome: string | null
          dias_na_fase: number | null
          dias_sem_movimentacao: number | null
          empresa_devedora_id: string | null
          fase_atual: string | null
          fase_desde: string | null
          nosso_cnpj: string | null
          numero_cnj: string | null
          orgao_julgador: string | null
          polo_nosso: string | null
          proximo_prazo: string | null
          proximo_prazo_em: string | null
          qtd_movimentacoes: number | null
          qtd_operacoes: number | null
          recuperado: number | null
          saldo_liquido: number | null
          situacao_interna: string | null
          status_predito: string | null
          tribunal_sigla: string | null
          uf: string | null
          ultima_sincronizacao: string | null
          valor_atualizado: number | null
          valor_causa: number | null
          valor_operacoes: number | null
        }
        Relationships: [
          {
            foreignKeyName: "advogados_usuario_id_fkey"
            columns: ["advogado_usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "processos_advogado_id_fkey"
            columns: ["advogado_id"]
            isOneToOne: false
            referencedRelation: "advogados"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "processos_empresa_devedora_id_fkey"
            columns: ["empresa_devedora_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "processos_empresa_devedora_id_fkey"
            columns: ["empresa_devedora_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "processos_empresa_devedora_id_fkey"
            columns: ["empresa_devedora_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "processos_empresa_devedora_id_fkey"
            columns: ["empresa_devedora_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "processos_empresa_devedora_id_fkey"
            columns: ["empresa_devedora_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "processos_empresa_devedora_id_fkey"
            columns: ["empresa_devedora_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      mercado_explorador: {
        Row: {
          analise_estagio: string | null
          camada: string | null
          camada_regra_versao: number | null
          capital_social: number | null
          chance_concessao: number | null
          churn_erp_concorrente: boolean | null
          cnae_grupos: string[] | null
          cnae_principal: string | null
          cnaes_todos: string[] | null
          cnpj: string | null
          consumed_pct: number | null
          contatos_enriquecidos_em: string | null
          data_exclusao_simples: string | null
          data_inicio_atividade: string | null
          dias_sem_antecipar: number | null
          dominio: string | null
          dominio_confianca: string | null
          dominio_consultado_em: string | null
          e_cliente_onepay: boolean | null
          e_ex_cliente: boolean | null
          empresa_id: string | null
          erp_atual: string | null
          erp_detalhes: Json | null
          erp_mrr: number | null
          estagio: string | null
          ex_cliente_desde: string | null
          ex_cliente_meses: number | null
          ex_cliente_motivo: string | null
          faixa_score: string | null
          faturamento_confianca: string | null
          faturamento_estimado: number | null
          faturamento_origem: string | null
          fora_recorte_cnae: boolean | null
          funcionarios: number | null
          funcionarios_crescimento_12m: number | null
          funcionarios_origem: string | null
          grafo_sefaz: boolean | null
          grupo_id: string | null
          grupo_spes_24m: number | null
          grupo_spes_total: number | null
          grupo_ufs: string[] | null
          is_spe: boolean | null
          limite_potencial: number | null
          m2_em_execucao: number | null
          municipio: string | null
          natureza_juridica: string | null
          nome_fantasia: string | null
          obras_ativas: number | null
          obras_iniciadas_24m: number | null
          opcao_simples: boolean | null
          origem_ingestao: string | null
          porte_rfb: string | null
          protestos_consultados_em: string | null
          qtd_contatos: number | null
          qtd_filiais: number | null
          qtd_usuarios_erp: number | null
          ratio_usuarios_ativos: number | null
          razao_social: string | null
          receita_mensal_prevista: number | null
          regime_tributario: string | null
          score_credito: number | null
          situacao_cadastral: string | null
          tem_analise_vigente: boolean | null
          tem_contato: boolean | null
          tem_processo_nosso_ativo: boolean | null
          tem_protesto: boolean | null
          teve_analise_sem_cadastro: boolean | null
          tipo: string | null
          uf: string | null
          ultima_analise_expirou_em: string | null
          ultima_analise_limite: number | null
          valor_esperado_mensal: number | null
        }
        Relationships: [
          {
            foreignKeyName: "mercado_universo_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "mercado_universo_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "mercado_universo_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "mercado_universo_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "mercado_universo_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mercado_universo_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "mercado_universo_grupo_fk"
            columns: ["grupo_id"]
            isOneToOne: false
            referencedRelation: "grupos_economicos"
            referencedColumns: ["id"]
          },
        ]
      }
      notas_funil: {
        Row: {
          access_key: string | null
          bilateral: boolean | null
          cancelada_em: string | null
          contato_fornecedor: Json | null
          contato_sacado: Json | null
          conversao_antecipacao_id: number | null
          conversao_em_disputa: boolean | null
          conversao_status: string | null
          conversao_taxa: number | null
          conversao_valor: number | null
          dias_para_vencimento: number | null
          direction: string | null
          emitida_em: string | null
          estagio_alterado_em: string | null
          estagio_funil: string | null
          faixa: string | null
          faixa_alterada_em: string | null
          faixa_motivo: string | null
          faixa_regra_versao: number | null
          fornecedor_cadastrado: boolean | null
          fornecedor_capital_social: number | null
          fornecedor_cnpj: string | null
          fornecedor_e_cliente_onepay: boolean | null
          fornecedor_empresa_id: string | null
          fornecedor_ja_antecipou: boolean | null
          fornecedor_natureza_juridica: string | null
          fornecedor_nome: string | null
          fornecedor_protesto_em: string | null
          fornecedor_protesto_valor: number | null
          fornecedor_sem_interesse: boolean | null
          fornecedor_situacao_cadastral: string | null
          fornecedor_suprimido: boolean | null
          fornecedor_tem_protesto: boolean | null
          fornecedor_tipagem: string | null
          fornecedor_uf: string | null
          fornecedor_ultimo_numero_nf: number | null
          liquido_estimado: number | null
          nao_operavel_motivo: string | null
          natureza_operacao: string | null
          nf_id_externo: string | null
          numero: string | null
          operavel: boolean | null
          parcelas: Json | null
          perda_motivo: string | null
          receita_esperada: number | null
          sacado_cadastrado: boolean | null
          sacado_camada: string | null
          sacado_cnae_grupos: string[] | null
          sacado_cnae_principal: string | null
          sacado_cnpj: string | null
          sacado_construcao: boolean | null
          sacado_credito_role: string | null
          sacado_credito_status: string | null
          sacado_empresa_id: string | null
          sacado_gestao_operacao: string | null
          sacado_limite: number | null
          sacado_limite_cobre_nota: boolean | null
          sacado_limite_disponivel: number | null
          sacado_limite_origem: string | null
          sacado_municipio: string | null
          sacado_nome: string | null
          sacado_razao_social: string | null
          sacado_uf: string | null
          seguro_estimado: number | null
          serie: string | null
          sincronizada_em: string | null
          situacao: string | null
          status_sync: string | null
          tac_estimada: number | null
          taxa_analise_am: number | null
          taxa_analise_origem: string | null
          taxa_usada: number | null
          tipo: string | null
          tipo_nf: string | null
          valor: number | null
          vencimento: string | null
          vencimento_origem: string | null
          vendedor_id: string | null
          vendedor_origem: string | null
          xml_resumo: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "notas_fiscais_conversao_antecipacao_id_fkey"
            columns: ["conversao_antecipacao_id"]
            isOneToOne: false
            referencedRelation: "antecipacoes"
            referencedColumns: ["id_externo"]
          },
          {
            foreignKeyName: "notas_fiscais_fornecedor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "notas_fiscais_fornecedor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "notas_fiscais_fornecedor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "notas_fiscais_fornecedor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "notas_fiscais_fornecedor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notas_fiscais_fornecedor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "notas_fiscais_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "notas_fiscais_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "notas_fiscais_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "notas_fiscais_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "notas_fiscais_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notas_fiscais_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "notas_fiscais_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
        ]
      }
      protestos_atual: {
        Row: {
          cartorios: Json | null
          cnpj: string | null
          consultado_em: string | null
          custo: number | null
          empresa_id: string | null
          fonte: string | null
          id: string | null
          payload: Json | null
          qtd_protestos: number | null
          tem_protesto: boolean | null
          valor_total: number | null
        }
        Relationships: [
          {
            foreignKeyName: "protestos_consultas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "protestos_consultas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "protestos_consultas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "protestos_consultas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "protestos_consultas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "protestos_consultas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      sacados_prospeccao_view: {
        Row: {
          analise_credito_id: string | null
          analise_decidida_em: string | null
          analise_estagio: string | null
          analise_limite_aprovado: number | null
          atualizado_em: string | null
          chance_concessao: number | null
          cnae_principal: string | null
          cnpj_sacado: string | null
          condicao_expira_em: string | null
          condicao_publicada_em: string | null
          condicao_tac: number | null
          condicao_taxa_am: number | null
          data_inicio_atividade: string | null
          empresa_id: string | null
          entrou_em: string | null
          estagio: string | null
          estagio_alterado_em: string | null
          faturamento_estimado: number | null
          id: string | null
          limite_potencial: number | null
          media_mensal_6m: number | null
          meses_com_emissao_6m: number | null
          motivo_saida: string | null
          municipio: string | null
          nome_fantasia: string | null
          observacao_saida: string | null
          originador_id: string | null
          originador_nome: string | null
          originador_origem: string | null
          porte_rfb: string | null
          prazo_medio_dias: number | null
          prazo_minimo_operavel_dias: number | null
          prazo_minimo_origem: string | null
          qtd_fornecedores: number | null
          qtd_nfs_30d: number | null
          sacado_nome: string | null
          score_completude: number | null
          score_credito: number | null
          situacao_cadastral: string | null
          uf: string | null
          ultima_nf_em: string | null
          valor_esperado_mensal: number | null
          valor_operavel: number | null
          volume_30d: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sacados_prospeccao_analise_credito_id_fkey"
            columns: ["analise_credito_id"]
            isOneToOne: false
            referencedRelation: "analise_vigente"
            referencedColumns: ["analise_id"]
          },
          {
            foreignKeyName: "sacados_prospeccao_analise_credito_id_fkey"
            columns: ["analise_credito_id"]
            isOneToOne: false
            referencedRelation: "analises_credito"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sacados_prospeccao_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agentes_empresas_alvo"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sacados_prospeccao_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "analises_sem_cadastro"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sacados_prospeccao_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "antecipacao_fornecedores_sem_interesse"
            referencedColumns: ["fornecedor_empresa_id"]
          },
          {
            foreignKeyName: "sacados_prospeccao_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "credito_carteira"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sacados_prospeccao_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sacados_prospeccao_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "ex_clientes"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sacados_prospeccao_originador_id_fkey"
            columns: ["originador_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      analise_propria_painel: {
        Args: { p_analise_credito_id: string }
        Returns: Json
      }
      antecipacao_calibracao_carteira: { Args: { p?: Json }; Returns: Json }
      antecipacao_candidatas: { Args: { p: Json }; Returns: Json }
      antecipacao_custo_protesto: { Args: never; Returns: Json }
      antecipacao_metricas_faixa: { Args: never; Returns: Json }
      antecipacao_resumo_funil: { Args: never; Returns: Json }
      antecipacao_status_conversoes: { Args: { p?: Json }; Returns: Json }
      app__abrir_analise_credito: {
        Args: {
          p_ator: string
          p_empresa_id: string
          p_limite: number
          p_mesmo_com_aberta?: boolean
          p_observacoes: string
          p_origem_motivo: string
        }
        Returns: {
          analise_propria_id: string | null
          atradius_buyer_id: string | null
          atradius_case_id: string | null
          atualizada_em: string
          cnpj: string
          codigo_decisao: string | null
          codigo_historico: string | null
          contato_externo: Json | null
          criada_em: string
          decidida_em: string | null
          decisao_interna: string | null
          decisao_interna_em: string | null
          empresa_id: string | null
          envio_manual_em: string | null
          envio_manual_por: string | null
          estagio: string
          expira_em: string | null
          expirada_em: string | null
          external_id: string | null
          id: string
          limite_aprovado: number | null
          limite_operacional: number | null
          limite_solicitado: number | null
          moeda: string
          motivo: string | null
          observacoes: string | null
          origem: string
          origem_externa: string | null
          origem_motivo: string | null
          rating_classe_seguradora: string | null
          rating_seguradora: string | null
          seguradora: string
          solicitada_por: string | null
          substituida_em: string | null
          substituida_por: string | null
        }
        SetofOptions: {
          from: "*"
          to: "analises_credito"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app__agenda_reservar: { Args: { p: Json }; Returns: Json }
      app__agente_agendar_reuniao: { Args: { p: Json }; Returns: Json }
      app__agente_mover_estagio: { Args: { p: Json }; Returns: Json }
      app__agentes_alertas_orcamento: { Args: never; Returns: number[] }
      app__agentes_consumir: { Args: { p: Json }; Returns: Json }
      app__agentes_consumo_direto: { Args: { p: Json }; Returns: Json }
      app__agentes_criar_mandato: {
        Args: { p: Json }
        Returns: {
          acoes_executadas: number
          agente_id: string
          assumido_por: string | null
          atualizado_em: string
          codigo: string | null
          contatos_tentados: Json
          criado_em: string
          criado_por: string | null
          empresa_id: string
          encerrado_em: string | null
          estado: string
          expira_em: string
          gasto_centavos: number
          id: string
          max_acoes: number
          motivo_encerramento: string | null
          nota_access_key: string | null
          objetivo: string
          orcamento_centavos: number
          origem: string
          pausado_motivo: string | null
          plano: Json | null
          plano_versao: number
          playbook_id: string | null
          prioridade: number
          proposta_id: string | null
          proxima_acao_em: string | null
          regra_id: string | null
          resultado: string | null
          reuniao_id: string | null
          sdr_lead_id: string | null
          tipo: string
          ultima_acao_em: string | null
          ultimo_ciclo_em: string | null
          ultimo_ciclo_erro: string | null
        }
        SetofOptions: {
          from: "*"
          to: "mandatos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app__agentes_estornar: { Args: { p: Json }; Returns: Json }
      app__agentes_mes_atual: { Args: never; Returns: string }
      app__agentes_orcamento_do_mes: {
        Args: { p_mes: string }
        Returns: {
          alertas_enviados: number[]
          atualizado_em: string
          consumido_centavos: number
          id: string
          mes: string
          reservado_centavos: number
          teto_centavos: number
        }
        SetofOptions: {
          from: "*"
          to: "agentes_orcamento"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app__agentes_proximo_codigo: { Args: never; Returns: string }
      app__agentes_reservar: { Args: { p: Json }; Returns: Json }
      app__agentes_salvar_tokens_caixa: {
        Args: { p: Json }
        Returns: {
          access_token_expira_em: string | null
          access_token_secret_id: string | null
          ativa: boolean
          conectada_em: string | null
          conectada_por: string | null
          criada_em: string
          endereco: string
          escopos: string[]
          history_id: string | null
          id: string
          identificador_externo: string | null
          provedor: string
          refresh_token_secret_id: string | null
          ultimo_erro: string | null
          ultimo_sync_em: string | null
          watch_expira_em: string | null
        }
        SetofOptions: {
          from: "*"
          to: "email_caixas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app__atualizar_limites_dos_sacados: { Args: never; Returns: number }
      app__cadastro_do_cnpj: {
        Args: { p_cnpj: string }
        Returns: {
          camada: string
          capital_social: number
          cnae_grupos: string[]
          cnae_principal: string
          cnpj: string
          municipio: string
          natureza_juridica: string
          nome_fantasia: string
          razao_social: string
          situacao_cadastral: string
          uf: string
        }[]
      }
      app__cobranca_bloquear_grupo: {
        Args: { p_ator: string; p_cobranca_id: string }
        Returns: undefined
      }
      app__cobranca_cnpjs_do_grupo: {
        Args: { p_matriz: string }
        Returns: string[]
      }
      app__cobranca_codigo: { Args: { p_prefixo: string }; Returns: string }
      app__cobranca_config: { Args: { p_chave: string }; Returns: Json }
      app__cobranca_empresas_do_grupo: {
        Args: { p_matriz: string }
        Returns: string[]
      }
      app__cobranca_marcar_enviada: {
        Args: { p_ator: string; p_notificacao_id: string }
        Returns: undefined
      }
      app__cobranca_placeholders_validos: {
        Args: { p_tipo: string }
        Returns: string[]
      }
      app__cobranca_ingerir_titulos: { Args: { p: Json }; Returns: number }
      app__cobranca_liquidacao_esperada: { Args: { p_vencimento: string }; Returns: string }
      app__cobranca_projetar_titulos: { Args: never; Returns: Json }
      app__cobranca_status_cedido: {
        Args: { p_status: string }
        Returns: boolean
      }
      app__cobranca_talvez_bloquear: {
        Args: { p_ator: string; p_cobranca_id: string }
        Returns: undefined
      }
      app__cobranca_vincular_processo: {
        Args: { p_ator: string; p_cnj: string; p_cobranca_id: string }
        Returns: {
          aceite_apolice_em: string | null
          aceite_apolice_por: string | null
          codigo: string | null
          convertida_em_processo_em: string | null
          criada_em: string
          criada_por: string | null
          data_base: string | null
          encerrada_em: string | null
          escopo_notificacao: string
          estagio: string
          honorarios_pct: number | null
          id: string
          indice_correcao: string | null
          juros_mora_mes: number | null
          juros_pro_rata: boolean
          motivo_encerramento: string | null
          multa_pct: number | null
          notificada_em: string | null
          notificar_matriz_cedente: boolean
          observacoes: string | null
          processo_cnj: string | null
          responsavel_id: string | null
          sacado_empresa_id: string | null
          sacado_matriz_cnpj: string
          valor_atualizado: number | null
          valor_atualizado_em: string | null
        }
        SetofOptions: {
          from: "*"
          to: "cobrancas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app__condicao_publicada: {
        Args: { p_cnpj: string }
        Returns: {
          expira_em: string
          limite: number
          publicada_em: string
          tac: number
          tac_minima: number
          taxa_am: number
        }[]
      }
      app__conta_do_webhook: {
        Args: { p_segredo: string }
        Returns: {
          apelido: string
          id: string
          numero: string
        }[]
      }
      app__conversa_absorver_lid: {
        Args: { p_conversa: string; p_lid: string }
        Returns: undefined
      }
      app__conversa_ignorada: { Args: { p_conversa: string }; Returns: boolean }
      app__conversa_minha: { Args: { p_conversa: string }; Returns: boolean }
      app__conversa_oculta: { Args: { p_conversa: string }; Returns: boolean }
      app__conversa_para: {
        Args: {
          p_canal: string
          p_conta: string | null
          p_contato: string | null
          p_empresa: string | null
          p_identificador: string
          p_vendedor: string | null
        }
        Returns: string
      }
      app__conversa_por_lid: {
        Args: { p_conta?: string | null; p_lid: string }
        Returns: string
      }
      app__conversa_recontar: {
        Args: { p_conversa: string }
        Returns: undefined
      }
      app__donos_da_conversa: {
        Args: { p_conversa: string }
        Returns: string[]
      }
      app__e_conta_contratante: {
        Args: { p_empresa_id: string }
        Returns: boolean
      }
      app__enfileirar_webhook: {
        Args: { p_analise: string; p_evento: string; p_semente: Json }
        Returns: undefined
      }
      app__identificador_canonico: {
        Args: { p_canal: string; p_valor: string }
        Returns: string
      }
      app__identificador_oculto: {
        Args: { p_canal: string; p_ident: string }
        Returns: boolean
      }
      app__limite_da_analise: {
        Args: { p_sacado_cnpj: string }
        Returns: {
          disponivel: number
          limite: number
          origem: string
        }[]
      }
      app__matriz_do_cnpj: { Args: { p_cnpj: string }; Returns: string }
      app__md_ativo: {
        Args: { p_bloco: string; p_config: Json }
        Returns: boolean
      }
      app__md_bloco: {
        Args: {
          p_itens: Json
          p_tipo: string
          p_total: number
          p_valor: number
        }
        Returns: Json
      }
      app__md_carteira_passiva: {
        Args: { p_passiva: string[] }
        Returns: string[]
      }
      app__md_closer: {
        Args: {
          p_alvo: string
          p_carteira: string[]
          p_config: Json
          p_ocultos: string[]
          p_passiva: string[]
        }
        Returns: Json
      }
      app__md_comuns: {
        Args: { p_alvos: string[]; p_config: Json; p_ocultos: string[] }
        Returns: Json
      }
      app__md_lim: {
        Args: {
          p_bloco: string
          p_chave: string
          p_config: Json
          p_padrao: number
        }
        Returns: number
      }
      app__md_max: {
        Args: { p_bloco: string; p_config: Json }
        Returns: number
      }
      app__md_montar: {
        Args: { p_alvo: string; p_config: Json }
        Returns: Json
      }
      app__md_nome: { Args: { p: string }; Returns: string }
      app__md_num: { Args: { p_valor: number }; Returns: string }
      app__md_originador: {
        Args: {
          p_alvo: string
          p_carteira: string[]
          p_config: Json
          p_ocultos: string[]
          p_orig: string[]
        }
        Returns: Json
      }
      app__md_sdr: {
        Args: { p_alvo: string; p_config: Json; p_ocultos: string[] }
        Returns: Json
      }
      app__nome_do_cedente: { Args: { p_cnpj: string }; Returns: string }
      app__primeiro_contato_empresa: {
        Args: { p_empresa_id: string }
        Returns: number
      }
      app__promover_fornecedor_para_empresa: {
        Args: { p_ator: string | null; p_cnpj: string; p_origem: string }
        Returns: {
          atualizado_em: string
          bloqueio_cobranca: boolean
          bloqueio_cobranca_cobranca_id: string | null
          bloqueio_cobranca_em: string | null
          bloqueio_cobranca_motivo: string | null
          camada: string | null
          chance_concessao: number | null
          churn_erp_concorrente: boolean
          cnae_principal: string | null
          cnpj: string
          credito_calculado_em: string | null
          credito_revisao_desde: string | null
          credito_revisao_pos_inadimplencia: boolean
          credito_versao: number | null
          criado_em: string
          dados_apollo: Json | null
          dominio: string | null
          dominio_confianca: string | null
          dominio_evidencia: string | null
          dominio_origem: string | null
          dominio_validado_em: string | null
          erp_atual: string | null
          erp_canal_venda: string | null
          erp_detalhes: Json
          erp_mrr: number | null
          estagio: string
          ex_cliente_desde: string | null
          ex_cliente_motivo: string | null
          ex_cliente_motivo_obs: string | null
          fase_manual: string | null
          faturamento_anual: number | null
          faturamento_atualizado_em: string | null
          faturamento_confianca: string | null
          faturamento_origem: string | null
          funcionarios: number | null
          funcionarios_atualizado_em: string | null
          funcionarios_crescimento_12m: number | null
          funcionarios_origem: string | null
          gestao_definida_em: string | null
          gestao_definida_por: string | null
          gestao_operacao: string | null
          grafo_sefaz: boolean
          grupo_id: string | null
          id: string
          is_spe: boolean
          limite_confianca: string | null
          limite_potencial: number | null
          marco_ativacao: string | null
          municipio: string | null
          nome_fantasia: string | null
          origem: string | null
          patrimonio_atualizado_em: string | null
          patrimonio_liquido: number | null
          patrimonio_origem: string | null
          porte: string | null
          razao_social: string | null
          receita_mensal_prevista: number | null
          receita_taxa_am: number | null
          regime_tributario: string | null
          score_calculado_em: string | null
          score_completude: number | null
          score_credito: number | null
          score_faixa: string | null
          tem_processo_nosso_ativo: boolean
          teve_analise_sem_cadastro: boolean
          tipagem_antecipacao: string | null
          tipo: string
          uf: string | null
          ultima_antecipacao: string | null
          ultima_conversa_em: string | null
          valor_esperado_mensal: number | null
        }
        SetofOptions: {
          from: "*"
          to: "empresas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app__prospeccao_evento_estagio: {
        Args: {
          p_ator: string
          p_card: Database["public"]["Tables"]["sacados_prospeccao"]["Row"]
          p_era: string
        }
        Returns: undefined
      }
      app__prospeccao_motivo_valido: {
        Args: { p_motivo: string }
        Returns: boolean
      }
      app__protesto_atualizar_titulo: {
        Args: { p: Json; p_ator: string }
        Returns: {
          atualizado_em: string
          cartorio: string | null
          certidao_path: string | null
          cobranca_titulo_id: string | null
          custas: number | null
          data_protesto: string | null
          id: string
          instrucao_cancelamento_em: string | null
          instrucao_nao_aplicavel_motivo: string | null
          motivo_rejeicao: string | null
          protocolo_cartorio: string | null
          remessa_id: string | null
          situacao: string
        }
        SetofOptions: {
          from: "*"
          to: "protesto_titulos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app__qualidade_writeback: { Args: { p: Json }; Returns: Json }
      app__qualidade_gravar_analise: { Args: { p: Json }; Returns: string }
      app__qualidade_janelas_candidatas: {
        Args: { p_horas: number; p_limite: number }
        Returns: {
          conversa_id: string
          mensagens: string[]
          ultima_janela_fim: string
        }[]
      }
      app__qualidade_vigiar: { Args: never; Returns: Json }
      app__qualidade_segredo: { Args: { p_chave: string }; Returns: string }
      app__qualidade_recalcular: {
        Args: { p_analise: string }
        Returns: undefined
      }
      app__qualidade_exige_gestor: { Args: never; Returns: undefined }
      app__qualidade_ve_analise: {
        Args: { p_vendedor_id: string }
        Returns: boolean
      }
      app__qualidade_captura_ligada: { Args: never; Returns: boolean }
      app__qualidade_cfg: { Args: { p_chave: string }; Returns: Json }
      app__registrar_toque: {
        Args: {
          p_ator: string
          p_canal: string
          p_cnpj: string
          p_contato: string
          p_extra: Json
        }
        Returns: undefined
      }
      app__reuniao_por_fireflies: { Args: { p: Json }; Returns: string }
      app__reuniao_visivel: {
        Args: { p_ev: Database["public"]["Tables"]["vendedor_eventos"]["Row"] }
        Returns: boolean
      }
      app__rp_carteira: {
        Args: { p_fim: string; p_inicio: string; p_retrato: string }
        Returns: Json
      }
      app__rp_carteira_em: {
        Args: { p_data: string }
        Returns: {
          available_limit: number
          cnpj: string
          credit_limit: number
          days_without_anticipation: number
          empresa_id: string
          nome: string
          operation_status: string
          status: string
        }[]
      }
      app__rp_certificados_cegos: {
        Args: { p_fim: string; p_limite: number }
        Returns: Json
      }
      app__rp_comercial: {
        Args: { p_fim: string; p_inicio: string; p_retrato: string }
        Returns: Json
      }
      app__rp_estagios_em: {
        Args: { p_fim: string; p_funil: string }
        Returns: {
          em: string
          estagio: string
          item_id: string
        }[]
      }
      app__rp_indicador: {
        Args: {
          p_fim: string
          p_mes: number
          p_metrica: string
          p_semana: number
          p_subir_e_pior?: boolean
          p_unidade?: string
        }
        Returns: Json
      }
      app__rp_montar: {
        Args: { p_fim: string; p_inicio: string; p_retrato?: string }
        Returns: Json
      }
      app__rp_operacao: {
        Args: { p_fim: string; p_inicio: string; p_retrato: string }
        Returns: Json
      }
      app__rp_serie: {
        Args: { p_fim: string; p_metrica: string }
        Returns: Json
      }
      app__segredo_vault: { Args: { p_id: string }; Returns: string }
      app__sincronizar_originacao_como_cedente: {
        Args: { p_ids: string[]; p_vendedor: string }
        Returns: undefined
      }
      app__sinistro_semear_documentos: {
        Args: { p_sinistro_id: string }
        Returns: undefined
      }
      app__suprimir_fornecedor: {
        Args: {
          p_ator: string
          p_cnpj: string
          p_contexto: string
          p_dias: number
          p_motivo: string
        }
        Returns: {
          contexto: string
          criado_em: string
          criado_por: string | null
          escopo: string
          expira_em: string | null
          id: string
          motivo: string
          observacao: string | null
          valor: string
        }
        SetofOptions: {
          from: "*"
          to: "supressao"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app__taxa_da_analise: {
        Args: { p_sacado_cnpj: string }
        Returns: {
          origem: string
          taxa: number
        }[]
      }
      app__telefone_e164: { Args: { p: string }; Returns: string }
      app__uuid_ou_nulo: { Args: { p: string }; Returns: string }
      app__vinc_candidatas_nome: {
        Args: { p_limite: number; p_nome: string }
        Returns: {
          cnpj: string
          dominio: string
          empresa_id: string
          nome_fantasia: string
          razao_social: string
          uf: string
          valor: number
        }[]
      }
      app__vinc_candidatas_telefone: {
        Args: { p_digitos: string }
        Returns: {
          cnpj: string
          dominio: string
          empresa_id: string
          nome_fantasia: string
          razao_social: string
          uf: string
          valor: number
        }[]
      }
      app__vinc_candidatas_dominio: {
        Args: { p_dominio: string }
        Returns: {
          cnpj: string
          dominio: string
          empresa_id: string
          nome_fantasia: string
          razao_social: string
          uf: string
          valor: number
        }[]
      }
      app__vincular_notas_da_empresa: {
        Args: { p_cnpj: string; p_empresa: string }
        Returns: undefined
      }
      app__voz_enfileirar_mandato: {
        Args: { p: Json }
        Returns: {
          access_key: string | null
          agendada_para: string | null
          atualizada_em: string
          cancelada_em: string | null
          cancelada_por: string | null
          chamada_id: string | null
          comunicacao_id: string | null
          contato_id: string | null
          criada_em: string
          custo_centavos: number | null
          duracao_s: number | null
          empresa_id: string | null
          encerrada_em: string | null
          enfileirada_por: string | null
          enviada_em: string | null
          erro: string | null
          fornecedor_cnpj: string | null
          id: string
          id_externo: string
          iniciada_em: string | null
          ligacao_id: string | null
          links: Json | null
          mandato_id: string | null
          motivo_recusa: string | null
          objetivo: string
          origem: string
          outcome: string | null
          pedido: Json | null
          resultado: Json | null
          resumo: string | null
          status: string
          telefone: string | null
          tentativa: number
          tentativas: number
          transcricao: Json | null
          ultima_tentativa_em: string | null
          versao_api: string | null
        }
        SetofOptions: {
          from: "*"
          to: "voz_ligacoes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app__voz_portao: {
        Args: {
          p_access_key: string
          p_cnpj: string
          p_contato: string
          p_empresa: string
          p_telefone: string
        }
        Returns: string
      }
      app__voz_portao_mensagem: { Args: { p_motivo: string }; Returns: string }
      app__voz_registrar_resultado: {
        Args: { p: Json }
        Returns: {
          access_key: string | null
          agendada_para: string | null
          atualizada_em: string
          cancelada_em: string | null
          cancelada_por: string | null
          chamada_id: string | null
          comunicacao_id: string | null
          contato_id: string | null
          criada_em: string
          custo_centavos: number | null
          duracao_s: number | null
          empresa_id: string | null
          encerrada_em: string | null
          enfileirada_por: string | null
          enviada_em: string | null
          erro: string | null
          fornecedor_cnpj: string | null
          id: string
          id_externo: string
          iniciada_em: string | null
          ligacao_id: string | null
          links: Json | null
          mandato_id: string | null
          motivo_recusa: string | null
          objetivo: string
          origem: string
          outcome: string | null
          pedido: Json | null
          resultado: Json | null
          resumo: string | null
          status: string
          telefone: string | null
          tentativa: number
          tentativas: number
          transcricao: Json | null
          ultima_tentativa_em: string | null
          versao_api: string | null
        }
        SetofOptions: {
          from: "*"
          to: "voz_ligacoes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app__voz_resultado_para_mandato: {
        Args: {
          p: Json
          p_linha: Database["public"]["Tables"]["voz_ligacoes"]["Row"]
        }
        Returns: undefined
      }
      app__voz_varrer_orfas: {
        Args: { p_minutos: number }
        Returns: {
          id: string
          id_externo: string
          mandato_id: string
        }[]
      }
      app_agente_aceitar: {
        Args: { p: Json }
        Returns: {
          access_keys: string[]
          agendada_para: string | null
          anexos: Json
          assunto: string | null
          atualizada_em: string
          campanha_destinatario_id: string | null
          campanha_id: string | null
          canal: string
          comunicacao_id: string | null
          conversa_id: string | null
          corpo: string | null
          criada_em: string
          criada_por: string | null
          descartada_por: string | null
          destinatario: string | null
          destinatario_contato_id: string | null
          destinatario_ponto_focal: boolean
          empresa_id: string | null
          erro: string | null
          faixa: string | null
          forcar_janela: boolean
          fornecedor_cnpj: string | null
          fornecedor_empresa_id: string | null
          fornecedor_nome: string | null
          funil: string | null
          funil_card_id: string | null
          id: string
          mandato_acao_id: string | null
          mandato_id: string | null
          motivo_descarte: string | null
          oportunidades: string[] | null
          origem: string
          por_ia: boolean
          status: string
          template_id: string | null
          tentativas: number
          ultima_tentativa_em: string | null
          valor_total: number | null
          vendedor_id: string | null
          whatsapp_conta_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "mensagens_outbox"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_agente_descartar: { Args: { p: Json }; Returns: undefined }
      app_agentes_criar_mandato: {
        Args: { p: Json }
        Returns: {
          acoes_executadas: number
          agente_id: string
          assumido_por: string | null
          atualizado_em: string
          codigo: string | null
          contatos_tentados: Json
          criado_em: string
          criado_por: string | null
          empresa_id: string
          encerrado_em: string | null
          estado: string
          expira_em: string
          gasto_centavos: number
          id: string
          max_acoes: number
          motivo_encerramento: string | null
          nota_access_key: string | null
          objetivo: string
          orcamento_centavos: number
          origem: string
          pausado_motivo: string | null
          plano: Json | null
          plano_versao: number
          playbook_id: string | null
          prioridade: number
          proposta_id: string | null
          proxima_acao_em: string | null
          regra_id: string | null
          resultado: string | null
          reuniao_id: string | null
          sdr_lead_id: string | null
          tipo: string
          ultima_acao_em: string | null
          ultimo_ciclo_em: string | null
          ultimo_ciclo_erro: string | null
        }
        SetofOptions: {
          from: "*"
          to: "mandatos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_agentes_decidir_proposta: {
        Args: { p: Json }
        Returns: {
          agente_id: string
          criado_em: string
          decidido_em: string | null
          decidido_por: string | null
          empresa_id: string
          estado: string
          id: string
          justificativa: string
          mandato_criado_id: string | null
          mandato_origem_id: string
          motivo_recusa: string | null
          objetivo: string
          tipo: string
        }
        SetofOptions: {
          from: "*"
          to: "mandato_propostas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_agentes_desempenho: { Args: { p?: Json }; Returns: Json }
      app_agentes_exige_gestor: { Args: never; Returns: undefined }
      app_agentes_exige_modulo: { Args: never; Returns: undefined }
      app_agentes_gestor: { Args: never; Returns: boolean }
      app_agentes_ligar_regra: {
        Args: { p: Json }
        Returns: {
          agente_id: string | null
          ativa: boolean
          atualizada_em: string
          criada_em: string
          criada_por: string | null
          filtro: Json
          id: string
          max_acoes: number
          nome: string
          objetivo_template: string
          orcamento_centavos: number
          playbook_id: string | null
          prazo_dias: number
          prioridade: number
          teto_mandatos_ativos: number | null
          tipo_mandato: string
          ultima_avaliacao_em: string | null
          ultima_previa: Json | null
        }
        SetofOptions: {
          from: "*"
          to: "mandato_regras"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_agentes_mandato_acao: {
        Args: { p: Json }
        Returns: {
          acoes_executadas: number
          agente_id: string
          assumido_por: string | null
          atualizado_em: string
          codigo: string | null
          contatos_tentados: Json
          criado_em: string
          criado_por: string | null
          empresa_id: string
          encerrado_em: string | null
          estado: string
          expira_em: string
          gasto_centavos: number
          id: string
          max_acoes: number
          motivo_encerramento: string | null
          nota_access_key: string | null
          objetivo: string
          orcamento_centavos: number
          origem: string
          pausado_motivo: string | null
          plano: Json | null
          plano_versao: number
          playbook_id: string | null
          prioridade: number
          proposta_id: string | null
          proxima_acao_em: string | null
          regra_id: string | null
          resultado: string | null
          reuniao_id: string | null
          sdr_lead_id: string | null
          tipo: string
          ultima_acao_em: string | null
          ultimo_ciclo_em: string | null
          ultimo_ciclo_erro: string | null
        }
        SetofOptions: {
          from: "*"
          to: "mandatos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_agentes_pausar_agente: {
        Args: { p: Json }
        Returns: {
          ativo: boolean
          ausente_ate: string | null
          autonomo: boolean
          closer_id: string | null
          closer_substituto_id: string | null
          criado_em: string
          email_caixa_id: string | null
          email_remetente: string | null
          escopo: Json | null
          id: string
          is_ia: boolean
          limites: Json | null
          modo_rodagem: string
          nome: string
          pausado_em: string | null
          pausado_motivo: string | null
          persona: Json | null
          settings: Json
          superior_id: string | null
          tipo: string
          usuario_id: string | null
          voz_conta_id: string | null
          whatsapp_conta_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "vendedores"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_agentes_reabrir_disjuntor: {
        Args: { p: Json }
        Returns: {
          aberto_detalhe: Json | null
          aberto_em: string | null
          aberto_motivo: string | null
          agente_id: string
          avaliado_em: string | null
          estado: string
          janela_acoes: number
          janela_desde: string
          limiar_escalacao: number
          limiar_falha_tecnica: number
          limiar_sem_interesse: number
          limiar_supressao: number
          reaberto_em: string | null
          reaberto_por: string | null
        }
        SetofOptions: {
          from: "*"
          to: "agentes_disjuntor"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_agentes_registrar_previa: { Args: { p: Json }; Returns: undefined }
      app_agentes_salvar_caixa: {
        Args: { p: Json }
        Returns: {
          access_token_expira_em: string | null
          access_token_secret_id: string | null
          ativa: boolean
          conectada_em: string | null
          conectada_por: string | null
          criada_em: string
          endereco: string
          escopos: string[]
          history_id: string | null
          id: string
          identificador_externo: string | null
          provedor: string
          refresh_token_secret_id: string | null
          ultimo_erro: string | null
          ultimo_sync_em: string | null
          watch_expira_em: string | null
        }
        SetofOptions: {
          from: "*"
          to: "email_caixas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_agentes_salvar_config: {
        Args: { p: Json }
        Returns: {
          atualizado_em: string
          atualizado_por: string | null
          chave: string
          valor: Json
        }
        SetofOptions: {
          from: "*"
          to: "agentes_config"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_agentes_salvar_disjuntor: {
        Args: { p: Json }
        Returns: {
          aberto_detalhe: Json | null
          aberto_em: string | null
          aberto_motivo: string | null
          agente_id: string
          avaliado_em: string | null
          estado: string
          janela_acoes: number
          janela_desde: string
          limiar_escalacao: number
          limiar_falha_tecnica: number
          limiar_sem_interesse: number
          limiar_supressao: number
          reaberto_em: string | null
          reaberto_por: string | null
        }
        SetofOptions: {
          from: "*"
          to: "agentes_disjuntor"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_agentes_salvar_material: {
        Args: { p: Json }
        Returns: {
          arquivo_path: string | null
          ativo: boolean
          atualizado_em: string
          canais: string[]
          corpo: string | null
          criado_em: string
          criado_por: string | null
          descricao: string
          id: string
          nome: string
          quando_usar: string
          tags: string[]
          tipo: string
          url: string | null
          vezes_usado: number
        }
        SetofOptions: {
          from: "*"
          to: "materiais"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_agentes_salvar_persona: {
        Args: { p: Json }
        Returns: {
          ativo: boolean
          ausente_ate: string | null
          autonomo: boolean
          closer_id: string | null
          closer_substituto_id: string | null
          criado_em: string
          email_caixa_id: string | null
          email_remetente: string | null
          escopo: Json | null
          id: string
          is_ia: boolean
          limites: Json | null
          modo_rodagem: string
          nome: string
          pausado_em: string | null
          pausado_motivo: string | null
          persona: Json | null
          settings: Json
          superior_id: string | null
          tipo: string
          usuario_id: string | null
          voz_conta_id: string | null
          whatsapp_conta_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "vendedores"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_agentes_salvar_regra: {
        Args: { p: Json }
        Returns: {
          agente_id: string | null
          ativa: boolean
          atualizada_em: string
          criada_em: string
          criada_por: string | null
          filtro: Json
          id: string
          max_acoes: number
          nome: string
          objetivo_template: string
          orcamento_centavos: number
          playbook_id: string | null
          prazo_dias: number
          prioridade: number
          teto_mandatos_ativos: number | null
          tipo_mandato: string
          ultima_avaliacao_em: string | null
          ultima_previa: Json | null
        }
        SetofOptions: {
          from: "*"
          to: "mandato_regras"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_agentes_visiveis: { Args: never; Returns: string[] }
      app_ajuste_manual_comissao: {
        Args: { p: Json }
        Returns: {
          anticipation_days: number | null
          aprovado_em: string | null
          aprovado_por: string | null
          cedente_cnpj: string | null
          cedente_nome: string | null
          competencia: string
          criado_em: string
          descricao: string | null
          empresa_id: string | null
          evento_em: string
          fase: string | null
          gestao_operacao: string | null
          id: string
          nf_numero: string | null
          origem_id: string
          origem_tipo: string
          papel: string
          params_snapshot: Json
          share_pct: number
          status: string
          taxa_brl_por_mm: number | null
          valor: number
          valor_cedido: number | null
          vendedor_id: string
          vop: number | null
        }
        SetofOptions: {
          from: "*"
          to: "comissao_lancamentos_v2"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_ano_referencia_metrica: {
        Args: { p_capturado: string; p_detalhes: Json; p_origem: string }
        Returns: number
      }
      app_apagar_estimativas_do_ano: {
        Args: { p_ano: number; p_cnpj: string; p_metrica: string }
        Returns: number
      }
      app_aprovar_campanha: {
        Args: { p: Json }
        Returns: {
          aprovada_em: string | null
          aprovada_por: string | null
          atualizada_em: string
          canal: string
          concluida_em: string | null
          contas_remetentes: string[]
          criada_em: string
          criada_por: string | null
          definicao_filtro: Json | null
          empresas_manuais: string[]
          excluir_contatados_dias: number
          excluir_conversa_aberta: boolean
          id: string
          inicio_em: string | null
          modo_agente_ao_responder: string
          nome: string
          objetivo: string | null
          origem_publico: string
          pausa_motivo: string | null
          preset: string | null
          preset_params: Json
          respeitar_janela: boolean
          ritmo_por_dia: number
          segmento_id: string | null
          simulacao: Json | null
          simulada_em: string | null
          status: string
          tipo: string
          variantes: Json
          vendedor_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "campanhas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_aprovar_lote: {
        Args: { p: Json }
        Returns: {
          aprovado_em: string | null
          aprovado_por: string | null
          atualizado_em: string
          concluido_em: string | null
          criado_em: string
          criado_por: string | null
          custo_estimado_esperado: number | null
          custo_estimado_min: number | null
          custo_real: number
          definicao_filtro: Json
          id: string
          nome: string | null
          parametros: Json
          status: string
          tipo: string
          total_itens: number | null
        }
        SetofOptions: {
          from: "*"
          to: "lotes_enriquecimento"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_aprovar_mensagem: {
        Args: { p: Json }
        Returns: {
          access_keys: string[]
          agendada_para: string | null
          anexos: Json
          assunto: string | null
          atualizada_em: string
          campanha_destinatario_id: string | null
          campanha_id: string | null
          canal: string
          comunicacao_id: string | null
          conversa_id: string | null
          corpo: string | null
          criada_em: string
          criada_por: string | null
          descartada_por: string | null
          destinatario: string | null
          destinatario_contato_id: string | null
          destinatario_ponto_focal: boolean
          empresa_id: string | null
          erro: string | null
          faixa: string | null
          forcar_janela: boolean
          fornecedor_cnpj: string | null
          fornecedor_empresa_id: string | null
          fornecedor_nome: string | null
          funil: string | null
          funil_card_id: string | null
          id: string
          mandato_acao_id: string | null
          mandato_id: string | null
          motivo_descarte: string | null
          oportunidades: string[] | null
          origem: string
          por_ia: boolean
          status: string
          template_id: string | null
          tentativas: number
          ultima_tentativa_em: string | null
          valor_total: number | null
          vendedor_id: string | null
          whatsapp_conta_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "mensagens_outbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      app_arredondar_limite_sugerido: {
        Args: { p_valor: number }
        Returns: number
      }
      app_ativar_camada_regra: {
        Args: { p: Json }
        Returns: {
          ativa: boolean
          camada: string
          criada_em: string
          criada_por: string | null
          definicao: Json
          id: string
          versao: number
        }
        SetofOptions: {
          from: "*"
          to: "camada_regras"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_ativar_faixa_regra: {
        Args: { p: Json }
        Returns: {
          ativa: boolean
          criada_em: string
          criada_por: string | null
          definicao: Json
          faixa: string
          id: string
          versao: number
        }
        SetofOptions: {
          from: "*"
          to: "faixa_regras"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_ativar_matriz_precificacao: {
        Args: { p: Json }
        Returns: {
          ativa: boolean
          criada_em: string
          criada_por: string | null
          definicao: Json
          versao: number
        }
        SetofOptions: {
          from: "*"
          to: "precificacao_matriz"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_ativar_scorecard_versao: {
        Args: { p: Json }
        Returns: {
          ativa: boolean
          criada_em: string
          criada_por: string | null
          definicao: Json
          id: string
          nome: string | null
          versao: number
        }
        SetofOptions: {
          from: "*"
          to: "scorecard_versoes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_atribuir_lead_sdr: { Args: { p: Json }; Returns: Json }
      app_atribuir_nf: { Args: { p: Json }; Returns: undefined }
      app_atribuir_venda: { Args: { p: Json }; Returns: Json }
      app_atualizar_empresa: {
        Args: { p: Json }
        Returns: {
          atualizado_em: string
          bloqueio_cobranca: boolean
          bloqueio_cobranca_cobranca_id: string | null
          bloqueio_cobranca_em: string | null
          bloqueio_cobranca_motivo: string | null
          camada: string | null
          chance_concessao: number | null
          churn_erp_concorrente: boolean
          cnae_principal: string | null
          cnpj: string
          credito_calculado_em: string | null
          credito_revisao_desde: string | null
          credito_revisao_pos_inadimplencia: boolean
          credito_versao: number | null
          criado_em: string
          dados_apollo: Json | null
          dominio: string | null
          dominio_confianca: string | null
          dominio_evidencia: string | null
          dominio_origem: string | null
          dominio_validado_em: string | null
          erp_atual: string | null
          erp_canal_venda: string | null
          erp_detalhes: Json
          erp_mrr: number | null
          estagio: string
          ex_cliente_desde: string | null
          ex_cliente_motivo: string | null
          ex_cliente_motivo_obs: string | null
          fase_manual: string | null
          faturamento_anual: number | null
          faturamento_atualizado_em: string | null
          faturamento_confianca: string | null
          faturamento_origem: string | null
          funcionarios: number | null
          funcionarios_atualizado_em: string | null
          funcionarios_crescimento_12m: number | null
          funcionarios_origem: string | null
          gestao_definida_em: string | null
          gestao_definida_por: string | null
          gestao_operacao: string | null
          grafo_sefaz: boolean
          grupo_id: string | null
          id: string
          is_spe: boolean
          limite_confianca: string | null
          limite_potencial: number | null
          marco_ativacao: string | null
          municipio: string | null
          nome_fantasia: string | null
          origem: string | null
          patrimonio_atualizado_em: string | null
          patrimonio_liquido: number | null
          patrimonio_origem: string | null
          porte: string | null
          razao_social: string | null
          receita_mensal_prevista: number | null
          receita_taxa_am: number | null
          regime_tributario: string | null
          score_calculado_em: string | null
          score_completude: number | null
          score_credito: number | null
          score_faixa: string | null
          tem_processo_nosso_ativo: boolean
          teve_analise_sem_cadastro: boolean
          tipagem_antecipacao: string | null
          tipo: string
          uf: string | null
          ultima_antecipacao: string | null
          ultima_conversa_em: string | null
          valor_esperado_mensal: number | null
        }
        SetofOptions: {
          from: "*"
          to: "empresas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_auxiliar_de_closer: { Args: never; Returns: boolean }
      app_buscar_candidatos_universo: {
        Args: { p: Json }
        Returns: {
          cnpj: string
          municipio: string
          nome_fantasia: string
          razao_social: string
          situacao_cadastral: string
          uf: string
        }[]
      }
      app_campanha_definir_status: {
        Args: { p: Json }
        Returns: {
          aprovada_em: string | null
          aprovada_por: string | null
          atualizada_em: string
          canal: string
          concluida_em: string | null
          contas_remetentes: string[]
          criada_em: string
          criada_por: string | null
          definicao_filtro: Json | null
          empresas_manuais: string[]
          excluir_contatados_dias: number
          excluir_conversa_aberta: boolean
          id: string
          inicio_em: string | null
          modo_agente_ao_responder: string
          nome: string
          objetivo: string | null
          origem_publico: string
          pausa_motivo: string | null
          preset: string | null
          preset_params: Json
          respeitar_janela: boolean
          ritmo_por_dia: number
          segmento_id: string | null
          simulacao: Json | null
          simulada_em: string | null
          status: string
          tipo: string
          variantes: Json
          vendedor_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "campanhas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_campanha_metricas: { Args: { p: Json }; Returns: Json }
      app_campanha_pode_gerir: { Args: never; Returns: boolean }
      app_campanha_registrar_simulacao: {
        Args: { p: Json }
        Returns: {
          aprovada_em: string | null
          aprovada_por: string | null
          atualizada_em: string
          canal: string
          concluida_em: string | null
          contas_remetentes: string[]
          criada_em: string
          criada_por: string | null
          definicao_filtro: Json | null
          empresas_manuais: string[]
          excluir_contatados_dias: number
          excluir_conversa_aberta: boolean
          id: string
          inicio_em: string | null
          modo_agente_ao_responder: string
          nome: string
          objetivo: string | null
          origem_publico: string
          pausa_motivo: string | null
          preset: string | null
          preset_params: Json
          respeitar_janela: boolean
          ritmo_por_dia: number
          segmento_id: string | null
          simulacao: Json | null
          simulada_em: string | null
          status: string
          tipo: string
          variantes: Json
          vendedor_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "campanhas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_cancelar_campanha: {
        Args: { p: Json }
        Returns: {
          aprovada_em: string | null
          aprovada_por: string | null
          atualizada_em: string
          canal: string
          concluida_em: string | null
          contas_remetentes: string[]
          criada_em: string
          criada_por: string | null
          definicao_filtro: Json | null
          empresas_manuais: string[]
          excluir_contatados_dias: number
          excluir_conversa_aberta: boolean
          id: string
          inicio_em: string | null
          modo_agente_ao_responder: string
          nome: string
          objetivo: string | null
          origem_publico: string
          pausa_motivo: string | null
          preset: string | null
          preset_params: Json
          respeitar_janela: boolean
          ritmo_por_dia: number
          segmento_id: string | null
          simulacao: Json | null
          simulada_em: string | null
          status: string
          tipo: string
          variantes: Json
          vendedor_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "campanhas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_cancelar_lote: {
        Args: { p: Json }
        Returns: {
          aprovado_em: string | null
          aprovado_por: string | null
          atualizado_em: string
          concluido_em: string | null
          criado_em: string
          criado_por: string | null
          custo_estimado_esperado: number | null
          custo_estimado_min: number | null
          custo_real: number
          definicao_filtro: Json
          id: string
          nome: string | null
          parametros: Json
          status: string
          tipo: string
          total_itens: number | null
        }
        SetofOptions: {
          from: "*"
          to: "lotes_enriquecimento"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_carteira_empresas: { Args: never; Returns: string[] }
      app_casar_antecipacao: {
        Args: { p: Json }
        Returns: {
          access_key_casada: string | null
          anticipation_days: number | null
          anticipation_type: string | null
          approval_with_automation: boolean | null
          atualizada_em: string
          completion_date: string | null
          convertida_em: string | null
          created_at_plataforma: string | null
          discounted_amount: number | null
          document_number: string | null
          fornecedor_cnpj: string
          fornecedor_nome: string | null
          gross_value: number | null
          id_externo: number
          invoice_cancelled_at: string | null
          match_candidatas: Json
          match_confianca: string | null
          match_em: string | null
          match_motivo: string | null
          match_observacao: string | null
          match_por: string | null
          match_status: string
          monthly_interest_rate: number | null
          net_value: number | null
          numero_normalizado: string | null
          original_due_date: string | null
          raw: Json | null
          regrediu_em: string | null
          request_date: string | null
          sacado_cnpj: string
          sacado_nome: string | null
          sem_nf_definitivo_em: string | null
          sincronizada_em: string
          status: string
          status_anterior: string | null
          total_spread: number | null
          withhold_tax: number | null
        }
        SetofOptions: {
          from: "*"
          to: "antecipacoes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_cnpjs_em_cobranca: { Args: never; Returns: string[] }
      app_cobranca_aceitar_aviso_apolice: {
        Args: { p: Json }
        Returns: {
          aceite_apolice_em: string | null
          aceite_apolice_por: string | null
          codigo: string | null
          convertida_em_processo_em: string | null
          criada_em: string
          criada_por: string | null
          data_base: string | null
          encerrada_em: string | null
          escopo_notificacao: string
          estagio: string
          honorarios_pct: number | null
          id: string
          indice_correcao: string | null
          juros_mora_mes: number | null
          juros_pro_rata: boolean
          motivo_encerramento: string | null
          multa_pct: number | null
          notificada_em: string | null
          notificar_matriz_cedente: boolean
          observacoes: string | null
          processo_cnj: string | null
          responsavel_id: string | null
          sacado_empresa_id: string | null
          sacado_matriz_cnpj: string
          valor_atualizado: number | null
          valor_atualizado_em: string | null
        }
        SetofOptions: {
          from: "*"
          to: "cobrancas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_cobranca_anexar_acordo_assinado: {
        Args: { p: Json }
        Returns: {
          cobranca_id: string
          criado_em: string
          criado_por: string | null
          dados_minuta: Json
          documento_assinado_path: string | null
          entrada: number
          id: string
          juros_parcelamento_mes: number
          memoria_calculo: Json
          minuta_hash: string | null
          minuta_path: string | null
          modelo_minuta_id: string | null
          parcelas: Json
          periodicidade: string
          primeira_parcela: string | null
          qtd_parcelas: number
          sistema: string
          status: string
          valor_atualizado: number
          valor_total_projetado: number | null
        }
        SetofOptions: {
          from: "*"
          to: "acordos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_cobranca_arquivar_modelo: { Args: { p: Json }; Returns: undefined }
      app_cobranca_atualizar: {
        Args: { p: Json }
        Returns: {
          aceite_apolice_em: string | null
          aceite_apolice_por: string | null
          codigo: string | null
          convertida_em_processo_em: string | null
          criada_em: string
          criada_por: string | null
          data_base: string | null
          encerrada_em: string | null
          escopo_notificacao: string
          estagio: string
          honorarios_pct: number | null
          id: string
          indice_correcao: string | null
          juros_mora_mes: number | null
          juros_pro_rata: boolean
          motivo_encerramento: string | null
          multa_pct: number | null
          notificada_em: string | null
          notificar_matriz_cedente: boolean
          observacoes: string | null
          processo_cnj: string | null
          responsavel_id: string | null
          sacado_empresa_id: string | null
          sacado_matriz_cnpj: string
          valor_atualizado: number | null
          valor_atualizado_em: string | null
        }
        SetofOptions: {
          from: "*"
          to: "cobrancas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_cobranca_cadastro: {
        Args: { p_cnpjs: string[] }
        Returns: {
          bairro: string | null
          cep: string | null
          cnpj: string
          empresa_id: string | null
          logradouro: string | null
          municipio: string | null
          numero: string | null
          razao_social: string | null
          uf: string | null
        }[]
      }
      app_cobranca_cancelar_acordo: {
        Args: { p: Json }
        Returns: {
          cobranca_id: string
          criado_em: string
          criado_por: string | null
          dados_minuta: Json
          documento_assinado_path: string | null
          entrada: number
          id: string
          juros_parcelamento_mes: number
          memoria_calculo: Json
          minuta_hash: string | null
          minuta_path: string | null
          modelo_minuta_id: string | null
          parcelas: Json
          periodicidade: string
          primeira_parcela: string | null
          qtd_parcelas: number
          sistema: string
          status: string
          valor_atualizado: number
          valor_total_projetado: number | null
        }
        SetofOptions: {
          from: "*"
          to: "acordos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_cobranca_criar: {
        Args: { p: Json }
        Returns: {
          aceite_apolice_em: string | null
          aceite_apolice_por: string | null
          codigo: string | null
          convertida_em_processo_em: string | null
          criada_em: string
          criada_por: string | null
          data_base: string | null
          encerrada_em: string | null
          escopo_notificacao: string
          estagio: string
          honorarios_pct: number | null
          id: string
          indice_correcao: string | null
          juros_mora_mes: number | null
          juros_pro_rata: boolean
          motivo_encerramento: string | null
          multa_pct: number | null
          notificada_em: string | null
          notificar_matriz_cedente: boolean
          observacoes: string | null
          processo_cnj: string | null
          responsavel_id: string | null
          sacado_empresa_id: string | null
          sacado_matriz_cnpj: string
          valor_atualizado: number | null
          valor_atualizado_em: string | null
        }
        SetofOptions: {
          from: "*"
          to: "cobrancas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_cobranca_criar_processo: {
        Args: { p: Json }
        Returns: {
          aceite_apolice_em: string | null
          aceite_apolice_por: string | null
          codigo: string | null
          convertida_em_processo_em: string | null
          criada_em: string
          criada_por: string | null
          data_base: string | null
          encerrada_em: string | null
          escopo_notificacao: string
          estagio: string
          honorarios_pct: number | null
          id: string
          indice_correcao: string | null
          juros_mora_mes: number | null
          juros_pro_rata: boolean
          motivo_encerramento: string | null
          multa_pct: number | null
          notificada_em: string | null
          notificar_matriz_cedente: boolean
          observacoes: string | null
          processo_cnj: string | null
          responsavel_id: string | null
          sacado_empresa_id: string | null
          sacado_matriz_cnpj: string
          valor_atualizado: number | null
          valor_atualizado_em: string | null
        }
        SetofOptions: {
          from: "*"
          to: "cobrancas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_cobranca_dados_minuta: {
        Args: { p: Json }
        Returns: {
          cobranca_id: string
          criado_em: string
          criado_por: string | null
          dados_minuta: Json
          documento_assinado_path: string | null
          entrada: number
          id: string
          juros_parcelamento_mes: number
          memoria_calculo: Json
          minuta_hash: string | null
          minuta_path: string | null
          modelo_minuta_id: string | null
          parcelas: Json
          periodicidade: string
          primeira_parcela: string | null
          qtd_parcelas: number
          sistema: string
          status: string
          valor_atualizado: number
          valor_total_projetado: number | null
        }
        SetofOptions: {
          from: "*"
          to: "acordos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_cobranca_definir_config: {
        Args: { p: Json }
        Returns: {
          atualizado_em: string
          atualizado_por: string | null
          chave: string
          valor: Json
        }
        SetofOptions: {
          from: "*"
          to: "cobranca_config"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_cobranca_editar_notificacao: {
        Args: { p: Json }
        Returns: {
          cobranca_id: string
          destinatario_cnpj: string
          destinatario_empresa_id: string | null
          destinatario_endereco: Json | null
          destinatario_razao_social: string
          documento_hash: string | null
          documento_path: string | null
          enviada_em: string | null
          gerada_em: string
          id: string
          memoria_calculo: Json | null
          modelo_id: string | null
          papel: string
          prazo_expira_em: string | null
          prazo_pagamento_dias: number
          qtd_titulos: number
          rodada: number
          status: string
          valor_total: number
          valor_total_atualizado: number | null
        }
        SetofOptions: {
          from: "*"
          to: "cobranca_notificacoes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_cobranca_enviar_notificacao: {
        Args: { p: Json }
        Returns: {
          canal: string
          codigo_rastreio: string | null
          comprovante_path: string | null
          comunicacao_id: string | null
          confirmado_em: string | null
          contato_id: string | null
          criado_em: string
          criado_por: string | null
          destino: string | null
          enviado_em: string | null
          id: string
          notificacao_id: string
          observacao: string | null
          outbox_id: string | null
          status: string
        }[]
        SetofOptions: {
          from: "*"
          to: "cobranca_notificacao_entregas"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      app_cobranca_exige_gestor: { Args: never; Returns: undefined }
      app_cobranca_exige_modulo: { Args: never; Returns: undefined }
      app_cobranca_gestor: { Args: never; Returns: boolean }
      app_cobranca_mover_estagio: {
        Args: { p: Json }
        Returns: {
          aceite_apolice_em: string | null
          aceite_apolice_por: string | null
          codigo: string | null
          convertida_em_processo_em: string | null
          criada_em: string
          criada_por: string | null
          data_base: string | null
          encerrada_em: string | null
          escopo_notificacao: string
          estagio: string
          honorarios_pct: number | null
          id: string
          indice_correcao: string | null
          juros_mora_mes: number | null
          juros_pro_rata: boolean
          motivo_encerramento: string | null
          multa_pct: number | null
          notificada_em: string | null
          notificar_matriz_cedente: boolean
          observacoes: string | null
          processo_cnj: string | null
          responsavel_id: string | null
          sacado_empresa_id: string | null
          sacado_matriz_cnpj: string
          valor_atualizado: number | null
          valor_atualizado_em: string | null
        }
        SetofOptions: {
          from: "*"
          to: "cobrancas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_cobranca_painel: { Args: never; Returns: Json }
      app_cobranca_quitar_titulo: {
        Args: { p: Json }
        Returns: {
          cedente_cnpj_snapshot: string
          cobranca_id: string
          dias_atraso_snapshot: number
          id: string
          quitado_em: string | null
          quitado_origem: string | null
          sacado_cnpj_snapshot: string
          situacao: string
          titulo_id: string
          valor_cedido_snapshot: number | null
          valor_face_snapshot: number
          valor_recebido: number | null
          vencimento_snapshot: string
        }
        SetofOptions: {
          from: "*"
          to: "cobranca_titulos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_cobranca_registrar_entrega: {
        Args: { p: Json }
        Returns: {
          canal: string
          codigo_rastreio: string | null
          comprovante_path: string | null
          comunicacao_id: string | null
          confirmado_em: string | null
          contato_id: string | null
          criado_em: string
          criado_por: string | null
          destino: string | null
          enviado_em: string | null
          id: string
          notificacao_id: string
          observacao: string | null
          outbox_id: string | null
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "cobranca_notificacao_entregas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_cobranca_registrar_insolvencia: {
        Args: { p: Json }
        Returns: {
          confirmada: boolean
          criado_em: string
          criado_por: string | null
          data_decisao: string
          fonte: string
          id: string
          numero_cnj: string | null
          observacao: string | null
          sacado_matriz_cnpj: string
          tipo: string
        }
        SetofOptions: {
          from: "*"
          to: "cobranca_insolvencias"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_cobranca_registrar_interacao: {
        Args: { p: Json }
        Returns: {
          cobranca_id: string
          criado_em: string
          id: string
          ocorrida_em: string
          resumo: string
          tipo: string
          usuario_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "cobranca_interacoes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_cobranca_reconciliacao: {
        Args: { p_matrizes?: string[] | null }
        Returns: {
          a_vencer: number
          aberto: number
          consumido: number | null
          consumido_em: string | null
          qtd_vencidos: number
          sacado_matriz_cnpj: string
          situacao: string
          vencido: number
          vencido_estimado: number | null
        }[]
      }
      app_cobranca_regularizar_sacado: { Args: { p: Json }; Returns: Json }
      app_cobranca_retirar_titulo: {
        Args: { p: Json }
        Returns: {
          cedente_cnpj_snapshot: string
          cobranca_id: string
          dias_atraso_snapshot: number
          id: string
          quitado_em: string | null
          quitado_origem: string | null
          sacado_cnpj_snapshot: string
          situacao: string
          titulo_id: string
          valor_cedido_snapshot: number | null
          valor_face_snapshot: number
          valor_recebido: number | null
          vencimento_snapshot: string
        }
        SetofOptions: {
          from: "*"
          to: "cobranca_titulos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_cobranca_sacado_bloqueado: {
        Args: { p_cnpj: string }
        Returns: boolean
      }
      app_cobranca_salvar_acordo: {
        Args: { p: Json }
        Returns: {
          cobranca_id: string
          criado_em: string
          criado_por: string | null
          dados_minuta: Json
          documento_assinado_path: string | null
          entrada: number
          id: string
          juros_parcelamento_mes: number
          memoria_calculo: Json
          minuta_hash: string | null
          minuta_path: string | null
          modelo_minuta_id: string | null
          parcelas: Json
          periodicidade: string
          primeira_parcela: string | null
          qtd_parcelas: number
          sistema: string
          status: string
          valor_atualizado: number
          valor_total_projetado: number | null
        }
        SetofOptions: {
          from: "*"
          to: "acordos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_cobranca_salvar_apolice: {
        Args: { p: Json }
        Returns: {
          ativa: boolean
          atualizado_em: string
          criado_em: string
          franquia: number
          id: string
          numero: string
          percentagem_segurada: number
          periodo_espera_dias: number
          periodo_max_prorrogacao_dias: number
          prazo_documentos_complementares_dias: number
          prazo_envio_sinistro_meses: number
          prazo_maximo_credito_dias: number
          prazo_notificacao_apos_prorrogacao_dias: number
          responsabilidade_maxima: number | null
          segurado_cnpj: string
          seguradora: string
          vigencia_fim: string
          vigencia_inicio: string
        }
        SetofOptions: {
          from: "*"
          to: "apolices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_cobranca_salvar_modelo: {
        Args: { p: Json }
        Returns: {
          ativo: boolean
          corpo_markdown: string
          criado_em: string
          criado_por: string | null
          familia_id: string
          id: string
          nome: string
          tipo: string
          versao: number
        }
        SetofOptions: {
          from: "*"
          to: "cobranca_modelos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_cobranca_salvar_notificacoes: {
        Args: { p: Json }
        Returns: {
          cobranca_id: string
          destinatario_cnpj: string
          destinatario_empresa_id: string | null
          destinatario_endereco: Json | null
          destinatario_razao_social: string
          documento_hash: string | null
          documento_path: string | null
          enviada_em: string | null
          gerada_em: string
          id: string
          memoria_calculo: Json | null
          modelo_id: string | null
          papel: string
          prazo_expira_em: string | null
          prazo_pagamento_dias: number
          qtd_titulos: number
          rodada: number
          status: string
          valor_total: number
          valor_total_atualizado: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "cobranca_notificacoes"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      app_cobranca_vincular_processo: {
        Args: { p: Json }
        Returns: {
          aceite_apolice_em: string | null
          aceite_apolice_por: string | null
          codigo: string | null
          convertida_em_processo_em: string | null
          criada_em: string
          criada_por: string | null
          data_base: string | null
          encerrada_em: string | null
          escopo_notificacao: string
          estagio: string
          honorarios_pct: number | null
          id: string
          indice_correcao: string | null
          juros_mora_mes: number | null
          juros_pro_rata: boolean
          motivo_encerramento: string | null
          multa_pct: number | null
          notificada_em: string | null
          notificar_matriz_cedente: boolean
          observacoes: string | null
          processo_cnj: string | null
          responsavel_id: string | null
          sacado_empresa_id: string | null
          sacado_matriz_cnpj: string
          valor_atualizado: number | null
          valor_atualizado_em: string | null
        }
        SetofOptions: {
          from: "*"
          to: "cobrancas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_competencia_fechada: { Args: { p_data: string }; Returns: boolean }
      app_comunicacao_atividade: { Args: { p: Json }; Returns: Json }
      app_comunicacao_atividade_series: { Args: { p: Json }; Returns: Json }
      app_comunicacao_enfileirar: {
        Args: { p: Json }
        Returns: {
          access_keys: string[]
          agendada_para: string | null
          anexos: Json
          assunto: string | null
          atualizada_em: string
          campanha_destinatario_id: string | null
          campanha_id: string | null
          canal: string
          comunicacao_id: string | null
          conversa_id: string | null
          corpo: string | null
          criada_em: string
          criada_por: string | null
          descartada_por: string | null
          destinatario: string | null
          destinatario_contato_id: string | null
          destinatario_ponto_focal: boolean
          empresa_id: string | null
          erro: string | null
          faixa: string | null
          forcar_janela: boolean
          fornecedor_cnpj: string | null
          fornecedor_empresa_id: string | null
          fornecedor_nome: string | null
          funil: string | null
          funil_card_id: string | null
          id: string
          mandato_acao_id: string | null
          mandato_id: string | null
          motivo_descarte: string | null
          oportunidades: string[] | null
          origem: string
          por_ia: boolean
          status: string
          template_id: string | null
          tentativas: number
          ultima_tentativa_em: string | null
          valor_total: number | null
          vendedor_id: string | null
          whatsapp_conta_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "mensagens_outbox"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_concluir_analise: {
        Args: { p: Json }
        Returns: {
          analise_propria_id: string | null
          atradius_buyer_id: string | null
          atradius_case_id: string | null
          atualizada_em: string
          cnpj: string
          codigo_decisao: string | null
          codigo_historico: string | null
          contato_externo: Json | null
          criada_em: string
          decidida_em: string | null
          decisao_interna: string | null
          decisao_interna_em: string | null
          empresa_id: string | null
          envio_manual_em: string | null
          envio_manual_por: string | null
          estagio: string
          expira_em: string | null
          expirada_em: string | null
          external_id: string | null
          id: string
          limite_aprovado: number | null
          limite_operacional: number | null
          limite_solicitado: number | null
          moeda: string
          motivo: string | null
          observacoes: string | null
          origem: string
          origem_externa: string | null
          origem_motivo: string | null
          rating_classe_seguradora: string | null
          rating_seguradora: string | null
          seguradora: string
          solicitada_por: string | null
          substituida_em: string | null
          substituida_por: string | null
        }
        SetofOptions: {
          from: "*"
          to: "analises_credito"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_contas_dos_sacados: {
        Args: { p_cnpjs: string[] }
        Returns: {
          cnpj: string
          conta_cnpj: string
          conta_fantasia: string
          conta_id: string
          conta_nome: string
        }[]
      }
      app_conversa_definir_modo: {
        Args: { p: Json }
        Returns: {
          atualizada_em: string
          canal: string
          conta_remetente: string | null
          contato_id: string | null
          criada_em: string
          empresa_id: string | null
          id: string
          identificador_externo: string
          lid: string | null
          modo_agente: string
          nao_lidas: number
          objetivo: string | null
          playbook_id: string | null
          proxima_acao_em: string | null
          responsavel_vendedor_id: string | null
          status: string
          ultima_direcao: string | null
          ultima_mensagem_em: string | null
        }
        SetofOptions: {
          from: "*"
          to: "conversas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_conversa_ignorar: { Args: { p: Json }; Returns: undefined }
      app_conversa_marcar_lida: { Args: { p: Json }; Returns: undefined }
      app_conversa_ocultar: { Args: { p: Json }; Returns: undefined }
      app_conversa_reabrir: { Args: { p: Json }; Returns: undefined }
      app_conversa_reexibir: { Args: { p: Json }; Returns: undefined }
      app_conversa_vincular: {
        Args: { p: Json }
        Returns: {
          atualizada_em: string
          canal: string
          conta_remetente: string | null
          contato_id: string | null
          criada_em: string
          empresa_id: string | null
          id: string
          identificador_externo: string
          lid: string | null
          modo_agente: string
          nao_lidas: number
          objetivo: string | null
          playbook_id: string | null
          proxima_acao_em: string | null
          responsavel_vendedor_id: string | null
          status: string
          ultima_direcao: string | null
          ultima_mensagem_em: string | null
        }
        SetofOptions: {
          from: "*"
          to: "conversas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_conversas_ocultas: { Args: never; Returns: Json }
      app_credito_realimentar_faturamento: {
        Args: { p_analise_id: string }
        Returns: Json
      }
      app_criar_api_key: {
        Args: { p: Json }
        Returns: {
          ativa: boolean
          criada_em: string
          criada_por: string | null
          escopos: string[]
          id: string
          key_hash: string
          nome: string
          prefixo: string
          revogada_em: string | null
          ultimo_uso_em: string | null
        }
        SetofOptions: {
          from: "*"
          to: "api_keys"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_criar_empresa: {
        Args: { p: Json }
        Returns: {
          atualizado_em: string
          bloqueio_cobranca: boolean
          bloqueio_cobranca_cobranca_id: string | null
          bloqueio_cobranca_em: string | null
          bloqueio_cobranca_motivo: string | null
          camada: string | null
          chance_concessao: number | null
          churn_erp_concorrente: boolean
          cnae_principal: string | null
          cnpj: string
          credito_calculado_em: string | null
          credito_revisao_desde: string | null
          credito_revisao_pos_inadimplencia: boolean
          credito_versao: number | null
          criado_em: string
          dados_apollo: Json | null
          dominio: string | null
          dominio_confianca: string | null
          dominio_evidencia: string | null
          dominio_origem: string | null
          dominio_validado_em: string | null
          erp_atual: string | null
          erp_canal_venda: string | null
          erp_detalhes: Json
          erp_mrr: number | null
          estagio: string
          ex_cliente_desde: string | null
          ex_cliente_motivo: string | null
          ex_cliente_motivo_obs: string | null
          fase_manual: string | null
          faturamento_anual: number | null
          faturamento_atualizado_em: string | null
          faturamento_confianca: string | null
          faturamento_origem: string | null
          funcionarios: number | null
          funcionarios_atualizado_em: string | null
          funcionarios_crescimento_12m: number | null
          funcionarios_origem: string | null
          gestao_definida_em: string | null
          gestao_definida_por: string | null
          gestao_operacao: string | null
          grafo_sefaz: boolean
          grupo_id: string | null
          id: string
          is_spe: boolean
          limite_confianca: string | null
          limite_potencial: number | null
          marco_ativacao: string | null
          municipio: string | null
          nome_fantasia: string | null
          origem: string | null
          patrimonio_atualizado_em: string | null
          patrimonio_liquido: number | null
          patrimonio_origem: string | null
          porte: string | null
          razao_social: string | null
          receita_mensal_prevista: number | null
          receita_taxa_am: number | null
          regime_tributario: string | null
          score_calculado_em: string | null
          score_completude: number | null
          score_credito: number | null
          score_faixa: string | null
          tem_processo_nosso_ativo: boolean
          teve_analise_sem_cadastro: boolean
          tipagem_antecipacao: string | null
          tipo: string
          uf: string | null
          ultima_antecipacao: string | null
          ultima_conversa_em: string | null
          valor_esperado_mensal: number | null
        }
        SetofOptions: {
          from: "*"
          to: "empresas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_criar_lead_sdr: { Args: { p: Json }; Returns: Json }
      app_criar_lote: {
        Args: { p: Json }
        Returns: {
          aprovado_em: string | null
          aprovado_por: string | null
          atualizado_em: string
          concluido_em: string | null
          criado_em: string
          criado_por: string | null
          custo_estimado_esperado: number | null
          custo_estimado_min: number | null
          custo_real: number
          definicao_filtro: Json
          id: string
          nome: string | null
          parametros: Json
          status: string
          tipo: string
          total_itens: number | null
        }
        SetofOptions: {
          from: "*"
          to: "lotes_enriquecimento"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_criar_nota: {
        Args: { p: Json }
        Returns: {
          autor_usuario_id: string
          conteudo: string
          criado_em: string
          empresa_id: string
          id: string
        }
        SetofOptions: {
          from: "*"
          to: "empresa_notas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_criar_nota_funil: {
        Args: { p: Json }
        Returns: {
          anexos: Json
          autor_usuario_id: string
          card_id: string
          conteudo: string
          criado_em: string
          empresa_id: string | null
          funil: string
          id: string
        }
        SetofOptions: {
          from: "*"
          to: "funil_notas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_criar_segmento: {
        Args: { p: Json }
        Returns: {
          contagem_atualizada_em: string | null
          contagem_cache: number | null
          criado_em: string
          criado_por: string | null
          definicao: Json
          descricao: string | null
          id: string
          nome: string
        }
        SetofOptions: {
          from: "*"
          to: "segmentos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_criar_venda: { Args: { p: Json }; Returns: Json }
      app_decidir_aceite_sdr: {
        Args: { p: Json }
        Returns: {
          aceite_automatico: boolean
          criado_em: string
          decidido_em: string | null
          decidido_por: string | null
          empresa_id: string
          id: string
          lancado_em: string | null
          motivo_recusa: string | null
          prazo_em: string
          reuniao_em: string | null
          sdr_id: string
          sdr_lead_id: string
          status: string
          vendedor_destino_id: string
        }
        SetofOptions: {
          from: "*"
          to: "sdr_aceites"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_declarar_metrica: {
        Args: { p: Json }
        Returns: {
          capturado_em: string
          cnpj: string
          confianca: string | null
          detalhes: Json
          empresa_id: string | null
          id: string
          metrica: string
          origem: string
          valor: number
        }
        SetofOptions: {
          from: "*"
          to: "empresa_metricas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_definir_beta: { Args: { p: Json }; Returns: Json }
      app_definir_carteira: {
        Args: { p: Json }
        Returns: {
          ate: string | null
          comissiona_como_cedente: boolean
          desde: string
          empresa_id: string
          id: string
          origem: string
          papel: string
          share_pct: number
          vendedor_id: string
        }
        SetofOptions: {
          from: "*"
          to: "vendedor_carteira"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_definir_carteira_passiva: { Args: { p: Json }; Returns: Json }
      app_definir_config: {
        Args: { p: Json }
        Returns: {
          atualizado_em: string
          atualizado_por: string | null
          chave: string
          descricao: string | null
          valor: Json
        }
        SetofOptions: {
          from: "*"
          to: "app_config"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_definir_ex_cliente_motivo: {
        Args: { p: Json }
        Returns: {
          atualizado_em: string
          bloqueio_cobranca: boolean
          bloqueio_cobranca_cobranca_id: string | null
          bloqueio_cobranca_em: string | null
          bloqueio_cobranca_motivo: string | null
          camada: string | null
          chance_concessao: number | null
          churn_erp_concorrente: boolean
          cnae_principal: string | null
          cnpj: string
          credito_calculado_em: string | null
          credito_revisao_desde: string | null
          credito_revisao_pos_inadimplencia: boolean
          credito_versao: number | null
          criado_em: string
          dados_apollo: Json | null
          dominio: string | null
          dominio_confianca: string | null
          dominio_evidencia: string | null
          dominio_origem: string | null
          dominio_validado_em: string | null
          erp_atual: string | null
          erp_canal_venda: string | null
          erp_detalhes: Json
          erp_mrr: number | null
          estagio: string
          ex_cliente_desde: string | null
          ex_cliente_motivo: string | null
          ex_cliente_motivo_obs: string | null
          fase_manual: string | null
          faturamento_anual: number | null
          faturamento_atualizado_em: string | null
          faturamento_confianca: string | null
          faturamento_origem: string | null
          funcionarios: number | null
          funcionarios_atualizado_em: string | null
          funcionarios_crescimento_12m: number | null
          funcionarios_origem: string | null
          gestao_definida_em: string | null
          gestao_definida_por: string | null
          gestao_operacao: string | null
          grafo_sefaz: boolean
          grupo_id: string | null
          id: string
          is_spe: boolean
          limite_confianca: string | null
          limite_potencial: number | null
          marco_ativacao: string | null
          municipio: string | null
          nome_fantasia: string | null
          origem: string | null
          patrimonio_atualizado_em: string | null
          patrimonio_liquido: number | null
          patrimonio_origem: string | null
          porte: string | null
          razao_social: string | null
          receita_mensal_prevista: number | null
          receita_taxa_am: number | null
          regime_tributario: string | null
          score_calculado_em: string | null
          score_completude: number | null
          score_credito: number | null
          score_faixa: string | null
          tem_processo_nosso_ativo: boolean
          teve_analise_sem_cadastro: boolean
          tipagem_antecipacao: string | null
          tipo: string
          uf: string | null
          ultima_antecipacao: string | null
          ultima_conversa_em: string | null
          valor_esperado_mensal: number | null
        }
        SetofOptions: {
          from: "*"
          to: "empresas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_definir_fase_conta: {
        Args: { p: Json }
        Returns: {
          atualizado_em: string
          bloqueio_cobranca: boolean
          bloqueio_cobranca_cobranca_id: string | null
          bloqueio_cobranca_em: string | null
          bloqueio_cobranca_motivo: string | null
          camada: string | null
          chance_concessao: number | null
          churn_erp_concorrente: boolean
          cnae_principal: string | null
          cnpj: string
          credito_calculado_em: string | null
          credito_revisao_desde: string | null
          credito_revisao_pos_inadimplencia: boolean
          credito_versao: number | null
          criado_em: string
          dados_apollo: Json | null
          dominio: string | null
          dominio_confianca: string | null
          dominio_evidencia: string | null
          dominio_origem: string | null
          dominio_validado_em: string | null
          erp_atual: string | null
          erp_canal_venda: string | null
          erp_detalhes: Json
          erp_mrr: number | null
          estagio: string
          ex_cliente_desde: string | null
          ex_cliente_motivo: string | null
          ex_cliente_motivo_obs: string | null
          fase_manual: string | null
          faturamento_anual: number | null
          faturamento_atualizado_em: string | null
          faturamento_confianca: string | null
          faturamento_origem: string | null
          funcionarios: number | null
          funcionarios_atualizado_em: string | null
          funcionarios_crescimento_12m: number | null
          funcionarios_origem: string | null
          gestao_definida_em: string | null
          gestao_definida_por: string | null
          gestao_operacao: string | null
          grafo_sefaz: boolean
          grupo_id: string | null
          id: string
          is_spe: boolean
          limite_confianca: string | null
          limite_potencial: number | null
          marco_ativacao: string | null
          municipio: string | null
          nome_fantasia: string | null
          origem: string | null
          patrimonio_atualizado_em: string | null
          patrimonio_liquido: number | null
          patrimonio_origem: string | null
          porte: string | null
          razao_social: string | null
          receita_mensal_prevista: number | null
          receita_taxa_am: number | null
          regime_tributario: string | null
          score_calculado_em: string | null
          score_completude: number | null
          score_credito: number | null
          score_faixa: string | null
          tem_processo_nosso_ativo: boolean
          teve_analise_sem_cadastro: boolean
          tipagem_antecipacao: string | null
          tipo: string
          uf: string | null
          ultima_antecipacao: string | null
          ultima_conversa_em: string | null
          valor_esperado_mensal: number | null
        }
        SetofOptions: {
          from: "*"
          to: "empresas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_definir_gestao_operacao: {
        Args: { p: Json }
        Returns: {
          atualizado_em: string
          bloqueio_cobranca: boolean
          bloqueio_cobranca_cobranca_id: string | null
          bloqueio_cobranca_em: string | null
          bloqueio_cobranca_motivo: string | null
          camada: string | null
          chance_concessao: number | null
          churn_erp_concorrente: boolean
          cnae_principal: string | null
          cnpj: string
          credito_calculado_em: string | null
          credito_revisao_desde: string | null
          credito_revisao_pos_inadimplencia: boolean
          credito_versao: number | null
          criado_em: string
          dados_apollo: Json | null
          dominio: string | null
          dominio_confianca: string | null
          dominio_evidencia: string | null
          dominio_origem: string | null
          dominio_validado_em: string | null
          erp_atual: string | null
          erp_canal_venda: string | null
          erp_detalhes: Json
          erp_mrr: number | null
          estagio: string
          ex_cliente_desde: string | null
          ex_cliente_motivo: string | null
          ex_cliente_motivo_obs: string | null
          fase_manual: string | null
          faturamento_anual: number | null
          faturamento_atualizado_em: string | null
          faturamento_confianca: string | null
          faturamento_origem: string | null
          funcionarios: number | null
          funcionarios_atualizado_em: string | null
          funcionarios_crescimento_12m: number | null
          funcionarios_origem: string | null
          gestao_definida_em: string | null
          gestao_definida_por: string | null
          gestao_operacao: string | null
          grafo_sefaz: boolean
          grupo_id: string | null
          id: string
          is_spe: boolean
          limite_confianca: string | null
          limite_potencial: number | null
          marco_ativacao: string | null
          municipio: string | null
          nome_fantasia: string | null
          origem: string | null
          patrimonio_atualizado_em: string | null
          patrimonio_liquido: number | null
          patrimonio_origem: string | null
          porte: string | null
          razao_social: string | null
          receita_mensal_prevista: number | null
          receita_taxa_am: number | null
          regime_tributario: string | null
          score_calculado_em: string | null
          score_completude: number | null
          score_credito: number | null
          score_faixa: string | null
          tem_processo_nosso_ativo: boolean
          teve_analise_sem_cadastro: boolean
          tipagem_antecipacao: string | null
          tipo: string
          uf: string | null
          ultima_antecipacao: string | null
          ultima_conversa_em: string | null
          valor_esperado_mensal: number | null
        }
        SetofOptions: {
          from: "*"
          to: "empresas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_definir_limite_analise: {
        Args: { p: Json }
        Returns: {
          analise_propria_id: string | null
          atradius_buyer_id: string | null
          atradius_case_id: string | null
          atualizada_em: string
          cnpj: string
          codigo_decisao: string | null
          codigo_historico: string | null
          contato_externo: Json | null
          criada_em: string
          decidida_em: string | null
          decisao_interna: string | null
          decisao_interna_em: string | null
          empresa_id: string | null
          envio_manual_em: string | null
          envio_manual_por: string | null
          estagio: string
          expira_em: string | null
          expirada_em: string | null
          external_id: string | null
          id: string
          limite_aprovado: number | null
          limite_operacional: number | null
          limite_solicitado: number | null
          moeda: string
          motivo: string | null
          observacoes: string | null
          origem: string
          origem_externa: string | null
          origem_motivo: string | null
          rating_classe_seguradora: string | null
          rating_seguradora: string | null
          seguradora: string
          solicitada_por: string | null
          substituida_em: string | null
          substituida_por: string | null
        }
        SetofOptions: {
          from: "*"
          to: "analises_credito"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_definir_ponto_focal: {
        Args: { p: Json }
        Returns: {
          apollo_person_id: string | null
          base_legal: string | null
          base_legal_detalhe: string | null
          base_legal_em: string | null
          cargo: string | null
          criado_em: string
          departamento: string | null
          email: string | null
          email_status: string | null
          empresa_id: string
          enriquecido_em: string | null
          id: string
          linkedin_url: string | null
          nao_e_o_decisor: boolean
          nome: string | null
          origem: string | null
          origem_interacao: Json | null
          ponto_focal: boolean
          senioridade: string | null
          telefone: string | null
          telefone_status: string | null
          whatsapp: string | null
        }
        SetofOptions: {
          from: "*"
          to: "contatos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_descartar_mensagem: {
        Args: { p: Json }
        Returns: {
          access_keys: string[]
          agendada_para: string | null
          anexos: Json
          assunto: string | null
          atualizada_em: string
          campanha_destinatario_id: string | null
          campanha_id: string | null
          canal: string
          comunicacao_id: string | null
          conversa_id: string | null
          corpo: string | null
          criada_em: string
          criada_por: string | null
          descartada_por: string | null
          destinatario: string | null
          destinatario_contato_id: string | null
          destinatario_ponto_focal: boolean
          empresa_id: string | null
          erro: string | null
          faixa: string | null
          forcar_janela: boolean
          fornecedor_cnpj: string | null
          fornecedor_empresa_id: string | null
          fornecedor_nome: string | null
          funil: string | null
          funil_card_id: string | null
          id: string
          mandato_acao_id: string | null
          mandato_id: string | null
          motivo_descarte: string | null
          oportunidades: string[] | null
          origem: string
          por_ia: boolean
          status: string
          template_id: string | null
          tentativas: number
          ultima_tentativa_em: string | null
          valor_total: number | null
          vendedor_id: string | null
          whatsapp_conta_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "mensagens_outbox"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_desconectar_gmail: { Args: { p: Json }; Returns: undefined }
      app_desmonitorar_protesto: {
        Args: { p_cnpj: string }
        Returns: undefined
      }
      app_desvincular_cnpj_conta: { Args: { p: Json }; Returns: Json }
      app_editar_parecer: {
        Args: { p: Json }
        Returns: {
          analise_credito_id: string | null
          atradius_limite: number | null
          atradius_status: string | null
          cenarios: Json | null
          cnpj: string
          concluida_em: string | null
          criada_em: string
          criada_por: string | null
          dados_extraidos: Json | null
          decidida_em: string | null
          decidida_por: string | null
          decisao_final: string | null
          decisao_limite: number | null
          decisao_motivo: string | null
          empresa_id: string | null
          erro: string | null
          etapa: string | null
          extracao_revisada_em: string | null
          extracao_revisada_por: string | null
          gatilho: string
          id: string
          indicadores: Json | null
          lacunas_calculo: Json
          limite_recomendado: number | null
          motivos_nao_operar: Json
          parametros_versao: number
          parecer_editado: string | null
          parecer_editado_em: string | null
          parecer_editado_por: string | null
          parecer_markdown: string | null
          parecer_modelo: string | null
          parecer_tokens: number | null
          protestos_opcoes: Json | null
          protestos_resultado: Json | null
          quadrante: string | null
          recomendacao: string | null
          status: string
          tetos: Json | null
          tipo: string
        }
        SetofOptions: {
          from: "*"
          to: "analises_proprietarias"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_empresa_sugestao_decidir: {
        Args: { p: Json }
        Returns: {
          analise_id: string | null
          campo: string
          contato_id: string | null
          criada_em: string
          decidida_em: string | null
          decidida_por: string | null
          empresa_id: string
          id: string
          origem: string
          status: string
          valor_atual: string | null
          valor_sugerido: string
        }
        SetofOptions: {
          from: "*"
          to: "empresa_sugestoes_cadastro"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_empresa_sugestoes: { Args: { p: Json }; Returns: Json }
      app_empresas_do_meu_funil: { Args: never; Returns: string[] }
      app_enviar_analise_manualmente: {
        Args: { p: Json }
        Returns: {
          analise_propria_id: string | null
          atradius_buyer_id: string | null
          atradius_case_id: string | null
          atualizada_em: string
          cnpj: string
          codigo_decisao: string | null
          codigo_historico: string | null
          contato_externo: Json | null
          criada_em: string
          decidida_em: string | null
          decisao_interna: string | null
          decisao_interna_em: string | null
          empresa_id: string | null
          envio_manual_em: string | null
          envio_manual_por: string | null
          estagio: string
          expira_em: string | null
          expirada_em: string | null
          external_id: string | null
          id: string
          limite_aprovado: number | null
          limite_operacional: number | null
          limite_solicitado: number | null
          moeda: string
          motivo: string | null
          observacoes: string | null
          origem: string
          origem_externa: string | null
          origem_motivo: string | null
          rating_classe_seguradora: string | null
          rating_seguradora: string | null
          seguradora: string
          solicitada_por: string | null
          substituida_em: string | null
          substituida_por: string | null
        }
        SetofOptions: {
          from: "*"
          to: "analises_credito"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_fornecedor_contato_manual: {
        Args: { p: Json }
        Returns: {
          apollo_person_id: string | null
          base_legal: string | null
          base_legal_detalhe: string | null
          base_legal_em: string | null
          cargo: string | null
          criado_em: string
          departamento: string | null
          email: string | null
          email_status: string | null
          empresa_id: string
          enriquecido_em: string | null
          id: string
          linkedin_url: string | null
          nao_e_o_decisor: boolean
          nome: string | null
          origem: string | null
          origem_interacao: Json | null
          ponto_focal: boolean
          senioridade: string | null
          telefone: string | null
          telefone_status: string | null
          whatsapp: string | null
        }
        SetofOptions: {
          from: "*"
          to: "contatos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_fornecedor_mover: {
        Args: { p: Json }
        Returns: {
          atualizado_em: string
          contatos_encontrados: number
          descoberta_automatica_em: string | null
          empresa_id: string | null
          entrou_em: string
          estagio: string
          estagio_alterado_em: string | null
          estagio_alterado_por: string | null
          fornecedor_cnpj: string
          id: string
          melhor_confianca: string | null
          originador_id: string | null
          originador_origem: string
          potencial_mensal: number | null
          prazo_medio_dias: number | null
          qtd_nfs_90d: number | null
          sacados_principais: Json
          sem_interesse_ate: string | null
          sem_interesse_motivo: string | null
          sem_interesse_observacao: string | null
          sem_interesse_origem: string | null
          ultima_busca_em: string | null
          ultima_nf_em: string | null
          volume_90d: number | null
        }
        SetofOptions: {
          from: "*"
          to: "fornecedores_funil"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_fornecedor_reatribuir: {
        Args: { p: Json }
        Returns: {
          atualizado_em: string
          contatos_encontrados: number
          descoberta_automatica_em: string | null
          empresa_id: string | null
          entrou_em: string
          estagio: string
          estagio_alterado_em: string | null
          estagio_alterado_por: string | null
          fornecedor_cnpj: string
          id: string
          melhor_confianca: string | null
          originador_id: string | null
          originador_origem: string
          potencial_mensal: number | null
          prazo_medio_dias: number | null
          qtd_nfs_90d: number | null
          sacados_principais: Json
          sem_interesse_ate: string | null
          sem_interesse_motivo: string | null
          sem_interesse_observacao: string | null
          sem_interesse_origem: string | null
          ultima_busca_em: string | null
          ultima_nf_em: string | null
          volume_90d: number | null
        }
        SetofOptions: {
          from: "*"
          to: "fornecedores_funil"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_fornecedor_sem_interesse: {
        Args: { p: Json }
        Returns: {
          atualizado_em: string
          contatos_encontrados: number
          descoberta_automatica_em: string | null
          empresa_id: string | null
          entrou_em: string
          estagio: string
          estagio_alterado_em: string | null
          estagio_alterado_por: string | null
          fornecedor_cnpj: string
          id: string
          melhor_confianca: string | null
          originador_id: string | null
          originador_origem: string
          potencial_mensal: number | null
          prazo_medio_dias: number | null
          qtd_nfs_90d: number | null
          sacados_principais: Json
          sem_interesse_ate: string | null
          sem_interesse_motivo: string | null
          sem_interesse_observacao: string | null
          sem_interesse_origem: string | null
          ultima_busca_em: string | null
          ultima_nf_em: string | null
          volume_90d: number | null
        }
        SetofOptions: {
          from: "*"
          to: "fornecedores_funil"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_fornecedor_toque: { Args: { p: Json }; Returns: undefined }
      app_fornecedor_visivel: { Args: { p_cnpj: string }; Returns: boolean }
      app_funil_analise: { Args: { p: Json }; Returns: Json }
      app_gerar_token_ics: { Args: { p: Json }; Returns: string }
      app_gestor_comercial: { Args: never; Returns: boolean }
      app_holding_do_sacado: { Args: { p_cnpj: string }; Returns: string }
      app_inbox_responsaveis: {
        Args: never
        Returns: {
          id: string
          is_ia: boolean
          nome: string
        }[]
      }
      app_is_admin: { Args: never; Returns: boolean }
      app_juridico_atualizar_processo: {
        Args: { p: Json }
        Returns: {
          advogado_id: string | null
          area: string | null
          arquivado: boolean | null
          assunto: string | null
          atualizado_em: string
          classe: string | null
          cnpj_devedor: string | null
          comarca: string | null
          criado_em: string
          data_arquivamento: string | null
          data_distribuicao: string | null
          data_inicio: string | null
          data_ultima_movimentacao: string | null
          data_ultima_verificacao: string | null
          empresa_devedora_id: string | null
          fase_atual: string | null
          fase_desde: string | null
          fisico: boolean | null
          grau: number | null
          nosso_cnpj: string | null
          numero_cnj: string
          observacoes: string | null
          orgao_julgador: string | null
          polo_nosso: string | null
          qtd_movimentacoes: number | null
          raw: Json | null
          segredo_justica: boolean | null
          sistema: string | null
          situacao_interna: string
          status_predito: string | null
          titulo_polo_ativo: string | null
          titulo_polo_passivo: string | null
          tribunal_nome: string | null
          tribunal_sigla: string | null
          uf: string | null
          ultima_sincronizacao: string | null
          url_tribunal: string | null
          valor_causa: number | null
          vinculo_cobranca_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "processos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_juridico_concluir_prazo: {
        Args: { p: Json }
        Returns: {
          avisado_d1_em: string | null
          avisado_d3_em: string | null
          concluido: boolean
          concluido_em: string | null
          criado_em: string
          criado_por: string | null
          data: string
          descricao: string
          id: string
          numero_cnj: string
          responsavel_id: string | null
          tipo: string
        }
        SetofOptions: {
          from: "*"
          to: "processo_prazos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_juridico_definir_config: {
        Args: { p: Json }
        Returns: {
          atualizado_em: string
          atualizado_por: string | null
          chave: string
          valor: Json
        }
        SetofOptions: {
          from: "*"
          to: "juridico_config"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_juridico_editar_parecer: {
        Args: { p: Json }
        Returns: {
          criado_em: string
          editado: boolean
          gerado_por: string | null
          id: string
          modelo: string | null
          numero_cnj: string
          parecer_markdown: string
          proximo_passo: string
          risco: string | null
          tokens: number | null
        }
        SetofOptions: {
          from: "*"
          to: "processo_pareceres"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_juridico_exige_modulo: { Args: never; Returns: undefined }
      app_juridico_registrar_calculo: {
        Args: { p: Json }
        Returns: {
          correcao: number | null
          criado_em: string
          custas: number | null
          data_base: string
          data_calculo: string
          gerado_por: string | null
          honorarios: number | null
          id: string
          juros: number | null
          memoria: Json
          multa: number | null
          numero_cnj: string
          parametros: Json
          principal: number | null
          total: number
        }
        SetofOptions: {
          from: "*"
          to: "processo_calculos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_juridico_registrar_custo: {
        Args: { p: Json }
        Returns: {
          comprovante_url: string | null
          criado_em: string
          data: string
          descricao: string | null
          id: string
          numero_cnj: string
          registrado_por: string | null
          tipo: string
          valor: number
        }
        SetofOptions: {
          from: "*"
          to: "processo_custos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_juridico_registrar_recuperacao: {
        Args: { p: Json }
        Returns: {
          criado_em: string
          data: string
          id: string
          numero_cnj: string
          observacao: string | null
          origem: string
          registrado_por: string | null
          valor: number
        }
        SetofOptions: {
          from: "*"
          to: "processo_recuperacoes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_juridico_remover_operacao: { Args: { p: Json }; Returns: Json }
      app_juridico_salvar_advogado: {
        Args: { p: Json }
        Returns: {
          ativo: boolean
          atualizado_em: string
          criado_em: string
          email: string | null
          escritorio: string | null
          id: string
          nome: string
          oab_numero: string | null
          oab_uf: string | null
          telefone: string | null
          tipo: string
          usuario_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "advogados"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_juridico_salvar_indices: { Args: { p: Json }; Returns: Json }
      app_juridico_salvar_operacao: {
        Args: { p: Json }
        Returns: {
          access_key: string | null
          antecipacao_id_externo: number | null
          criado_em: string
          criado_por: string | null
          descricao: string | null
          id: string
          numero_cnj: string
          valor_original: number
          vencimento: string
        }
        SetofOptions: {
          from: "*"
          to: "processo_operacoes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_juridico_salvar_prazo: {
        Args: { p: Json }
        Returns: {
          avisado_d1_em: string | null
          avisado_d3_em: string | null
          concluido: boolean
          concluido_em: string | null
          criado_em: string
          criado_por: string | null
          data: string
          descricao: string
          id: string
          numero_cnj: string
          responsavel_id: string | null
          tipo: string
        }
        SetofOptions: {
          from: "*"
          to: "processo_prazos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_juridico_solicitar_atualizacao: { Args: { p: Json }; Returns: Json }
      app_marcar_fornecedor_sem_interesse: {
        Args: { p: Json }
        Returns: {
          cnpj: string
          fornecedor_nome: string | null
          marcado_em: string
          marcado_por: string | null
          motivo: string
          observacao: string | null
        }
        SetofOptions: {
          from: "*"
          to: "antecipacao_fornecedor_sem_interesse"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_marcar_sem_interesse: {
        Args: { p: Json }
        Returns: {
          contexto: string
          criado_em: string
          criado_por: string | null
          escopo: string
          expira_em: string | null
          id: string
          motivo: string
          observacao: string | null
          valor: string
        }
        SetofOptions: {
          from: "*"
          to: "supressao"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_meu_dia_alvos: { Args: never; Returns: string[] }
      app_meu_dia_cargo: { Args: { p_vendedor_id?: string }; Returns: string }
      app_meu_dia_concluir_tarefa: {
        Args: { p_id: string }
        Returns: {
          concluida_em: string | null
          criada_em: string
          criada_por: string | null
          detalhe: string | null
          empresa_id: string | null
          id: string
          titulo: string
          vence_em: string | null
          vendedor_id: string
        }
        SetofOptions: {
          from: "*"
          to: "meu_dia_tarefas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_meu_dia_ocultar: {
        Args: { p: Json }
        Returns: {
          acao: string
          adiado_ate: string | null
          criado_em: string
          id: string
          motivo: string | null
          referencia_id: string
          tipo_item: string
          vendedor_id: string
        }
        SetofOptions: {
          from: "*"
          to: "meu_dia_itens_ocultos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_meu_dia_reexibir: { Args: { p: Json }; Returns: boolean }
      app_monitorar_protesto: { Args: { p_cnpj: string }; Returns: undefined }
      app_mover_analise: {
        Args: { p: Json }
        Returns: {
          analise_propria_id: string | null
          atradius_buyer_id: string | null
          atradius_case_id: string | null
          atualizada_em: string
          cnpj: string
          codigo_decisao: string | null
          codigo_historico: string | null
          contato_externo: Json | null
          criada_em: string
          decidida_em: string | null
          decisao_interna: string | null
          decisao_interna_em: string | null
          empresa_id: string | null
          envio_manual_em: string | null
          envio_manual_por: string | null
          estagio: string
          expira_em: string | null
          expirada_em: string | null
          external_id: string | null
          id: string
          limite_aprovado: number | null
          limite_operacional: number | null
          limite_solicitado: number | null
          moeda: string
          motivo: string | null
          observacoes: string | null
          origem: string
          origem_externa: string | null
          origem_motivo: string | null
          rating_classe_seguradora: string | null
          rating_seguradora: string | null
          seguradora: string
          solicitada_por: string | null
          substituida_em: string | null
          substituida_por: string | null
        }
        SetofOptions: {
          from: "*"
          to: "analises_credito"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_mover_certificado_card: { Args: { p: Json }; Returns: Json }
      app_mover_estagio_nf: {
        Args: { p: Json }
        Returns: {
          access_key: string
          atualizada_em: string
          bilateral: boolean
          cancelada_em: string | null
          contato_fornecedor: Json | null
          contato_sacado: Json | null
          conversao_antecipacao_id: number | null
          conversao_em_disputa: boolean
          credit_disponivel: number | null
          credit_limite: number | null
          credit_role: string | null
          credit_status: string | null
          criada_em: string
          dias_para_vencimento: number | null
          direction: string
          emitida_em: string | null
          estagio_alterado_em: string | null
          estagio_alterado_por: string | null
          estagio_funil: string
          faixa: string | null
          faixa_alterada_em: string | null
          faixa_motivo: string | null
          faixa_regra_versao: number | null
          fornecedor_cadastrado: boolean | null
          fornecedor_cnpj: string
          fornecedor_empresa_id: string | null
          fornecedor_nome: string | null
          limite_disponivel_sacado: number | null
          limite_sacado_origem: string | null
          link_antecipacao: string | null
          nao_operavel_motivo: string | null
          natureza_operacao: string | null
          nf_id_externo: string | null
          numero: string | null
          operavel: boolean
          operavel_manual: boolean | null
          parcelas: Json | null
          perda_motivo: string | null
          raw_xml: string | null
          receita_esperada: number | null
          resumo_relido_em: string | null
          sacado_cadastrado: boolean | null
          sacado_cnpj: string
          sacado_empresa_id: string | null
          sacado_nome: string | null
          seguro_estimado: number | null
          serie: string | null
          sincronizada_em: string | null
          situacao: string
          status_sync: string | null
          tac_estimada: number | null
          taxa_analise_am: number | null
          taxa_analise_origem: string | null
          taxa_usada: number | null
          tipo: string
          valor: number
          vencimento: string | null
          vencimento_origem: string | null
          vendedor_definido_em: string | null
          vendedor_id: string | null
          vendedor_origem: string | null
          xml_parse_erro: string | null
          xml_resumo: boolean
        }
        SetofOptions: {
          from: "*"
          to: "notas_fiscais"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_mover_lead_sdr: {
        Args: { p: Json }
        Returns: {
          atualizado_em: string
          distribuido_em: string
          empresa_id: string
          encerrado_em: string | null
          encerrado_motivo: string | null
          estagio: string
          fit: boolean | null
          fit_definido_em: string | null
          id: string
          origem: string
          reuniao_em: string | null
          sdr_id: string
          sem_fit_motivo: string | null
          ultimo_toque_em: string | null
          vendedor_destino_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "sdr_leads"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_mover_oportunidade: { Args: { p: Json }; Returns: Json }
      app_mover_venda: {
        Args: { p: Json }
        Returns: {
          analise_credito_id: string | null
          atualizada_em: string
          criada_em: string
          empresa_id: string
          estagio: string
          ganho_em: string | null
          id: string
          perdido_em: string | null
          perdido_motivo: string | null
          primeira_operacao_em: string | null
          primeira_operacao_id: number | null
          sdr_lead_id: string | null
          situacao: string
          vendedor_id: string
        }
        SetofOptions: {
          from: "*"
          to: "vendas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_mudar_status_comissao: { Args: { p: Json }; Returns: number }
      app_mudar_status_competencia: { Args: { p: Json }; Returns: number }
      app_notificacao_numeros: {
        Args: never
        Returns: {
          enviados: number
          lidos: number
          pessoas: number
          resumidos: number
          tipo: string
          ultimo_em: string | null
        }[]
      }
      app_notificacao_previa: {
        Args: {
          p_corpo?: string
          p_tipo: string
          p_titulo?: string
          p_url?: string
        }
        Returns: Json
      }
      app_notificacao_testar: { Args: { p_tipo: string }; Returns: string }
      app_ocultar_ex_cliente: { Args: { p_cnpj: string }; Returns: undefined }
      app_ocultar_spe_certificado: { Args: { p_cnpj: string }; Returns: Json }
      app_pausar_campanha: {
        Args: { p: Json }
        Returns: {
          aprovada_em: string | null
          aprovada_por: string | null
          atualizada_em: string
          canal: string
          concluida_em: string | null
          contas_remetentes: string[]
          criada_em: string
          criada_por: string | null
          definicao_filtro: Json | null
          empresas_manuais: string[]
          excluir_contatados_dias: number
          excluir_conversa_aberta: boolean
          id: string
          inicio_em: string | null
          modo_agente_ao_responder: string
          nome: string
          objetivo: string | null
          origem_publico: string
          pausa_motivo: string | null
          preset: string | null
          preset_params: Json
          respeitar_janela: boolean
          ritmo_por_dia: number
          segmento_id: string | null
          simulacao: Json | null
          simulada_em: string | null
          status: string
          tipo: string
          variantes: Json
          vendedor_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "campanhas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_pedido_apresentacao_enviar: {
        Args: { p: Json }
        Returns: {
          comunicacao_id: string | null
          contato_fornecedor_id: string | null
          contato_sacado_id: string | null
          criado_em: string
          direcao: string
          fornecedor_cnpj: string
          id: string
          mensagem: string | null
          respondido_em: string | null
          sacado_cnpj: string
          solicitado_por: string | null
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "pedidos_apresentacao"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_pedido_apresentacao_status: {
        Args: { p: Json }
        Returns: {
          comunicacao_id: string | null
          contato_fornecedor_id: string | null
          contato_sacado_id: string | null
          criado_em: string
          direcao: string
          fornecedor_cnpj: string
          id: string
          mensagem: string | null
          respondido_em: string | null
          sacado_cnpj: string
          solicitado_por: string | null
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "pedidos_apresentacao"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_pedir_apresentacao: {
        Args: { p: Json }
        Returns: {
          comunicacao_id: string | null
          contato_fornecedor_id: string | null
          contato_sacado_id: string | null
          criado_em: string
          direcao: string
          fornecedor_cnpj: string
          id: string
          mensagem: string | null
          respondido_em: string | null
          sacado_cnpj: string
          solicitado_por: string | null
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "pedidos_apresentacao"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_pode_pedir_analise_sempre: { Args: never; Returns: boolean }
      app_pode_ver_folha: { Args: { p_vendedor_id: string }; Returns: boolean }
      app_pode_ver_vendedor: {
        Args: { p_vendedor_id: string }
        Returns: boolean
      }
      app_processar_submissao: { Args: { p: Json }; Returns: Json }
      app_promover_contato_descoberto: {
        Args: { p: Json }
        Returns: {
          apollo_person_id: string | null
          base_legal: string | null
          base_legal_detalhe: string | null
          base_legal_em: string | null
          cargo: string | null
          criado_em: string
          departamento: string | null
          email: string | null
          email_status: string | null
          empresa_id: string
          enriquecido_em: string | null
          id: string
          linkedin_url: string | null
          nao_e_o_decisor: boolean
          nome: string | null
          origem: string | null
          origem_interacao: Json | null
          ponto_focal: boolean
          senioridade: string | null
          telefone: string | null
          telefone_status: string | null
          whatsapp: string | null
        }
        SetofOptions: {
          from: "*"
          to: "contatos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_promover_empresa: {
        Args: { p: Json }
        Returns: {
          atualizado_em: string
          bloqueio_cobranca: boolean
          bloqueio_cobranca_cobranca_id: string | null
          bloqueio_cobranca_em: string | null
          bloqueio_cobranca_motivo: string | null
          camada: string | null
          chance_concessao: number | null
          churn_erp_concorrente: boolean
          cnae_principal: string | null
          cnpj: string
          credito_calculado_em: string | null
          credito_revisao_desde: string | null
          credito_revisao_pos_inadimplencia: boolean
          credito_versao: number | null
          criado_em: string
          dados_apollo: Json | null
          dominio: string | null
          dominio_confianca: string | null
          dominio_evidencia: string | null
          dominio_origem: string | null
          dominio_validado_em: string | null
          erp_atual: string | null
          erp_canal_venda: string | null
          erp_detalhes: Json
          erp_mrr: number | null
          estagio: string
          ex_cliente_desde: string | null
          ex_cliente_motivo: string | null
          ex_cliente_motivo_obs: string | null
          fase_manual: string | null
          faturamento_anual: number | null
          faturamento_atualizado_em: string | null
          faturamento_confianca: string | null
          faturamento_origem: string | null
          funcionarios: number | null
          funcionarios_atualizado_em: string | null
          funcionarios_crescimento_12m: number | null
          funcionarios_origem: string | null
          gestao_definida_em: string | null
          gestao_definida_por: string | null
          gestao_operacao: string | null
          grafo_sefaz: boolean
          grupo_id: string | null
          id: string
          is_spe: boolean
          limite_confianca: string | null
          limite_potencial: number | null
          marco_ativacao: string | null
          municipio: string | null
          nome_fantasia: string | null
          origem: string | null
          patrimonio_atualizado_em: string | null
          patrimonio_liquido: number | null
          patrimonio_origem: string | null
          porte: string | null
          razao_social: string | null
          receita_mensal_prevista: number | null
          receita_taxa_am: number | null
          regime_tributario: string | null
          score_calculado_em: string | null
          score_completude: number | null
          score_credito: number | null
          score_faixa: string | null
          tem_processo_nosso_ativo: boolean
          teve_analise_sem_cadastro: boolean
          tipagem_antecipacao: string | null
          tipo: string
          uf: string | null
          ultima_antecipacao: string | null
          ultima_conversa_em: string | null
          valor_esperado_mensal: number | null
        }
        SetofOptions: {
          from: "*"
          to: "empresas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_promover_fornecedor: {
        Args: { p: Json }
        Returns: {
          atualizado_em: string
          bloqueio_cobranca: boolean
          bloqueio_cobranca_cobranca_id: string | null
          bloqueio_cobranca_em: string | null
          bloqueio_cobranca_motivo: string | null
          camada: string | null
          chance_concessao: number | null
          churn_erp_concorrente: boolean
          cnae_principal: string | null
          cnpj: string
          credito_calculado_em: string | null
          credito_revisao_desde: string | null
          credito_revisao_pos_inadimplencia: boolean
          credito_versao: number | null
          criado_em: string
          dados_apollo: Json | null
          dominio: string | null
          dominio_confianca: string | null
          dominio_evidencia: string | null
          dominio_origem: string | null
          dominio_validado_em: string | null
          erp_atual: string | null
          erp_canal_venda: string | null
          erp_detalhes: Json
          erp_mrr: number | null
          estagio: string
          ex_cliente_desde: string | null
          ex_cliente_motivo: string | null
          ex_cliente_motivo_obs: string | null
          fase_manual: string | null
          faturamento_anual: number | null
          faturamento_atualizado_em: string | null
          faturamento_confianca: string | null
          faturamento_origem: string | null
          funcionarios: number | null
          funcionarios_atualizado_em: string | null
          funcionarios_crescimento_12m: number | null
          funcionarios_origem: string | null
          gestao_definida_em: string | null
          gestao_definida_por: string | null
          gestao_operacao: string | null
          grafo_sefaz: boolean
          grupo_id: string | null
          id: string
          is_spe: boolean
          limite_confianca: string | null
          limite_potencial: number | null
          marco_ativacao: string | null
          municipio: string | null
          nome_fantasia: string | null
          origem: string | null
          patrimonio_atualizado_em: string | null
          patrimonio_liquido: number | null
          patrimonio_origem: string | null
          porte: string | null
          razao_social: string | null
          receita_mensal_prevista: number | null
          receita_taxa_am: number | null
          regime_tributario: string | null
          score_calculado_em: string | null
          score_completude: number | null
          score_credito: number | null
          score_faixa: string | null
          tem_processo_nosso_ativo: boolean
          teve_analise_sem_cadastro: boolean
          tipagem_antecipacao: string | null
          tipo: string
          uf: string | null
          ultima_antecipacao: string | null
          ultima_conversa_em: string | null
          valor_esperado_mensal: number | null
        }
        SetofOptions: {
          from: "*"
          to: "empresas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_prospeccao_buscar_cedentes: {
        Args: { p: Json }
        Returns: {
          fornecedor_cnpj: string
          ja_seguido: boolean
          nome: string
          notas: number
          ultima_emissao: string
        }[]
      }
      app_prospeccao_descartar: {
        Args: { p: Json }
        Returns: {
          analise_credito_id: string | null
          atualizado_em: string
          chance_concessao: number | null
          cnpj_sacado: string
          empresa_id: string | null
          entrou_em: string
          estagio: string
          estagio_alterado_em: string | null
          estagio_alterado_por: string | null
          faturamento_estimado: number | null
          id: string
          limite_potencial: number | null
          media_mensal_6m: number | null
          meses_com_emissao_6m: number | null
          motivo_saida: string | null
          observacao_saida: string | null
          originador_id: string | null
          originador_origem: string
          prazo_medio_dias: number | null
          prazo_minimo_operavel_dias: number | null
          prazo_minimo_origem: string | null
          qtd_fornecedores: number | null
          qtd_nfs_30d: number | null
          sacado_nome: string | null
          score_completude: number | null
          score_credito: number | null
          ultima_nf_em: string | null
          valor_esperado_mensal: number | null
          valor_operavel: number | null
          volume_30d: number | null
        }
        SetofOptions: {
          from: "*"
          to: "sacados_prospeccao"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_prospeccao_mover: {
        Args: { p: Json }
        Returns: {
          analise_credito_id: string | null
          atualizado_em: string
          chance_concessao: number | null
          cnpj_sacado: string
          empresa_id: string | null
          entrou_em: string
          estagio: string
          estagio_alterado_em: string | null
          estagio_alterado_por: string | null
          faturamento_estimado: number | null
          id: string
          limite_potencial: number | null
          media_mensal_6m: number | null
          meses_com_emissao_6m: number | null
          motivo_saida: string | null
          observacao_saida: string | null
          originador_id: string | null
          originador_origem: string
          prazo_medio_dias: number | null
          prazo_minimo_operavel_dias: number | null
          prazo_minimo_origem: string | null
          qtd_fornecedores: number | null
          qtd_nfs_30d: number | null
          sacado_nome: string | null
          score_completude: number | null
          score_credito: number | null
          ultima_nf_em: string | null
          valor_esperado_mensal: number | null
          valor_operavel: number | null
          volume_30d: number | null
        }
        SetofOptions: {
          from: "*"
          to: "sacados_prospeccao"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_prospeccao_pedir_apresentacao: {
        Args: { p: Json }
        Returns: {
          comunicacao_id: string | null
          contato_fornecedor_id: string | null
          contato_sacado_id: string | null
          criado_em: string
          direcao: string
          fornecedor_cnpj: string
          id: string
          mensagem: string | null
          respondido_em: string | null
          sacado_cnpj: string
          solicitado_por: string | null
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "pedidos_apresentacao"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_prospeccao_reatribuir: {
        Args: { p: Json }
        Returns: {
          analise_credito_id: string | null
          atualizado_em: string
          chance_concessao: number | null
          cnpj_sacado: string
          empresa_id: string | null
          entrou_em: string
          estagio: string
          estagio_alterado_em: string | null
          estagio_alterado_por: string | null
          faturamento_estimado: number | null
          id: string
          limite_potencial: number | null
          media_mensal_6m: number | null
          meses_com_emissao_6m: number | null
          motivo_saida: string | null
          observacao_saida: string | null
          originador_id: string | null
          originador_origem: string
          prazo_medio_dias: number | null
          prazo_minimo_operavel_dias: number | null
          prazo_minimo_origem: string | null
          qtd_fornecedores: number | null
          qtd_nfs_30d: number | null
          sacado_nome: string | null
          score_completude: number | null
          score_credito: number | null
          ultima_nf_em: string | null
          valor_esperado_mensal: number | null
          valor_operavel: number | null
          volume_30d: number | null
        }
        SetofOptions: {
          from: "*"
          to: "sacados_prospeccao"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_prospeccao_seguir: {
        Args: { p: Json }
        Returns: {
          ate: string | null
          criado_por: string | null
          desde: string
          fornecedor_cnpj: string
          id: string
          origem: string
          originador_id: string
        }
        SetofOptions: {
          from: "*"
          to: "fornecedores_seguidos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_prospeccao_solicitar_analise: {
        Args: { p: Json }
        Returns: {
          analise_propria_id: string | null
          atradius_buyer_id: string | null
          atradius_case_id: string | null
          atualizada_em: string
          cnpj: string
          codigo_decisao: string | null
          codigo_historico: string | null
          contato_externo: Json | null
          criada_em: string
          decidida_em: string | null
          decisao_interna: string | null
          decisao_interna_em: string | null
          empresa_id: string | null
          envio_manual_em: string | null
          envio_manual_por: string | null
          estagio: string
          expira_em: string | null
          expirada_em: string | null
          external_id: string | null
          id: string
          limite_aprovado: number | null
          limite_operacional: number | null
          limite_solicitado: number | null
          moeda: string
          motivo: string | null
          observacoes: string | null
          origem: string
          origem_externa: string | null
          origem_motivo: string | null
          rating_classe_seguradora: string | null
          rating_seguradora: string | null
          seguradora: string
          solicitada_por: string | null
          substituida_em: string | null
          substituida_por: string | null
        }
        SetofOptions: {
          from: "*"
          to: "analises_credito"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_protesto_anexar_arquivo: {
        Args: { p: Json }
        Returns: {
          arquivo_path: string | null
          cobranca_id: string | null
          cra: string
          criado_em: string
          criado_por: string | null
          enviada_em: string | null
          id: string
          modo: string
          protocolo: string | null
          retorno_path: string | null
          retorno_processado_em: string | null
          status: string
          tipo: string
          uf: string
        }
        SetofOptions: {
          from: "*"
          to: "protesto_remessas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_protesto_atualizar_titulo: {
        Args: { p: Json }
        Returns: {
          atualizado_em: string
          cartorio: string | null
          certidao_path: string | null
          cobranca_titulo_id: string | null
          custas: number | null
          data_protesto: string | null
          id: string
          instrucao_cancelamento_em: string | null
          instrucao_nao_aplicavel_motivo: string | null
          motivo_rejeicao: string | null
          protocolo_cartorio: string | null
          remessa_id: string | null
          situacao: string
        }
        SetofOptions: {
          from: "*"
          to: "protesto_titulos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_protesto_criar_remessa: {
        Args: { p: Json }
        Returns: {
          arquivo_path: string | null
          cobranca_id: string | null
          cra: string
          criado_em: string
          criado_por: string | null
          enviada_em: string | null
          id: string
          modo: string
          protocolo: string | null
          retorno_path: string | null
          retorno_processado_em: string | null
          status: string
          tipo: string
          uf: string
        }
        SetofOptions: {
          from: "*"
          to: "protesto_remessas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_protesto_instrucao_cancelamento: {
        Args: { p: Json }
        Returns: {
          arquivo_path: string | null
          cobranca_id: string | null
          cra: string
          criado_em: string
          criado_por: string | null
          enviada_em: string | null
          id: string
          modo: string
          protocolo: string | null
          retorno_path: string | null
          retorno_processado_em: string | null
          status: string
          tipo: string
          uf: string
        }
        SetofOptions: {
          from: "*"
          to: "protesto_remessas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_protesto_marcar_enviada: {
        Args: { p: Json }
        Returns: {
          arquivo_path: string | null
          cobranca_id: string | null
          cra: string
          criado_em: string
          criado_por: string | null
          enviada_em: string | null
          id: string
          modo: string
          protocolo: string | null
          retorno_path: string | null
          retorno_processado_em: string | null
          status: string
          tipo: string
          uf: string
        }
        SetofOptions: {
          from: "*"
          to: "protesto_remessas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_protesto_processar_retorno: {
        Args: { p: Json }
        Returns: {
          arquivo_path: string | null
          cobranca_id: string | null
          cra: string
          criado_em: string
          criado_por: string | null
          enviada_em: string | null
          id: string
          modo: string
          protocolo: string | null
          retorno_path: string | null
          retorno_processado_em: string | null
          status: string
          tipo: string
          uf: string
        }
        SetofOptions: {
          from: "*"
          to: "protesto_remessas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_publicar_condicoes: {
        Args: { p: Json }
        Returns: {
          ajustes: Json | null
          analise_credito_id: string
          bill_fine_percent: number
          cnpj: string
          commission_percent: number
          credit_limit: number
          criada_em: string
          definida_por: string | null
          empresa_id: string | null
          erro_validacao: string | null
          expires_at: string
          extension_rate_percent: number
          fee_d0: number
          fee_d1: number
          fee_min_d0: number
          fee_min_d1: number
          fidc_ready: boolean
          has_insurance: boolean
          has_referral: boolean
          id: string
          invest_back_commission_percent: number
          invest_back_limit: number
          matriz_versao: number
          max_due_date_days: number
          max_invoice_amount: number
          monthly_rate_d0: number
          monthly_rate_d1: number
          publicada_em: string | null
          status: string
          sugestao: Json
        }
        SetofOptions: {
          from: "*"
          to: "condicoes_comerciais"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_qualidade_auditar_vinculo: {
        Args: { p: Json }
        Returns: {
          aplicada: boolean
          auditada_em: string | null
          auditada_por: string | null
          auditoria_correta: boolean | null
          candidatas: Json
          criada_em: string
          custo_centavos: number
          empresa_id: string | null
          etapa: string
          id: string
          motivo: string | null
          nao_resolvivel: boolean
          nao_vinculada_id: string
          probabilidade: number | null
        }
        SetofOptions: {
          from: "*"
          to: "vinculacao_tentativas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_qualidade_vinculacao: { Args: { p: Json }; Returns: Json }
      app_qualidade_agregado: { Args: { p: Json }; Returns: Json }
      app_qualidade_resolver_pendencia: {
        Args: { p: Json }
        Returns: {
          analise_id: string
          analise_item_id: string | null
          citacao: string | null
          conversa_id: string | null
          criada_em: string
          descricao: string
          empresa_id: string | null
          id: string
          prazo_em: string | null
          resolvida_em: string | null
          resolvida_por: string | null
          reuniao_id: string | null
          status: string
          tipo: string
          vendedor_id: string
        }
        SetofOptions: {
          from: "*"
          to: "qualidade_pendencias"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_qualidade_override_limiar: {
        Args: { p: Json }
        Returns: {
          atende: string[] | null
          ativo: boolean
          calibracao: Json | null
          calibrado_em: string | null
          chave: string
          condicao_aplicabilidade: string | null
          etapa: string | null
          f1: number | null
          gera_pendencia: string | null
          id: string
          limiar: number | null
          limiar_origem: string | null
          limiar_override_em: string | null
          limiar_override_motivo: string | null
          limiar_override_por: string | null
          n_amostras: number | null
          opcoes: Json | null
          ordem: number
          orientacao: string
          pergunta: string
          peso: number
          precisa_revisao: boolean
          precisao: number | null
          recall: number | null
          rotulo: string
          rubrica_id: string
          status_calibracao: string
          tipo_resposta: string
        }
        SetofOptions: {
          from: "*"
          to: "rubrica_itens"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_qualidade_pedir_recalibracao: {
        Args: { p: Json }
        Returns: {
          ativa: boolean
          ativada_em: string | null
          calibrada_em: string | null
          criada_em: string
          criada_por: string | null
          descricao: string | null
          id: string
          nome: string
          recalibrar_pedido_em: string | null
          tipo_interacao: string
          versao: number
        }
        SetofOptions: {
          from: "*"
          to: "rubricas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_qualidade_ativar_rubrica: {
        Args: { p: Json }
        Returns: {
          ativa: boolean
          ativada_em: string | null
          calibrada_em: string | null
          criada_em: string
          criada_por: string | null
          descricao: string | null
          id: string
          nome: string
          recalibrar_pedido_em: string | null
          tipo_interacao: string
          versao: number
        }
        SetofOptions: {
          from: "*"
          to: "rubricas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_qualidade_salvar_rubrica: {
        Args: { p: Json }
        Returns: {
          ativa: boolean
          ativada_em: string | null
          calibrada_em: string | null
          criada_em: string
          criada_por: string | null
          descricao: string | null
          id: string
          nome: string
          recalibrar_pedido_em: string | null
          tipo_interacao: string
          versao: number
        }
        SetofOptions: {
          from: "*"
          to: "rubricas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_qualidade_rotular: { Args: { p: Json }; Returns: number }
      app_qualidade_para_rotular: { Args: { p: Json }; Returns: Json }
      app_qualidade_decidir_contestacao: {
        Args: { p: Json }
        Returns: {
          analise_id: string
          analise_item_id: string
          contestado_por: string
          criada_em: string
          id: string
          justificativa: string | null
          resposta_gestor: string | null
          revisada_em: string | null
          revisada_por: string | null
          rotulo_humano: string | null
          veredito: string | null
        }
        SetofOptions: {
          from: "*"
          to: "analise_contestacoes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_qualidade_contestacoes: { Args: { p: Json }; Returns: Json }
      app_qualidade_contestar: {
        Args: { p: Json }
        Returns: {
          analise_id: string
          analise_item_id: string
          contestado_por: string
          criada_em: string
          id: string
          justificativa: string | null
          resposta_gestor: string | null
          revisada_em: string | null
          revisada_por: string | null
          rotulo_humano: string | null
          veredito: string | null
        }
        SetofOptions: {
          from: "*"
          to: "analise_contestacoes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_qualidade_feedback: { Args: { p: Json }; Returns: Json }
      app_qualidade_selo: { Args: { p: Json }; Returns: Json }
      app_qualidade_analise: { Args: { p: Json }; Returns: Json }
      app_qualidade_salvar_pessoa: {
        Args: { p: Json }
        Returns: {
          analise_ativa: boolean
          atualizado_em: string
          atualizado_por: string | null
          captura_ativa: boolean
          vendedor_id: string
        }
        SetofOptions: {
          from: "*"
          to: "qualidade_pessoas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_qualidade_pessoas: {
        Args: never
        Returns: {
          analise_ativa: boolean
          captura_ativa: boolean
          is_ia: boolean
          nome: string
          tipo: string
          vendedor_id: string
        }[]
      }
      app_qualidade_segredos: {
        Args: never
        Returns: {
          chave: string
          definido_em: string
          definido_por: string
        }[]
      }
      app_qualidade_salvar_segredo: { Args: { p: Json }; Returns: Json }
      app_qualidade_salvar_config: {
        Args: { p: Json }
        Returns: {
          atualizado_em: string
          atualizado_por: string | null
          chave: string
          valor: Json
        }
        SetofOptions: {
          from: "*"
          to: "qualidade_config"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_rank_origem_metrica: { Args: { p_origem: string }; Returns: number }
      app_reenviar_entrega: {
        Args: { p: Json }
        Returns: {
          analise_id: string | null
          criado_em: string
          entregue_em: string | null
          evento: string
          evento_id: string
          id: string
          payload: Json
          proxima_tentativa_em: string
          status: string
          tentativas: number
          ultima_resposta: string | null
          ultimo_erro: string | null
          ultimo_status_http: number | null
          webhook_id: string
        }
        SetofOptions: {
          from: "*"
          to: "webhook_entregas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_reexibir_ex_cliente: { Args: { p_cnpj: string }; Returns: undefined }
      app_reexibir_spe_certificado: { Args: { p_cnpj: string }; Returns: Json }
      app_registrar_decisao_credito: {
        Args: { p: Json }
        Returns: {
          analise_credito_id: string | null
          atradius_limite: number | null
          atradius_status: string | null
          cenarios: Json | null
          cnpj: string
          concluida_em: string | null
          criada_em: string
          criada_por: string | null
          dados_extraidos: Json | null
          decidida_em: string | null
          decidida_por: string | null
          decisao_final: string | null
          decisao_limite: number | null
          decisao_motivo: string | null
          empresa_id: string | null
          erro: string | null
          etapa: string | null
          extracao_revisada_em: string | null
          extracao_revisada_por: string | null
          gatilho: string
          id: string
          indicadores: Json | null
          lacunas_calculo: Json
          limite_recomendado: number | null
          motivos_nao_operar: Json
          parametros_versao: number
          parecer_editado: string | null
          parecer_editado_em: string | null
          parecer_editado_por: string | null
          parecer_markdown: string | null
          parecer_modelo: string | null
          parecer_tokens: number | null
          protestos_opcoes: Json | null
          protestos_resultado: Json | null
          quadrante: string | null
          recomendacao: string | null
          status: string
          tetos: Json | null
          tipo: string
        }
        SetofOptions: {
          from: "*"
          to: "analises_proprietarias"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_registrar_doc_analise: {
        Args: { p: Json }
        Returns: {
          analise_id: string
          arquivo_url: string
          enviado_em: string
          enviado_por: string | null
          enviado_seguradora_em: string | null
          envio_seguradora_erro: string | null
          exercicio: number | null
          external_id: string | null
          extraido_em: string | null
          id: string
          nome_arquivo: string | null
          origem: string
          paginas: number | null
          tipo: string
        }
        SetofOptions: {
          from: "*"
          to: "analise_docs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_registrar_metrica_importada: {
        Args: { p: Json }
        Returns: {
          capturado_em: string
          cnpj: string
          confianca: string | null
          detalhes: Json
          empresa_id: string | null
          id: string
          metrica: string
          origem: string
          valor: number
        }
        SetofOptions: {
          from: "*"
          to: "empresa_metricas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_registrar_sugestao_perfil: {
        Args: { p: Json }
        Returns: {
          acao: string
          em: string
          id: string
          motivo: string | null
          regra_chave: string | null
          regra_tipo: string | null
          regra_versao_criada: number | null
          snapshot_id: string | null
          sugestao: Json
          sugestao_id: string
          usuario_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "perfil_sugestoes_log"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_registrar_toque_manual: { Args: { p: Json }; Returns: undefined }
      app_remover_supressao: { Args: { p: Json }; Returns: undefined }
      app_report_atualizar: { Args: { p: Json }; Returns: Json }
      app_report_comentar: { Args: { p: Json }; Returns: Json }
      app_report_criar: {
        Args: { p: Json }
        Returns: {
          anexo_url: string | null
          atualizado_em: string
          contexto: Json
          criado_em: string
          criado_por: string
          descricao: string
          duplicado_de: string | null
          id: string
          numero: number
          prioridade: string | null
          resolvido_em: string | null
          status: string
          tipo: string
          titulo: string
        }
        SetofOptions: {
          from: "*"
          to: "reports"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_report_gestor: { Args: never; Returns: boolean }
      app_report_materializar_series: {
        Args: { p_meses?: number }
        Returns: Json
      }
      app_report_semanal: {
        Args: { p_ao_vivo?: boolean; p_fim?: string; p_inicio?: string }
        Returns: Json
      }
      app_retomar_campanha: {
        Args: { p: Json }
        Returns: {
          aprovada_em: string | null
          aprovada_por: string | null
          atualizada_em: string
          canal: string
          concluida_em: string | null
          contas_remetentes: string[]
          criada_em: string
          criada_por: string | null
          definicao_filtro: Json | null
          empresas_manuais: string[]
          excluir_contatados_dias: number
          excluir_conversa_aberta: boolean
          id: string
          inicio_em: string | null
          modo_agente_ao_responder: string
          nome: string
          objetivo: string | null
          origem_publico: string
          pausa_motivo: string | null
          preset: string | null
          preset_params: Json
          respeitar_janela: boolean
          ritmo_por_dia: number
          segmento_id: string | null
          simulacao: Json | null
          simulada_em: string | null
          status: string
          tipo: string
          variantes: Json
          vendedor_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "campanhas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_reuniao_chamar_bot: { Args: { p: Json }; Returns: Json }
      app_reuniao_dispensar_captura: {
        Args: { p: Json }
        Returns: {
          agente_id: string | null
          alerta_sem_bot_em: string | null
          atualizada_em: string
          bot_entrou_em: string | null
          captura_status: string
          contato_id: string | null
          criada_em: string
          dispensada_motivo: string | null
          dispensada_por: string | null
          duracao_s: number | null
          empresa_id: string | null
          evento_id: string
          fireflies_client_reference_id: string | null
          fireflies_meeting_id: string | null
          id: string
          mandato_id: string | null
          participantes_detectados: Json | null
          proximos_passos: Json
          resumo: string | null
          resumo_origem: string | null
          resumo_recebido_em: string | null
          transcricao: string | null
          transcricao_expurgada_em: string | null
          transcricao_recebida_em: string | null
          transcricao_segmentos: Json | null
          url_fireflies: string | null
          vendedor_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "reunioes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_reuniao_captura: { Args: { p: Json }; Returns: Json }
      app_reuniao_do_card: { Args: { p: Json }; Returns: Json }
      app_reverter_fornecedor_sem_interesse: {
        Args: { p: Json }
        Returns: boolean
      }
      app_revisar_extracao: {
        Args: { p: Json }
        Returns: {
          analise_credito_id: string | null
          atradius_limite: number | null
          atradius_status: string | null
          cenarios: Json | null
          cnpj: string
          concluida_em: string | null
          criada_em: string
          criada_por: string | null
          dados_extraidos: Json | null
          decidida_em: string | null
          decidida_por: string | null
          decisao_final: string | null
          decisao_limite: number | null
          decisao_motivo: string | null
          empresa_id: string | null
          erro: string | null
          etapa: string | null
          extracao_revisada_em: string | null
          extracao_revisada_por: string | null
          gatilho: string
          id: string
          indicadores: Json | null
          lacunas_calculo: Json
          limite_recomendado: number | null
          motivos_nao_operar: Json
          parametros_versao: number
          parecer_editado: string | null
          parecer_editado_em: string | null
          parecer_editado_por: string | null
          parecer_markdown: string | null
          parecer_modelo: string | null
          parecer_tokens: number | null
          protestos_opcoes: Json | null
          protestos_resultado: Json | null
          quadrante: string | null
          recomendacao: string | null
          status: string
          tetos: Json | null
          tipo: string
        }
        SetofOptions: {
          from: "*"
          to: "analises_proprietarias"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_revogar_api_key: {
        Args: { p: Json }
        Returns: {
          ativa: boolean
          criada_em: string
          criada_por: string | null
          escopos: string[]
          id: string
          key_hash: string
          nome: string
          prefixo: string
          revogada_em: string | null
          ultimo_uso_em: string | null
        }
        SetofOptions: {
          from: "*"
          to: "api_keys"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_rodar_analise_propria: {
        Args: { p: Json }
        Returns: {
          analise_credito_id: string | null
          atradius_limite: number | null
          atradius_status: string | null
          cenarios: Json | null
          cnpj: string
          concluida_em: string | null
          criada_em: string
          criada_por: string | null
          dados_extraidos: Json | null
          decidida_em: string | null
          decidida_por: string | null
          decisao_final: string | null
          decisao_limite: number | null
          decisao_motivo: string | null
          empresa_id: string | null
          erro: string | null
          etapa: string | null
          extracao_revisada_em: string | null
          extracao_revisada_por: string | null
          gatilho: string
          id: string
          indicadores: Json | null
          lacunas_calculo: Json
          limite_recomendado: number | null
          motivos_nao_operar: Json
          parametros_versao: number
          parecer_editado: string | null
          parecer_editado_em: string | null
          parecer_editado_por: string | null
          parecer_markdown: string | null
          parecer_modelo: string | null
          parecer_tokens: number | null
          protestos_opcoes: Json | null
          protestos_resultado: Json | null
          quadrante: string | null
          recomendacao: string | null
          status: string
          tetos: Json | null
          tipo: string
        }
        SetofOptions: {
          from: "*"
          to: "analises_proprietarias"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_sacado_prospeccao_visivel: {
        Args: { p_cnpj: string }
        Returns: boolean
      }
      app_salvar_acesso_vendedor: { Args: { p: Json }; Returns: undefined }
      app_salvar_antecipacao_config: {
        Args: { p: Json }
        Returns: {
          atualizado_em: string
          atualizado_por: string | null
          chave: string
          valor: Json
        }
        SetofOptions: {
          from: "*"
          to: "antecipacao_config"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_salvar_camada_regra: {
        Args: { p: Json }
        Returns: {
          ativa: boolean
          camada: string
          criada_em: string
          criada_por: string | null
          definicao: Json
          id: string
          versao: number
        }
        SetofOptions: {
          from: "*"
          to: "camada_regras"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_salvar_campanha: {
        Args: { p: Json }
        Returns: {
          aprovada_em: string | null
          aprovada_por: string | null
          atualizada_em: string
          canal: string
          concluida_em: string | null
          contas_remetentes: string[]
          criada_em: string
          criada_por: string | null
          definicao_filtro: Json | null
          empresas_manuais: string[]
          excluir_contatados_dias: number
          excluir_conversa_aberta: boolean
          id: string
          inicio_em: string | null
          modo_agente_ao_responder: string
          nome: string
          objetivo: string | null
          origem_publico: string
          pausa_motivo: string | null
          preset: string | null
          preset_params: Json
          respeitar_janela: boolean
          ritmo_por_dia: number
          segmento_id: string | null
          simulacao: Json | null
          simulada_em: string | null
          status: string
          tipo: string
          variantes: Json
          vendedor_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "campanhas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_salvar_comercial_config: {
        Args: { p: Json }
        Returns: {
          atualizado_em: string
          atualizado_por: string | null
          chave: string
          valor: Json
        }
        SetofOptions: {
          from: "*"
          to: "comercial_config"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_salvar_comissao_regra: {
        Args: { p: Json }
        Returns: {
          criada_em: string
          criada_por: string | null
          id: string
          parametros: Json
          tipo_vendedor: string
          vendedor_id: string | null
          vigente_ate: string | null
          vigente_de: string
        }
        SetofOptions: {
          from: "*"
          to: "comissao_regras"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_salvar_commission_param: {
        Args: { p: Json }
        Returns: {
          chave: string
          criado_em: string
          criado_por: string | null
          id: string
          unidade: string
          valor: number
          vendedor_id: string | null
          vigente_ate: string | null
          vigente_de: string
        }
        SetofOptions: {
          from: "*"
          to: "commission_params"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_salvar_comunicacao_config: { Args: { p: Json }; Returns: undefined }
      app_salvar_condicoes: {
        Args: { p: Json }
        Returns: {
          ajustes: Json | null
          analise_credito_id: string
          bill_fine_percent: number
          cnpj: string
          commission_percent: number
          credit_limit: number
          criada_em: string
          definida_por: string | null
          empresa_id: string | null
          erro_validacao: string | null
          expires_at: string
          extension_rate_percent: number
          fee_d0: number
          fee_d1: number
          fee_min_d0: number
          fee_min_d1: number
          fidc_ready: boolean
          has_insurance: boolean
          has_referral: boolean
          id: string
          invest_back_commission_percent: number
          invest_back_limit: number
          matriz_versao: number
          max_due_date_days: number
          max_invoice_amount: number
          monthly_rate_d0: number
          monthly_rate_d1: number
          publicada_em: string | null
          status: string
          sugestao: Json
        }
        SetofOptions: {
          from: "*"
          to: "condicoes_comerciais"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_salvar_credito_config: {
        Args: { p: Json }
        Returns: {
          atualizado_em: string
          atualizado_por: string | null
          chave: string
          valor: Json
        }
        SetofOptions: {
          from: "*"
          to: "credito_config"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_salvar_faixa_disparo: {
        Args: { p: Json }
        Returns: {
          assunto_email: string | null
          atualizado_em: string
          atualizado_por: string | null
          cooldown_dias: number
          email_habilitado: boolean
          faixa: string
          template_email: string | null
          template_whatsapp: string | null
          whatsapp_contas: string[]
          whatsapp_habilitado: boolean
        }
        SetofOptions: {
          from: "*"
          to: "faixa_disparos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_salvar_faixa_regra: {
        Args: { p: Json }
        Returns: {
          ativa: boolean
          criada_em: string
          criada_por: string | null
          definicao: Json
          faixa: string
          id: string
          versao: number
        }
        SetofOptions: {
          from: "*"
          to: "faixa_regras"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_salvar_formulario: { Args: { p: Json }; Returns: Json }
      app_salvar_fornecedores_config: {
        Args: { p: Json }
        Returns: {
          atualizado_em: string
          atualizado_por: string | null
          chave: string
          valor: Json
        }
        SetofOptions: {
          from: "*"
          to: "fornecedores_config"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_salvar_gmail_conta: {
        Args: { p: Json }
        Returns: {
          access_token_expira_em: string | null
          access_token_secret_id: string | null
          ativo: boolean
          atualizado_em: string
          conectado_em: string
          endereco: string
          escopos: string[]
          history_id: string | null
          refresh_token_secret_id: string | null
          ultimo_erro: string | null
          ultimo_sync_em: string | null
          usuario_id: string
          watch_expira_em: string | null
        }
        SetofOptions: {
          from: "*"
          to: "gmail_contas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_salvar_matriz_precificacao: {
        Args: { p: Json }
        Returns: {
          ativa: boolean
          criada_em: string
          criada_por: string | null
          definicao: Json
          versao: number
        }
        SetofOptions: {
          from: "*"
          to: "precificacao_matriz"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_salvar_motivo_perda: {
        Args: { p: Json }
        Returns: {
          ativo: boolean
          contexto: string
          id: string
          motivo: string
          ordem: number
          retorno_possivel: boolean | null
        }
        SetofOptions: {
          from: "*"
          to: "motivos_perda"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_salvar_parametros_analise: {
        Args: { p: Json }
        Returns: {
          ativa: boolean
          criada_em: string
          criada_por: string | null
          definicao: Json
          nome: string | null
          versao: number
        }
        SetofOptions: {
          from: "*"
          to: "analise_parametros"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_salvar_perfil_config: {
        Args: { p: Json }
        Returns: {
          atualizado_em: string
          atualizado_por: string | null
          chave: string
          valor: Json
        }
        SetofOptions: {
          from: "*"
          to: "perfil_config"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_salvar_playbook: {
        Args: { p: Json }
        Returns: {
          acoes_permitidas: string[]
          ativo: boolean
          atualizado_em: string
          criado_em: string
          funil: string
          id: string
          instrucoes: string
          nome: string
          objetivo: string
          prazos: Json
          templates_disponiveis: string[]
          tipo_mandato: string | null
          versao: number
        }
        SetofOptions: {
          from: "*"
          to: "agente_playbooks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_salvar_prospeccao_config: {
        Args: { p: Json }
        Returns: {
          atualizado_em: string
          atualizado_por: string | null
          chave: string
          valor: Json
        }
        SetofOptions: {
          from: "*"
          to: "prospeccao_config"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_salvar_radar_config: {
        Args: { p: Json }
        Returns: {
          atualizado_em: string
          atualizado_por: string | null
          chave: string
          valor: Json
        }
        SetofOptions: {
          from: "*"
          to: "radar_config"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_salvar_reuniao: {
        Args: { p: Json }
        Returns: {
          acompanhantes: string[]
          atualizado_em: string
          cancelado_em: string | null
          criado_em: string
          criado_por: string | null
          descricao: string | null
          duracao_min: number
          empresa_id: string | null
          google_calendar_id: string | null
          google_conta_usuario_id: string | null
          google_erro: string | null
          google_evento_id: string | null
          google_pendente_em: string | null
          google_sincronizado_em: string | null
          id: string
          inicio_em: string
          local: string | null
          meet_url: string | null
          modalidade: string
          participantes: Json
          sdr_lead_id: string | null
          tipo: string
          titulo: string
          venda_id: string | null
          vendedor_id: string
        }
        SetofOptions: {
          from: "*"
          to: "vendedor_eventos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_salvar_scorecard_versao: {
        Args: { p: Json }
        Returns: {
          ativa: boolean
          criada_em: string
          criada_por: string | null
          definicao: Json
          id: string
          nome: string | null
          versao: number
        }
        SetofOptions: {
          from: "*"
          to: "scorecard_versoes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_salvar_template_mensagem: {
        Args: { p: Json }
        Returns: {
          assunto: string | null
          ativo: boolean
          atualizado_em: string
          canal: string
          corpo: string
          criado_em: string
          criado_por: string | null
          funil: string | null
          id: string
          nome: string
          objetivo: string | null
          variaveis: string[]
        }
        SetofOptions: {
          from: "*"
          to: "templates_mensagem"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_salvar_territorio: {
        Args: { p: Json }
        Returns: {
          faturamento_max: number | null
          faturamento_min: number | null
          ufs: string[]
          vendedor_id: string
        }
        SetofOptions: {
          from: "*"
          to: "vendedor_territorios"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_salvar_vendedor: {
        Args: { p: Json }
        Returns: {
          ativo: boolean
          ausente_ate: string | null
          autonomo: boolean
          closer_id: string | null
          closer_substituto_id: string | null
          criado_em: string
          email_caixa_id: string | null
          email_remetente: string | null
          escopo: Json | null
          id: string
          is_ia: boolean
          limites: Json | null
          modo_rodagem: string
          nome: string
          pausado_em: string | null
          pausado_motivo: string | null
          persona: Json | null
          settings: Json
          superior_id: string | null
          tipo: string
          usuario_id: string | null
          voz_conta_id: string | null
          whatsapp_conta_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "vendedores"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_salvar_webhook: {
        Args: { p: Json }
        Returns: {
          ativo: boolean
          criado_em: string
          criado_por: string | null
          eventos: string[]
          id: string
          nome: string
          secret: string
          url: string
        }
        SetofOptions: {
          from: "*"
          to: "webhooks_saida"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_salvar_whatsapp_conta: {
        Args: { p: Json }
        Returns: {
          apelido: string
          ativo: boolean
          atualizada_em: string
          criada_em: string
          id: string
          intervalo_max_seg: number
          intervalo_min_seg: number
          mensagens_por_dia: number
          numero: string
          provedor: string
          sessao_caiu_em: string | null
          sessao_status: string | null
          sessao_verificada_em: string | null
          tipo: string
          token_definido_em: string | null
          token_secret_id: string | null
          usuario_responsavel: string | null
          warmup_iniciado_em: string | null
          webhook_secret_definido_em: string | null
          webhook_secret_hash: string | null
        }
        SetofOptions: {
          from: "*"
          to: "whatsapp_contas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_sdr_restrito: { Args: never; Returns: boolean }
      app_sincronizar_carteira_originacao: {
        Args: { p_ids: string[]; p_vendedor: string }
        Returns: undefined
      }
      app_sinistro_criar: {
        Args: { p: Json }
        Returns: {
          apolice_id: string
          causa: string
          cobranca_id: string | null
          codigo: string | null
          criado_em: string
          criado_por: string | null
          data_limite_envio: string | null
          data_perda: string
          dossie_gerado_em: string | null
          dossie_hash: string | null
          dossie_path: string | null
          enviado_em: string | null
          estagio: string
          id: string
          indenizacao_estimada: number | null
          indenizacao_recebida: number | null
          justificativa_prova_entrega: string | null
          memoria_perda: Json | null
          modo_envio: string
          motivo_recusa: string | null
          notificado_em: string | null
          perda_segurada_estimada: number | null
          protocolo_externo: string | null
          respondido_em: string | null
          responsavel_id: string | null
          resposta_prevista_em: string | null
          sacado_empresa_id: string | null
          sacado_matriz_cnpj: string
          valor_recebido_parcial: number
          valor_total_face: number
        }
        SetofOptions: {
          from: "*"
          to: "sinistros"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_sinistro_custo: {
        Args: { p: Json }
        Returns: {
          aprovacao_referencia: string | null
          aprovado_pela_seguradora: boolean
          cobranca_id: string | null
          comprovante_path: string | null
          criado_em: string
          criado_por: string | null
          data: string
          descricao: string
          id: string
          sinistro_id: string | null
          valor: number
        }
        SetofOptions: {
          from: "*"
          to: "sinistro_custos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_sinistro_documento: {
        Args: { p: Json }
        Returns: {
          anexado_em: string | null
          anexado_por: string | null
          arquivo_hash: string | null
          arquivo_path: string | null
          descricao: string
          id: string
          item: string
          justificativa_ausencia: string | null
          obrigatorio: boolean
          origem: string
          sinistro_id: string
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "sinistro_documentos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_sinistro_estimativa: {
        Args: { p: Json }
        Returns: {
          apolice_id: string
          causa: string
          cobranca_id: string | null
          codigo: string | null
          criado_em: string
          criado_por: string | null
          data_limite_envio: string | null
          data_perda: string
          dossie_gerado_em: string | null
          dossie_hash: string | null
          dossie_path: string | null
          enviado_em: string | null
          estagio: string
          id: string
          indenizacao_estimada: number | null
          indenizacao_recebida: number | null
          justificativa_prova_entrega: string | null
          memoria_perda: Json | null
          modo_envio: string
          motivo_recusa: string | null
          notificado_em: string | null
          perda_segurada_estimada: number | null
          protocolo_externo: string | null
          respondido_em: string | null
          responsavel_id: string | null
          resposta_prevista_em: string | null
          sacado_empresa_id: string | null
          sacado_matriz_cnpj: string
          valor_recebido_parcial: number
          valor_total_face: number
        }
        SetofOptions: {
          from: "*"
          to: "sinistros"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_sinistro_mover: {
        Args: { p: Json }
        Returns: {
          apolice_id: string
          causa: string
          cobranca_id: string | null
          codigo: string | null
          criado_em: string
          criado_por: string | null
          data_limite_envio: string | null
          data_perda: string
          dossie_gerado_em: string | null
          dossie_hash: string | null
          dossie_path: string | null
          enviado_em: string | null
          estagio: string
          id: string
          indenizacao_estimada: number | null
          indenizacao_recebida: number | null
          justificativa_prova_entrega: string | null
          memoria_perda: Json | null
          modo_envio: string
          motivo_recusa: string | null
          notificado_em: string | null
          perda_segurada_estimada: number | null
          protocolo_externo: string | null
          respondido_em: string | null
          responsavel_id: string | null
          resposta_prevista_em: string | null
          sacado_empresa_id: string | null
          sacado_matriz_cnpj: string
          valor_recebido_parcial: number
          valor_total_face: number
        }
        SetofOptions: {
          from: "*"
          to: "sinistros"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_sinistro_solicitacao: {
        Args: { p: Json }
        Returns: {
          descricao: string
          id: string
          prazo_em: string
          respondida_em: string | null
          sinistro_id: string
          solicitada_em: string
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "sinistro_solicitacoes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_solicitar_analise: {
        Args: { p: Json }
        Returns: {
          analise_propria_id: string | null
          atradius_buyer_id: string | null
          atradius_case_id: string | null
          atualizada_em: string
          cnpj: string
          codigo_decisao: string | null
          codigo_historico: string | null
          contato_externo: Json | null
          criada_em: string
          decidida_em: string | null
          decisao_interna: string | null
          decisao_interna_em: string | null
          empresa_id: string | null
          envio_manual_em: string | null
          envio_manual_por: string | null
          estagio: string
          expira_em: string | null
          expirada_em: string | null
          external_id: string | null
          id: string
          limite_aprovado: number | null
          limite_operacional: number | null
          limite_solicitado: number | null
          moeda: string
          motivo: string | null
          observacoes: string | null
          origem: string
          origem_externa: string | null
          origem_motivo: string | null
          rating_classe_seguradora: string | null
          rating_seguradora: string | null
          seguradora: string
          solicitada_por: string | null
          substituida_em: string | null
          substituida_por: string | null
        }
        SetofOptions: {
          from: "*"
          to: "analises_credito"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_solicitar_analise_da_venda: {
        Args: { p: Json }
        Returns: {
          analise_propria_id: string | null
          atradius_buyer_id: string | null
          atradius_case_id: string | null
          atualizada_em: string
          cnpj: string
          codigo_decisao: string | null
          codigo_historico: string | null
          contato_externo: Json | null
          criada_em: string
          decidida_em: string | null
          decisao_interna: string | null
          decisao_interna_em: string | null
          empresa_id: string | null
          envio_manual_em: string | null
          envio_manual_por: string | null
          estagio: string
          expira_em: string | null
          expirada_em: string | null
          external_id: string | null
          id: string
          limite_aprovado: number | null
          limite_operacional: number | null
          limite_solicitado: number | null
          moeda: string
          motivo: string | null
          observacoes: string | null
          origem: string
          origem_externa: string | null
          origem_motivo: string | null
          rating_classe_seguradora: string | null
          rating_seguradora: string | null
          seguradora: string
          solicitada_por: string | null
          substituida_em: string | null
          substituida_por: string | null
        }
        SetofOptions: {
          from: "*"
          to: "analises_credito"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_suprimir: {
        Args: { p: Json }
        Returns: {
          contexto: string
          criado_em: string
          criado_por: string | null
          escopo: string
          expira_em: string | null
          id: string
          motivo: string
          observacao: string | null
          valor: string
        }
        SetofOptions: {
          from: "*"
          to: "supressao"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_tem_modulo: { Args: { p_modulo_id: string }; Returns: boolean }
      app_usuario_ativo: { Args: never; Returns: boolean }
      app_ve_analise_pela_venda: {
        Args: { p_analise_id: string }
        Returns: boolean
      }
      app_ve_card_do_funil: {
        Args: { p_card_id: string; p_funil: string }
        Returns: boolean
      }
      app_vendedor_atual: { Args: never; Returns: string }
      app_vendedor_restrito: { Args: never; Returns: boolean }
      app_vendedor_tipo: { Args: never; Returns: string }
      app_vendedores_visiveis: { Args: never; Returns: string[] }
      app_vendedores_visiveis_comissao: { Args: never; Returns: string[] }
      app_vincular_cnpj_conta: { Args: { p: Json }; Returns: Json }
      app_vincular_pedido_seguradora: {
        Args: { p: Json }
        Returns: {
          analise_propria_id: string | null
          atradius_buyer_id: string | null
          atradius_case_id: string | null
          atualizada_em: string
          cnpj: string
          codigo_decisao: string | null
          codigo_historico: string | null
          contato_externo: Json | null
          criada_em: string
          decidida_em: string | null
          decisao_interna: string | null
          decisao_interna_em: string | null
          empresa_id: string | null
          envio_manual_em: string | null
          envio_manual_por: string | null
          estagio: string
          expira_em: string | null
          expirada_em: string | null
          external_id: string | null
          id: string
          limite_aprovado: number | null
          limite_operacional: number | null
          limite_solicitado: number | null
          moeda: string
          motivo: string | null
          observacoes: string | null
          origem: string
          origem_externa: string | null
          origem_motivo: string | null
          rating_classe_seguradora: string | null
          rating_seguradora: string | null
          seguradora: string
          solicitada_por: string | null
          substituida_em: string | null
          substituida_por: string | null
        }
        SetofOptions: {
          from: "*"
          to: "analises_credito"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_vincular_sacado: {
        Args: { p: Json }
        Returns: {
          atualizado_em: string
          cnpj: string
          criado_em: string
          criado_por: string | null
          empresa_id: string
          motivo: string
        }
        SetofOptions: {
          from: "*"
          to: "sacado_vinculo"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_vincular_versao_sugestao: {
        Args: { p: Json }
        Returns: {
          acao: string
          em: string
          id: string
          motivo: string | null
          regra_chave: string | null
          regra_tipo: string | null
          regra_versao_criada: number | null
          snapshot_id: string | null
          sugestao: Json
          sugestao_id: string
          usuario_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "perfil_sugestoes_log"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_voz_cancelar: { Args: { p: Json }; Returns: Json }
      app_voz_enfileirar: {
        Args: { p: Json }
        Returns: {
          access_key: string | null
          agendada_para: string | null
          atualizada_em: string
          cancelada_em: string | null
          cancelada_por: string | null
          chamada_id: string | null
          comunicacao_id: string | null
          contato_id: string | null
          criada_em: string
          custo_centavos: number | null
          duracao_s: number | null
          empresa_id: string | null
          encerrada_em: string | null
          enfileirada_por: string | null
          enviada_em: string | null
          erro: string | null
          fornecedor_cnpj: string | null
          id: string
          id_externo: string
          iniciada_em: string | null
          ligacao_id: string | null
          links: Json | null
          mandato_id: string | null
          motivo_recusa: string | null
          objetivo: string
          origem: string
          outcome: string | null
          pedido: Json | null
          resultado: Json | null
          resumo: string | null
          status: string
          telefone: string | null
          tentativa: number
          tentativas: number
          transcricao: Json | null
          ultima_tentativa_em: string | null
          versao_api: string | null
        }
        SetofOptions: {
          from: "*"
          to: "voz_ligacoes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_webhook_teste: {
        Args: { p: Json }
        Returns: {
          analise_id: string | null
          criado_em: string
          entregue_em: string | null
          evento: string
          evento_id: string
          id: string
          payload: Json
          proxima_tentativa_em: string
          status: string
          tentativas: number
          ultima_resposta: string | null
          ultimo_erro: string | null
          ultimo_status_http: number | null
          webhook_id: string
        }
        SetofOptions: {
          from: "*"
          to: "webhook_entregas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      certificado_funil: { Args: { p_vendedor_id?: string }; Returns: Json }
      certificado_funil_sincronizar: { Args: never; Returns: Json }
      certificados_grid: { Args: never; Returns: Json }
      cnae_grupos_de: {
        Args: { p_principal: string; p_secundarios: string[] }
        Returns: string[]
      }
      comercial_alcance_da_carteira: {
        Args: { p_vendedor_id: string }
        Returns: Json
      }
      comercial_carteira_vendedor: {
        Args: { p_vendedor_id?: string }
        Returns: Json
      }
      comercial_contas_fase: { Args: never; Returns: Json }
      comercial_resumo_vendedor: {
        Args: { p_vendedor_id?: string }
        Returns: Json
      }
      comercial_sacados_sem_conta: { Args: never; Returns: Json }
      comercial_vendedores_da_comissao: { Args: never; Returns: Json }
      comercial_vendedores_visiveis: { Args: never; Returns: Json }
      comercial_vinculos_da_conta: {
        Args: { p_empresa_id: string }
        Returns: Json
      }
      comissao_painel_v2: {
        Args: { p_meses?: number; p_vendedor_id?: string }
        Returns: Json
      }
      comissao_reclassificacao: {
        Args: { p_janela_dias?: number }
        Returns: Json
      }
      condicoes_painel: {
        Args: { p_analise_credito_id: string }
        Returns: Json
      }
      empresa_analise_financeira: {
        Args: { p_empresa_id: string }
        Returns: Json
      }
      empresa_grupo_protestos: { Args: { p_empresa_id: string }; Returns: Json }
      ex_clientes_analise: { Args: never; Returns: Json }
      ex_clientes_lista: {
        Args: { p_motivos?: string[]; p_recorte: string }
        Returns: Json
      }
      ex_clientes_por_motivo: { Args: { p_meses?: number }; Returns: Json }
      formulario_publico: { Args: { p_slug: string }; Returns: Json }
      formularios_lista: { Args: never; Returns: Json }
      fornecedores_eficacia_fontes: { Args: never; Returns: Json }
      fornecedores_painel: { Args: { p_originador_id?: string }; Returns: Json }
      mercado_amostra_camada: {
        Args: {
          p_camada: string
          p_limite: number
          p_tipo: string
          p_uf: string
        }
        Returns: Json
      }
      mercado_contar_exato: {
        Args: { p_arvore?: Json; p_termo?: string }
        Returns: number
      }
      mercado_explorar: {
        Args: {
          p_arvore?: Json
          p_asc?: boolean
          p_limite?: number
          p_offset?: number
          p_ordem?: string
          p_termo?: string
        }
        Returns: Json
      }
      mercado_mapa: {
        Args: { p_limite?: number; p_tipo?: string; p_uf?: string }
        Returns: Json
      }
      mercado_piramide: { Args: never; Returns: Json }
      mercado_pred: { Args: { no: Json }; Returns: string }
      mercado_where: {
        Args: { p_arvore: Json; p_termo: string }
        Returns: string
      }
      meu_dia: {
        Args: { p_config?: Json; p_vendedor_id?: string }
        Returns: Json
      }
      natureza_juridica_codigo: { Args: { bruto: string }; Returns: string }
      notificacao__entregar: {
        Args: {
          p_ator: string
          p_empresa_id: string
          p_payload: Json
          p_tipo: string
        }
        Returns: string[]
      }
      notificacao__exemplo: {
        Args: { p_tipo: string }
        Returns: {
          empresa_id: string
          payload: Json
        }[]
      }
      notificacao__formatar: {
        Args: { p_filtro: string; p_valor: string }
        Returns: string
      }
      notificacao__quando: {
        Args: { p_gravidade: string; p_respeita_silencio: boolean }
        Returns: string
      }
      notificacao__uuid: { Args: { p: string }; Returns: string }
      notificacao_emitir: {
        Args: {
          p_ator?: string
          p_empresa_id?: string
          p_payload?: Json
          p_tipo: string
        }
        Returns: string[]
      }
      notificacao_renderizar: {
        Args: { p_modelo: string; p_vars: Json }
        Returns: string
      }
      notificacao_resolver_papel: {
        Args: { p_empresa_id: string; p_papel: string; p_payload: Json }
        Returns: string[]
      }
      notificacao_texto: {
        Args: { p_empresa_id?: string; p_payload?: Json; p_tipo: string }
        Returns: Json
      }
      perfil_snapshot_atual: { Args: { p: Json }; Returns: Json }
      precificacao_amostra: { Args: { p_meses?: number }; Returns: Json }
      prospeccao_notas: { Args: { p: Json }; Returns: Json }
      prospeccao_painel: { Args: { p_originador_id?: string | null }; Returns: Json }
      radar_cobertura: { Args: never; Returns: Json }
      radar_custo_protestos_mensal: { Args: never; Returns: Json }
      radar_grupo_spes_monitoramento: {
        Args: { p_grupo_id: string }
        Returns: Json
      }
      radar_onepay_analytics: { Args: never; Returns: Json }
      radar_onepay_clientes: {
        Args: { p_dimensao: string; p_valor: string }
        Returns: Json
      }
      radar_onepay_protestos_cliente: {
        Args: { p_cnpj: string }
        Returns: Json
      }
      radar_onepay_titulos: {
        Args: { p_cnpjs: string[] }
        Returns: {
          cnpj: string
          data: string
          valor: number
        }[]
      }
      radar_protestos_empresa_previa: {
        Args: {
          p_ano_min: number
          p_empresa_id: string
          p_incluir_spes: boolean
          p_somente_afiancadas?: boolean
        }
        Returns: Json
      }
      raiz_e_spe: { Args: { p_cnpj: string }; Returns: boolean }
      recalcular_processo_ativo_da_empresa: {
        Args: { p_empresa: string }
        Returns: undefined
      }
      reports_painel: { Args: never; Returns: Json }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

// Compat: helper Views<> (o gerador novo dobra views em Tables<>, mas o repo importa Views<'x'>).
export type Views<
  DefaultSchemaViewNameOrOptions extends
    | keyof DefaultSchema["Views"]
    | { schema: keyof DatabaseWithoutInternals },
  ViewName extends DefaultSchemaViewNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaViewNameOrOptions["schema"]]["Views"]
    : never = never,
> = DefaultSchemaViewNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaViewNameOrOptions["schema"]]["Views"][ViewName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaViewNameOrOptions extends keyof DefaultSchema["Views"]
    ? DefaultSchema["Views"][DefaultSchemaViewNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never
