import {
  buildSubtitleTemplateCatalog,
  defaultSubtitleTemplateRoot,
  writeSubtitleTemplateCatalog,
} from "../services/subtitle-template-library";

const root = process.argv[2] || defaultSubtitleTemplateRoot();
const catalog = await buildSubtitleTemplateCatalog(root);
await writeSubtitleTemplateCatalog(catalog);

const categories = new Set(catalog.templates.map((template) => template.category));
console.log(
  JSON.stringify(
    {
      root,
      templates: catalog.templates.length,
      categories: categories.size,
    },
    null,
    2,
  ),
);

