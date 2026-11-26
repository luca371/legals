-- 014: schedules for the new automation functions. They reuse the HTTP call of
-- the existing expiry-reminders job (same project URL and x-cron-secret), so
-- the secret never has to be written out again.
select cron.schedule(
  'portfolio-monitor-weekly',
  '0 6 * * 1',  -- Mondays 06:00 UTC
  (select replace(command, '/functions/v1/expiry-reminders', '/functions/v1/portfolio-monitor')
   from cron.job where jobname = 'agreement-expiry-reminders-daily')
);

select cron.schedule(
  'docusign-poll',
  '*/30 * * * *',  -- every 30 minutes
  (select replace(command, '/functions/v1/expiry-reminders', '/functions/v1/docusign-poll')
   from cron.job where jobname = 'agreement-expiry-reminders-daily')
);
