import type { Database } from "./types";

/** RPC contracts for the external database, independent of Cloud-generated functions. */
export type ExternalDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Functions"> & {
    Functions: {
      cr_get_room: {
        Args: { p_room: string };
        Returns: Array<{ expires_at: string; message_ttl_seconds: number; fingerprint: string; max_participants: number; salt: string }>;
      };
      cr_join_room: {
        Args: { p_room: string; p_fingerprint: string; p_pseudo: string; p_pubkey: string };
        Returns: undefined;
      };
      cr_list_participants: {
        Args: { p_room: string };
        Returns: Array<{ fingerprint: string; pseudo: string; joined_at: string }>;
      };
      cr_list_messages: {
        Args: { p_room: string };
        Returns: Array<{ id: string; sender_fingerprint: string; sender_pubkey: string; ciphertext: string; iv: string; signature: string; created_at: string; expires_at: string | null }>;
      };
      cr_post_message: {
        Args: { p_room: string; p_fingerprint: string; p_ciphertext: string; p_iv: string; p_signature: string };
        Returns: Array<{ id: string; created_at: string; expires_at: string | null }>;
      };
    };
  };
};