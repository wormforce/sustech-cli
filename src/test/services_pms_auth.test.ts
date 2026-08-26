import assert from "node:assert/strict";
import { createPrivateKey, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { CliError } from "../core/errors.js";
import { listPmsStations } from "../services/pms.js";
import { PmsSession } from "../services/pms-auth.js";

test("PmsSession performs RSA login, persists OSESSIONID in memory, and works as a ServiceAdapter", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 1024,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const rawPublicKey = publicKey.replace("-----BEGIN PUBLIC KEY-----", "").replace("-----END PUBLIC KEY-----", "").replace(/\s+/g, "");
  let encryptedPassword = "";
  let checkCalls = 0;
  let stationCalls = 0;
  let redirectedWriteCalls = 0;

  const session = new PmsSession(
    { username: "12210000", password: "super-secret" },
    {
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url === "https://pms.sustech.edu.cn/api/client/Auth/GetAuthToken") {
          assert.equal(init?.method, "POST");
          return jsonResponse({ code: 0, szToken: "TOKEN-123" });
        }
        if (url === "https://pms.sustech.edu.cn/api/client/Auth/PublicKey") {
          return jsonResponse({
            code: 0,
            result: {
              publicKey: rawPublicKey,
              nonceStr: "NONCE-XYZ",
            },
          });
        }
        if (url === "https://pms.sustech.edu.cn/api/client/Auth/Login") {
          const body = JSON.parse(String(init?.body));
          assert.equal(body.szLogonName, "12210000");
          assert.equal(body.szToken, "TOKEN-123");
          assert.equal(typeof body.szPassword, "string");
          assert.equal(body.szPassword.includes("super-secret"), false);
          encryptedPassword = body.szPassword;
          return jsonResponse(
            {
              code: 0,
              result: { szTrueName: "测试同学" },
            },
            200,
            { "set-cookie": "OSESSIONID=session-123; Path=/; Secure; HttpOnly" },
          );
        }
        if (url === "https://pms.sustech.edu.cn/api/client/Auth/Check") {
          checkCalls += 1;
          const headers = new Headers(init?.headers);
          assert.match(String(headers.get("cookie")), /OSESSIONID=session-123/);
          return jsonResponse({
            code: 0,
            result: { szTrueName: "测试同学" },
          });
        }
        if (url === "https://pms.sustech.edu.cn/api/client/Station/GetList?timestamp=0") {
          stationCalls += 1;
          const headers = new Headers(init?.headers);
          assert.match(String(headers.get("cookie")), /OSESSIONID=session-123/);
          return jsonResponse({
            code: 0,
            result: [{
              dwDevSN: 4001001,
              szName: "慧园打印点",
              szStatInfo: "Idle",
              dwStatus: 1,
              dwTrayPaper1: 9,
              dwTrayPaper2: -1,
              dwTrayPaper3: -1,
              dwTrayPaper4: -1,
              dwProperty: 1,
            }],
          });
        }
        if (url === "https://pms.sustech.edu.cn/api/client/Report/DetailPage") {
          return new Response(null, {
            status: 307,
            headers: { location: "https://pms.sustech.edu.cn/api/client/PrintJob/Delete" },
          });
        }
        if (url === "https://pms.sustech.edu.cn/api/client/PrintJob/Delete") {
          redirectedWriteCalls += 1;
          return jsonResponse({ code: 0 });
        }
        throw new Error(`Unexpected URL ${url}`);
      },
    },
  );

  const login = await session.login();
  assert.deepEqual(login, {
    authenticated: true,
    displayName: "测试同学",
    message: "Logged in as 测试同学",
  });

  const decrypted = decryptPkcs1V15(encryptedPassword, privateKey);
  assert.equal(decrypted, "super-secret;NONCE-XYZ");

  const check = await session.check();
  assert.deepEqual(check, {
    authenticated: true,
    displayName: "测试同学",
    message: "Logged in as 测试同学",
  });
  assert.equal(checkCalls, 1);

  const stations = await listPmsStations(session);
  assert.equal(stationCalls, 1);
  assert.equal(stations[0]?.name, "慧园打印点");
  assert.equal(stations[0]?.canPrint, true);
  await assert.rejects(
    () => session.fetch("https://pms.sustech.edu.cn/api/client/Report/DetailPage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
    (error: unknown) => error instanceof CliError && error.code === "UNSAFE_REDIRECT",
  );
  assert.equal(redirectedWriteCalls, 0);
});

test("PmsSession.check reports missing in-memory session without making a network call", async () => {
  const session = new PmsSession(
    { username: "12210000", password: "super-secret" },
    {
      fetchImpl: async () => {
        throw new Error("network should not be touched");
      },
    },
  );

  const result = await session.check();
  assert.deepEqual(result, {
    authenticated: false,
    message: "PMS session not available",
  });
});

test("PmsSession explains the campus-network restriction before parsing JSON", async () => {
  const session = new PmsSession(
    { username: "12210000", password: "super-secret" },
    {
      fetchImpl: async () => new Response("Access forbidden, please contact administrator.", {
        status: 403,
        headers: { "content-type": "text/plain" },
      }),
    },
  );
  await assert.rejects(
    () => session.login(),
    (error: unknown) => error instanceof CliError && error.code === "CAMPUS_NETWORK_REQUIRED",
  );
});

test("PmsSession rejects unsafe hosts at construction and request time", async () => {
  assert.throws(
    () => new PmsSession({ username: "12210000", password: "super-secret" }, { baseUrl: "http://pms.sustech.edu.cn" }),
    (error: unknown) => error instanceof CliError && error.code === "UNSAFE_SERVICE_URL",
  );
  assert.throws(
    () => new PmsSession({ username: "12210000", password: "super-secret" }, { baseUrl: "https://example.com" }),
    (error: unknown) => error instanceof CliError && error.code === "UNSAFE_SERVICE_URL",
  );

  const session = new PmsSession(
    { username: "12210000", password: "super-secret" },
    {
      fetchImpl: async (input) => {
        const url = String(input);
        if (url === "https://pms.sustech.edu.cn/api/client/Auth/GetAuthToken") return jsonResponse({ code: 0, szToken: "TOKEN-123" });
        if (url === "https://pms.sustech.edu.cn/api/client/Auth/PublicKey") {
          const { publicKey } = generateKeyPairSync("rsa", {
            modulusLength: 1024,
            publicKeyEncoding: { type: "spki", format: "pem" },
            privateKeyEncoding: { type: "pkcs8", format: "pem" },
          });
          return jsonResponse({
            code: 0,
            result: {
              publicKey: publicKey.replace("-----BEGIN PUBLIC KEY-----", "").replace("-----END PUBLIC KEY-----", "").replace(/\s+/g, ""),
              nonceStr: "NONCE-XYZ",
            },
          });
        }
        if (url === "https://pms.sustech.edu.cn/api/client/Auth/Login") {
          return jsonResponse({ code: 0, result: { szTrueName: "测试同学" } }, 200, {
            "set-cookie": "OSESSIONID=session-123; Path=/; Secure; HttpOnly",
          });
        }
        throw new Error(`Unexpected URL ${url}`);
      },
    },
  );

  await session.login();
  await assert.rejects(
    () => session.fetch("https://cas.sustech.edu.cn/cas/login"),
    (error: unknown) => error instanceof CliError && error.code === "UNSAFE_SERVICE_URL",
  );
  await assert.rejects(
    () => session.fetch("https://pms.sustech.edu.cn/api/client/Auth/Check", { method: "POST" }),
    (error: unknown) => error instanceof CliError && error.code === "UNSAFE_SERVICE_URL",
  );
  await assert.rejects(
    () => session.fetch("https://pms.sustech.edu.cn/api/client/Station/GetList?timestamp=0", { method: "POST" }),
    (error: unknown) => error instanceof CliError && error.code === "UNSAFE_SERVICE_URL",
  );
});

test("PmsSession auth errors do not leak password, token, nonce, or cookies", async () => {
  const session = new PmsSession(
    { username: "12210000", password: "super-secret" },
    {
      fetchImpl: async (input) => {
        const url = String(input);
        if (url === "https://pms.sustech.edu.cn/api/client/Auth/GetAuthToken") {
          return jsonResponse({ code: 0, szToken: "TOKEN-123" });
        }
        if (url === "https://pms.sustech.edu.cn/api/client/Auth/PublicKey") {
          const { publicKey } = generateKeyPairSync("rsa", {
            modulusLength: 1024,
            publicKeyEncoding: { type: "spki", format: "pem" },
            privateKeyEncoding: { type: "pkcs8", format: "pem" },
          });
          return jsonResponse({
            code: 0,
            result: {
              publicKey: publicKey.replace("-----BEGIN PUBLIC KEY-----", "").replace("-----END PUBLIC KEY-----", "").replace(/\s+/g, ""),
              nonceStr: "NONCE-XYZ",
            },
          });
        }
        if (url === "https://pms.sustech.edu.cn/api/client/Auth/Login") {
          return jsonResponse({ code: 401, message: "bad credentials" });
        }
        throw new Error(`Unexpected URL ${url}`);
      },
    },
  );

  await assert.rejects(
    () => session.login(),
    (error: unknown) => {
      assert.equal(error instanceof CliError, true);
      const text = `${String(error)} ${JSON.stringify((error as CliError).details ?? {})}`;
      assert.equal(text.includes("super-secret"), false);
      assert.equal(text.includes("TOKEN-123"), false);
      assert.equal(text.includes("NONCE-XYZ"), false);
      assert.equal(text.includes("OSESSIONID"), false);
      return error instanceof CliError && error.code === "AUTHENTICATION_FAILED";
    },
  );
});

function jsonResponse(value: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json",
      ...extraHeaders,
    },
  });
}

function decryptPkcs1V15(ciphertextBase64: string, privateKeyPem: string): string {
  const jwk = createPrivateKey(privateKeyPem).export({ format: "jwk" });
  const modulusValue = jwk.n;
  const privateExponentValue = jwk.d;
  if (typeof modulusValue !== "string" || typeof privateExponentValue !== "string") {
    throw new Error("RSA private key export did not expose modulus/exponent");
  }
  const modulus = base64UrlToBigInt(modulusValue);
  const privateExponent = base64UrlToBigInt(privateExponentValue);
  const ciphertext = bytesToBigInt(Buffer.from(ciphertextBase64, "base64"));
  const modulusLength = Math.ceil(bitLength(modulus) / 8);
  const encoded = bigIntToBuffer(modPow(ciphertext, privateExponent, modulus), modulusLength);
  assert.equal(encoded[0], 0x00);
  assert.equal(encoded[1], 0x02);
  const separator = encoded.indexOf(0x00, 2);
  assert.notEqual(separator, -1);
  return encoded.slice(separator + 1).toString("utf8");
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let factor = base % modulus;
  let power = exponent;
  while (power > 0n) {
    if (power & 1n) result = (result * factor) % modulus;
    factor = (factor * factor) % modulus;
    power >>= 1n;
  }
  return result;
}

function bitLength(value: bigint): number {
  return value === 0n ? 0 : value.toString(2).length;
}

function bytesToBigInt(value: Buffer): bigint {
  const hex = value.toString("hex");
  return hex ? BigInt(`0x${hex}`) : 0n;
}

function bigIntToBuffer(value: bigint, size: number): Buffer {
  const hex = value.toString(16).padStart(size * 2, "0");
  return Buffer.from(hex, "hex");
}

function base64UrlToBigInt(value: string): bigint {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return bytesToBigInt(Buffer.from(padded, "base64"));
}
