ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS salt text;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

SELECT cron.unschedule('cipherroom-prune-expired-messages')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'cipherroom-prune-expired-messages'
);

SELECT cron.schedule(
  'cipherroom-prune-expired-messages',
  '* * * * *',
  $$
  DELETE FROM public.messages
  WHERE expires_at IS NOT NULL AND expires_at <= now();
  $$
);