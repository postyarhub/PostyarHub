import argon2 from 'argon2';

/** Argon2id (§39). Reference used weak bcrypt/md5 variants — not carried over. */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function passwordPolicyOk(password: string): boolean {
  return password.length >= 8 && /[a-zA-Z\u0600-\u06FF]/.test(password) && /\d/.test(password);
}
