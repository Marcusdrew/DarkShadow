CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

SELECT cron.unschedule('cipherroom-prune-expired-rooms')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'cipherroom-prune-expired-rooms'
);

SELECT cron.schedule(
  'cipherroom-prune-expired-rooms',
  '* * * * *',
  $$
  DELETE FROM public.rooms
  WHERE expires_at <= now();
  $$
);