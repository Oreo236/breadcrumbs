// Client-side twin of supabase/functions/generate-adventure/lib/joinCode.ts.
// Uppercase, no ambiguous characters (0/O, 1/I/L excluded). Uses Math.random because
// Hermes has no crypto.getRandomValues; collisions are caught by the unique constraint + retry.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateJoinCode(length = 6): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}
