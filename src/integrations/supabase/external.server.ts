// Client privilégié (service role) vers le projet Supabase externe.
// Serveur uniquement — ne jamais importer depuis du code navigateur.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

const EXTERNAL_SUPABASE_URL = "https://ydietqhwvolrofznupxt.supabase.co";

export function createExternalAdmin() {
  const key = process.env["EXTERNAL_SUPABASE_SERVICE_ROLE_KEY"];
  if (!key) {
    throw new Error("missing_external_service_role_key");
  }
  return createClient<Database>(EXTERNAL_SUPABASE_URL, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
