import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const MAGIC = "AKASHA-BACKUP-ENC v1";
const AUTH_TAG_BYTES = 16;

export type EncryptManifestArtifactsInput = {
  backupDir: string;
  manifestPath: string;
  key: Buffer;
  now?: Date;
  keepPlaintext?: boolean;
  randomBytes?: (size: number) => Buffer;
};

export async function encryptFile(input: {
  inputPath: string;
  outputPath: string;
  key: Buffer;
  randomBytes?: (size: number) => Buffer;
}): Promise<void> {
  validateEncryptionKey(input.key);
  const iv = (input.randomBytes ?? randomBytes)(12);
  const cipher = createCipheriv("aes-256-gcm", input.key, iv);
  const output = fs.createWriteStream(input.outputPath, { flags: "wx" });
  const header = `${MAGIC}\n${JSON.stringify({
    algorithm: "AES-256-GCM",
    iv: iv.toString("base64"),
  })}\n`;

  output.write(header);
  await pipeline(fs.createReadStream(input.inputPath), cipher, output, {
    end: false,
  });
  output.end(cipher.getAuthTag());
  await once(output, "close");
}

export async function decryptFile(input: {
  inputPath: string;
  outputPath: string;
  key: Buffer;
}): Promise<void> {
  validateEncryptionKey(input.key);
  const encrypted = await fsp.readFile(input.inputPath);
  const firstNewline = encrypted.indexOf(0x0a);
  const secondNewline = encrypted.indexOf(0x0a, firstNewline + 1);
  if (
    firstNewline === -1 ||
    secondNewline === -1 ||
    encrypted.slice(0, firstNewline).toString("utf8") !== MAGIC
  ) {
    throw new Error("encrypted backup artifact has an invalid header");
  }

  const header = JSON.parse(
    encrypted.slice(firstNewline + 1, secondNewline).toString("utf8"),
  ) as { algorithm?: string; iv?: string };
  if (header.algorithm !== "AES-256-GCM" || !header.iv) {
    throw new Error("encrypted backup artifact has unsupported metadata");
  }

  const tagStart = encrypted.length - AUTH_TAG_BYTES;
  if (tagStart <= secondNewline) {
    throw new Error("encrypted backup artifact is truncated");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    input.key,
    Buffer.from(header.iv, "base64"),
  );
  decipher.setAuthTag(encrypted.slice(tagStart));

  await pipeline(
    Readable.from([encrypted.slice(secondNewline + 1, tagStart)]),
    decipher,
    fs.createWriteStream(input.outputPath, { flags: "wx" }),
  );
}

export async function loadBackupEncryptionKeyFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Promise<Buffer | null> {
  const keyFile = env.BACKUP_ENCRYPTION_KEY_FILE;
  if (keyFile === undefined) {
    return null;
  }

  const trimmedKeyFile = keyFile.trim();
  if (trimmedKeyFile.length === 0) {
    throw new Error("BACKUP_ENCRYPTION_KEY_FILE must contain non-whitespace text");
  }

  return parseEncryptionKey(await fsp.readFile(trimmedKeyFile));
}

export function loadBackupEncryptionKeepPlaintextFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = env.BACKUP_ENCRYPTION_KEEP_PLAINTEXT;
  if (value === undefined) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }

  throw new Error("BACKUP_ENCRYPTION_KEEP_PLAINTEXT must be true or false when set");
}

export function parseEncryptionKey(raw: Buffer): Buffer {
  const text = raw.toString("utf8").trim();
  const key =
    /^[0-9a-f]{64}$/i.test(text)
      ? Buffer.from(text, "hex")
      : maybeBase64Key(text) ?? raw;
  validateEncryptionKey(key);
  return key;
}

function maybeBase64Key(value: string): Buffer | null {
  try {
    const decoded = Buffer.from(value, "base64");
    return decoded.length === 32 ? decoded : null;
  } catch (_err: unknown) {
    return null;
  }
}

function validateEncryptionKey(key: Buffer): void {
  if (key.length !== 32) {
    throw new Error("BACKUP_ENCRYPTION_KEY_FILE must contain a 32-byte key (hex, base64, or raw bytes)");
  }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = fs.createReadStream(filePath);
  stream.on("data", (chunk) => {
    hash.update(chunk);
  });
  await once(stream, "end");
  return hash.digest("hex");
}
export function createBackupEncryptionArtifacts(input: EncryptManifestArtifactsInput): import("../../application/ports/backup-artifacts.js").BackupEncryptionArtifacts {
  return {
    readManifest: () => fsp.readFile(input.manifestPath, "utf8"),
    encryptArtifact: (artifact) => encryptFile({ inputPath: path.join(input.backupDir, artifact.sourceFileName), outputPath: path.join(input.backupDir, artifact.encryptedFileName), key: artifact.key, randomBytes: artifact.randomBytes }),
    checksum: (name) => sha256File(path.join(input.backupDir, name)),
    writeChecksum: (name, checksum) => fsp.writeFile(path.join(input.backupDir, name) + ".sha256", `${checksum}  ${name}\n`),
    async removePlainArtifact(name) { const plainPath = path.join(input.backupDir, name); await fsp.rm(plainPath, { force: true }); await fsp.rm(plainPath + ".sha256", { force: true }); },
    commitManifest: (manifest) => fsp.writeFile(input.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`),
  };
}
