import { readFileSync } from 'node:fs';
import { createSecureContext } from 'node:tls';

export function loadTls(certPath: string, keyPath: string): { cert: Buffer; key: Buffer } {
  try {
    const cert = readFileSync(certPath),
      key = readFileSync(keyPath);
    createSecureContext({ cert, key });
    return { cert, key };
  } catch (error) {
    throw new Error(
      `TLS: unable to load the certificate (${certPath}) or private key (${keyPath}): ${(error as Error).message}`,
    );
  }
}
