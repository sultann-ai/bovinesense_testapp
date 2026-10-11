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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      alert_events: {
        Row: {
          alert_id: number
          created_at: string
          from_status: Database["public"]["Enums"]["alert_status"] | null
          id: number
          note: string | null
          organization_id: string
          to_status: Database["public"]["Enums"]["alert_status"]
          user_id: string | null
        }
        Insert: {
          alert_id: number
          created_at?: string
          from_status?: Database["public"]["Enums"]["alert_status"] | null
          id?: number
          note?: string | null
          organization_id: string
          to_status: Database["public"]["Enums"]["alert_status"]
          user_id?: string | null
        }
        Update: {
          alert_id?: number
          created_at?: string
          from_status?: Database["public"]["Enums"]["alert_status"] | null
          id?: number
          note?: string | null
          organization_id?: string
          to_status?: Database["public"]["Enums"]["alert_status"]
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "alert_events_alert_fk"
            columns: ["organization_id", "alert_id"]
            isOneToOne: false
            referencedRelation: "alert_overview"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "alert_events_alert_fk"
            columns: ["organization_id", "alert_id"]
            isOneToOne: false
            referencedRelation: "alerts"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "alert_events_organization_fk"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      alerts: {
        Row: {
          acknowledged_at: string | null
          animal_id: number
          assigned_at: string | null
          assignee_id: string | null
          created_at: string
          detail: string | null
          distance_km: number | null
          id: number
          organization_id: string
          resolution_note: string | null
          resolution_reason:
            | Database["public"]["Enums"]["resolution_reason"]
            | null
          resolved_at: string | null
          severity: Database["public"]["Enums"]["alert_severity"]
          status: Database["public"]["Enums"]["alert_status"]
          tag_id: number | null
          title: string
          type: Database["public"]["Enums"]["alert_type"]
        }
        Insert: {
          acknowledged_at?: string | null
          animal_id: number
          assigned_at?: string | null
          assignee_id?: string | null
          created_at?: string
          detail?: string | null
          distance_km?: number | null
          id?: number
          organization_id: string
          resolution_note?: string | null
          resolution_reason?:
            | Database["public"]["Enums"]["resolution_reason"]
            | null
          resolved_at?: string | null
          severity: Database["public"]["Enums"]["alert_severity"]
          status?: Database["public"]["Enums"]["alert_status"]
          tag_id?: number | null
          title: string
          type: Database["public"]["Enums"]["alert_type"]
        }
        Update: {
          acknowledged_at?: string | null
          animal_id?: number
          assigned_at?: string | null
          assignee_id?: string | null
          created_at?: string
          detail?: string | null
          distance_km?: number | null
          id?: number
          organization_id?: string
          resolution_note?: string | null
          resolution_reason?:
            | Database["public"]["Enums"]["resolution_reason"]
            | null
          resolved_at?: string | null
          severity?: Database["public"]["Enums"]["alert_severity"]
          status?: Database["public"]["Enums"]["alert_status"]
          tag_id?: number | null
          title?: string
          type?: Database["public"]["Enums"]["alert_type"]
        }
        Relationships: [
          {
            foreignKeyName: "alerts_animal_fk"
            columns: ["organization_id", "animal_id"]
            isOneToOne: false
            referencedRelation: "animal_overview"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "alerts_animal_fk"
            columns: ["organization_id", "animal_id"]
            isOneToOne: false
            referencedRelation: "animals"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "alerts_assignee_fk"
            columns: ["organization_id", "assignee_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "alerts_organization_fk"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_tag_fk"
            columns: ["organization_id", "tag_id"]
            isOneToOne: false
            referencedRelation: "device_overview"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "alerts_tag_fk"
            columns: ["organization_id", "tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      animal_geofence: {
        Row: {
          animal_id: number
          assigned_at: string
          geofence_id: number
          id: number
          is_active: boolean
          organization_id: string
        }
        Insert: {
          animal_id: number
          assigned_at?: string
          geofence_id: number
          id?: number
          is_active?: boolean
          organization_id: string
        }
        Update: {
          animal_id?: number
          assigned_at?: string
          geofence_id?: number
          id?: number
          is_active?: boolean
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "animal_geofence_animal_fk"
            columns: ["organization_id", "animal_id"]
            isOneToOne: false
            referencedRelation: "animal_overview"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "animal_geofence_animal_fk"
            columns: ["organization_id", "animal_id"]
            isOneToOne: false
            referencedRelation: "animals"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "animal_geofence_geofence_fk"
            columns: ["organization_id", "geofence_id"]
            isOneToOne: false
            referencedRelation: "geofence_detail"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "animal_geofence_geofence_fk"
            columns: ["organization_id", "geofence_id"]
            isOneToOne: false
            referencedRelation: "geofence_overview"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "animal_geofence_geofence_fk"
            columns: ["organization_id", "geofence_id"]
            isOneToOne: false
            referencedRelation: "geofences"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "animal_geofence_organization_fk"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      animals: {
        Row: {
          age_years: number | null
          borrower_id: number
          branch_id: number
          created_at: string
          district: string | null
          id: number
          loan_id: number | null
          name: string | null
          organization_id: string
          sex: string | null
          species: string
          status: Database["public"]["Enums"]["animal_status"]
          tag_id: number | null
        }
        Insert: {
          age_years?: number | null
          borrower_id: number
          branch_id: number
          created_at?: string
          district?: string | null
          id?: number
          loan_id?: number | null
          name?: string | null
          organization_id: string
          sex?: string | null
          species?: string
          status?: Database["public"]["Enums"]["animal_status"]
          tag_id?: number | null
        }
        Update: {
          age_years?: number | null
          borrower_id?: number
          branch_id?: number
          created_at?: string
          district?: string | null
          id?: number
          loan_id?: number | null
          name?: string | null
          organization_id?: string
          sex?: string | null
          species?: string
          status?: Database["public"]["Enums"]["animal_status"]
          tag_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "animals_borrower_fk"
            columns: ["organization_id", "borrower_id"]
            isOneToOne: false
            referencedRelation: "borrowers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "animals_branch_fk"
            columns: ["organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "animals_loan_fk"
            columns: ["organization_id", "loan_id"]
            isOneToOne: false
            referencedRelation: "loans"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "animals_organization_fk"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "animals_tag_fk"
            columns: ["organization_id", "tag_id"]
            isOneToOne: false
            referencedRelation: "device_overview"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "animals_tag_fk"
            columns: ["organization_id", "tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      borrowers: {
        Row: {
          address: string | null
          branch_id: number
          cnic: string | null
          created_at: string
          district: string | null
          id: number
          name: string
          organization_id: string
          phone: string | null
        }
        Insert: {
          address?: string | null
          branch_id: number
          cnic?: string | null
          created_at?: string
          district?: string | null
          id?: number
          name: string
          organization_id: string
          phone?: string | null
        }
        Update: {
          address?: string | null
          branch_id?: number
          cnic?: string | null
          created_at?: string
          district?: string | null
          id?: number
          name?: string
          organization_id?: string
          phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "borrowers_branch_fk"
            columns: ["organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "borrowers_organization_fk"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      branches: {
        Row: {
          code: string
          district: string | null
          id: number
          name: string
          organization_id: string
          region_id: number
        }
        Insert: {
          code: string
          district?: string | null
          id?: number
          name: string
          organization_id: string
          region_id: number
        }
        Update: {
          code?: string
          district?: string | null
          id?: number
          name?: string
          organization_id?: string
          region_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "branches_organization_fk"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branches_region_fk"
            columns: ["organization_id", "region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      device_api_keys: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          key_hash: string
          key_prefix: string
          label: string
          last_used_at: string | null
          organization_id: string
          revoked_at: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          key_hash: string
          key_prefix: string
          label: string
          last_used_at?: string | null
          organization_id: string
          revoked_at?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          key_hash?: string
          key_prefix?: string
          label?: string
          last_used_at?: string | null
          organization_id?: string
          revoked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "device_api_keys_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      district_boundaries: {
        Row: {
          district_name: string
          gadm_gid: string | null
          geom: unknown
          id: number
          province: string | null
        }
        Insert: {
          district_name: string
          gadm_gid?: string | null
          geom: unknown
          id?: number
          province?: string | null
        }
        Update: {
          district_name?: string
          gadm_gid?: string | null
          geom?: unknown
          id?: number
          province?: string | null
        }
        Relationships: []
      }
      fix_daily_summary: {
        Row: {
          animal_id: number
          first_fix_at: string
          first_lat: number
          first_lon: number
          fix_count: number
          last_fix_at: string
          last_lat: number
          last_lon: number
          max_speed_kmh: number | null
          organization_id: string
          summary_date: string
        }
        Insert: {
          animal_id: number
          first_fix_at: string
          first_lat: number
          first_lon: number
          fix_count: number
          last_fix_at: string
          last_lat: number
          last_lon: number
          max_speed_kmh?: number | null
          organization_id: string
          summary_date: string
        }
        Update: {
          animal_id?: number
          first_fix_at?: string
          first_lat?: number
          first_lon?: number
          fix_count?: number
          last_fix_at?: string
          last_lat?: number
          last_lon?: number
          max_speed_kmh?: number | null
          organization_id?: string
          summary_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "fix_daily_summary_animal_fk"
            columns: ["organization_id", "animal_id"]
            isOneToOne: false
            referencedRelation: "animal_overview"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "fix_daily_summary_animal_fk"
            columns: ["organization_id", "animal_id"]
            isOneToOne: false
            referencedRelation: "animals"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      fixes: {
        Row: {
          animal_id: number | null
          battery_pct: number | null
          created_at: string
          fixed_at: string
          geom: unknown
          id: number
          is_simulated: boolean
          lat: number
          lon: number
          organization_id: string
          signal_bars: number | null
          speed_kmh: number | null
          tag_id: number
        }
        Insert: {
          animal_id?: number | null
          battery_pct?: number | null
          created_at?: string
          fixed_at: string
          geom?: unknown
          id?: number
          is_simulated?: boolean
          lat: number
          lon: number
          organization_id: string
          signal_bars?: number | null
          speed_kmh?: number | null
          tag_id: number
        }
        Update: {
          animal_id?: number | null
          battery_pct?: number | null
          created_at?: string
          fixed_at?: string
          geom?: unknown
          id?: number
          is_simulated?: boolean
          lat?: number
          lon?: number
          organization_id?: string
          signal_bars?: number | null
          speed_kmh?: number | null
          tag_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "fixes_animal_fk"
            columns: ["organization_id", "animal_id"]
            isOneToOne: false
            referencedRelation: "animal_overview"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "fixes_animal_fk"
            columns: ["organization_id", "animal_id"]
            isOneToOne: false
            referencedRelation: "animals"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "fixes_organization_fk"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixes_tag_fk"
            columns: ["organization_id", "tag_id"]
            isOneToOne: false
            referencedRelation: "device_overview"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "fixes_tag_fk"
            columns: ["organization_id", "tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      geofences: {
        Row: {
          center_lat: number | null
          center_lon: number | null
          created_at: string
          district_name: string | null
          geom: unknown
          id: number
          name: string
          organization_id: string
          radius_m: number | null
          type: Database["public"]["Enums"]["fence_type"]
          warning_buffer_m: number
        }
        Insert: {
          center_lat?: number | null
          center_lon?: number | null
          created_at?: string
          district_name?: string | null
          geom: unknown
          id?: number
          name: string
          organization_id: string
          radius_m?: number | null
          type: Database["public"]["Enums"]["fence_type"]
          warning_buffer_m?: number
        }
        Update: {
          center_lat?: number | null
          center_lon?: number | null
          created_at?: string
          district_name?: string | null
          geom?: unknown
          id?: number
          name?: string
          organization_id?: string
          radius_m?: number | null
          type?: Database["public"]["Enums"]["fence_type"]
          warning_buffer_m?: number
        }
        Relationships: [
          {
            foreignKeyName: "geofences_organization_fk"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      loans: {
        Row: {
          amount_pkr: number
          borrower_id: number
          branch_id: number
          disbursed_at: string | null
          id: number
          loan_number: string
          organization_id: string
          status: string
        }
        Insert: {
          amount_pkr: number
          borrower_id: number
          branch_id: number
          disbursed_at?: string | null
          id?: number
          loan_number: string
          organization_id: string
          status?: string
        }
        Update: {
          amount_pkr?: number
          borrower_id?: number
          branch_id?: number
          disbursed_at?: string | null
          id?: number
          loan_number?: string
          organization_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "loans_borrower_fk"
            columns: ["organization_id", "borrower_id"]
            isOneToOne: false
            referencedRelation: "borrowers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "loans_branch_fk"
            columns: ["organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "loans_organization_fk"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          branch_id: number | null
          created_at: string
          id: string
          organization_id: string
          region_id: number | null
          role: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Insert: {
          branch_id?: number | null
          created_at?: string
          id?: string
          organization_id: string
          region_id?: number | null
          role: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Update: {
          branch_id?: number | null
          created_at?: string
          id?: string
          organization_id?: string
          region_id?: number | null
          role?: Database["public"]["Enums"]["org_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_branch_fk"
            columns: ["organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_region_fk"
            columns: ["organization_id", "region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      organizations: {
        Row: {
          brand_settings: Json
          created_at: string
          id: string
          logo_url: string | null
          name: string
          settings: Json
          slug: string
          status: Database["public"]["Enums"]["org_status"]
        }
        Insert: {
          brand_settings?: Json
          created_at?: string
          id?: string
          logo_url?: string | null
          name: string
          settings?: Json
          slug: string
          status?: Database["public"]["Enums"]["org_status"]
        }
        Update: {
          brand_settings?: Json
          created_at?: string
          id?: string
          logo_url?: string | null
          name?: string
          settings?: Json
          slug?: string
          status?: Database["public"]["Enums"]["org_status"]
        }
        Relationships: []
      }
      platform_admins: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      platform_audit_log: {
        Row: {
          action: string
          created_at: string
          detail: Json
          id: number
          organization_id: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          detail?: Json
          id?: never
          organization_id?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          detail?: Json
          id?: never
          organization_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_audit_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      regions: {
        Row: {
          code: string
          id: number
          name: string
          organization_id: string
        }
        Insert: {
          code: string
          id?: number
          name: string
          organization_id: string
        }
        Update: {
          code?: string
          id?: number
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "regions_organization_fk"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          id: number
          is_simulated: boolean
          last_seen_at: string | null
          organization_id: string
          serial_number: string
        }
        Insert: {
          id?: number
          is_simulated?: boolean
          last_seen_at?: string | null
          organization_id: string
          serial_number: string
        }
        Update: {
          id?: number
          is_simulated?: boolean
          last_seen_at?: string | null
          organization_id?: string
          serial_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "tags_organization_fk"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      alert_audit: {
        Row: {
          alert_id: number | null
          created_at: string | null
          from_status: Database["public"]["Enums"]["alert_status"] | null
          id: number | null
          note: string | null
          organization_id: string | null
          to_status: Database["public"]["Enums"]["alert_status"] | null
          user_id: string | null
          user_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "alert_events_alert_fk"
            columns: ["organization_id", "alert_id"]
            isOneToOne: false
            referencedRelation: "alert_overview"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "alert_events_alert_fk"
            columns: ["organization_id", "alert_id"]
            isOneToOne: false
            referencedRelation: "alerts"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "alert_events_organization_fk"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      alert_overview: {
        Row: {
          acknowledged_at: string | null
          animal_id: number | null
          animal_name: string | null
          animal_status: Database["public"]["Enums"]["animal_status"] | null
          assigned_at: string | null
          assignee_id: string | null
          borrower_id: number | null
          borrower_name: string | null
          branch_id: number | null
          branch_name: string | null
          created_at: string | null
          detail: string | null
          distance_km: number | null
          id: number | null
          loan_number: string | null
          organization_id: string | null
          region_id: number | null
          region_name: string | null
          resolution_note: string | null
          resolution_reason:
            | Database["public"]["Enums"]["resolution_reason"]
            | null
          resolved_at: string | null
          severity: Database["public"]["Enums"]["alert_severity"] | null
          severity_rank: number | null
          status: Database["public"]["Enums"]["alert_status"] | null
          status_rank: number | null
          tag_serial: string | null
          title: string | null
          type: Database["public"]["Enums"]["alert_type"] | null
        }
        Relationships: [
          {
            foreignKeyName: "alerts_assignee_fk"
            columns: ["organization_id", "assignee_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "alerts_organization_fk"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      animal_overview: {
        Row: {
          address: string | null
          age_years: number | null
          amount_pkr: number | null
          animal_name: string | null
          battery_pct: number | null
          borrower_id: number | null
          borrower_name: string | null
          branch_id: number | null
          branch_name: string | null
          cnic: string | null
          disbursed_at: string | null
          district: string | null
          geofence_id: number | null
          geofence_name: string | null
          has_unack_breach: boolean | null
          id: number | null
          last_fix_at: string | null
          lat: number | null
          loan_id: number | null
          loan_number: string | null
          loan_status: string | null
          lon: number | null
          organization_id: string | null
          phone: string | null
          region_id: number | null
          region_name: string | null
          sex: string | null
          signal_bars: number | null
          species: string | null
          speed_kmh: number | null
          status: Database["public"]["Enums"]["animal_status"] | null
          status_rank: number | null
          tag_id: number | null
          tag_is_simulated: boolean | null
          tag_last_seen_at: string | null
          tag_serial: string | null
          warning_buffer_m: number | null
        }
        Relationships: [
          {
            foreignKeyName: "animals_borrower_fk"
            columns: ["organization_id", "borrower_id"]
            isOneToOne: false
            referencedRelation: "borrowers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "animals_branch_fk"
            columns: ["organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "animals_loan_fk"
            columns: ["organization_id", "loan_id"]
            isOneToOne: false
            referencedRelation: "loans"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "animals_organization_fk"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "animals_tag_fk"
            columns: ["organization_id", "tag_id"]
            isOneToOne: false
            referencedRelation: "device_overview"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "animals_tag_fk"
            columns: ["organization_id", "tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      device_overview: {
        Row: {
          animal_id: number | null
          animal_name: string | null
          battery_pct: number | null
          id: number | null
          is_simulated: boolean | null
          is_unassigned: boolean | null
          last_fix_at: string | null
          last_seen_at: string | null
          organization_id: string | null
          serial_number: string | null
          signal_bars: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tags_organization_fk"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      district_boundary_features: {
        Row: {
          district_name: string | null
          geometry: Json | null
          id: number | null
          province: string | null
        }
        Insert: {
          district_name?: string | null
          geometry?: never
          id?: number | null
          province?: string | null
        }
        Update: {
          district_name?: string | null
          geometry?: never
          id?: number | null
          province?: string | null
        }
        Relationships: []
      }
      geofence_detail: {
        Row: {
          center_lat: number | null
          center_lon: number | null
          created_at: string | null
          district_name: string | null
          geojson: Json | null
          id: number | null
          name: string | null
          organization_id: string | null
          radius_m: number | null
          type: Database["public"]["Enums"]["fence_type"] | null
          warning_buffer_m: number | null
        }
        Insert: {
          center_lat?: number | null
          center_lon?: number | null
          created_at?: string | null
          district_name?: string | null
          geojson?: never
          id?: number | null
          name?: string | null
          organization_id?: string | null
          radius_m?: number | null
          type?: Database["public"]["Enums"]["fence_type"] | null
          warning_buffer_m?: number | null
        }
        Update: {
          center_lat?: number | null
          center_lon?: number | null
          created_at?: string | null
          district_name?: string | null
          geojson?: never
          id?: number | null
          name?: string | null
          organization_id?: string | null
          radius_m?: number | null
          type?: Database["public"]["Enums"]["fence_type"] | null
          warning_buffer_m?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "geofences_organization_fk"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      geofence_overview: {
        Row: {
          animal_count: number | null
          breach_count: number | null
          created_at: string | null
          district_name: string | null
          id: number | null
          name: string | null
          organization_id: string | null
          type: Database["public"]["Enums"]["fence_type"] | null
          warning_buffer_m: number | null
        }
        Relationships: [
          {
            foreignKeyName: "geofences_organization_fk"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      kpi_summary: {
        Row: {
          branch_id: number | null
          breach_count: number | null
          inside_count: number | null
          new_alerts: number | null
          organization_id: string | null
          region_id: number | null
          stale_count: number | null
          total: number | null
        }
        Relationships: [
          {
            foreignKeyName: "animals_branch_fk"
            columns: ["organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "animals_organization_fk"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _raise_alert: {
        Args: {
          p_animal: number
          p_detail: string
          p_distance_km?: number
          p_org: string
          p_severity: Database["public"]["Enums"]["alert_severity"]
          p_tag: number
          p_title: string
          p_type: Database["public"]["Enums"]["alert_type"]
        }
        Returns: number
      }
      alert_assignees: {
        Args: { p_alert_id: number }
        Returns: {
          full_name: string
          user_id: string
        }[]
      }
      alert_rule_number: {
        Args: { p_default: number; p_key: string; p_min: number; p_rules: Json }
        Returns: number
      }
      animal_has_prior_outside_fix: {
        Args: { p_animal_id: number; p_fix_id: number; p_geofence_id: number }
        Returns: boolean
      }
      background_job_status: {
        Args: never
        Returns: {
          job_name: string
          last_run_at: string
          last_status: string
          schedule: string
        }[]
      }
      build_fence_geometry: {
        Args: {
          p_center_lat: number
          p_center_lon: number
          p_district: string
          p_geojson: Json
          p_radius_m: number
          p_type: Database["public"]["Enums"]["fence_type"]
        }
        Returns: unknown
      }
      can_see_whole_org: { Args: { p_org: string }; Returns: boolean }
      check_offline_tags: { Args: { p_org?: string }; Returns: number }
      create_geofence: {
        Args: {
          p_center_lat?: number
          p_center_lon?: number
          p_district_name?: string
          p_geojson?: Json
          p_name: string
          p_organization_id: string
          p_radius_m?: number
          p_type: Database["public"]["Enums"]["fence_type"]
          p_warning_buffer_m?: number
        }
        Returns: number
      }
      current_org_ids: { Args: never; Returns: string[] }
      fence_spatial_context: {
        Args: { p_geofence_id: number; p_lat: number; p_lon: number }
        Returns: {
          inside_fence: boolean
          metres_outside: number
          metres_to_edge: number
        }[]
      }
      find_offline_animals: {
        Args: { p_threshold_hours?: number }
        Returns: {
          animal_id: number
          animal_name: string
          borrower_name: string
          branch_id: number
          loan_number: string
          organization_id: string
          region_id: number
          tag_id: number
        }[]
      }
      has_any_role: {
        Args: {
          p_org: string
          p_roles: Database["public"]["Enums"]["org_role"][]
        }
        Returns: boolean
      }
      has_role: {
        Args: { p_org: string; p_role: Database["public"]["Enums"]["org_role"] }
        Returns: boolean
      }
      haversine_km: {
        Args: { lat1: number; lat2: number; lon1: number; lon2: number }
        Returns: number
      }
      health_ping: { Args: never; Returns: Json }
      import_district_boundary: {
        Args: {
          p_geojson: Json
          p_gid: string
          p_name: string
          p_province: string
        }
        Returns: undefined
      }
      ingest_fix: {
        Args: {
          p_battery_pct?: number
          p_device_key_id: string
          p_fixed_at: string
          p_lat: number
          p_lon: number
          p_organization_id: string
          p_signal_bars?: number
          p_speed_kmh?: number
          p_tag_serial: string
        }
        Returns: Json
      }
      is_platform_admin: { Args: never; Returns: boolean }
      org_alert_rules: {
        Args: { p_org: string }
        Returns: {
          breach_consecutive_fixes: number
          hard_breach_metres: number
          low_battery_pct: number
          speed_threshold_kmh: number
        }[]
      }
      org_member_ids: { Args: never; Returns: string[] }
      org_offline_threshold_hours: { Args: { p_org: string }; Returns: number }
      org_retention_days: { Args: { p_org: string }; Returns: number }
      org_timezone: { Args: { p_org: string }; Returns: string }
      rollup_and_prune_fixes: {
        Args: { p_max_days?: number; p_now?: string; p_org?: string }
        Returns: number
      }
      schedule_background_jobs: { Args: never; Returns: undefined }
      set_animal_fence: {
        Args: {
          p_animal_ids: number[]
          p_assign: boolean
          p_geofence_id: number
        }
        Returns: number
      }
      update_geofence: {
        Args: {
          p_center_lat?: number
          p_center_lon?: number
          p_geojson?: Json
          p_id: number
          p_name?: string
          p_radius_m?: number
          p_warning_buffer_m?: number
        }
        Returns: number
      }
      user_branch_scope: { Args: never; Returns: number[] }
    }
    Enums: {
      alert_severity: "critical" | "warning" | "info"
      alert_status: "new" | "acknowledged" | "assigned" | "resolved"
      alert_type:
        | "breach"
        | "near_boundary"
        | "fast_movement"
        | "tag_offline"
        | "low_battery"
        | "returned"
      animal_status: "inside" | "near" | "breach" | "fast" | "stale"
      fence_type: "district" | "polygon" | "radius"
      org_role: "org_admin" | "regional_manager" | "branch_officer" | "auditor"
      org_status: "active" | "suspended"
      resolution_reason:
        | "returned_home"
        | "false_alarm"
        | "moved_with_consent"
        | "escalated_to_recovery"
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
    Enums: {
      alert_severity: ["critical", "warning", "info"],
      alert_status: ["new", "acknowledged", "assigned", "resolved"],
      alert_type: [
        "breach",
        "near_boundary",
        "fast_movement",
        "tag_offline",
        "low_battery",
        "returned",
      ],
      animal_status: ["inside", "near", "breach", "fast", "stale"],
      fence_type: ["district", "polygon", "radius"],
      org_role: ["org_admin", "regional_manager", "branch_officer", "auditor"],
      org_status: ["active", "suspended"],
      resolution_reason: [
        "returned_home",
        "false_alarm",
        "moved_with_consent",
        "escalated_to_recovery",
      ],
    },
  },
} as const
