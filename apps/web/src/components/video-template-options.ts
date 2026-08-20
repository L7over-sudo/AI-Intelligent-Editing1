export const videoTemplateOptions = [
  {
    value: "KNOWLEDGE_BOARD",
    label: "知识白板",
    description: "图片缩小，字幕不遮挡画面",
  },
  {
    value: "IMPACT_CAPTIONS",
    label: "爆点大字",
    description: "全文重点逐句弹入并在同屏累积",
  },
  {
    value: "FULL_BLEED",
    label: "全屏画面",
    description: "保留原来的铺满画面样式",
  },
] as const;

export type VideoTemplate = (typeof videoTemplateOptions)[number]["value"];
