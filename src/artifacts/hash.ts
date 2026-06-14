import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export function sha256Bytes(body: Buffer | Uint8Array | string): string {
  return createHash("sha256").update(body).digest("hex");
}

export async function sha256File(
  filePath: string
): Promise<{ contentSha256: string; byteSize: number }> {
  const hash = createHash("sha256");
  let byteSize = 0;

  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk: Buffer | string) => {
      const data = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      byteSize += data.length;
      hash.update(data);
    });
    stream.on("error", reject);
    stream.on("end", resolve);
  });

  return { contentSha256: hash.digest("hex"), byteSize };
}
