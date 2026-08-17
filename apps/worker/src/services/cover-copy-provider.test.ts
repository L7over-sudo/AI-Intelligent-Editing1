import { describe, expect, it, vi } from "vitest";

import { coverCopyModel, summarizeCoverCopy } from "./cover-copy-provider";

describe("cover copy provider", () => {
  it("uses claude-sonnet-5 after editing and parses strict title copy", async () => {
    const complete = vi.fn().mockResolvedValue({
      message: {
        role: "assistant" as const,
        content:
          '```json\n{"title":"踩点上班","subtitle":"守住边界也要扛起责任"}\n```',
      },
      model: coverCopyModel,
    });

    await expect(
      summarizeCoverCopy({
        sourceText:
          "00后踩点上班，有的人是在守住工作和生活的边界，有的人却是在挑战团队协作的基本规则。",
        apiKey: "dialogue-key",
        baseUrl: "https://www.hfsyapi.cn",
        complete,
      }),
    ).resolves.toEqual({
      copy: { title: "踩点上班", subtitle: "守住边界也要扛起责任" },
      model: coverCopyModel,
    });

    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-sonnet-5" }),
    );
  });

  it("rejects prose that is not a JSON title response", async () => {
    const complete = vi.fn().mockResolvedValue({
      message: { role: "assistant" as const, content: "我建议使用职场边界。" },
      model: coverCopyModel,
    });

    await expect(
      summarizeCoverCopy({
        sourceText: "测试文案",
        apiKey: "dialogue-key",
        baseUrl: "https://www.hfsyapi.cn",
        complete,
      }),
    ).rejects.toThrow("COVER_COPY_RESPONSE_INVALID");
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("normalizes a non-four-character model topic without breaking a word", async () => {
    const complete = vi.fn().mockResolvedValue({
      message: {
        role: "assistant" as const,
        content:
          '{"title":"00后员工","subtitle":"年轻员工正在重写职场规则"}',
      },
      model: coverCopyModel,
    });

    await expect(
      summarizeCoverCopy({
        sourceText: "00后员工正在用自己的方式重新定义职场规则。",
        apiKey: "dialogue-key",
        baseUrl: "https://www.hfsyapi.cn",
        complete,
      }),
    ).resolves.toMatchObject({
      copy: {
        title: "职场新规",
        subtitle: "年轻员工正在重写职场规则",
      },
    });
  });
});
