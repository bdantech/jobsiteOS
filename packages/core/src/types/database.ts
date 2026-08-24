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
      analises_plataforma: {
        Row: {
          available_limit: number | null
          bill_fine: number | null
          cnpj: string
          commission_percent: number | null
          company_name: string | null
          consumed_limit: number | null
          credit_limit: number | null
          empresa_cadastrada: boolean
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
          sincronizada_em: string
          status: string
          role: string
          ever_approved: boolean | null
          company_type: string | null
        }
        Insert: {
          available_limit?: number | null
          bill_fine?: number | null
          cnpj: string
          commission_percent?: number | null
          company_name?: string | null
          consumed_limit?: number | null
          credit_limit?: number | null
          empresa_cadastrada: boolean
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
          sincronizada_em?: string
          status: string
          role?: string
          ever_approved?: boolean | null
          company_type?: string | null
        }
        Update: {
          available_limit?: number | null
          bill_fine?: number | null
          cnpj?: string
          commission_percent?: number | null
          company_name?: string | null
          consumed_limit?: number | null
          credit_limit?: number | null
          empresa_cadastrada?: boolean
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
          sincronizada_em?: string
          status?: string
          role?: string
          ever_approved?: boolean | null
          company_type?: string | null
        }
        Relationships: []
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
            referencedRelation: "notas_fiscais"
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
      formularios: {
        Row: {
          id: string
          slug: string
          nome: string
          descricao: string | null
          titulo: string | null
          subtitulo: string | null
          texto_botao: string
          mensagem_sucesso: string | null
          ajuda_cnpj: string | null
          campos: Json
          pergunta_intencao: Json | null
          consentimento_texto: string | null
          consentimento_obrigatorio: boolean
          vendedor_destino_id: string | null
          auto_resposta_habilitada: boolean
          auto_resposta_assunto: string | null
          auto_resposta_corpo: string | null
          enriquecimento_pago: boolean
          ativo: boolean
          criado_por: string | null
          criado_em: string
          atualizado_em: string
        }
        Insert: {
          id?: string
          slug: string
          nome: string
          descricao?: string | null
          titulo?: string | null
          subtitulo?: string | null
          texto_botao?: string
          mensagem_sucesso?: string | null
          ajuda_cnpj?: string | null
          campos: Json
          pergunta_intencao?: Json | null
          consentimento_texto?: string | null
          consentimento_obrigatorio?: boolean
          vendedor_destino_id?: string | null
          auto_resposta_habilitada?: boolean
          auto_resposta_assunto?: string | null
          auto_resposta_corpo?: string | null
          enriquecimento_pago?: boolean
          ativo?: boolean
          criado_por?: string | null
        }
        Update: Partial<Database['public']['Tables']['formularios']['Insert']>
        Relationships: []
      }
      formulario_submissoes: {
        Row: {
          id: string
          formulario_id: string | null
          dados: Json
          campos_snapshot: Json
          intencao: string | null
          utm_source: string | null
          utm_medium: string | null
          utm_campaign: string | null
          utm_term: string | null
          utm_content: string | null
          referrer: string | null
          pagina_url: string | null
          user_agent: string | null
          ip_hash: string | null
          cnpj: string | null
          empresa_id: string | null
          contato_id: string | null
          sdr_lead_id: string | null
          status: string
          motivo_revisao: string | null
          divergencia_papel: boolean
          consentimento_aceito: boolean | null
          consentimento_em: string | null
          enriquecimento_resultado: Json | null
          erro: string | null
          criada_em: string
          processada_em: string | null
        }
        Insert: {
          id?: string
          formulario_id?: string | null
          dados: Json
          campos_snapshot: Json
          intencao?: string | null
          utm_source?: string | null
          utm_medium?: string | null
          utm_campaign?: string | null
          utm_term?: string | null
          utm_content?: string | null
          referrer?: string | null
          pagina_url?: string | null
          user_agent?: string | null
          ip_hash?: string | null
          cnpj?: string | null
          empresa_id?: string | null
          contato_id?: string | null
          sdr_lead_id?: string | null
          status?: string
          motivo_revisao?: string | null
          divergencia_papel?: boolean
          consentimento_aceito?: boolean | null
          consentimento_em?: string | null
          enriquecimento_resultado?: Json | null
          erro?: string | null
          processada_em?: string | null
        }
        Update: Partial<Database['public']['Tables']['formulario_submissoes']['Insert']>
        Relationships: []
      }
      formulario_visualizacoes: {
        Row: {
          id: number
          formulario_id: string | null
          utm_source: string | null
          utm_campaign: string | null
          pagina_url: string | null
          visto_em: string
        }
        Insert: {
          formulario_id?: string | null
          utm_source?: string | null
          utm_campaign?: string | null
          pagina_url?: string | null
          visto_em?: string
        }
        Update: never
        Relationships: []
      }
      certificado_cards: {
        Row: {
          id: string
          empresa_id: string
          estagio: string
          estagio_anterior: string | null
          perdido_motivo: string | null
          perdido_em: string | null
          ganho_em: string | null
          fechado_matriz_coberta: boolean | null
          fechado_cobertos: number | null
          observacao: string | null
          aberto_em: string
          atualizado_em: string
          atualizado_por: string | null
        }
        Insert: {
          id?: string
          empresa_id: string
          estagio?: string
          estagio_anterior?: string | null
          perdido_motivo?: string | null
          perdido_em?: string | null
          ganho_em?: string | null
          fechado_matriz_coberta?: boolean | null
          fechado_cobertos?: number | null
          observacao?: string | null
          aberto_em?: string
          atualizado_em?: string
          atualizado_por?: string | null
        }
        Update: {
          estagio?: string
          estagio_anterior?: string | null
          perdido_motivo?: string | null
          perdido_em?: string | null
          ganho_em?: string | null
          fechado_matriz_coberta?: boolean | null
          fechado_cobertos?: number | null
          observacao?: string | null
          atualizado_em?: string
          atualizado_por?: string | null
        }
        Relationships: []
      }
      certificado_card_eventos: {
        Row: {
          id: number
          card_id: string
          de: string | null
          para: string
          motivo: string | null
          automatico: boolean
          detalhe: string | null
          usuario_id: string | null
          criado_em: string
        }
        Insert: {
          card_id: string
          de?: string | null
          para: string
          motivo?: string | null
          automatico?: boolean
          detalhe?: string | null
          usuario_id?: string | null
          criado_em?: string
        }
        Update: never
        Relationships: []
      }
      certificados: {
        Row: {
          cnpj: string
          company_name: string | null
          expires_at: string | null
          status: string | null
          expires_at_anterior: string | null
          ultimo_alerta: string | null
          sincronizado_em: string
        }
        Insert: {
          cnpj: string
          company_name?: string | null
          expires_at?: string | null
          status?: string | null
          expires_at_anterior?: string | null
          ultimo_alerta?: string | null
          sincronizado_em?: string
        }
        Update: {
          cnpj?: string
          company_name?: string | null
          expires_at?: string | null
          status?: string | null
          expires_at_anterior?: string | null
          ultimo_alerta?: string | null
          sincronizado_em?: string
        }
        Relationships: []
      }
      certificados_spe_ocultas: {
        Row: {
          cnpj: string
          oculto_por: string | null
          oculto_em: string
        }
        Insert: {
          cnpj: string
          oculto_por?: string | null
          oculto_em?: string
        }
        Update: {
          cnpj?: string
          oculto_por?: string | null
          oculto_em?: string
        }
        Relationships: []
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
            referencedRelation: "empresas"
            referencedColumns: ["id"]
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
      contatos: {
        Row: {
          apollo_person_id: string | null
          cargo: string | null
          criado_em: string
          departamento: string | null
          email: string | null
          email_status: string | null
          empresa_id: string
          enriquecido_em: string | null
          id: string
          linkedin_url: string | null
          nome: string | null
          origem: string | null
          ponto_focal: boolean
          senioridade: string | null
          telefone: string | null
          telefone_status: string | null
          whatsapp: string | null
        }
        Insert: {
          apollo_person_id?: string | null
          cargo?: string | null
          criado_em?: string
          departamento?: string | null
          email?: string | null
          email_status?: string | null
          empresa_id: string
          enriquecido_em?: string | null
          id?: string
          linkedin_url?: string | null
          nome?: string | null
          origem?: string | null
          ponto_focal?: boolean
          senioridade?: string | null
          telefone?: string | null
          telefone_status?: string | null
          whatsapp?: string | null
        }
        Update: {
          apollo_person_id?: string | null
          cargo?: string | null
          criado_em?: string
          departamento?: string | null
          email?: string | null
          email_status?: string | null
          empresa_id?: string
          enriquecido_em?: string | null
          id?: string
          linkedin_url?: string | null
          nome?: string | null
          origem?: string | null
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
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      analises_credito: {
        Row: {
          analise_propria_id: string | null
          atradius_buyer_id: string | null
          codigo_decisao: string | null
          codigo_historico: string | null
          rating_classe_seguradora: string | null
          atradius_case_id: string | null
          atualizada_em: string
          cnpj: string
          criada_em: string
          decidida_em: string | null
          decisao_interna: string | null
          decisao_interna_em: string | null
          empresa_id: string | null
          estagio: string
          expira_em: string | null
          id: string
          limite_aprovado: number | null
          limite_operacional: number | null
          limite_solicitado: number | null
          moeda: string
          motivo: string | null
          observacoes: string | null
          origem: string
          rating_seguradora: string | null
          seguradora: string
          solicitada_por: string | null
        }
        Insert: {
          analise_propria_id?: string | null
          atradius_buyer_id?: string | null
          codigo_decisao?: string | null
          codigo_historico?: string | null
          rating_classe_seguradora?: string | null
          atradius_case_id?: string | null
          atualizada_em?: string
          cnpj: string
          criada_em?: string
          decidida_em?: string | null
          decisao_interna?: string | null
          decisao_interna_em?: string | null
          empresa_id?: string | null
          estagio?: string
          expira_em?: string | null
          id?: string
          limite_aprovado?: number | null
          limite_operacional?: number | null
          limite_solicitado?: number | null
          moeda?: string
          motivo?: string | null
          observacoes?: string | null
          origem?: string
          rating_seguradora?: string | null
          seguradora?: string
          solicitada_por?: string | null
        }
        Update: {
          analise_propria_id?: string | null
          atradius_buyer_id?: string | null
          codigo_decisao?: string | null
          codigo_historico?: string | null
          rating_classe_seguradora?: string | null
          atradius_case_id?: string | null
          atualizada_em?: string
          cnpj?: string
          criada_em?: string
          decidida_em?: string | null
          decisao_interna?: string | null
          decisao_interna_em?: string | null
          empresa_id?: string | null
          estagio?: string
          expira_em?: string | null
          id?: string
          limite_aprovado?: number | null
          limite_operacional?: number | null
          limite_solicitado?: number | null
          moeda?: string
          motivo?: string | null
          observacoes?: string | null
          origem?: string
          rating_seguradora?: string | null
          seguradora?: string
          solicitada_por?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "analises_credito_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
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
          extraido_em: string | null
          id: string
          nome_arquivo: string | null
          paginas: number | null
          tipo: string
        }
        Insert: {
          analise_id: string
          arquivo_url: string
          enviado_em?: string
          enviado_por?: string | null
          extraido_em?: string | null
          id?: string
          nome_arquivo?: string | null
          paginas?: number | null
          tipo: string
        }
        Update: {
          analise_id?: string
          arquivo_url?: string
          enviado_em?: string
          enviado_por?: string | null
          extraido_em?: string | null
          id?: string
          nome_arquivo?: string | null
          paginas?: number | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "analise_docs_analise_id_fkey"
            columns: ["analise_id"]
            isOneToOne: false
            referencedRelation: "analises_credito"
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
            referencedRelation: "analises_credito"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analises_proprietarias_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
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
        Relationships: []
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
            referencedRelation: "empresas"
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
            referencedRelation: "empresas"
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
            referencedRelation: "empresas"
            referencedColumns: ["id"]
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
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      empresas: {
        Row: {
          atualizado_em: string
          camada: string | null
          churn_erp_concorrente: boolean
          cnae_principal: string | null
          cnpj: string
          criado_em: string
          credito_calculado_em: string | null
          credito_versao: number | null
          chance_concessao: number | null
          limite_confianca: string | null
          limite_potencial: number | null
          receita_mensal_prevista: number | null
          receita_taxa_am: number | null
          score_calculado_em: string | null
          score_completude: number | null
          score_credito: number | null
          score_faixa: string | null
          valor_esperado_mensal: number | null
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
          gestao_definida_em: string | null
          gestao_definida_por: string | null
          gestao_operacao: string | null
          faturamento_anual: number | null
          faturamento_atualizado_em: string | null
          patrimonio_atualizado_em: string | null
          patrimonio_liquido: number | null
          patrimonio_origem: string | null
          faturamento_confianca: string | null
          faturamento_origem: string | null
          funcionarios: number | null
          funcionarios_atualizado_em: string | null
          funcionarios_crescimento_12m: number | null
          funcionarios_origem: string | null
          grafo_sefaz: boolean
          grupo_id: string | null
          id: string
          is_spe: boolean
          municipio: string | null
          nome_fantasia: string | null
          origem: string | null
          porte: string | null
          razao_social: string | null
          regime_tributario: string | null
          tipagem_antecipacao: string | null
          tipo: string
          uf: string | null
          ultima_antecipacao: string | null
          ex_cliente_desde: string | null
          ex_cliente_motivo: string | null
          ex_cliente_motivo_obs: string | null
          teve_analise_sem_cadastro: boolean
        }
        Insert: {
          atualizado_em?: string
          camada?: string | null
          churn_erp_concorrente?: boolean
          cnae_principal?: string | null
          cnpj: string
          criado_em?: string
          credito_calculado_em?: string | null
          credito_versao?: number | null
          chance_concessao?: number | null
          limite_confianca?: string | null
          limite_potencial?: number | null
          receita_mensal_prevista?: number | null
          receita_taxa_am?: number | null
          score_calculado_em?: string | null
          score_completude?: number | null
          score_credito?: number | null
          score_faixa?: string | null
          valor_esperado_mensal?: number | null
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
          gestao_definida_em?: string | null
          gestao_definida_por?: string | null
          gestao_operacao?: string | null
          faturamento_anual?: number | null
          faturamento_atualizado_em?: string | null
          patrimonio_atualizado_em?: string | null
          patrimonio_liquido?: number | null
          patrimonio_origem?: string | null
          faturamento_confianca?: string | null
          faturamento_origem?: string | null
          funcionarios?: number | null
          funcionarios_atualizado_em?: string | null
          funcionarios_crescimento_12m?: number | null
          funcionarios_origem?: string | null
          grafo_sefaz?: boolean
          grupo_id?: string | null
          id?: string
          is_spe?: boolean
          municipio?: string | null
          nome_fantasia?: string | null
          origem?: string | null
          porte?: string | null
          razao_social?: string | null
          regime_tributario?: string | null
          tipagem_antecipacao?: string | null
          tipo?: string
          uf?: string | null
          ultima_antecipacao?: string | null
          ex_cliente_desde?: string | null
          ex_cliente_motivo?: string | null
          ex_cliente_motivo_obs?: string | null
          teve_analise_sem_cadastro?: boolean
        }
        Update: {
          atualizado_em?: string
          camada?: string | null
          churn_erp_concorrente?: boolean
          cnae_principal?: string | null
          cnpj?: string
          criado_em?: string
          credito_calculado_em?: string | null
          credito_versao?: number | null
          chance_concessao?: number | null
          limite_confianca?: string | null
          limite_potencial?: number | null
          receita_mensal_prevista?: number | null
          receita_taxa_am?: number | null
          score_calculado_em?: string | null
          score_completude?: number | null
          score_credito?: number | null
          score_faixa?: string | null
          valor_esperado_mensal?: number | null
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
          gestao_definida_em?: string | null
          gestao_definida_por?: string | null
          gestao_operacao?: string | null
          faturamento_anual?: number | null
          faturamento_atualizado_em?: string | null
          patrimonio_atualizado_em?: string | null
          patrimonio_liquido?: number | null
          patrimonio_origem?: string | null
          faturamento_confianca?: string | null
          faturamento_origem?: string | null
          funcionarios?: number | null
          funcionarios_atualizado_em?: string | null
          funcionarios_crescimento_12m?: number | null
          funcionarios_origem?: string | null
          grafo_sefaz?: boolean
          grupo_id?: string | null
          id?: string
          is_spe?: boolean
          municipio?: string | null
          nome_fantasia?: string | null
          origem?: string | null
          porte?: string | null
          razao_social?: string | null
          regime_tributario?: string | null
          tipagem_antecipacao?: string | null
          tipo?: string
          uf?: string | null
          ultima_antecipacao?: string | null
          ex_cliente_desde?: string | null
          ex_cliente_motivo?: string | null
          ex_cliente_motivo_obs?: string | null
          teve_analise_sem_cadastro?: boolean
        }
        Relationships: [
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
            referencedRelation: "empresas"
            referencedColumns: ["id"]
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
            referencedRelation: "empresas"
            referencedColumns: ["id"]
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
      mensagens_outbox: {
        Row: {
          access_keys: string[]
          assunto: string | null
          atualizada_em: string
          canal: string
          corpo: string | null
          criada_em: string
          descartada_por: string | null
          destinatario: string | null
          destinatario_contato_id: string | null
          destinatario_ponto_focal: boolean
          faixa: string | null
          fornecedor_cnpj: string
          fornecedor_empresa_id: string | null
          fornecedor_nome: string | null
          id: string
          motivo_descarte: string | null
          status: string
          valor_total: number | null
          whatsapp_conta_id: string | null
        }
        Insert: {
          access_keys: string[]
          assunto?: string | null
          atualizada_em?: string
          canal: string
          corpo?: string | null
          criada_em?: string
          descartada_por?: string | null
          destinatario?: string | null
          destinatario_contato_id?: string | null
          destinatario_ponto_focal?: boolean
          faixa?: string | null
          fornecedor_cnpj: string
          fornecedor_empresa_id?: string | null
          fornecedor_nome?: string | null
          id?: string
          motivo_descarte?: string | null
          status?: string
          valor_total?: number | null
          whatsapp_conta_id?: string | null
        }
        Update: {
          access_keys?: string[]
          assunto?: string | null
          atualizada_em?: string
          canal?: string
          corpo?: string | null
          criada_em?: string
          descartada_por?: string | null
          destinatario?: string | null
          destinatario_contato_id?: string | null
          destinatario_ponto_focal?: boolean
          faixa?: string | null
          fornecedor_cnpj?: string
          fornecedor_empresa_id?: string | null
          fornecedor_nome?: string | null
          id?: string
          motivo_descarte?: string | null
          status?: string
          valor_total?: number | null
          whatsapp_conta_id?: string | null
        }
        Relationships: [
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
            foreignKeyName: "mensagens_outbox_fornecedor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
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
            referencedRelation: "empresas"
            referencedColumns: ["id"]
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
          contato_fornecedor: Json | null
          contato_sacado: Json | null
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
          nf_id_externo: string | null
          numero: string | null
          parcelas: Json | null
          perda_motivo: string | null
          raw_xml: string | null
          receita_esperada: number | null
          sacado_cadastrado: boolean | null
          sacado_cnpj: string
          sacado_empresa_id: string | null
          sacado_nome: string | null
          serie: string | null
          sincronizada_em: string | null
          status_sync: string | null
          taxa_usada: number | null
          tipo: string
          valor: number
          vendedor_definido_em: string | null
          vendedor_id: string | null
          vendedor_origem: string | null
          vencimento: string | null
          vencimento_origem: string | null
          natureza_operacao: string | null
          operavel: boolean
          operavel_manual: boolean | null
          nao_operavel_motivo: string | null
          xml_parse_erro: string | null
          conversao_antecipacao_id: number | null
          conversao_em_disputa: boolean
        }
        Insert: {
          access_key: string
          atualizada_em?: string
          contato_fornecedor?: Json | null
          contato_sacado?: Json | null
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
          nf_id_externo?: string | null
          numero?: string | null
          parcelas?: Json | null
          perda_motivo?: string | null
          raw_xml?: string | null
          receita_esperada?: number | null
          sacado_cadastrado?: boolean | null
          sacado_cnpj: string
          sacado_empresa_id?: string | null
          sacado_nome?: string | null
          serie?: string | null
          sincronizada_em?: string | null
          status_sync?: string | null
          taxa_usada?: number | null
          tipo: string
          valor: number
          vencimento?: string | null
          vencimento_origem?: string | null
          natureza_operacao?: string | null
          operavel?: boolean
          operavel_manual?: boolean | null
          nao_operavel_motivo?: string | null
          xml_parse_erro?: string | null
          conversao_antecipacao_id?: number | null
          conversao_em_disputa?: boolean
        }
        Update: {
          access_key?: string
          atualizada_em?: string
          contato_fornecedor?: Json | null
          contato_sacado?: Json | null
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
          nf_id_externo?: string | null
          numero?: string | null
          parcelas?: Json | null
          perda_motivo?: string | null
          raw_xml?: string | null
          receita_esperada?: number | null
          sacado_cadastrado?: boolean | null
          sacado_cnpj?: string
          sacado_empresa_id?: string | null
          sacado_nome?: string | null
          serie?: string | null
          sincronizada_em?: string | null
          status_sync?: string | null
          taxa_usada?: number | null
          tipo?: string
          valor?: number
          vendedor_definido_em?: string | null
          vendedor_id?: string | null
          vendedor_origem?: string | null
          vencimento?: string | null
          vencimento_origem?: string | null
          natureza_operacao?: string | null
          operavel?: boolean
          operavel_manual?: boolean | null
          nao_operavel_motivo?: string | null
          xml_parse_erro?: string | null
          conversao_antecipacao_id?: number | null
          conversao_em_disputa?: boolean
        }
        Relationships: [
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
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notas_fiscais_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
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
        Relationships: []
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
      notificacao_regras: {
        Row: {
          ativo: boolean
          criado_em: string
          id: string
          perfil_id: string | null
          tipo_evento: string
          usuario_id: string | null
        }
        Insert: {
          ativo?: boolean
          criado_em?: string
          id?: string
          perfil_id?: string | null
          tipo_evento: string
          usuario_id?: string | null
        }
        Update: {
          ativo?: boolean
          criado_em?: string
          id?: string
          perfil_id?: string | null
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
      notificacoes: {
        Row: {
          corpo: string | null
          criado_em: string
          id: string
          lida: boolean
          titulo: string
          url: string | null
          usuario_id: string
        }
        Insert: {
          corpo?: string | null
          criado_em?: string
          id?: string
          lida?: boolean
          titulo: string
          url?: string | null
          usuario_id: string
        }
        Update: {
          corpo?: string | null
          criado_em?: string
          id?: string
          lida?: boolean
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
            referencedRelation: "empresas"
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
            referencedRelation: "empresas"
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
      usuarios: {
        Row: {
          ativo: boolean
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
      whatsapp_contas: {
        Row: {
          apelido: string
          ativo: boolean
          atualizada_em: string
          criada_em: string
          id: string
          numero: string
          provedor: string
          token_definido_em: string | null
          token_secret_id: string | null
          usuario_responsavel: string | null
        }
        Insert: {
          apelido: string
          ativo?: boolean
          atualizada_em?: string
          criada_em?: string
          id?: string
          numero: string
          provedor?: string
          token_definido_em?: string | null
          token_secret_id?: string | null
          usuario_responsavel?: string | null
        }
        Update: {
          apelido?: string
          ativo?: boolean
          atualizada_em?: string
          criada_em?: string
          id?: string
          numero?: string
          provedor?: string
          token_definido_em?: string | null
          token_secret_id?: string | null
          usuario_responsavel?: string | null
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
        Relationships: []
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
            foreignKeyName: "comissao_lancamentos_vendedor_id_fkey"
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
        Relationships: []
      }
      motivos_perda: {
        Row: {
          ativo: boolean
          contexto: string
          id: string
          motivo: string
          ordem: number
        }
        Insert: {
          ativo?: boolean
          contexto: string
          id?: string
          motivo: string
          ordem?: number
        }
        Update: {
          ativo?: boolean
          contexto?: string
          id?: string
          motivo?: string
          ordem?: number
        }
        Relationships: []
      }
      sdr_leads: {
        Row: {
          atualizado_em: string
          distribuido_em: string
          empresa_id: string
          estagio: string
          encerrado_em: string | null
          encerrado_motivo: string | null
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
          estagio?: string
          encerrado_em?: string | null
          encerrado_motivo?: string | null
          fit?: boolean | null
          fit_definido_em?: string | null
          gestao_definida_em?: string | null
          gestao_definida_por?: string | null
          gestao_operacao?: string | null
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
          estagio?: string
          encerrado_em?: string | null
          encerrado_motivo?: string | null
          fit?: boolean | null
          fit_definido_em?: string | null
          gestao_definida_em?: string | null
          gestao_definida_por?: string | null
          gestao_operacao?: string | null
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
            foreignKeyName: "sdr_leads_sdr_id_fkey"
            columns: ["sdr_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sdr_leads_vendedor_destino_id_fkey"
            columns: ["vendedor_destino_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sdr_leads_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
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
          primeira_operacao_em: string | null
          primeira_operacao_id: number | null
          situacao: string
          id: string
          perdido_em: string | null
          perdido_motivo: string | null
          sdr_lead_id: string | null
          vendedor_id: string
        }
        Insert: {
          analise_credito_id?: string | null
          atualizada_em?: string
          criada_em?: string
          empresa_id: string
          estagio?: string
          ganho_em?: string | null
          primeira_operacao_em?: string | null
          primeira_operacao_id?: number | null
          situacao?: string
          gestao_definida_em?: string | null
          gestao_definida_por?: string | null
          gestao_operacao?: string | null
          id?: string
          perdido_em?: string | null
          perdido_motivo?: string | null
          sdr_lead_id?: string | null
          vendedor_id: string
        }
        Update: {
          analise_credito_id?: string | null
          atualizada_em?: string
          criada_em?: string
          empresa_id?: string
          estagio?: string
          ganho_em?: string | null
          primeira_operacao_em?: string | null
          primeira_operacao_id?: number | null
          situacao?: string
          gestao_definida_em?: string | null
          gestao_definida_por?: string | null
          gestao_operacao?: string | null
          id?: string
          perdido_em?: string | null
          perdido_motivo?: string | null
          sdr_lead_id?: string | null
          vendedor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendas_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
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
        Relationships: []
      }
      vendedor_carteira: {
        Row: {
          ate: string | null
          desde: string
          empresa_id: string
          id: string
          papel: string
          vendedor_id: string
        }
        Insert: {
          ate?: string | null
          desde?: string
          empresa_id: string
          id?: string
          papel: string
          vendedor_id: string
        }
        Update: {
          ate?: string | null
          desde?: string
          empresa_id?: string
          id?: string
          papel?: string
          vendedor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendedor_carteira_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendedor_carteira_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      vendedor_eventos: {
        Row: {
          cancelado_em: string | null
          criado_em: string
          criado_por: string | null
          duracao_min: number
          empresa_id: string | null
          id: string
          inicio_em: string
          sdr_lead_id: string | null
          tipo: string
          titulo: string
          venda_id: string | null
          vendedor_id: string
        }
        Insert: {
          cancelado_em?: string | null
          criado_em?: string
          criado_por?: string | null
          duracao_min?: number
          empresa_id?: string | null
          id?: string
          inicio_em: string
          sdr_lead_id?: string | null
          tipo?: string
          titulo: string
          venda_id?: string | null
          vendedor_id: string
        }
        Update: {
          cancelado_em?: string | null
          criado_em?: string
          criado_por?: string | null
          duracao_min?: number
          empresa_id?: string | null
          id?: string
          inicio_em?: string
          sdr_lead_id?: string | null
          tipo?: string
          titulo?: string
          venda_id?: string | null
          vendedor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendedor_eventos_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendedor_eventos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
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
        Relationships: []
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
        Relationships: []
      }
      vendedores: {
        Row: {
          ativo: boolean
          criado_em: string
          email_remetente: string | null
          id: string
          is_ia: boolean
          nome: string
          settings: Json
          tipo: string
          usuario_id: string | null
          whatsapp_conta_id: string | null
        }
        Insert: {
          ativo?: boolean
          criado_em?: string
          email_remetente?: string | null
          id?: string
          is_ia?: boolean
          nome: string
          settings?: Json
          tipo: string
          usuario_id?: string | null
          whatsapp_conta_id?: string | null
        }
        Update: {
          ativo?: boolean
          criado_em?: string
          email_remetente?: string | null
          id?: string
          is_ia?: boolean
          nome?: string
          settings?: Json
          tipo?: string
          usuario_id?: string | null
          whatsapp_conta_id?: string | null
        }
        Relationships: []
      }
    }

    Views: {
      credito_carteira: {
        Row: {
          cnpj: string | null
          company_name: string | null
          empresa_id: string | null
          razao_social: string | null
          limite_concedido: number | null
          consumed_limit: number | null
          available_limit: number | null
          limite_expira_em: string | null
          plataforma_diz_ter_seguro: boolean | null
          limite_segurado: number | null
          segurado_em: string | null
          rating: string | null
          rating_classe: string | null
          coberturas: number | null
          descoberto: number | null
          situacao: string | null
        }
        Relationships: []
      }
      analises_plataforma_atual: {
        Row: {
          available_limit: number | null
          cnpj: string | null
          company_name: string | null
          consumed_limit: number | null
          credit_limit: number | null
          empresa_cadastrada: boolean | null
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
          ever_approved: boolean | null
          company_type: string | null
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
      ex_clientes: {
        Row: {
          cnpj: string | null
          consumo_historico: number | null
          empresa_id: string | null
          ex_cliente_desde: string | null
          ex_cliente_motivo: string | null
          ex_cliente_motivo_label: string | null
          ex_cliente_motivo_obs: string | null
          gestao_operacao: string | null
          meses_desde: number | null
          motivo_sugerido: string | null
          motivo_sugerido_label: string | null
          motivo_sugerido_evidencia: string | null
          e_filial: boolean | null
          e_spe: boolean | null
          e_principal: boolean | null
          origem_spe: string | null
          oculto: boolean | null
          na_lista: boolean | null
          municipio: string | null
          nome: string | null
          uf: string | null
          ultima_analise_expirou_em: string | null
          ultima_analise_status: string | null
          ultima_taxa_d0: number | null
          ultimo_limite: number | null
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
          sacado_cnae_principal: string | null
          sacado_cnpj: string | null
          sacado_empresa_id: string | null
          sacado_municipio: string | null
          sacado_nome: string | null
          sacado_camada: string | null
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
          grupo_id: string | null
          gross_value_last_2m: number | null
          last_anticipation: string | null
          nome: string | null
          onepay_company_id: number | null
          operation_status: string | null
          primeira_vez_visto: string | null
          protesto_grupo_cnpjs: number | null
          protesto_grupo_valor: number | null
          status: string | null
        }
        Relationships: []
      }
      mercado_explorador: {
        Row: {
          camada: string | null
          camada_regra_versao: number | null
          capital_social: number | null
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
          empresa_id: string | null
          erp_atual: string | null
          erp_detalhes: Json | null
          erp_mrr: number | null
          estagio: string | null
          analise_estagio: string | null
          chance_concessao: number | null
          faixa_score: string | null
          limite_potencial: number | null
          receita_mensal_prevista: number | null
          score_credito: number | null
          tem_analise_vigente: boolean | null
          valor_esperado_mensal: number | null
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
          regime_tributario: string | null
          razao_social: string | null
          situacao_cadastral: string | null
          tem_contato: boolean | null
          tem_protesto: boolean | null
          tipo: string | null
          uf: string | null
          e_ex_cliente: boolean | null
          ex_cliente_desde: string | null
          ex_cliente_meses: number | null
          ex_cliente_motivo: string | null
          teve_analise_sem_cadastro: boolean | null
          ultima_analise_limite: number | null
          ultima_analise_expirou_em: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mercado_universo_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
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
          contato_fornecedor: Json | null
          contato_sacado: Json | null
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
          fornecedor_nome: string | null
          fornecedor_protesto_valor: number | null
          fornecedor_situacao_cadastral: string | null
          fornecedor_suprimido: boolean | null
          fornecedor_tem_protesto: boolean | null
          fornecedor_tipagem: string | null
          fornecedor_uf: string | null
          fornecedor_ultimo_numero_nf: number | null
          nf_id_externo: string | null
          numero: string | null
          parcelas: Json | null
          perda_motivo: string | null
          receita_esperada: number | null
          sacado_cadastrado: boolean | null
          sacado_cnae_grupos: string[] | null
          sacado_cnae_principal: string | null
          sacado_cnpj: string | null
          sacado_construcao: boolean | null
          sacado_credito_role: string | null
          sacado_credito_status: string | null
          sacado_empresa_id: string | null
          sacado_limite: number | null
          sacado_limite_cobre_nota: boolean | null
          sacado_limite_disponivel: number | null
          sacado_municipio: string | null
          sacado_nome: string | null
          sacado_razao_social: string | null
          sacado_uf: string | null
          serie: string | null
          sincronizada_em: string | null
          status_sync: string | null
          taxa_usada: number | null
          tipo_nf: string | null
          valor: number | null
          vencimento: string | null
          vencimento_origem: string | null
          natureza_operacao: string | null
          operavel: boolean
          nao_operavel_motivo: string | null
          sacado_camada: string | null
          fornecedor_protesto_em: string | null
          conversao_antecipacao_id: number | null
          conversao_em_disputa: boolean | null
          conversao_valor: number | null
          conversao_taxa: number | null
          conversao_status: string | null
          vendedor_id: string | null
          vendedor_origem: string | null
          sacado_gestao_operacao: string | null
          fornecedor_sem_interesse: boolean
          fornecedor_natureza_juridica: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notas_fiscais_fornecedor_empresa_id_fkey"
            columns: ["fornecedor_empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notas_fiscais_sacado_empresa_id_fkey"
            columns: ["sacado_empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
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
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      perfil_snapshot_atual: { Args: { p: Json }; Returns: Json }
      app_salvar_perfil_config: {
        Args: { p: Json }
        Returns: {
          atualizado_em: string
          atualizado_por: string | null
          chave: string
          valor: Json
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
      }
      antecipacao_calibracao_carteira: { Args: { p: Json }; Returns: Json }
      antecipacao_candidatas: { Args: { p: Json }; Returns: Json }
      antecipacao_custo_protesto: { Args: never; Returns: Json }
      antecipacao_metricas_faixa: { Args: never; Returns: Json }
      antecipacao_resumo_funil: { Args: never; Returns: Json }
      antecipacao_status_conversoes: { Args: { p: Json }; Returns: Json }
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
      app_atualizar_empresa: {
        Args: { p: Json }
        Returns: Database["public"]["Tables"]["empresas"]["Row"]
        SetofOptions: {
          from: "*"
          to: "empresas"
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
      app_criar_empresa: {
        Args: { p: Json }
        Returns: Database["public"]["Tables"]["empresas"]["Row"]
        SetofOptions: {
          from: "*"
          to: "empresas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
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
      app_definir_ponto_focal: {
        Args: { p: Json }
        Returns: {
          apollo_person_id: string | null
          cargo: string | null
          criado_em: string
          departamento: string | null
          email: string | null
          email_status: string | null
          empresa_id: string
          enriquecido_em: string | null
          id: string
          linkedin_url: string | null
          nome: string | null
          origem: string | null
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
          assunto: string | null
          atualizada_em: string
          canal: string
          corpo: string | null
          criada_em: string
          descartada_por: string | null
          destinatario: string | null
          destinatario_contato_id: string | null
          destinatario_ponto_focal: boolean
          faixa: string | null
          fornecedor_cnpj: string
          fornecedor_empresa_id: string | null
          fornecedor_nome: string | null
          id: string
          motivo_descarte: string | null
          status: string
          valor_total: number | null
          whatsapp_conta_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "mensagens_outbox"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_desmonitorar_protesto: {
        Args: { p_cnpj: string }
        Returns: undefined
      }
      app_is_admin: { Args: never; Returns: boolean }
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
      app_monitorar_protesto: { Args: { p_cnpj: string }; Returns: undefined }
      app_mover_estagio_nf: {
        Args: { p: Json }
        Returns: {
          access_key: string
          atualizada_em: string
          contato_fornecedor: Json | null
          contato_sacado: Json | null
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
          nf_id_externo: string | null
          numero: string | null
          parcelas: Json | null
          perda_motivo: string | null
          raw_xml: string | null
          receita_esperada: number | null
          sacado_cadastrado: boolean | null
          sacado_cnpj: string
          sacado_empresa_id: string | null
          sacado_nome: string | null
          serie: string | null
          sincronizada_em: string | null
          status_sync: string | null
          taxa_usada: number | null
          tipo: string
          valor: number
          vencimento: string | null
          vencimento_origem: string | null
          vendedor_definido_em: string | null
          vendedor_id: string | null
          vendedor_origem: string | null
          natureza_operacao: string | null
          operavel: boolean
          operavel_manual: boolean | null
          nao_operavel_motivo: string | null
          xml_parse_erro: string | null
          conversao_antecipacao_id: number | null
          conversao_em_disputa: boolean
        }
        SetofOptions: {
          from: "*"
          to: "notas_fiscais"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_promover_empresa: {
        Args: { p: Json }
        Returns: Database["public"]["Tables"]["empresas"]["Row"]
        SetofOptions: {
          from: "*"
          to: "empresas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_ativar_scorecard_versao: {
        Args: { p: Json }
        Returns: Database["public"]["Tables"]["scorecard_versoes"]["Row"]
        SetofOptions: {
          from: "*"
          to: "scorecard_versoes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_mover_analise: {
        Args: { p: Json }
        Returns: Database["public"]["Tables"]["analises_credito"]["Row"]
        SetofOptions: {
          from: "*"
          to: "analises_credito"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_registrar_doc_analise: {
        Args: { p: Json }
        Returns: Database["public"]["Tables"]["analise_docs"]["Row"]
        SetofOptions: {
          from: "*"
          to: "analise_docs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_salvar_credito_config: {
        Args: { p: Json }
        Returns: Database["public"]["Tables"]["credito_config"]["Row"]
        SetofOptions: {
          from: "*"
          to: "credito_config"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_salvar_scorecard_versao: {
        Args: { p: Json }
        Returns: Database["public"]["Tables"]["scorecard_versoes"]["Row"]
        SetofOptions: {
          from: "*"
          to: "scorecard_versoes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_solicitar_analise: {
        Args: { p: Json }
        Returns: Database["public"]["Tables"]["analises_credito"]["Row"]
        SetofOptions: {
          from: "*"
          to: "analises_credito"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_declarar_metrica: {
        Args: { p: Json }
        Returns: Database["public"]["Tables"]["empresa_metricas"]["Row"]
        SetofOptions: {
          from: "*"
          to: "empresa_metricas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_buscar_candidatos_universo: {
        Args: { p: Json }
        Returns: {
          cnpj: string
          razao_social: string | null
          nome_fantasia: string | null
          uf: string | null
          municipio: string | null
          situacao_cadastral: string | null
        }[]
      }
      app_registrar_metrica_importada: {
        Args: { p: Json }
        Returns: Database["public"]["Tables"]["empresa_metricas"]["Row"]
        SetofOptions: {
          from: "*"
          to: "empresa_metricas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_definir_ex_cliente_motivo: {
        Args: { p: Json }
        Returns: Database["public"]["Tables"]["empresas"]["Row"]
        SetofOptions: {
          from: "*"
          to: "empresas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ex_clientes_analise: {
        Args: never
        Returns: Json
      }
      app_rodar_analise_propria: {
        Args: { p: Json }
        Returns: Database["public"]["Tables"]["analises_proprietarias"]["Row"]
        SetofOptions: {
          from: "*"
          to: "analises_proprietarias"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_revisar_extracao: {
        Args: { p: Json }
        Returns: Database["public"]["Tables"]["analises_proprietarias"]["Row"]
        SetofOptions: {
          from: "*"
          to: "analises_proprietarias"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_editar_parecer: {
        Args: { p: Json }
        Returns: Database["public"]["Tables"]["analises_proprietarias"]["Row"]
        SetofOptions: {
          from: "*"
          to: "analises_proprietarias"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_registrar_decisao_credito: {
        Args: { p: Json }
        Returns: Database["public"]["Tables"]["analises_proprietarias"]["Row"]
        SetofOptions: {
          from: "*"
          to: "analises_proprietarias"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_salvar_parametros_analise: {
        Args: { p: Json }
        Returns: Database["public"]["Tables"]["analise_parametros"]["Row"]
        SetofOptions: {
          from: "*"
          to: "analise_parametros"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      analise_propria_painel: {
        Args: { p_analise_credito_id: string }
        Returns: Json
      }
      certificado_funil: {
        Args: { p_vendedor_id?: string | null }
        Returns: Json
      }
      certificado_funil_sincronizar: {
        Args: never
        Returns: Json
      }
      app_mover_certificado_card: {
        Args: { p: Json }
        Returns: Json
      }
      ex_clientes_por_motivo: {
        Args: { p_meses?: number }
        Returns: Json
      }
      ex_clientes_lista: {
        Args: { p_recorte: string; p_motivos?: string[] | null }
        Returns: Json
      }
      formulario_publico: {
        Args: { p_slug: string }
        Returns: Json
      }
      formularios_lista: {
        Args: never
        Returns: Json
      }
      app_salvar_formulario: {
        Args: { p: Json }
        Returns: Json
      }
      app_atribuir_lead_sdr: {
        Args: { p: Json }
        Returns: Json
      }
      app_atribuir_venda: {
        Args: { p: Json }
        Returns: Json
      }
      app_processar_submissao: {
        Args: { p: Json }
        Returns: Json
      }
      app_marcar_fornecedor_sem_interesse: {
        Args: { p: Json }
        Returns: Database["public"]["Tables"]["antecipacao_fornecedor_sem_interesse"]["Row"]
        SetofOptions: {
          from: "*"
          to: "antecipacao_fornecedor_sem_interesse"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_reverter_fornecedor_sem_interesse: { Args: { p: Json }; Returns: boolean }
      app_promover_fornecedor: {
        Args: { p: Json }
        Returns: Database["public"]["Tables"]["empresas"]["Row"]
        SetofOptions: {
          from: "*"
          to: "empresas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_registrar_toque_manual: { Args: { p: Json }; Returns: undefined }
      app_remover_supressao: { Args: { p: Json }; Returns: undefined }
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
      app_salvar_whatsapp_conta: {
        Args: { p: Json }
        Returns: {
          apelido: string
          ativo: boolean
          atualizada_em: string
          criada_em: string
          id: string
          numero: string
          provedor: string
          token_definido_em: string | null
          token_secret_id: string | null
          usuario_responsavel: string | null
        }
        SetofOptions: {
          from: "*"
          to: "whatsapp_contas"
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
      cnae_grupos_de: {
        Args: { p_principal: string; p_secundarios: string[] }
        Returns: string[]
      }
      natureza_juridica_codigo: {
        Args: { bruto: string }
        Returns: string
      }
      empresa_analise_financeira: {
        Args: { p_empresa_id: string }
        Returns: Json
      }
      empresa_grupo_protestos: { Args: { p_empresa_id: string }; Returns: Json }
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
        Args: { p_arvore?: Json | null; p_termo?: string | null }
        Returns: number
      }
      mercado_explorar: {
        Args: {
          p_arvore?: Json | null
          p_asc?: boolean
          p_limite?: number
          p_offset?: number
          p_ordem?: string
          p_termo?: string | null
        }
        Returns: Json
      }
      mercado_mapa: {
        Args: { p_limite?: number; p_tipo?: string | null; p_uf?: string | null }
        Returns: Json
      }
      mercado_piramide: { Args: never; Returns: Json }
      mercado_pred: { Args: { no: Json }; Returns: string }
      mercado_where: {
        Args: { p_arvore: Json; p_termo: string }
        Returns: string
      }
      radar_cobertura: { Args: never; Returns: Json }
      radar_grupo_spes_monitoramento: {
        Args: { p_grupo_id: string }
        Returns: Json
      }
      app_salvar_vendedor: { Args: { p: Json }; Returns: Json }
      app_salvar_territorio: { Args: { p: Json }; Returns: Json }
      app_salvar_comissao_regra: { Args: { p: Json }; Returns: Json }
      app_salvar_acesso_vendedor: { Args: { p: Json }; Returns: undefined }
      app_salvar_comercial_config: { Args: { p: Json }; Returns: Json }
      app_salvar_motivo_perda: { Args: { p: Json }; Returns: Json }
      app_definir_carteira: { Args: { p: Json }; Returns: Json }
      app_definir_carteira_passiva: { Args: { p: Json }; Returns: Json }
      app_definir_gestao_operacao: { Args: { p: Json }; Returns: Json }
      app_mover_lead_sdr: { Args: { p: Json }; Returns: Json }
      app_mover_venda: { Args: { p: Json }; Returns: Json }
      app_atribuir_nf: { Args: { p: Json }; Returns: undefined }
      app_mudar_status_comissao: { Args: { p: Json }; Returns: number }
      app_gerar_token_ics: { Args: { p: Json }; Returns: string }
      app_vendedor_atual: { Args: never; Returns: string }
      app_gestor_comercial: { Args: never; Returns: boolean }
      app_pode_ver_vendedor: { Args: { p_vendedor_id: string }; Returns: boolean }
      comercial_resumo_vendedor: { Args: { p_vendedor_id?: string }; Returns: Json }
      comercial_carteira_vendedor: { Args: { p_vendedor_id?: string }; Returns: Json }
      comercial_alcance_da_carteira: { Args: { p_vendedor_id: string }; Returns: Json }
      comercial_vendedores_visiveis: { Args: never; Returns: Json }
      app_holding_do_sacado: { Args: { p_cnpj: string }; Returns: string }
      radar_custo_protestos_mensal: { Args: never; Returns: Json }
      radar_onepay_analytics: { Args: never; Returns: Json }
      radar_onepay_clientes: {
        Args: { p_dimensao: string; p_valor: string }
        Returns: Json
      }
      radar_protestos_empresa_previa: {
        Args: {
          p_ano_min: number
          p_empresa_id: string
          p_incluir_spes: boolean
        }
        Returns: Json
      }
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
