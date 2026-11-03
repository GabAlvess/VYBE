export function isConfiguredPlatformAdmin(email: string, configuredEmails = process.env.VYBE_PLATFORM_ADMIN_EMAILS ?? '') {
  const configured = configuredEmails.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
  return configured.includes(email.trim().toLowerCase());
}
