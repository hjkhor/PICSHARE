import { build } from "esbuild";
import { copyFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

await mkdir("public/models", { recursive: true });
await mkdir(".publisher-cache", { recursive: true });
const source = "node_modules/@vladmandic/face-api/model";
for (const filename of await readdir(source)) {
  if (/^(ssd_mobilenetv1_model|face_landmark_68_model|face_recognition_model)[.-]/.test(filename)) {
    await copyFile(join(source, filename), join("public/models", filename));
  }
}
await copyFile("node_modules/@vladmandic/face-api/LICENSE", "public/face-api-license.txt");
await Promise.all([
  build({ entryPoints: ["src/guest.js"], outfile: "public/guest.js", bundle: true, format: "esm", minify: true, platform: "browser", target: "es2022" }),
  build({ entryPoints: ["src/publisher.js"], outfile: ".publisher-cache/publisher.js", bundle: true, format: "esm", minify: true, platform: "browser", target: "es2022" }),
]);
