import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createExternalSoundEffectCatalog,
  findExternalSoundEffectCatalogPath,
  findExternalSoundEffectRoot,
} from "../services/external-sound-effect-library";

const root = process.argv[2]
  ? path.resolve(process.argv[2])
  : await findExternalSoundEffectRoot();
if (!root) throw new Error("SFX_EXTERNAL_ROOT_NOT_FOUND");

const catalog = await createExternalSoundEffectCatalog(root);
const outputPath = await findExternalSoundEffectCatalogPath();
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");

const counts = Object.fromEntries(
  [...new Set(catalog.assets.map((asset) => asset.tag))]
    .sort()
    .map((tag) => [
      tag,
      catalog.assets.filter((asset) => asset.tag === tag).length,
    ]),
);
process.stdout.write(
  `${JSON.stringify(
    {
      status: "OK",
      root,
      outputPath,
      indexedAssets: catalog.assets.length,
      counts,
    },
    null,
    2,
  )}\n`,
);
