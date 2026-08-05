import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  soundEffectTagSchema,
  type SoundEffectTag,
} from "@stickmotion/shared";
import { z } from "zod";

const supportedAudioExtensions = new Set([
  ".mp3",
  ".wav",
  ".ogg",
  ".flac",
  ".m4a",
  ".aac",
  ".aiff",
  ".aif",
]);

const relativeAudioPathSchema = z
  .string()
  .min(1)
  .max(500)
  .refine((value) => !path.isAbsolute(value))
  .refine(
    (value) =>
      !value
        .split(/[\\/]/u)
        .some((segment) => segment === ".." || segment === ""),
  )
  .refine((value) =>
    supportedAudioExtensions.has(path.extname(value).toLowerCase()),
  );

export const externalSoundEffectCatalogSchema = z
  .object({
    version: z.literal(1),
    rootName: z.string().trim().min(1).max(120),
    generatedAt: z.string().datetime(),
    source: z.literal("user-local-library"),
    assets: z
      .array(
        z
          .object({
            tag: soundEffectTagSchema,
            relativePath: relativeAudioPathSchema,
            displayName: z.string().trim().min(1).max(180),
            contentType: z.enum([
              "audio/mpeg",
              "audio/wav",
              "audio/ogg",
              "audio/flac",
              "audio/mp4",
              "audio/aac",
              "audio/aiff",
            ]),
            byteSize: z.number().int().positive().max(30 * 1024 * 1024),
            recommendedGainDb: z.number().min(-24).max(0),
          })
          .strict(),
      )
      .max(1_024),
  })
  .strict();

export type ExternalSoundEffectCatalog = z.infer<
  typeof externalSoundEffectCatalogSchema
>;
export type ExternalSoundEffectCatalogAsset =
  ExternalSoundEffectCatalog["assets"][number];

interface ClassificationRule {
  tag: SoundEffectTag;
  pattern: RegExp;
  gainDb: number;
}

export const externalSoundEffectClassificationRules: readonly ClassificationRule[] =
  [
    { tag: "applause", pattern: /掌声|鼓掌|拍手|applause/iu, gainDb: -12 },
    { tag: "cheer", pattern: /欢呼|喝彩|胜利欢庆|起哄|cheer/iu, gainDb: -12 },
    {
      tag: "laughter",
      pattern: /笑声|大笑|哈哈|咯咯笑|笑场|laughter|laugh/iu,
      gainDb: -14,
    },
    {
      tag: "surprise",
      pattern: /惊讶|震惊|惊吓|倒吸|哇哦|意外|surprise|shock/iu,
      gainDb: -12,
    },
    {
      tag: "question",
      pattern: /疑问|问号|困惑|迷惑|挠头|尴尬|question/iu,
      gainDb: -13,
    },
    {
      tag: "notification",
      pattern: /通知|提示音|消息|叮咚|提醒|铃声|notification/iu,
      gainDb: -14,
    },
    {
      tag: "camera",
      pattern: /相机|拍照|快门|摄影|camera|shutter/iu,
      gainDb: -12,
    },
    {
      tag: "phone",
      pattern: /手机|电话|拨号|接听|来电|挂断|phone|telephone/iu,
      gainDb: -14,
    },
    {
      tag: "footsteps",
      pattern: /脚步|走路|跑步|高跟鞋|行走|footstep|walking/iu,
      gainDb: -15,
    },
    {
      tag: "door",
      pattern: /开门|关门|敲门|门铃|推门|door|knock/iu,
      gainDb: -13,
    },
    {
      tag: "money",
      pattern: /金币|硬币|钱币|现金|收款|到账|付款|money|coin|cash/iu,
      gainDb: -12,
    },
    {
      tag: "cooking",
      pattern: /切菜|剁菜|油炸|煎蛋|翻炒|烹饪|厨房|锅|cooking|kitchen/iu,
      gainDb: -16,
    },
    {
      tag: "food",
      pattern: /咀嚼|吃东西|吃饭|喝水|打嗝|饥饿|食物|food|chew|drink/iu,
      gainDb: -16,
    },
    {
      tag: "water",
      pattern: /水流|倒水|滴水|海浪|雨声|溪流|water|rain|wave/iu,
      gainDb: -17,
    },
    {
      tag: "nature",
      pattern: /鸟叫|虫鸣|森林|风声|雷声|自然|nature|bird|forest|wind/iu,
      gainDb: -18,
    },
    {
      tag: "traffic",
      pattern: /汽车|公交|地铁|火车|鸣笛|交通|车辆|traffic|car|train/iu,
      gainDb: -17,
    },
    {
      tag: "crowd",
      pattern: /人群|街道|市场|会议室|办公室环境|嘈杂|crowd|office/iu,
      gainDb: -18,
    },
    {
      tag: "animal",
      pattern: /动物|猫叫|狗叫|马叫|狮子|大象|animal|cat|dog/iu,
      gainDb: -16,
    },
    {
      tag: "magic",
      pattern: /魔法|闪光|变身|梦幻|能量|法术|magic|spell/iu,
      gainDb: -12,
    },
    {
      tag: "tension",
      pattern: /紧张|恐怖|悬疑|心跳|惊悚|压迫|tension|horror|heartbeat/iu,
      gainDb: -17,
    },
    {
      tag: "sad",
      pattern: /悲伤|哭声|哭泣|叹气|失落|难过|sad|crying|sigh/iu,
      gainDb: -16,
    },
    {
      tag: "sci_fi",
      pattern: /科幻|未来|飞船|激光|机器人|赛博|sci.?fi|cyber|laser/iu,
      gainDb: -13,
    },
    {
      tag: "mechanical",
      pattern: /机械|齿轮|金属|机器|引擎|马达|mechanical|machine|gear/iu,
      gainDb: -15,
    },
    {
      tag: "game",
      pattern: /游戏|升级|得分|通关|奖励|game|level|score/iu,
      gainDb: -13,
    },
    {
      tag: "typing",
      pattern: /键盘|打字|输入文字|typing|keyboard/iu,
      gainDb: -16,
    },
    {
      tag: "clock",
      pattern: /时钟|滴答|倒计时|闹钟|秒针|clock|tick|countdown/iu,
      gainDb: -16,
    },
    {
      tag: "click",
      pattern: /点击|按键|鼠标|按钮|开关|click|button|mouse/iu,
      gainDb: -14,
    },
    {
      tag: "success",
      pattern: /成功|完成|正确|胜利|解锁|success|complete|correct/iu,
      gainDb: -12,
    },
    {
      tag: "error",
      pattern: /错误|失败|警报|故障|危险|error|fail|alarm|warning/iu,
      gainDb: -12,
    },
    {
      tag: "impact",
      pattern: /撞击|重击|爆炸|砰|冲击|打斗|impact|hit|punch|explosion/iu,
      gainDb: -13,
    },
    {
      tag: "whoosh",
      pattern: /转场|嗖|呼啸|飞过|划过|滑动|whoosh|swoosh|transition/iu,
      gainDb: -14,
    },
    {
      tag: "pop",
      pattern: /弹出|气泡|啵|泡泡|轻弹|pop|bubble/iu,
      gainDb: -13,
    },
  ];

function contentTypeForExtension(extension: string) {
  if (extension === ".mp3") return "audio/mpeg" as const;
  if (extension === ".wav") return "audio/wav" as const;
  if (extension === ".ogg") return "audio/ogg" as const;
  if (extension === ".flac") return "audio/flac" as const;
  if (extension === ".m4a") return "audio/mp4" as const;
  if (extension === ".aac") return "audio/aac" as const;
  return "audio/aiff" as const;
}

export function classifyExternalSoundEffect(
  relativePath: string,
): { tag: SoundEffectTag; recommendedGainDb: number } | undefined {
  const normalized = relativePath.normalize("NFKC");
  const rule = externalSoundEffectClassificationRules.find((candidate) =>
    candidate.pattern.test(normalized),
  );
  return rule
    ? { tag: rule.tag, recommendedGainDb: rule.gainDb }
    : undefined;
}

function candidateScore(relativePath: string, byteSize: number): number {
  const extension = path.extname(relativePath).toLowerCase();
  let score = extension === ".mp3" ? 100 : extension === ".wav" ? 75 : 55;
  if (/剪映音效/iu.test(relativePath)) score += 20;
  if (byteSize <= 2 * 1024 * 1024) score += 15;
  if (byteSize <= 512 * 1024) score += 10;
  if (/BGM|背景音乐|配乐|music/iu.test(relativePath)) score -= 200;
  return score;
}

export async function createExternalSoundEffectCatalog(
  root: string,
  maxPerTag = 16,
): Promise<ExternalSoundEffectCatalog> {
  const resolvedRoot = path.resolve(root);
  const rootStat = await stat(resolvedRoot);
  if (!rootStat.isDirectory()) throw new Error("SFX_EXTERNAL_ROOT_NOT_DIRECTORY");
  const candidates = new Map<
    SoundEffectTag,
    Array<ExternalSoundEffectCatalogAsset & { score: number }>
  >();
  const pending = [resolvedRoot];

  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) break;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = path.extname(entry.name).toLowerCase();
      if (!supportedAudioExtensions.has(extension)) continue;
      const relativePath = path
        .relative(resolvedRoot, fullPath)
        .split(path.sep)
        .join("/");
      const classification = classifyExternalSoundEffect(relativePath);
      if (!classification) continue;
      const fileStat = await stat(fullPath);
      if (fileStat.size <= 0 || fileStat.size > 30 * 1024 * 1024) continue;
      const item: ExternalSoundEffectCatalogAsset & { score: number } = {
        tag: classification.tag,
        relativePath,
        displayName: path.basename(entry.name, extension),
        contentType: contentTypeForExtension(extension),
        byteSize: fileStat.size,
        recommendedGainDb: classification.recommendedGainDb,
        score: candidateScore(relativePath, fileStat.size),
      };
      const list = candidates.get(item.tag) ?? [];
      list.push(item);
      candidates.set(item.tag, list);
    }
  }

  const assets = [...candidates.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([, items]) => {
      const seen = new Set<string>();
      return items
        .sort(
          (left, right) =>
            right.score - left.score ||
            left.relativePath.localeCompare(right.relativePath, "zh-CN"),
        )
        .filter((item) => {
          const fingerprint = item.displayName
            .normalize("NFKC")
            .replace(/\s+/gu, "")
            .toLowerCase();
          if (seen.has(fingerprint)) return false;
          seen.add(fingerprint);
          return true;
        })
        .slice(0, maxPerTag)
        .map((item) => ({
          tag: item.tag,
          relativePath: item.relativePath,
          displayName: item.displayName,
          contentType: item.contentType,
          byteSize: item.byteSize,
          recommendedGainDb: item.recommendedGainDb,
        }));
    });

  return externalSoundEffectCatalogSchema.parse({
    version: 1,
    rootName: path.basename(resolvedRoot),
    generatedAt: new Date().toISOString(),
    source: "user-local-library",
    assets,
  });
}

export function externalSoundEffectObjectKey(
  asset: ExternalSoundEffectCatalogAsset,
): string {
  const digest = createHash("sha256")
    .update(asset.relativePath)
    .digest("hex")
    .slice(0, 20);
  return `library/sfx/external/${asset.tag}-${digest}${path
    .extname(asset.relativePath)
    .toLowerCase()}`;
}

export async function findExternalSoundEffectRoot(): Promise<
  string | undefined
> {
  const configured =
    process.env.SFX_LIBRARY_ROOT ??
    (process.platform === "win32" ? "E:\\codex\\素材库\\音效" : undefined);
  if (!configured) return undefined;
  const resolved = path.resolve(configured);
  try {
    return (await stat(resolved)).isDirectory() ? resolved : undefined;
  } catch {
    return undefined;
  }
}

export function resolveExternalSoundEffectPath(
  root: string,
  relativePath: string,
): string {
  const safeRelativePath = relativeAudioPathSchema.parse(relativePath);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(
    resolvedRoot,
    ...safeRelativePath.split(/[\\/]/u),
  );
  const prefix = `${resolvedRoot}${path.sep}`.toLowerCase();
  if (!resolved.toLowerCase().startsWith(prefix)) {
    throw new Error("SFX_EXTERNAL_PATH_OUTSIDE_ROOT");
  }
  return resolved;
}

export async function findExternalSoundEffectCatalogPath(): Promise<string> {
  const fileName = "sfx-library.json";
  const candidates = [
    path.resolve(process.cwd(), "storage", "indexes", fileName),
    path.resolve(process.cwd(), "..", "..", "storage", "indexes", fileName),
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "..",
      "..",
      "storage",
      "indexes",
      fileName,
    ),
  ];
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // Try the next workspace-relative candidate.
    }
  }
  return candidates.at(-1) ?? candidates[0]!;
}

export async function readExternalSoundEffectCatalog(): Promise<
  ExternalSoundEffectCatalog | undefined
> {
  const catalogPath = await findExternalSoundEffectCatalogPath();
  try {
    return externalSoundEffectCatalogSchema.parse(
      JSON.parse(await readFile(catalogPath, "utf8")) as unknown,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
