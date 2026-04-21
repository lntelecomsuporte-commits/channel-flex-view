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
      categories: {
        Row: {
          created_at: string
          id: string
          name: string
          position: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          position?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          position?: number
          updated_at?: string
        }
        Relationships: []
      }
      category_includes: {
        Row: {
          category_id: string
          created_at: string
          id: string
          included_category_id: string
        }
        Insert: {
          category_id: string
          created_at?: string
          id?: string
          included_category_id: string
        }
        Update: {
          category_id?: string
          created_at?: string
          id?: string
          included_category_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "category_includes_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "category_includes_included_category_id_fkey"
            columns: ["included_category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      channels: {
        Row: {
          category_id: string | null
          channel_number: number
          created_at: string
          epg_alt_text: string | null
          epg_channel_id: string | null
          epg_grab_logo: boolean
          epg_show_synopsis: boolean
          epg_type: string | null
          epg_url: string | null
          id: string
          is_active: boolean
          logo_url: string | null
          name: string
          stream_url: string
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          channel_number: number
          created_at?: string
          epg_alt_text?: string | null
          epg_channel_id?: string | null
          epg_grab_logo?: boolean
          epg_show_synopsis?: boolean
          epg_type?: string | null
          epg_url?: string | null
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name: string
          stream_url: string
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          channel_number?: number
          created_at?: string
          epg_alt_text?: string | null
          epg_channel_id?: string | null
          epg_grab_logo?: boolean
          epg_show_synopsis?: boolean
          epg_type?: string | null
          epg_url?: string | null
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name?: string
          stream_url?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "channels_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      hubsoft_config: {
        Row: {
          api_key: string
          api_url: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          package_id: string
          password: string
          updated_at: string
          username: string
        }
        Insert: {
          api_key?: string
          api_url?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          package_id?: string
          password?: string
          updated_at?: string
          username?: string
        }
        Update: {
          api_key?: string
          api_url?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          package_id?: string
          password?: string
          updated_at?: string
          username?: string
        }
        Relationships: []
      }
      hubsoft_config_categories: {
        Row: {
          category_id: string
          created_at: string
          hubsoft_config_id: string
          id: string
        }
        Insert: {
          category_id: string
          created_at?: string
          hubsoft_config_id: string
          id?: string
        }
        Update: {
          category_id?: string
          created_at?: string
          hubsoft_config_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hubsoft_config_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hubsoft_config_categories_hubsoft_config_id_fkey"
            columns: ["hubsoft_config_id"]
            isOneToOne: false
            referencedRelation: "hubsoft_config"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          hubsoft_client_id: string | null
          id: string
          is_active: boolean
          is_blocked: boolean
          updated_at: string
          user_id: string
          username: string | null
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          hubsoft_client_id?: string | null
          id?: string
          is_active?: boolean
          is_blocked?: boolean
          updated_at?: string
          user_id: string
          username?: string | null
        }
        Update: {
          created_at?: string
          display_name?: string | null
          hubsoft_client_id?: string | null
          id?: string
          is_active?: boolean
          is_blocked?: boolean
          updated_at?: string
          user_id?: string
          username?: string | null
        }
        Relationships: []
      }
      proxy_access_log: {
        Row: {
          bucket_minute: string
          bytes_transferred: number
          channel_id: string | null
          channel_name: string | null
          created_at: string
          first_seen_at: string
          id: string
          ip_address: string
          last_seen_at: string
          request_count: number
          stream_host: string | null
          user_id: string | null
        }
        Insert: {
          bucket_minute: string
          bytes_transferred?: number
          channel_id?: string | null
          channel_name?: string | null
          created_at?: string
          first_seen_at?: string
          id?: string
          ip_address: string
          last_seen_at?: string
          request_count?: number
          stream_host?: string | null
          user_id?: string | null
        }
        Update: {
          bucket_minute?: string
          bytes_transferred?: number
          channel_id?: string | null
          channel_name?: string | null
          created_at?: string
          first_seen_at?: string
          id?: string
          ip_address?: string
          last_seen_at?: string
          request_count?: number
          stream_host?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      user_category_access: {
        Row: {
          category_id: string
          created_at: string
          hubsoft_config_id: string | null
          id: string
          is_active: boolean
          user_id: string
        }
        Insert: {
          category_id: string
          created_at?: string
          hubsoft_config_id?: string | null
          id?: string
          is_active?: boolean
          user_id: string
        }
        Update: {
          category_id?: string
          created_at?: string
          hubsoft_config_id?: string | null
          id?: string
          is_active?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_category_access_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_category_access_hubsoft_config_id_fkey"
            columns: ["hubsoft_config_id"]
            isOneToOne: false
            referencedRelation: "hubsoft_config"
            referencedColumns: ["id"]
          },
        ]
      }
      user_favorites: {
        Row: {
          channel_id: string
          created_at: string
          id: string
          position: number
          user_id: string
        }
        Insert: {
          channel_id: string
          created_at?: string
          id?: string
          position?: number
          user_id: string
        }
        Update: {
          channel_id?: string
          created_at?: string
          id?: string
          position?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_favorites_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_sessions: {
        Row: {
          created_at: string
          current_channel_id: string | null
          current_channel_name: string | null
          ended_at: string | null
          id: string
          ip_address: string | null
          is_watching: boolean
          last_heartbeat_at: string
          session_token: string
          started_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          current_channel_id?: string | null
          current_channel_name?: string | null
          ended_at?: string | null
          id?: string
          ip_address?: string | null
          is_watching?: boolean
          last_heartbeat_at?: string
          session_token: string
          started_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          current_channel_id?: string | null
          current_channel_name?: string | null
          ended_at?: string | null
          id?: string
          ip_address?: string | null
          is_watching?: boolean
          last_heartbeat_at?: string
          session_token?: string
          started_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cleanup_old_monitoring_data: { Args: never; Returns: undefined }
      get_user_online_status: {
        Args: { _user_id: string }
        Returns: {
          current_channel_name: string
          is_logged_in: boolean
          is_watching: boolean
          last_seen: string
          session_started_at: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
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
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
