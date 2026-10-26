import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

/**
 * Google Cloud IAP as the door (AUTH_MODE=iap, used by the GCP deployment). IAP signs every request
 * it lets through with an ES256 JWT in x-goog-iap-jwt-assertion; the app checks the signature, the
 * issuer and the audience (its own backend service), so a request that skipped IAP is refused.
 */
const IAP_ISSUER = "https://cloud.google.com/iap";
const IAP_JWKS = "https://www.gstatic.com/iap/verify/public_key-jwk";

export const iapKeys = (): JWTVerifyGetKey => createRemoteJWKSet(new URL(IAP_JWKS));

/** The verified email, or null. */
export async function iapEmail(token: string | undefined, keys: JWTVerifyGetKey, audience: string): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, keys, { issuer: IAP_ISSUER, audience, algorithms: ["ES256"] });
    const email = String(payload.email ?? "").replace(/^accounts\.google\.com:/, "");
    return email || null;
  } catch {
    return null;
  }
}
