import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import {
  convertMarkdownToWord,
  createWordDocument,
  readWordDocument
} from "./lib.js";

const createWordDocumentSchema = z.object({
  outputPath: z.string().describe("Absolute path or path relative to this workspace."),
  title: z.string().optional(),
  author: z.string().optional(),
  description: z.string().optional(),
  paragraphs: z.array(z.string()).optional(),
  sections: z
    .array(
      z.object({
        heading: z.string().optional(),
        level: z.number().int().min(1).max(6).optional(),
        paragraphs: z.array(z.string()).optional(),
        bullets: z.array(z.string()).optional()
      })
    )
    .optional()
});

const convertMarkdownSchema = z.object({
  outputPath: z.string().describe("Absolute path or path relative to this workspace."),
  markdown: z.string(),
  title: z.string().optional(),
  author: z.string().optional(),
  description: z.string().optional()
});

const readWordDocumentSchema = z.object({
  inputPath: z.string().describe("Absolute path or path relative to this workspace.")
});

const server = new Server(
  {
    name: "word-mcp-server",
    version: "0.1.0"
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "create_word_document",
      description:
        "Create a Microsoft Word .docx document from structured sections, paragraphs, and bullet lists.",
      inputSchema: {
        type: "object",
        properties: {
          outputPath: {
            type: "string",
            description: "Absolute path or path relative to this workspace."
          },
          title: { type: "string" },
          author: { type: "string" },
          description: { type: "string" },
          paragraphs: {
            type: "array",
            items: { type: "string" }
          },
          sections: {
            type: "array",
            items: {
              type: "object",
              properties: {
                heading: { type: "string" },
                level: { type: "integer", minimum: 1, maximum: 6 },
                paragraphs: {
                  type: "array",
                  items: { type: "string" }
                },
                bullets: {
                  type: "array",
                  items: { type: "string" }
                }
              }
            }
          }
        },
        required: ["outputPath"]
      }
    },
    {
      name: "convert_markdown_to_word",
      description:
        "Convert Markdown content into a Microsoft Word .docx document while preserving headings and bullet lists.",
      inputSchema: {
        type: "object",
        properties: {
          outputPath: {
            type: "string",
            description: "Absolute path or path relative to this workspace."
          },
          markdown: { type: "string" },
          title: { type: "string" },
          author: { type: "string" },
          description: { type: "string" }
        },
        required: ["outputPath", "markdown"]
      }
    },
    {
      name: "read_word_document",
      description:
        "Read a Microsoft Word .docx document and return extracted plain text.",
      inputSchema: {
        type: "object",
        properties: {
          inputPath: {
            type: "string",
            description: "Absolute path or path relative to this workspace."
          }
        },
        required: ["inputPath"]
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs } = request.params;

  try {
    if (name === "create_word_document") {
      const args = createWordDocumentSchema.parse(rawArgs ?? {});
      const outputPath = await createWordDocument(args);

      return {
        content: [
          {
            type: "text",
            text: `Word document created at ${outputPath}`
          }
        ]
      };
    }

    if (name === "convert_markdown_to_word") {
      const args = convertMarkdownSchema.parse(rawArgs ?? {});
      const outputPath = await convertMarkdownToWord(args);

      return {
        content: [
          {
            type: "text",
            text: `Markdown converted to Word document at ${outputPath}`
          }
        ]
      };
    }

    if (name === "read_word_document") {
      const args = readWordDocumentSchema.parse(rawArgs ?? {});
      const result = await readWordDocument(args);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: error instanceof Error ? error.message : String(error)
        }
      ],
      isError: true
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
