// Client navigateur vers le projet Supabase externe de CipherRoom.
// La clé anon est publique par conception (protégée par les politiques RLS).
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

const EXTERNAL_SUPABASE_URL = "https://ydietqhwvolrofznupxt.supabase.co";
const EXTERNAL_SUPABASE_ANON_KEY = "ANON_KEY_A_REMPLACER";

function createExternalClient() {
  if (EXTERNAL_SUPABASE_ANON_KEY === "ANON_KEY_A_REMPLACER") {
    throw new Error("Clé anon du projet Supabase externe non configurée.");
  }
  return createClient<Database>(EXTERNAL_SUPABASE_URL, EXTERNAL_SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

let _client: ReturnType<typeof createExternalClient> | undefined;

// Import: import { supabase } from "@/integrations/supabase/external";
export const supabase = new Proxy({} as ReturnType<typeof createExternalClient>, {
  get(_, prop, receiver) {
    if (!_client) _client = createExternalClient();
    return Reflect.get(_client, prop, receiver);
  },
});
