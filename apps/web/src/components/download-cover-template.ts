const exportWidth = 768;
const exportHeight = 1024;

let embeddedDouyinFontPromise: Promise<string> | undefined;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 32_768;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return window.btoa(binary);
}

async function embeddedDouyinFont(): Promise<string> {
  embeddedDouyinFontPromise ??= fetch("/fonts/DouyinSansBold.otf")
    .then((response) => {
      if (!response.ok) throw new Error("抖音体字体加载失败");
      return response.arrayBuffer();
    })
    .then(arrayBufferToBase64);
  return embeddedDouyinFontPromise;
}

function inlineComputedStyles(source: Element, target: Element): void {
  if (source instanceof HTMLElement && target instanceof HTMLElement) {
    const computed = window.getComputedStyle(source);
    for (let index = 0; index < computed.length; index += 1) {
      const property = computed.item(index);
      target.style.setProperty(
        property,
        computed.getPropertyValue(property),
        computed.getPropertyPriority(property),
      );
    }
  }

  const sourceChildren = Array.from(source.children);
  const targetChildren = Array.from(target.children);
  sourceChildren.forEach((child, index) => {
    const targetChild = targetChildren[index];
    if (targetChild) inlineComputedStyles(child, targetChild);
  });
}

async function inlineImageSources(
  source: Element,
  target: Element,
): Promise<void> {
  if (source instanceof HTMLImageElement && target instanceof HTMLImageElement) {
    const sourceUrl = source.currentSrc || source.src;
    if (sourceUrl && !sourceUrl.startsWith("data:")) {
      const response = await fetch(sourceUrl);
      if (!response.ok) throw new Error("封面底图加载失败");
      const blob = await response.blob();
      const base64 = arrayBufferToBase64(await blob.arrayBuffer());
      target.src = `data:${blob.type || "image/png"};base64,${base64}`;
    }
  }

  const sourceChildren = Array.from(source.children);
  const targetChildren = Array.from(target.children);
  await Promise.all(
    sourceChildren.map((child, index) => {
      const targetChild = targetChildren[index];
      return targetChild
        ? inlineImageSources(child, targetChild)
        : Promise.resolve();
    }),
  );
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("封面图片生成失败"));
    image.src = url;
  });
}

function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("封面 PNG 编码失败"));
    }, "image/png");
  });
}

export async function renderCoverTemplatePng(element: HTMLElement): Promise<Blob> {
  await document.fonts.load('900 112px "DouyinSansBold"');
  await document.fonts.ready;

  const fontBase64 = await embeddedDouyinFont();
  const clone = element.cloneNode(true) as HTMLElement;
  inlineComputedStyles(element, clone);
  await inlineImageSources(element, clone);
  clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  clone.style.width = `${exportWidth}px`;
  clone.style.height = `${exportHeight}px`;
  clone.style.maxWidth = "none";
  clone.style.borderRadius = "0";
  clone.style.boxShadow = "none";

  const serialized = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${exportWidth}" height="${exportHeight}" viewBox="0 0 ${exportWidth} ${exportHeight}"><style>@font-face{font-family:"DouyinSansBold";src:url("data:font/otf;base64,${fontBase64}") format("opentype");font-style:normal;font-weight:700 900}</style><foreignObject width="100%" height="100%">${serialized}</foreignObject></svg>`;
  const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const image = await loadImage(svgUrl);
  const canvas = document.createElement("canvas");
  canvas.width = exportWidth;
  canvas.height = exportHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("浏览器不支持封面导出");
  context.drawImage(image, 0, 0, exportWidth, exportHeight);

  return canvasPng(canvas);
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const pngUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = pngUrl;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(pngUrl), 1_000);
}

export async function downloadCoverTemplatePng(
  element: HTMLElement,
  fileName: string,
): Promise<void> {
  downloadBlob(await renderCoverTemplatePng(element), fileName);
}
