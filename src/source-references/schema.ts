import { z } from "zod";

export const SOURCE_REFERENCE_SCHEMA = "brain.source-reference/v1" as const;

const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const ROOT_ALIAS_RE = /^[a-z][a-z0-9_]{0,63}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;

export function isSafeRelativePath(value: string): boolean {
  if (!value || value.startsWith("/") || value.includes("\\")) return false;
  if (/^[A-Za-z]:/.test(value)) return false;
  const segments = value.split("/");
  return segments.every(
    (segment) => Boolean(segment) && segment !== "." && segment !== ".."
  );
}

const SafeIdSchema = z.string().trim().regex(SAFE_ID_RE);
const StableUuidSchema = z.string().uuid();
const SafeRelativePathSchema = z
  .string()
  .trim()
  .refine(isSafeRelativePath, "must be a safe root-relative path");
const HttpsUrlSchema = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === "https:", "must use https");

export const SourceReferenceArtifactSchema = z
  .object({
    id: StableUuidSchema,
    kind: z.enum([
      "original",
      "markdown_conversion",
      "ocr_text",
      "extracted_text",
      "thumbnail",
      "derived",
    ]),
    label: z.string().trim().min(1).max(300),
    provider: z.string().trim().min(1).max(100).optional(),
    providerId: z.string().trim().min(1).max(500).optional(),
    providerRevision: z.string().trim().min(1).max(500).optional(),
    webUrl: HttpsUrlSchema.optional(),
    rootAlias: z.string().regex(ROOT_ALIAS_RE).optional(),
    relativePath: SafeRelativePathSchema.optional(),
    contentSha256: z.string().regex(SHA256_RE).optional(),
    mimeType: z.string().trim().min(1).max(200).optional(),
    byteSize: z.number().int().nonnegative().optional(),
    observedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .superRefine((artifact, context) => {
    if (Boolean(artifact.rootAlias) !== Boolean(artifact.relativePath)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "rootAlias and relativePath must be supplied together",
      });
    }
    if (!artifact.providerId && !artifact.webUrl && !artifact.relativePath) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "artifact requires a provider id, HTTPS URL, or registered local path",
      });
    }
  });

export const SourceReferenceBrainLinkSchema = z
  .object({
    filename: SafeRelativePathSchema.refine(
      (value) => value.endsWith(".md"),
      "Brain link must point to a Markdown file"
    ),
    relation: z.enum([
      "supports",
      "context",
      "contradicts",
      "derived_from",
      "mentions",
    ]),
    label: z.string().trim().min(1).max(300).optional(),
    anchor: z.string().trim().min(1).max(300).optional(),
  })
  .strict();

export const SourceReferenceUrlSchema = z
  .object({
    label: z.string().trim().min(1).max(300),
    url: HttpsUrlSchema,
  })
  .strict();

export const SourceReferenceManifestSchema = z
  .object({
    schema: z.literal(SOURCE_REFERENCE_SCHEMA),
    brainId: SafeIdSchema,
    sourceId: StableUuidSchema,
    label: z.string().trim().min(1).max(500),
    category: z.string().trim().min(1).max(100),
    status: z.enum(["pending", "processed", "blocked", "archived"]),
    evidenceTier: z.enum([
      "primary",
      "secondary",
      "tertiary",
      "personal_record",
      "analysis",
    ]),
    sourceDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    provenanceNote: z.string().trim().min(1).max(4000),
    evidenceLimitation: z.string().trim().min(1).max(4000).optional(),
    companionPath: SafeRelativePathSchema.refine(
      (value) => value.startsWith("sources/") && value.endsWith(".md"),
      "companionPath must be a Markdown file under sources/"
    ),
    sourceUrls: z.array(SourceReferenceUrlSchema).max(20).default([]),
    artifacts: z.array(SourceReferenceArtifactSchema).min(1).max(50),
    brainLinks: z.array(SourceReferenceBrainLinkSchema).min(1).max(100),
    summary: z.string().trim().min(1).max(4000).optional(),
    contentMarkdown: z.string().default(""),
  })
  .strict()
  .superRefine((manifest, context) => {
    const artifactIds = new Set<string>();
    for (const [index, artifact] of manifest.artifacts.entries()) {
      if (artifactIds.has(artifact.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["artifacts", index, "id"],
          message: "artifact ids must be unique within a source manifest",
        });
      }
      artifactIds.add(artifact.id);
      if (artifact.providerId && !artifact.provider) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["artifacts", index, "provider"],
          message: "provider is required when providerId is supplied",
        });
      }
      if (artifact.providerRevision && !artifact.providerId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["artifacts", index, "providerId"],
          message: "providerId is required when providerRevision is supplied",
        });
      }
    }
  });

export type SourceReferenceArtifact = z.infer<typeof SourceReferenceArtifactSchema>;
export type SourceReferenceBrainLink = z.infer<typeof SourceReferenceBrainLinkSchema>;
export type SourceReferenceManifest = z.infer<typeof SourceReferenceManifestSchema>;
