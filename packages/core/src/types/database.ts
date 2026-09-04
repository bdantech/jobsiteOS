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
          versao?: number
        }
        Relationships: []
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
        Relationships: []
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
        Relationships: []
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
        Relationships: []
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
        Relationships: []
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
        Relationships: []
      }
      analise_docs: {
        Row: {
          analise_id: string
          arquivo_url: string
          enviado_em: string
          exercicio: number | null
          external_id: string | null
          origem: string
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
          exercicio?: number | null
          external_id?: string | null
          origem?: string
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
          exercicio?: number | null
          external_id?: string | null
          origem?: string
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
      analises_credito: {
        Row: {
          contato_externo: Json | null
          external_id: string | null
          origem_externa: string | null
          origem_motivo: string | null
          analise_propria_id: string | null
          atradius_buyer_id: string | null
          atradius_case_id: string | null
          atualizada_em: string
          cnpj: string
          codigo_decisao: string | null
          codigo_historico: string | null
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
          rating_classe_seguradora: string | null
          rating_seguradora: string | null
          seguradora: string
          solicitada_por: string | null
        }
        Insert: {
          contato_externo?: Json | null
          external_id?: string | null
          origem_externa?: string | null
          origem_motivo?: string | null
          analise_propria_id?: string | null
          atradius_buyer_id?: string | null
          atradius_case_id?: string | null
          atualizada_em?: string
          cnpj: string
          codigo_decisao?: string | null
          codigo_historico?: string | null
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
          rating_classe_seguradora?: string | null
          rating_seguradora?: string | null
          seguradora?: string
          solicitada_por?: string | null
        }
        Update: {
          contato_externo?: Json | null
          external_id?: string | null
          origem_externa?: string | null
          origem_motivo?: string | null
          analise_propria_id?: string | null
          atradius_buyer_id?: string | null
          atradius_case_id?: string | null
          atualizada_em?: string
          cnpj?: string
          codigo_decisao?: string | null
          codigo_historico?: string | null
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
          rating_classe_seguradora?: string | null
          rating_seguradora?: string | null
          seguradora?: string
          solicitada_por?: string | null
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
            foreignKeyName: "analises_credito_solicitada_por_fkey"
            columns: ["solicitada_por"]
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
      empresas: {
        Row: {
          atualizado_em: string
          camada: string | null
          chance_concessao: number | null
          churn_erp_concorrente: boolean
          cnae_principal: string | null
          cnpj: string
          credito_calculado_em: string | null
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
          fase_manual: string | null
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
          camada?: string | null
          chance_concessao?: number | null
          churn_erp_concorrente?: boolean
          cnae_principal?: string | null
          cnpj: string
          credito_calculado_em?: string | null
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
          fase_manual?: string | null
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
          camada?: string | null
          chance_concessao?: number | null
          churn_erp_concorrente?: boolean
          cnae_principal?: string | null
          cnpj?: string
          credito_calculado_em?: string | null
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
          fase_manual?: string | null
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
      mensagens_outbox: {
        Row: {
          access_keys: string[]
          agendada_para: string | null
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
          fornecedor_cnpj: string | null
          fornecedor_empresa_id: string | null
          fornecedor_nome: string | null
          funil: string | null
          funil_card_id: string | null
          id: string
          motivo_descarte: string | null
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
          fornecedor_cnpj?: string | null
          fornecedor_empresa_id?: string | null
          fornecedor_nome?: string | null
          funil?: string | null
          funil_card_id?: string | null
          id?: string
          motivo_descarte?: string | null
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
          fornecedor_cnpj?: string | null
          fornecedor_empresa_id?: string | null
          fornecedor_nome?: string | null
          funil?: string | null
          funil_card_id?: string | null
          id?: string
          motivo_descarte?: string | null
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
          xml_parse_erro: string | null
        }
        Insert: {
          access_key: string
          atualizada_em?: string
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
          vendedor_definido_em?: string | null
          vendedor_id?: string | null
          vendedor_origem?: string | null
          xml_parse_erro?: string | null
        }
        Update: {
          access_key?: string
          atualizada_em?: string
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
          vendedor_definido_em?: string | null
          vendedor_id?: string | null
          vendedor_origem?: string | null
          xml_parse_erro?: string | null
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
      pedidos_apresentacao: {
        Row: {
          comunicacao_id: string | null
          contato_sacado_id: string | null
          criado_em: string
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
          contato_sacado_id?: string | null
          criado_em?: string
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
          contato_sacado_id?: string | null
          criado_em?: string
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
            foreignKeyName: "conta_fase_historico_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
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
            foreignKeyName: "sacado_vinculo_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
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
            referencedRelation: "empresas"
            referencedColumns: ["id"]
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
        Relationships: [
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
      inbox_conversas: {
        Row: {
          canal: string | null
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
      app__conta_do_webhook: {
        Args: { p_segredo: string }
        Returns: { apelido: string; id: string; numero: string }[]
      }
      /*
       * PATCH DO REPO (ver a nota no fim deste arquivo): o gerador emite todo
       * argumento de RPC como NÃO-anulável, e os quatro últimos aqui aceitam
       * null de propósito — uma conversa pode não ter empresa, contato nem
       * vendedor resolvidos, que é exatamente o caso do inbox de identificação.
       * Reaplique isto depois de cada \`pnpm db:types\`.
       */
      app__conversa_para: {
        Args: {
          p_canal: string
          p_contato: string | null
          p_empresa: string | null
          p_identificador: string
          p_vendedor: string | null
        }
        Returns: string
      }
      app__conversa_absorver_lid: {
        Args: { p_lid: string; p_conversa: string | null }
        Returns: undefined
      }
      app__conversa_por_lid: { Args: { p_lid: string }; Returns: string | null }
      app__identificador_canonico: {
        Args: { p_canal: string; p_valor: string }
        Returns: string
      }
      app__promover_fornecedor_para_empresa: {
        Args: { p_ator: string | null; p_cnpj: string; p_origem: string }
        Returns: {
          atualizado_em: string
          camada: string | null
          chance_concessao: number | null
          churn_erp_concorrente: boolean
          cnae_principal: string | null
          cnpj: string
          credito_calculado_em: string | null
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
          fase_manual: string | null
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
      app__segredo_vault: { Args: { p_id: string }; Returns: string }
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
      app_agente_aceitar: {
        Args: { p: Json }
        Returns: {
          access_keys: string[]
          agendada_para: string | null
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
          fornecedor_cnpj: string | null
          fornecedor_empresa_id: string | null
          fornecedor_nome: string | null
          funil: string | null
          funil_card_id: string | null
          id: string
          motivo_descarte: string | null
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
          fornecedor_cnpj: string | null
          fornecedor_empresa_id: string | null
          fornecedor_nome: string | null
          funil: string | null
          funil_card_id: string | null
          id: string
          motivo_descarte: string | null
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
          camada: string | null
          chance_concessao: number | null
          churn_erp_concorrente: boolean
          cnae_principal: string | null
          cnpj: string
          credito_calculado_em: string | null
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
          fase_manual: string | null
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
      app_competencia_fechada: { Args: { p_data: string }; Returns: boolean }
      app_comunicacao_atividade: { Args: { p: Json }; Returns: Json }
      app_comunicacao_atividade_series: { Args: { p: Json }; Returns: Json }
      app_comunicacao_enfileirar: {
        Args: { p: Json }
        Returns: {
          access_keys: string[]
          agendada_para: string | null
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
          fornecedor_cnpj: string | null
          fornecedor_empresa_id: string | null
          fornecedor_nome: string | null
          funil: string | null
          funil_card_id: string | null
          id: string
          motivo_descarte: string | null
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
      app_conversa_definir_modo: {
        Args: { p: Json }
        Returns: {
          atualizada_em: string
          canal: string
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
      app_conversa_ocultar: { Args: { p: Json }; Returns: undefined }
      app_conversa_reexibir: { Args: { p: Json }; Returns: undefined }
      app_conversas_ocultas: { Args: Record<string, never>; Returns: Json }
      app_conversa_marcar_lida: { Args: { p: Json }; Returns: undefined }
      app_conversa_vincular: {
        Args: { p: Json }
        Returns: {
          atualizada_em: string
          canal: string
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
      app_criar_empresa: {
        Args: { p: Json }
        Returns: {
          atualizado_em: string
          camada: string | null
          chance_concessao: number | null
          churn_erp_concorrente: boolean
          cnae_principal: string | null
          cnpj: string
          credito_calculado_em: string | null
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
          fase_manual: string | null
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
      app_definir_fase_conta: { Args: { p: Json }; Returns: Json }
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
          camada: string | null
          chance_concessao: number | null
          churn_erp_concorrente: boolean
          cnae_principal: string | null
          cnpj: string
          credito_calculado_em: string | null
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
          fase_manual: string | null
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
          camada: string | null
          chance_concessao: number | null
          churn_erp_concorrente: boolean
          cnae_principal: string | null
          cnpj: string
          credito_calculado_em: string | null
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
          fase_manual: string | null
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
          fornecedor_cnpj: string | null
          fornecedor_empresa_id: string | null
          fornecedor_nome: string | null
          funil: string | null
          funil_card_id: string | null
          id: string
          motivo_descarte: string | null
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
      app__enfileirar_webhook: {
        Args: { p_evento: string; p_analise: string | null; p_semente: Json }
        Returns: undefined
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
      }
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
      app_fornecedor_visivel: { Args: { p_cnpj: string }; Returns: boolean }
      app_funil_analise: { Args: { p: Json }; Returns: Json }
      app_gerar_token_ics: { Args: { p: Json }; Returns: string }
      app_gestor_comercial: { Args: never; Returns: boolean }
      app_holding_do_sacado: { Args: { p_cnpj: string }; Returns: string }
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
          rating_classe_seguradora: string | null
          rating_seguradora: string | null
          seguradora: string
          solicitada_por: string | null
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
          xml_parse_erro: string | null
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
          contato_sacado_id: string | null
          criado_em: string
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
          contato_sacado_id: string | null
          criado_em: string
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
          contato_sacado_id: string | null
          criado_em: string
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
          camada: string | null
          chance_concessao: number | null
          churn_erp_concorrente: boolean
          cnae_principal: string | null
          cnpj: string
          credito_calculado_em: string | null
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
          fase_manual: string | null
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
          camada: string | null
          chance_concessao: number | null
          churn_erp_concorrente: boolean
          cnae_principal: string | null
          cnpj: string
          credito_calculado_em: string | null
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
          fase_manual: string | null
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
      app_rank_origem_metrica: { Args: { p_origem: string }; Returns: number }
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
          extraido_em: string | null
          id: string
          nome_arquivo: string | null
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
          versao: number
        }
        SetofOptions: {
          from: "*"
          to: "agente_playbooks"
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
        SetofOptions: {
          from: "*"
          to: "vendedores"
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
      app_sincronizar_carteira_originacao: {
        Args: { p_ids: string[]; p_vendedor: string }
        Returns: undefined
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
          rating_classe_seguradora: string | null
          rating_seguradora: string | null
          seguradora: string
          solicitada_por: string | null
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
          rating_classe_seguradora: string | null
          rating_seguradora: string | null
          seguradora: string
          solicitada_por: string | null
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
      app_vendedor_atual: { Args: never; Returns: string }
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
      comercial_resumo_vendedor: {
        Args: { p_vendedor_id?: string }
        Returns: Json
      }
      comercial_vendedores_visiveis: { Args: never; Returns: Json }
      comissao_painel_v2: {
        Args: { p_meses?: number; p_vendedor_id?: string }
        Returns: Json
      }
      comercial_contas_fase: { Args: never; Returns: Json }
      comercial_sacados_sem_conta: { Args: never; Returns: Json }
      comissao_reclassificacao: {
        Args: { p_janela_dias?: number }
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
      natureza_juridica_codigo: { Args: { bruto: string }; Returns: string }
      perfil_snapshot_atual: { Args: { p: Json }; Returns: Json }
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

/*
 * ─── PATCHES DO REPO SOBRE O ARQUIVO GERADO ─────────────────────────────────
 *
 * Duas coisas neste arquivo NÃO vêm do gerador, e as duas precisam ser
 * reaplicadas depois de cada `pnpm db:types`:
 *
 *   1. O helper `Views<>` abaixo. O gerador novo dobra as views dentro de
 *      `Tables<>`, e o repo inteiro importa `Views<'nome'>`.
 *
 *   2. `| null` nos argumentos anuláveis de `app__conversa_para` (busque pelo
 *      comentário "PATCH DO REPO" acima). O gerador emite todo argumento de RPC
 *      como obrigatório e não-anulável, mesmo quando a função aceita null.
 *
 * Sem (1) o build da web quebra; sem (2) o worker não compila.
 */

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
