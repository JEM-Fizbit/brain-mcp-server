export interface RegistrationLimits { maximumClients: number; perHour: number }

export function registrationLimits(): RegistrationLimits {
  function positive(name: string, fallback: number): number {
    const value = Number(process.env[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
    return value;
  }
  return { maximumClients: positive("BRAIN_OAUTH_MAX_CLIENTS", 10000), perHour: positive("BRAIN_OAUTH_REGISTRATIONS_PER_HOUR", 300) };
}
