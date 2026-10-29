// Client navigateur vers le projet Supabase externe de CipherRoom.
// La clé anon est publique par conception (protégée par les politiques RLS).
import { createClient } from "@supabase/supabase-js";
import type { ExternalDatabase } from "./external.types";

const EXTERNAL_SUPABASE_URL = "https://ydietqhwvolrofznupxt.supabase.co";
const EXTERNAL_SUPABASE_ANON_KEY = "sb_publishable_LdX8ey871vACpkcP3ZWIUQ_6neP9VBJ";

function createExternalClient() {
  return createClient<ExternalDatabase>(EXTERNAL_SUPABASE_URL, EXTERNAL_SUPABASE_ANON_KEY, {
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
