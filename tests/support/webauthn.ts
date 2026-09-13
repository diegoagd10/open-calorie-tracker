import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";

// A protocol-speaking test authenticator: real ES256 signatures and CBOR, no verification stubs.
export function authenticator() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const jwk = publicKey.export({ format: "jwk" });
  const id = randomBytes(32);
  const credentialId = id.toString("base64url");
  let userHandle = "";
  const cose = isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x!, "base64url")],
      [-3, Buffer.from(jwk.y!, "base64url")],
    ]),
  );
  function authData(rpId: string, flags: number, counter: number) {
    const count = Buffer.alloc(4);
    count.writeUInt32BE(counter);
    return Buffer.concat([
      createHash("sha256").update(rpId).digest(),
      Buffer.from([flags]),
      count,
    ]);
  }
  function clientData(type: string, challenge: string, origin: string) {
    return Buffer.from(
      JSON.stringify({ type, challenge, origin, crossOrigin: false }),
    );
  }
  return {
    id: credentialId,
    registration(
      options: PublicKeyCredentialCreationOptionsJSON,
      overrides: {
        origin?: string;
        rpId?: string;
        flags?: number;
        challenge?: string;
      } = {},
    ): RegistrationResponseJSON {
      userHandle = options.user.id;
      const length = Buffer.alloc(2);
      length.writeUInt16BE(id.length);
      const data = Buffer.concat([
        authData(overrides.rpId ?? options.rp.id!, overrides.flags ?? 0x45, 0),
        Buffer.alloc(16),
        length,
        id,
        cose,
      ]);
      const attestation = isoCBOR.encode(
        new Map<string, string | Map<string, never> | Uint8Array>([
          ["fmt", "none"],
          ["attStmt", new Map<string, never>()],
          ["authData", data],
        ]),
      );
      return {
        id: credentialId,
        rawId: credentialId,
        type: "public-key",
        clientExtensionResults: {},
        response: {
          clientDataJSON: clientData(
            "webauthn.create",
            overrides.challenge ?? options.challenge,
            overrides.origin ?? "https://tracker.example",
          ).toString("base64url"),
          attestationObject: Buffer.from(attestation).toString("base64url"),
          transports: ["usb"],
        },
      };
    },
    assertion(
      options: PublicKeyCredentialRequestOptionsJSON,
      counter = 1,
      overrides: {
        origin?: string;
        rpId?: string;
        flags?: number;
        challenge?: string;
        userHandle?: string;
        badSignature?: boolean;
      } = {},
    ): AuthenticationResponseJSON {
      const data = authData(
        overrides.rpId ?? options.rpId!,
        overrides.flags ?? 5,
        counter,
      );
      const client = clientData(
        "webauthn.get",
        overrides.challenge ?? options.challenge,
        overrides.origin ?? "https://tracker.example",
      );
      const signature = sign(
        "sha256",
        Buffer.concat([data, createHash("sha256").update(client).digest()]),
        privateKey,
      );
      if (overrides.badSignature) signature[5] ^= 0xff;
      return {
        id: credentialId,
        rawId: credentialId,
        type: "public-key",
        clientExtensionResults: {},
        response: {
          clientDataJSON: client.toString("base64url"),
          authenticatorData: data.toString("base64url"),
          signature: signature.toString("base64url"),
          userHandle: overrides.userHandle ?? userHandle,
        },
      };
    },
  };
}
