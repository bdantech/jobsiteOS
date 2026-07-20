// Generated from the live schema via Supabase MCP. Do not edit by hand.
// Regenerate after any migration:  pnpm db:types
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '14.5'
  }
  public: {
    Tables: {
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
            foreignKeyName: 'app_config_atualizado_por_fkey'
            columns: ['atualizado_por']
            isOneToOne: false
            referencedRelation: 'usuarios'
            referencedColumns: ['id']
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
            foreignKeyName: 'camada_regras_criada_por_fkey'
            columns: ['criada_por']
            isOneToOne: false
            referencedRelation: 'usuarios'
            referencedColumns: ['id']
          },
        ]
      }
      contatos: {
        Row: {
          cargo: string | null
          criado_em: string
          email: string | null
          empresa_id: string
          id: string
          nome: string | null
          origem: string | null
          telefone: string | null
          whatsapp: string | null
        }
        Insert: {
          cargo?: string | null
          criado_em?: string
          email?: string | null
          empresa_id: string
          id?: string
          nome?: string | null
          origem?: string | null
          telefone?: string | null
          whatsapp?: string | null
        }
        Update: {
          cargo?: string | null
          criado_em?: string
          email?: string | null
          empresa_id?: string
          id?: string
          nome?: string | null
          origem?: string | null
          telefone?: string | null
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'contatos_empresa_id_fkey'
            columns: ['empresa_id']
            isOneToOne: false
            referencedRelation: 'empresas'
            referencedColumns: ['id']
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
            foreignKeyName: 'empresa_eventos_empresa_id_fkey'
            columns: ['empresa_id']
            isOneToOne: false
            referencedRelation: 'empresas'
            referencedColumns: ['id']
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
            foreignKeyName: 'empresa_notas_empresa_id_fkey'
            columns: ['empresa_id']
            isOneToOne: false
            referencedRelation: 'empresas'
            referencedColumns: ['id']
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
          erp_atual: string | null
          erp_canal_venda: string | null
          erp_detalhes: Json
          erp_mrr: number | null
          estagio: string
          grafo_sefaz: boolean
          grupo_id: string | null
          id: string
          is_spe: boolean
          municipio: string | null
          nome_fantasia: string | null
          origem: string | null
          porte: string | null
          razao_social: string | null
          tipo: string
          uf: string | null
        }
        Insert: {
          atualizado_em?: string
          camada?: string | null
          churn_erp_concorrente?: boolean
          cnae_principal?: string | null
          cnpj: string
          criado_em?: string
          erp_atual?: string | null
          erp_canal_venda?: string | null
          erp_detalhes?: Json
          erp_mrr?: number | null
          estagio?: string
          grafo_sefaz?: boolean
          grupo_id?: string | null
          id?: string
          is_spe?: boolean
          municipio?: string | null
          nome_fantasia?: string | null
          origem?: string | null
          porte?: string | null
          razao_social?: string | null
          tipo?: string
          uf?: string | null
        }
        Update: {
          atualizado_em?: string
          camada?: string | null
          churn_erp_concorrente?: boolean
          cnae_principal?: string | null
          cnpj?: string
          criado_em?: string
          erp_atual?: string | null
          erp_canal_venda?: string | null
          erp_detalhes?: Json
          erp_mrr?: number | null
          estagio?: string
          grafo_sefaz?: boolean
          grupo_id?: string | null
          id?: string
          is_spe?: boolean
          municipio?: string | null
          nome_fantasia?: string | null
          origem?: string | null
          porte?: string | null
          razao_social?: string | null
          tipo?: string
          uf?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'empresas_grupo_id_fkey'
            columns: ['grupo_id']
            isOneToOne: false
            referencedRelation: 'grupos_economicos'
            referencedColumns: ['id']
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
            foreignKeyName: 'importacoes_linhas_importacao_id_fkey'
            columns: ['importacao_id']
            isOneToOne: false
            referencedRelation: 'importacoes_listas'
            referencedColumns: ['id']
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
            foreignKeyName: 'importacoes_listas_criado_por_fkey'
            columns: ['criado_por']
            isOneToOne: false
            referencedRelation: 'usuarios'
            referencedColumns: ['id']
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
            foreignKeyName: 'mercado_socios_cnpj_fkey'
            columns: ['cnpj']
            isOneToOne: false
            referencedRelation: 'mercado_universo'
            referencedColumns: ['cnpj']
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
          email_rfb: string | null
          empresa_id: string | null
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
          email_rfb?: string | null
          empresa_id?: string | null
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
          email_rfb?: string | null
          empresa_id?: string | null
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
            foreignKeyName: 'mercado_universo_empresa_id_fkey'
            columns: ['empresa_id']
            isOneToOne: false
            referencedRelation: 'empresas'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'mercado_universo_grupo_fk'
            columns: ['grupo_id']
            isOneToOne: false
            referencedRelation: 'grupos_economicos'
            referencedColumns: ['id']
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
            foreignKeyName: 'notificacao_regras_perfil_id_fkey'
            columns: ['perfil_id']
            isOneToOne: false
            referencedRelation: 'perfis'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'notificacao_regras_usuario_id_fkey'
            columns: ['usuario_id']
            isOneToOne: false
            referencedRelation: 'usuarios'
            referencedColumns: ['id']
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
            foreignKeyName: 'notificacoes_usuario_id_fkey'
            columns: ['usuario_id']
            isOneToOne: false
            referencedRelation: 'usuarios'
            referencedColumns: ['id']
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
            foreignKeyName: 'perfil_modulos_perfil_id_fkey'
            columns: ['perfil_id']
            isOneToOne: false
            referencedRelation: 'perfis'
            referencedColumns: ['id']
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
            foreignKeyName: 'segmentos_criado_por_fkey'
            columns: ['criado_por']
            isOneToOne: false
            referencedRelation: 'usuarios'
            referencedColumns: ['id']
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
            foreignKeyName: 'usuarios_perfil_id_fkey'
            columns: ['perfil_id']
            isOneToOne: false
            referencedRelation: 'perfis'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
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
          data_exclusao_simples: string | null
          data_inicio_atividade: string | null
          empresa_id: string | null
          erp_atual: string | null
          erp_detalhes: Json | null
          erp_mrr: number | null
          estagio: string | null
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
          porte_rfb: string | null
          qtd_filiais: number | null
          qtd_usuarios_erp: number | null
          ratio_usuarios_ativos: number | null
          razao_social: string | null
          situacao_cadastral: string | null
          tem_contato: boolean | null
          tipo: string | null
          uf: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      mercado_mapa: {
        Args: { p_uf?: string | null; p_tipo?: string | null; p_limite?: number }
        Returns: Json
      }
      mercado_piramide: {
        Args: Record<string, never>
        Returns: Json
      }
      mercado_explorar: {
        Args: {
          p_termo?: string | null
          p_arvore?: Json | null
          p_ordem?: string
          p_asc?: boolean
          p_offset?: number
          p_limite?: number
        }
        Returns: Json
      }
      mercado_contar_exato: {
        Args: { p_termo?: string | null; p_arvore?: Json | null }
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
          from: '*'
          to: 'camada_regras'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_atualizar_empresa: {
        Args: { p: Json }
        Returns: {
          atualizado_em: string
          camada: string | null
          churn_erp_concorrente: boolean
          cnae_principal: string | null
          cnpj: string
          criado_em: string
          erp_atual: string | null
          erp_canal_venda: string | null
          erp_detalhes: Json
          erp_mrr: number | null
          estagio: string
          grafo_sefaz: boolean
          grupo_id: string | null
          id: string
          is_spe: boolean
          municipio: string | null
          nome_fantasia: string | null
          origem: string | null
          porte: string | null
          razao_social: string | null
          tipo: string
          uf: string | null
        }
        SetofOptions: {
          from: '*'
          to: 'empresas'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_criar_empresa: {
        Args: { p: Json }
        Returns: {
          atualizado_em: string
          camada: string | null
          churn_erp_concorrente: boolean
          cnae_principal: string | null
          cnpj: string
          criado_em: string
          erp_atual: string | null
          erp_canal_venda: string | null
          erp_detalhes: Json
          erp_mrr: number | null
          estagio: string
          grafo_sefaz: boolean
          grupo_id: string | null
          id: string
          is_spe: boolean
          municipio: string | null
          nome_fantasia: string | null
          origem: string | null
          porte: string | null
          razao_social: string | null
          tipo: string
          uf: string | null
        }
        SetofOptions: {
          from: '*'
          to: 'empresas'
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
          from: '*'
          to: 'empresa_notas'
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
          from: '*'
          to: 'segmentos'
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
          from: '*'
          to: 'app_config'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_is_admin: { Args: never; Returns: boolean }
      app_promover_empresa: {
        Args: { p: Json }
        Returns: {
          atualizado_em: string
          camada: string | null
          churn_erp_concorrente: boolean
          cnae_principal: string | null
          cnpj: string
          criado_em: string
          erp_atual: string | null
          erp_canal_venda: string | null
          erp_detalhes: Json
          erp_mrr: number | null
          estagio: string
          grafo_sefaz: boolean
          grupo_id: string | null
          id: string
          is_spe: boolean
          municipio: string | null
          nome_fantasia: string | null
          origem: string | null
          porte: string | null
          razao_social: string | null
          tipo: string
          uf: string | null
        }
        SetofOptions: {
          from: '*'
          to: 'empresas'
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
          from: '*'
          to: 'camada_regras'
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
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { '': string }; Returns: string[] }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>]

export type Tables<T extends keyof DefaultSchema['Tables']> =
  DefaultSchema['Tables'][T]['Row']

export type TablesInsert<T extends keyof DefaultSchema['Tables']> =
  DefaultSchema['Tables'][T]['Insert']

export type TablesUpdate<T extends keyof DefaultSchema['Tables']> =
  DefaultSchema['Tables'][T]['Update']

export type Views<T extends keyof DefaultSchema['Views']> =
  DefaultSchema['Views'][T]['Row']
