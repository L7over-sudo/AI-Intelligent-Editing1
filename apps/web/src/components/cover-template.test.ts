import { describe, expect, it } from "vitest";

import {
  findSelectedCoverTemplate,
  noCoverTemplateId,
  type SavedCoverTemplate,
} from "./cover-template";

const savedTemplate: SavedCoverTemplate = {
  id: "saved-cover",
  name: "DY",
  templateId: "black-white-opinion",
  templateName: "账号名片",
  cover: {
    title: "上班崩溃",
    subtitle: "没边界的工作最让人崩溃",
    account: "@杰妍社进化论",
    footer: "",
    avatarUrl: "",
  },
};

describe("findSelectedCoverTemplate", () => {
  it("maps the no-cover option to an undefined selection", () => {
    expect(
      findSelectedCoverTemplate([savedTemplate], noCoverTemplateId),
    ).toBeUndefined();
  });

  it("returns the matching saved template", () => {
    expect(
      findSelectedCoverTemplate([savedTemplate], savedTemplate.id),
    ).toEqual(savedTemplate);
  });
});
