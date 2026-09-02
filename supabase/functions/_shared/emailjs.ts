// Server-side EmailJS sending for Deno edge functions — the official
// @emailjs/browser SDK assumes a browser context, so this hits EmailJS's
// REST API directly instead. EmailJS blocks non-browser calls unless the
// account either has "Allow non-browser requests" enabled, or the request
// includes the private key as accessToken — pass EMAILJS_PRIVATE_KEY when
// you have it to be safe either way.
export async function sendEmailJs({
  serviceId,
  templateId,
  publicKey,
  privateKey,
  templateParams,
}: {
  serviceId: string;
  templateId: string;
  publicKey: string;
  privateKey?: string;
  templateParams: Record<string, unknown>;
}) {
  if (!serviceId || !templateId || !publicKey) {
    throw new Error('Missing EmailJS configuration (service id, template id, or public key) on the Edge Function.');
  }

  const body: Record<string, unknown> = {
    service_id: serviceId,
    template_id: templateId,
    user_id: publicKey,
    template_params: templateParams,
  };
  if (privateKey) body.accessToken = privateKey;

  const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`EmailJS send failed (${response.status}): ${text.slice(0, 300)}`);
  }
}
