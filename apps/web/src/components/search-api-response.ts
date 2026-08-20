export async function readSearchApiPayload(
  response: Response,
): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(
      response.status === 404
        ? "搜索接口未加载，请重启本地服务后重试"
        : "搜索服务返回了无效响应，请稍后重试",
    );
  }

  try {
    return (await response.json()) as unknown;
  } catch {
    throw new Error("搜索服务返回的数据格式不正确，请稍后重试");
  }
}
