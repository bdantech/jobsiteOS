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
          atradius_buyer_id: string | null
          atradius_case_id: string | null
          atualizada_em: string
          cnpj: string
          criada_em: string
          decidida_em: string | null
          empresa_id: string | null
          estagio: string
          expira_em: string | null
          id: string
          limite_aprovado: number | null
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
          atradius_buyer_id?: string | null
          atradius_case_id?: string | null
          atualizada_em?: string
          cnpj: string
          criada_em?: string
          decidida_em?: string | null
          empresa_id?: string | null
          estagio?: string
          expira_em?: string | null
          id?: string
          limite_aprovado?: number | null
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
          atradius_buyer_id?: string | null
          atradius_case_id?: string | null
          atualizada_em?: string
          cnpj?: string
          criada_em?: string
          decidida_em?: string | null
          empresa_id?: string | null
          estagio?: string
          expira_em?: string | null
          id?: string
          limite_aprovado?: number | null
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
          id: string
          nome_arquivo: string | null
          tipo: string
        }
        Insert: {
          analise_id: string
          arquivo_url: string
          enviado_em?: string
          enviado_por?: string | null
          id?: string
          nome_arquivo?: string | null
          tipo: string
        }
        Update: {
          analise_id?: string
          arquivo_url?: string
          enviado_em?: string
          enviado_por?: string | null
          id?: string
          nome_arquivo?: string | null
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
          faturamento_anual: number | null
          faturamento_atualizado_em: string | null
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
          faturamento_anual?: number | null
          faturamento_atualizado_em?: string | null
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
          faturamento_anual?: number | null
          faturamento_atualizado_em?: string | null
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
          arquivo_url: string | null
          criado_em: string
          criado_por: string | null
          id: string
          mapeamento: Json | null
          nome: string
          status: string
        }
        Insert: {
          arquivo_url?: string | null
          criado_em?: string
          criado_por?: string | null
          id?: string
          mapeamento?: Json | null
          nome: string
          status?: string
        }
        Update: {
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
    }
    Views: {
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
