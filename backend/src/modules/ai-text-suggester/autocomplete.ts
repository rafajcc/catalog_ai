// AI autocomplete: builds the prompt message sent to the AI provider so it
// proposes values for the empty product text fields, and parses the JSON the
// provider must answer with (a fixed contract appended to every prompt).

import { AIContentField, ProductData } from '../../types';

// The only fields the grid can edit and that are pushed back to PrestaShop, so
// these are the ones autocomplete is allowed to fill (and only when empty).
export const AUTOCOMPLETE_FIELDS: AIContentField[] = [
  'description_short',
  'description',
  'meta_title',
  'meta_description'
];

// Fixed instructions appended to the prompt so every provider answers with the
// same JSON contract, easy to parse and validate regardless of the model.
export const AI_COMPLETION_RESPONSE_INSTRUCTIONS = `DEVUELVE EXCLUSIVAMENTE JSON VÁLIDO CON ESTA ESTRUCTURA:
{
  "status": "ok | insufficient_data | contradictory_data",
  "confidence": 0,
  "warnings": [],
  "reference": "",
  "proposals": {
    "name": {
      "value": null,
      "reason": ""
    },
    "description_short": {
      "value": null,
      "reason": ""
    },
    "description": {
      "value": null,
      "reason": ""
    },
    "meta_title": {
      "value": null,
      "reason": ""
    },
    "meta_description": {
      "value": null,
      "reason": ""
    },
    "link_rewrite": {
      "value": null,
      "reason": ""
    }
  },
  "seo_notes": [],
  "source_facts_used": []
}

No incluyas Markdown, comentarios ni texto fuera del JSON.`;

// Placeholder key (normalized: uppercase, no accents, no punctuation) mapped to
// the product field that provides its value. Covers the Spanish and English
// default prompts and common custom-prompt keys; unknown placeholders are
// replaced with an empty value so the AI never sees a stale {{TOKEN}}.
const PLACEHOLDER_SOURCES: Record<string, keyof ProductData> = {
  REFERENCIA: 'reference',
  REFERENCE: 'reference',
  MARCA: 'brand',
  BRAND: 'brand',
  CATEGORIA: 'category',
  CATEGORY: 'category',
  NOMBREACTUAL: 'name',
  CURRENTNAME: 'name',
  NOMBRE: 'name',
  NAME: 'name',
  DESCRIPCIONCORTAACTUAL: 'description_short',
  CURRENTSHORTDESCRIPTION: 'description_short',
  EXISTINGDESCRIPTIONSHORT: 'description_short',
  DESCRIPCIONACTUAL: 'description',
  CURRENTDESCRIPTION: 'description',
  EXISTINGDESCRIPTION: 'description',
  METATITLEACTUAL: 'meta_title',
  CURRENTMETATITLE: 'meta_title',
  METADESCRIPTIONACTUAL: 'meta_description',
  CURRENTMETADESCRIPTION: 'meta_description',
  EAN: 'ean',
  PRECIO: 'price',
  PRICE: 'price'
};

function normalizePlaceholderKey(key: string): string {
  return key
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

// Escapes a value for the JSON-looking data block of the prompt and collapses
// newlines so a multiline description stays on one line of the prompt.
function escapePromptValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, ' ');
}

// Replaces every {{PLACEHOLDER}} in the prompt with the matching product value.
export function fillPrompt(prompt: string, product: ProductData): string {
  return prompt.replace(/\{\{([^}]+)\}\}/g, (_match, rawKey: string) => {
    const source = PLACEHOLDER_SOURCES[normalizePlaceholderKey(rawKey)];
    return escapePromptValue(source ? product[source] : undefined);
  });
}

// Extracts the JSON object from the provider answer, tolerating markdown code
// fences and surrounding prose (some models wrap the answer in a code block).
export function extractCompletionJson(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : trimmed).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return candidate;
  return candidate.slice(start, end + 1);
}

export function parseCompletionResponse(text: string): any {
  return JSON.parse(extractCompletionJson(text));
}

// Keeps only the fields with a non-empty string value, so the caller only fills
// the empty fields the AI actually proposed.
export function extractCompletionProposals(
  parsed: any,
  fields: AIContentField[]
): Partial<Record<AIContentField, string>> {
  const proposals: Partial<Record<AIContentField, string>> = {};
  if (!parsed?.proposals || typeof parsed.proposals !== 'object') return proposals;
  for (const field of fields) {
    const proposal = parsed.proposals[field];
    const value = proposal && typeof proposal === 'object' ? proposal.value : undefined;
    if (typeof value === 'string' && value.trim() !== '') {
      proposals[field] = value;
    }
  }
  return proposals;
}
