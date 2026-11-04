# send-email (Supabase Send Email Hook → SNDR)

Sends Hawkim's Supabase Auth emails (password reset, invitation, …) through SNDR from
`no-reply@mail.tryhawkim.com`, with the Hawkim templates in `templates.ts`.

## Setup (once)

1. **SNDR:** domain `mail.tryhawkim.com` verified; create an API key with the **send** scope.
2. **Deploy the function** with JWT verification off (Supabase Auth calls it, not a signed-in user):
   `npx supabase functions deploy send-email --no-verify-jwt`
   or Dashboard → Edge Functions → Deploy a new function → Via editor, name `send-email`, paste
   `send-email-single-file.ts`, deploy, then turn JWT verification off in the function's settings.
3. **Create the hook:** Dashboard → Authentication → Hooks → Add hook → **Send Email** → HTTPS →
   `https://<project-ref>.supabase.co/functions/v1/send-email` → generate the secret.
4. **Secrets:** Dashboard → Edge Functions → Secrets: `SNDR_API_KEY` and `SEND_EMAIL_HOOK_SECRET`
   (the full `v1,whsec_…` value). Optional: `SNDR_FROM`.
5. **Enable the hook** and test "Forgot password" on the website.

If an email doesn't arrive: Edge Functions → send-email → Logs (`send-email: … failed`), and
Authentication → Logs. A 401 there means `SEND_EMAIL_HOOK_SECRET` doesn't match the hook's secret.
To go back to Supabase's own sender, disable the hook.
