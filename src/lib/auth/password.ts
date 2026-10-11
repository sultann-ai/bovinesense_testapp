/**
 * Client-side mirror of the project's password policy
 * (supabase/config.toml: minimum_password_length = 10, lower_upper_letters_digits).
 * Supabase enforces the real policy; this only lets the form explain a failure
 * immediately instead of after a round trip. Keep the two in step.
 */
export const MIN_PASSWORD_LENGTH = 10;

export const PASSWORD_HINT = `At least ${MIN_PASSWORD_LENGTH} characters, with upper and lower case letters and a number.`;

/** Returns a human-readable problem, or null when the password meets the policy. */
export function validatePassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (!/[a-z]/.test(password)) return "Include a lower case letter.";
  if (!/[A-Z]/.test(password)) return "Include an upper case letter.";
  if (!/[0-9]/.test(password)) return "Include a number.";
  return null;
}
