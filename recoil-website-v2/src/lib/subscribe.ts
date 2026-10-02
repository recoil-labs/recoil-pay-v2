const GHOST_URL = import.meta.env.VITE_GHOST_API_URL as string | undefined;

export type SubscribeResult = { success: boolean; message: string };

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export async function subscribeEmail(email: string): Promise<SubscribeResult> {
  if (!GHOST_URL) {
    return { success: false, message: 'Subscriptions are not configured.' };
  }
  try {
    const res = await fetch(`${GHOST_URL}/members/api/send-magic-link/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, emailType: 'subscribe' }),
    });
    const text = await res.text();
    const created = text === 'Created.';
    return {
      success: created,
      message: created
        ? 'Check your inbox to confirm the subscription.'
        : 'Subscription failed. Please try again.',
    };
  } catch {
    return { success: false, message: 'An error occurred. Please try again later.' };
  }
}
