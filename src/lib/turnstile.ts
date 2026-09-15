export async function verifyTurnstileToken(
  token: string | null | undefined,
  secretKey?: string,
  ip?: string
): Promise<{ success: boolean; errorCodes?: string[] }> {
  // Allow bypassing in local dev if no secret key configured
  if (!secretKey || secretKey === 'dummy-secret-key' || secretKey.trim() === '') {
    return { success: true };
  }

  if (!token) {
    return { success: false, errorCodes: ['missing-input-response'] };
  }

  const formData = new URLSearchParams();
  formData.append('secret', secretKey);
  formData.append('response', token);
  if (ip) {
    formData.append('remoteip', ip);
  }

  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
    });

    const data: any = await res.json();
    return {
      success: !!data.success,
      errorCodes: data['error-codes'],
    };
  } catch (err) {
    return {
      success: false,
      errorCodes: ['internal-error'],
    };
  }
}
