import crypto from "node:crypto";
import fsp from "node:fs/promises";

export async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  const data = await fsp.readFile(filePath);
  hash.update(data);
  return hash.digest("hex");
}
