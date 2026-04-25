import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import MarkdownIt from "markdown-it";
import mammoth from "mammoth";

const md = new MarkdownIt();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultBaseDir = path.resolve(__dirname, "..", "..");

function toAbsolutePath(targetPath) {
  if (!targetPath || typeof targetPath !== "string") {
    throw new Error("A valid path string is required.");
  }

  return path.isAbsolute(targetPath)
    ? targetPath
    : path.resolve(defaultBaseDir, targetPath);
}

function withDocxExtension(targetPath) {
  return targetPath.toLowerCase().endsWith(".docx")
    ? targetPath
    : `${targetPath}.docx`;
}

async function ensureParentDirectory(targetPath) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
}

function createHeading(text, level) {
  const headingMap = {
    1: HeadingLevel.HEADING_1,
    2: HeadingLevel.HEADING_2,
    3: HeadingLevel.HEADING_3,
    4: HeadingLevel.HEADING_4,
    5: HeadingLevel.HEADING_5,
    6: HeadingLevel.HEADING_6
  };

  return new Paragraph({
    text,
    heading: headingMap[level] ?? HeadingLevel.HEADING_1,
    spacing: { after: 120 }
  });
}

function flattenInlineToken(token) {
  if (!token?.children?.length) {
    return token?.content ?? "";
  }

  const runs = [];

  let boldDepth = 0;
  let italicDepth = 0;

  for (const child of token.children) {
    if (child.type === "strong_open") {
      boldDepth += 1;
      continue;
    }

    if (child.type === "strong_close") {
      boldDepth = Math.max(0, boldDepth - 1);
      continue;
    }

    if (child.type === "em_open") {
      italicDepth += 1;
      continue;
    }

    if (child.type === "em_close") {
      italicDepth = Math.max(0, italicDepth - 1);
      continue;
    }

    if (child.type === "code_inline") {
      runs.push(
        new TextRun({
          text: child.content,
          font: "Menlo"
        })
      );
      continue;
    }

    if (child.type === "softbreak" || child.type === "hardbreak") {
      runs.push(new TextRun({ text: "\n" }));
      continue;
    }

    if (child.type === "text" || child.type === "link_open" || child.type === "link_close") {
      if (child.type === "text") {
        runs.push(
          new TextRun({
            text: child.content,
            bold: boldDepth > 0,
            italics: italicDepth > 0
          })
        );
      }
      continue;
    }
  }

  return runs.length ? runs : token.content;
}

function markdownToParagraphs(markdown, fallbackTitle) {
  const tokens = md.parse(markdown, {});
  const paragraphs = [];
  let currentListDepth = -1;
  let pendingListItem = false;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token.type === "heading_open") {
      const inline = tokens[index + 1];
      const level = Number(token.tag.replace("h", ""));
      const text = inline?.content?.trim();
      if (text) {
        paragraphs.push(createHeading(text, level));
      }
      continue;
    }

    if (token.type === "bullet_list_open") {
      currentListDepth += 1;
      continue;
    }

    if (token.type === "bullet_list_close") {
      currentListDepth = Math.max(-1, currentListDepth - 1);
      continue;
    }

    if (token.type === "ordered_list_open") {
      currentListDepth += 1;
      continue;
    }

    if (token.type === "ordered_list_close") {
      currentListDepth = Math.max(-1, currentListDepth - 1);
      continue;
    }

    if (token.type === "list_item_open") {
      pendingListItem = true;
      continue;
    }

    if (token.type === "list_item_close") {
      pendingListItem = false;
      continue;
    }

    if (token.type === "inline") {
      const content = flattenInlineToken(token);
      if (Array.isArray(content) ? content.length === 0 : !String(content).trim()) {
        continue;
      }

      if (pendingListItem && currentListDepth >= 0) {
        paragraphs.push(
          new Paragraph({
            children: Array.isArray(content) ? content : [new TextRun(String(content))],
            bullet: { level: currentListDepth }
          })
        );
      } else {
        paragraphs.push(
          new Paragraph({
            children: Array.isArray(content) ? content : [new TextRun(String(content))],
            spacing: { after: 120 }
          })
        );
      }
    }
  }

  if (!paragraphs.length && fallbackTitle) {
    paragraphs.push(createHeading(fallbackTitle, 1));
  }

  return paragraphs;
}

function sectionsToParagraphs(title, sections = [], trailingParagraphs = []) {
  const paragraphs = [];

  if (title) {
    paragraphs.push(createHeading(title, 1));
  }

  for (const section of sections) {
    if (section.heading) {
      paragraphs.push(createHeading(section.heading, section.level ?? 2));
    }

    for (const paragraphText of section.paragraphs ?? []) {
      paragraphs.push(
        new Paragraph({
          text: paragraphText,
          spacing: { after: 120 }
        })
      );
    }

    for (const bulletText of section.bullets ?? []) {
      paragraphs.push(
        new Paragraph({
          text: bulletText,
          bullet: { level: 0 }
        })
      );
    }
  }

  for (const paragraphText of trailingParagraphs) {
    paragraphs.push(
      new Paragraph({
        text: paragraphText,
        spacing: { after: 120 }
      })
    );
  }

  return paragraphs;
}

async function writeDocument(paragraphs, outputPath, metadata = {}) {
  const resolvedOutput = withDocxExtension(toAbsolutePath(outputPath));
  await ensureParentDirectory(resolvedOutput);

  const doc = new Document({
    creator: metadata.author ?? "Codex Word MCP",
    title: metadata.title ?? "Untitled Document",
    description: metadata.description ?? "",
    sections: [
      {
        properties: {},
        children: paragraphs
      }
    ]
  });

  const buffer = await Packer.toBuffer(doc);
  await fs.writeFile(resolvedOutput, buffer);

  return resolvedOutput;
}

export async function createWordDocument({
  outputPath,
  title,
  author,
  description,
  sections,
  paragraphs
}) {
  const docParagraphs = sectionsToParagraphs(title, sections, paragraphs);

  if (!docParagraphs.length) {
    throw new Error("The document is empty. Provide title, sections, or paragraphs.");
  }

  return writeDocument(docParagraphs, outputPath, {
    title,
    author,
    description
  });
}

export async function convertMarkdownToWord({
  outputPath,
  markdown,
  title,
  author,
  description
}) {
  const docParagraphs = markdownToParagraphs(markdown, title);

  if (!docParagraphs.length) {
    throw new Error("The markdown input did not produce any Word content.");
  }

  return writeDocument(docParagraphs, outputPath, {
    title,
    author,
    description
  });
}

export async function readWordDocument({ inputPath }) {
  const resolvedInput = toAbsolutePath(inputPath);
  const result = await mammoth.extractRawText({ path: resolvedInput });

  return {
    inputPath: resolvedInput,
    text: result.value.trim(),
    messages: result.messages ?? []
  };
}
