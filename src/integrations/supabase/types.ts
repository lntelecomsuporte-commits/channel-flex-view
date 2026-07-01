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
          requires_pin: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          position?: number
          requires_pin?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          position?: number
          requires_pin?: boolean
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
          backup_stream_urls: string[]
          category_id: string | null
          channel_number: number
          created_at: string
          epg_alt_text: string | null
          epg_channel_id: string | null
          epg_grab_logo: boolean
          epg_show_synopsis: boolean
          epg_type: string | null
          epg_url: string | null
          force_proxy_native: boolean
          id: string
          is_active: boolean
          is_adult: boolean
          logo_source_url: string | null
          logo_url: string | null
          name: string
          prefer_sw_decoder: boolean
          stream_format: string
          stream_url: string
          updated_at: string
          use_proxy_token: boolean
        }
        Insert: {
          backup_stream_urls?: string[]
          category_id?: string | null
          channel_number: number
          created_at?: string
          epg_alt_text?: string | null
          epg_channel_id?: string | null
          epg_grab_logo?: boolean
          epg_show_synopsis?: boolean
          epg_type?: string | null
          epg_url?: string | null
          force_proxy_native?: boolean
          id?: string
          is_active?: boolean
          is_adult?: boolean
          logo_source_url?: string | null
          logo_url?: string | null
          name: string
          prefer_sw_decoder?: boolean
          stream_format?: string
          stream_url: string
          updated_at?: string
          use_proxy_token?: boolean
        }
        Update: {
          backup_stream_urls?: string[]
          category_id?: string | null
          channel_number?: number
          created_at?: string
          epg_alt_text?: string | null
          epg_channel_id?: string | null
          epg_grab_logo?: boolean
          epg_show_synopsis?: boolean
          epg_type?: string | null
          epg_url?: string | null
          force_proxy_native?: boolean
          id?: string
          is_active?: boolean
          is_adult?: boolean
          logo_source_url?: string | null
          logo_url?: string | null
          name?: string
          prefer_sw_decoder?: boolean
          stream_format?: string
          stream_url?: string
          updated_at?: string
          use_proxy_token?: boolean
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
      epg_url_presets: {
        Row: {
          created_at: string
          epg_type: string
          id: string
          name: string
          updated_at: string
          url: string
        }
        Insert: {
          created_at?: string
          epg_type: string
          id?: string
          name: string
          updated_at?: string
          url: string
        }
        Update: {
          created_at?: string
          epg_type?: string
          id?: string
          name?: string
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      hubsoft_config: {
        Row: {
          api_key: string
          api_url: string
          created_at: string
          device_limit: number
          id: string
          is_active: boolean
          name: string
          package_id: string
          password: string
          trial_days: number
          trial_enabled: boolean
          updated_at: string
          username: string
        }
        Insert: {
          api_key?: string
          api_url?: string
          created_at?: string
          device_limit?: number
          id?: string
          is_active?: boolean
          name?: string
          package_id?: string
          password?: string
          trial_days?: number
          trial_enabled?: boolean
          updated_at?: string
          username?: string
        }
        Update: {
          api_key?: string
          api_url?: string
          created_at?: string
          device_limit?: number
          id?: string
          is_active?: boolean
          name?: string
          package_id?: string
          password?: string
          trial_days?: number
          trial_enabled?: boolean
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
      hubsoft_config_trial_categories: {
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
        Relationships: []
      }
      pending_devices: {
        Row: {
          app_version: string | null
          device_id: string
          device_name: string | null
          first_seen_at: string
          id: string
          last_ip: string | null
          last_seen_at: string
          platform: string
        }
        Insert: {
          app_version?: string | null
          device_id: string
          device_name?: string | null
          first_seen_at?: string
          id?: string
          last_ip?: string | null
          last_seen_at?: string
          platform: string
        }
        Update: {
          app_version?: string | null
          device_id?: string
          device_name?: string | null
          first_seen_at?: string
          id?: string
          last_ip?: string | null
          last_seen_at?: string
          platform?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          adult_pin: string
          created_at: string
          device_limit_override: number | null
          display_name: string | null
          force_signout_at: string | null
          hubsoft_client_id: string | null
          id: string
          is_active: boolean
          is_blocked: boolean
          playlist_password: string
          playlist_token: string
          updated_at: string
          user_id: string
          username: string | null
        }
        Insert: {
          adult_pin?: string
          created_at?: string
          device_limit_override?: number | null
          display_name?: string | null
          force_signout_at?: string | null
          hubsoft_client_id?: string | null
          id?: string
          is_active?: boolean
          is_blocked?: boolean
          playlist_password?: string
          playlist_token?: string
          updated_at?: string
          user_id: string
          username?: string | null
        }
        Update: {
          adult_pin?: string
          created_at?: string
          device_limit_override?: number | null
          display_name?: string | null
          force_signout_at?: string | null
          hubsoft_client_id?: string | null
          id?: string
          is_active?: boolean
          is_blocked?: boolean
          playlist_password?: string
          playlist_token?: string
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
      short_links: {
        Row: {
          created_at: string
          created_by: string | null
          hit_count: number
          last_hit_at: string | null
          slug: string
          target_url: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          hit_count?: number
          last_hit_at?: string | null
          slug: string
          target_url: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          hit_count?: number
          last_hit_at?: string | null
          slug?: string
          target_url?: string
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
          is_trial: boolean
          trial_expires_at: string | null
          user_id: string
        }
        Insert: {
          category_id: string
          created_at?: string
          hubsoft_config_id?: string | null
          id?: string
          is_active?: boolean
          is_trial?: boolean
          trial_expires_at?: string | null
          user_id: string
        }
        Update: {
          category_id?: string
          created_at?: string
          hubsoft_config_id?: string | null
          id?: string
          is_active?: boolean
          is_trial?: boolean
          trial_expires_at?: string | null
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
      user_devices: {
        Row: {
          app_version: string | null
          created_at: string
          created_by: string
          device_id: string
          device_label: string | null
          device_name: string | null
          first_login_at: string
          id: string
          is_active: boolean
          last_ip: string | null
          last_seen_at: string
          platform: string
          updated_at: string
          user_id: string
        }
        Insert: {
          app_version?: string | null
          created_at?: string
          created_by?: string
          device_id: string
          device_label?: string | null
          device_name?: string | null
          first_login_at?: string
          id?: string
          is_active?: boolean
          last_ip?: string | null
          last_seen_at?: string
          platform: string
          updated_at?: string
          user_id: string
        }
        Update: {
          app_version?: string | null
          created_at?: string
          created_by?: string
          device_id?: string
          device_label?: string | null
          device_name?: string | null
          first_login_at?: string
          id?: string
          is_active?: boolean
          last_ip?: string | null
          last_seen_at?: string
          platform?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
          client_ipv4: string | null
          client_ipv6: string | null
          created_at: string
          current_channel_id: string | null
          current_channel_name: string | null
          device_id: string | null
          ended_at: string | null
          id: string
          ip_address: string | null
          is_watching: boolean
          last_heartbeat_at: string
          platform: string | null
          session_token: string
          started_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          client_ipv4?: string | null
          client_ipv6?: string | null
          created_at?: string
          current_channel_id?: string | null
          current_channel_name?: string | null
          device_id?: string | null
          ended_at?: string | null
          id?: string
          ip_address?: string | null
          is_watching?: boolean
          last_heartbeat_at?: string
          platform?: string | null
          session_token: string
          started_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          client_ipv4?: string | null
          client_ipv6?: string | null
          created_at?: string
          current_channel_id?: string | null
          current_channel_name?: string | null
          device_id?: string | null
          ended_at?: string | null
          id?: string
          ip_address?: string | null
          is_watching?: boolean
          last_heartbeat_at?: string
          platform?: string | null
          session_token?: string
          started_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      user_access_stats: {
        Row: {
          created_at: string | null
          display_name: string | null
          is_active: boolean | null
          is_blocked: boolean | null
          last_login_at: string | null
          logins_last_30d: number | null
          total_logins: number | null
          user_id: string | null
          username: string | null
        }
        Insert: {
          created_at?: string | null
          display_name?: string | null
          is_active?: boolean | null
          is_blocked?: boolean | null
          last_login_at?: never
          logins_last_30d?: never
          total_logins?: never
          user_id?: string | null
          username?: string | null
        }
        Update: {
          created_at?: string | null
          display_name?: string | null
          is_active?: boolean | null
          is_blocked?: boolean | null
          last_login_at?: never
          logins_last_30d?: never
          total_logins?: never
          user_id?: string | null
          username?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      cleanup_old_monitoring_data: { Args: never; Returns: undefined }
      expire_trial_access: { Args: never; Returns: number }
      export_auth_identities: {
        Args: never
        Returns: unknown[]
        SetofOptions: {
          from: "*"
          to: "identities"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      export_auth_users: {
        Args: never
        Returns: unknown[]
        SetofOptions: {
          from: "*"
          to: "users"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_monitoring_stats_30d: {
        Args: never
        Returns: {
          total_sessions: number
          unique_ips: number
          unique_users: number
        }[]
      }
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
      resolve_device_limit: { Args: { _user_id: string }; Returns: number }
      short_link_hit: { Args: { _slug: string }; Returns: undefined }
      user_has_category_access: {
        Args: { _category_id: string; _user_id: string }
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
