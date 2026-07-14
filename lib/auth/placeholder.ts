import { hashPassword } from "./password";

let _placeholderHash: string | null = null;

/**
 * A valid bcrypt hash that never matches a real password. Used to keep
 * verifyPassword's cost constant when the looked-up user doesn't exist,
 * so login timing can't be used to enumerate registered emails.
 * Computed once (not hardcoded) so it always matches the running bcrypt version.
 */
export async function getPlaceholderHash(): Promise<string> {
  if (!_placeholderHash) {
    _placeholderHash = await hashPassword("placeholder_not_a_real_password");
  }
  return _placeholderHash;
}
