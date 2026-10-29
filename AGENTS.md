# Architecture rules

- Keep mobile privacy protection browser-side, with a synchronous document-wide mask and explicit resumption after lifecycle interruptions; browser signals cannot prove or prevent OS captures.
- Keep shield resumption eligibility in a browser-safe pure policy with focused tests so background or unfocused documents cannot reveal conversations.
- App data lives in the user's external Supabase project: browser code imports `supabase` from `@/integrations/supabase/external`, privileged server code uses `createExternalAdmin()` from `@/integrations/supabase/external.server` (secret `EXTERNAL_SUPABASE_SERVICE_ROLE_KEY`); the generated Lovable Cloud clients stay unused because Cloud cannot be detached.
- Keep external RPC contracts in external.types.ts rather than modifying Cloud-generated types, because each database exposes different functions.
- Size the active channel with the visual viewport and never treat viewport resizing alone as capture evidence, because mobile keyboards and browser chrome resize during messaging.