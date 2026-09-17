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
// Available in each supported language so the whole message sent to the AI is
// written in the same language as the rest of the prompt.
export const AI_COMPLETION_RESPONSE_INSTRUCTIONS: Record<'es' | 'en', string> = {
  es: `DEVUELVE EXCLUSIVAMENTE JSON VÁLIDO CON ESTA ESTRUCTURA:
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
  "image_urls": [],
  "seo_notes": [],
  "source_facts_used": []
}

REGLAS PARA image_urls:
- Devuelve exactamente el número de URLs que se te indique en la instrucción adjunta.
- Busca en la web las mejores imágenes del producto usando la marca, modelo, referencia y tipo de producto como claves de búsqueda.
- Devuelve solo URLs directas a imágenes en formato JPG (.jpg, .jpeg) o PNG (.png). No aceptes ningún otro formato (SVG, WEBP, GIF, BMP, TIFF, etc.).
- Prioriza imágenes de alta calidad del catálogo oficial del fabricante o tiendas autorizadas.
- VERIFICA CADA URL ANTES DE INCLUIRLA: haz una petición HTTP GET a la URL y comprueba que la respuesta tiene un Content-Type de imagen (image/jpeg, image/png, etc.). NO te conformes con un código HTTP 200: muchas páginas responden 200 aunque devuelvan HTML. Si la respuesta no es una imagen real, descarta la URL.
- NUNCA inventes URLs ni las adivines. Incluir una URL inventada es un error grave, aunque el resultado final sea un array vacío.
- Si no puedes verificar imágenes reales, devuelve un array vacío [].
- Es preferible un array vacío a una URL falsa.

No incluyas Markdown, comentarios ni texto fuera del JSON.`,
  en: `RETURN ONLY VALID JSON WITH THIS STRUCTURE:
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
  "image_urls": [],
  "seo_notes": [],
  "source_facts_used": []
}

RULES FOR image_urls:
- Return exactly the number of URLs specified in the attached instruction.
- Search the web for the best images of the product using the brand, model, reference and product type as search keys.
- Return only direct image URLs in JPG (.jpg, .jpeg) or PNG (.png) format. Do not accept any other format (SVG, WEBP, GIF, BMP, TIFF, etc.).
- Prioritize high-quality images from the manufacturer's official catalog or authorized retailers.
- VERIFY EACH URL BEFORE INCLUDING IT: make an HTTP GET request to the URL and confirm the response has an image Content-Type (image/jpeg, image/png, etc.). Do NOT settle for an HTTP 200 status: many pages reply 200 while serving HTML. If the response is not a real image, discard the URL.
- NEVER invent or guess URLs. Including a made-up URL is a serious failure, even if the final result is an empty array.
- If you cannot verify real images, return an empty array [].
- Prefer an empty array over a fake URL.

Do not include Markdown, comments or text outside the JSON.`
};

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

// Extracts image URLs from the AI response. Returns up to MAX_IMAGE_URLS
// validated URLs (must be strings starting with http).
export const MAX_IMAGE_URLS = 5;

export function extractImageUrls(parsed: any): string[] {
  if (!Array.isArray(parsed?.image_urls)) return [];
  return parsed.image_urls
    .filter((url: unknown): url is string =>
      typeof url === 'string' && /^https?:\/\//i.test(url.trim())
    )
    .slice(0, MAX_IMAGE_URLS)
    .map((url: string) => url.trim());
}
