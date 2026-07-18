import { copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { $ } from "bun";

const source = resolve("../release/AI Video Cataloger-0.1.0-arm64.dmg");
const target = resolve(
  "public/downloads/AI-Video-Cataloger-0.1.0-arm64.dmg"
);

try {
  await stat(source);
} catch {
  throw new Error(`Missing release DMG at ${source}`);
}

await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);
await $`pnpm build`;
await $`npx -y firebase-tools deploy --only hosting`;
