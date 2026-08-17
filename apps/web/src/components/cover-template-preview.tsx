import {
  characterCoverTemplateId,
  coverTextSize,
  type CoverTemplateData,
} from "./cover-template";

export function CoverTemplatePreview({
  value,
  templateId,
  className = "",
}: {
  value: CoverTemplateData;
  templateId?: string;
  className?: string;
}) {
  if (templateId === characterCoverTemplateId) {
    return <CharacterCoverTemplatePreview value={value} className={className} />;
  }

  const title = value.title || "主标题";
  const subtitle = value.subtitle || "副标题";
  const account = value.account || "@账号";

  return (
    <div
      role="img"
      aria-label={`封面预览：${title}，${subtitle}，${account}`}
      className={`relative aspect-[3/4] w-full overflow-hidden bg-black text-white ${className}`}
      style={{
        containerType: "inline-size",
        fontFamily:
          '"DouyinSansBold", "PingFang SC", "Microsoft YaHei", sans-serif',
        fontSynthesis: "none",
        textRendering: "geometricPrecision",
      }}
    >
      <div
        aria-hidden="true"
        className="absolute inset-x-[10%] top-[11.7%] z-0 overflow-hidden whitespace-nowrap text-center font-black leading-none text-white/60"
        style={{
          filter: "blur(13px)",
          fontSize: coverTextSize(title, 11.5, 76),
          opacity: 0.96,
          textShadow: "0 0 14px rgba(255,255,255,.68)",
          transform: "translate(3px, .5px) scale(1.152, 1.037)",
        }}
      >
        {title}
      </div>

      <div className="absolute inset-0 z-10" aria-label="主标题前景板块">
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-[20%] h-[28.9%] bg-black"
        />
        <div
          className="absolute inset-x-[4%] top-[27.8%] overflow-hidden whitespace-nowrap text-center font-black leading-none"
          style={{
            fontSize: coverTextSize(title, 14.6, 89),
            height: "13.67cqw",
            letterSpacing: "-0.023em",
          }}
        >
          {title}
        </div>
        <div
          className="absolute inset-x-[4%] top-[40.7%] overflow-hidden whitespace-nowrap text-center font-black leading-none"
          style={{
            fontSize: coverTextSize(subtitle, 7.6, 91),
            letterSpacing: "-0.006em",
          }}
        >
          {subtitle}
        </div>
      </div>

      <div
        className="absolute left-[6.9%] top-[51.2%] h-[2px] w-[55.1%]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(to right, rgba(255,255,255,.55) 0 11px, transparent 11px 18px), repeating-linear-gradient(to right, rgba(255,255,255,.55) 0 12px, transparent 12px 18px)",
          backgroundPosition: "top, bottom",
          backgroundRepeat: "no-repeat",
          backgroundSize: "100% 1px, 100% 1px",
        }}
      />

      <div
        className="absolute left-[6.8%] top-[55.9%] max-w-[54%] overflow-hidden whitespace-nowrap font-black leading-none text-white/80"
        style={{ fontSize: coverTextSize(account, 4.8, 52) }}
      >
        {account}
      </div>

      <div className="absolute right-[7.03%] top-[48.83%] aspect-square w-[26.04%] overflow-hidden rounded-full border border-white/20 bg-white/10">
        {value.avatarUrl ? (
          <img
            src={value.avatarUrl}
            alt="封面头像"
            className="size-full object-cover"
          />
        ) : (
          <div className="grid size-full place-items-center bg-white/[0.08] text-white/55">
            <svg
              width="42%"
              height="42%"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.45"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}

function CharacterCoverTemplatePreview({
  value,
  className,
}: {
  value: CoverTemplateData;
  className: string;
}) {
  const title = value.title || "主标题第一行";
  const subtitle = value.subtitle || "主标题第二行";
  const topText = value.account || "顶部标语";
  const footer = value.footer || "底部标语";

  return (
    <div
      role="img"
      aria-label={`封面预览：${topText}，${title}，${subtitle}，${footer}`}
      className={`relative aspect-[3/4] w-full overflow-hidden bg-black text-white ${className}`}
      style={{
        containerType: "inline-size",
        fontFamily:
          '"DouyinSansBold", "PingFang SC", "Microsoft YaHei", sans-serif',
        fontSynthesis: "none",
        textRendering: "geometricPrecision",
      }}
    >
      <img
        src="/cover-templates/monochrome-career-character.png"
        alt=""
        aria-hidden="true"
        className="absolute inset-0 size-full object-cover"
      />

      <div
        className="absolute inset-x-[8%] top-[3.8%] z-10 overflow-hidden whitespace-nowrap text-center font-black leading-none text-white/85"
        style={{
          fontSize: coverTextSize(topText, 4.15, 82),
          letterSpacing: "0.18em",
          textShadow: "0 1px 5px rgba(0,0,0,.85)",
        }}
      >
        {topText}
      </div>

      <div className="absolute inset-x-[3.5%] top-[72.2%] z-10 text-center font-black italic leading-[1.08] tracking-[-0.045em]">
        <div
          className="overflow-hidden whitespace-nowrap"
          style={{
            fontSize: coverTextSize(title, 7.1, 91),
            textShadow: "0 3px 10px rgba(0,0,0,.95)",
          }}
        >
          {title}
        </div>
        <div
          className="mt-[1.5%] overflow-hidden whitespace-nowrap"
          style={{
            fontSize: coverTextSize(subtitle, 7.1, 91),
            textShadow: "0 3px 10px rgba(0,0,0,.95)",
          }}
        >
          {subtitle}
        </div>
      </div>

      <div
        className="absolute inset-x-[8%] bottom-[3.9%] z-10 overflow-hidden whitespace-nowrap text-center font-black leading-none text-white/85"
        style={{
          fontSize: coverTextSize(footer, 3.85, 84),
          letterSpacing: "0.16em",
          textShadow: "0 1px 5px rgba(0,0,0,.9)",
        }}
      >
        {footer}
      </div>
    </div>
  );
}
