import {
  AI_COMPLETION_RESPONSE_INSTRUCTIONS,
  AUTOCOMPLETE_FIELDS,
  extractCompletionJson,
  extractCompletionProposals,
  fillPrompt,
  parseCompletionResponse
} from '../backend/src/modules/ai-text-suggester/autocomplete';
import { DEFAULT_AI_PROMPTS } from '../backend/src/modules/ai-text-suggester/default-prompts';
import { ProductData } from '../backend/src/types';

const product: ProductData = {
  id: 'p1',
  status: 'pending',
  source_file: 'PrestaShop',
  validation_errors: [],
  warnings: [],
  name: 'Camiseta Deportiva',
  reference: 'REF-100',
  brand: 'Adidas',
  category: 'Camisetas',
  description_short: '',
  description: '<p>Descripción larga</p>',
  meta_title: '',
  meta_description: ''
};

describe('fillPrompt', () => {
  it('fills every placeholder of the Spanish default prompt with product data', () => {
    const filled = fillPrompt(DEFAULT_AI_PROMPTS.es, product);

    expect(filled).toContain('"reference": "REF-100"');
    expect(filled).toContain('"brand": "Adidas"');
    expect(filled).toContain('"category": "Camisetas"');
    expect(filled).toContain('"existing_name": "Camiseta Deportiva"');
    expect(filled).toContain('"existing_description": "<p>Descripción larga</p>"');
    expect(filled).not.toContain('{{');
  });

  it('fills the English default prompt too', () => {
    const filled = fillPrompt(DEFAULT_AI_PROMPTS.en, product);

    expect(filled).toContain('"reference": "REF-100"');
    expect(filled).toContain('"brand": "Adidas"');
    expect(filled).toContain('"existing_name": "Camiseta Deportiva"');
    expect(filled).not.toContain('{{');
  });

  it('replaces unknown placeholders with an empty value', () => {
    const filled = fillPrompt('SIZE={{TALLA}} TYPE={{TIPO_DE_PRODUCTO}}', product);

    expect(filled).toBe('SIZE= TYPE=');
  });

  it('escapes quotes and collapses newlines in the filled values', () => {
    const withSpecialChars: ProductData = {
      ...product,
      name: 'Camiseta "Pro"',
      description: 'Primera línea\nSegunda línea'
    };
    const filled = fillPrompt('NAME={{NAME}}|DESC={{DESCRIPCION_ACTUAL}}', withSpecialChars);

    expect(filled).toBe('NAME=Camiseta \\"Pro\\"|DESC=Primera línea Segunda línea');
  });
});

describe('parseCompletionResponse', () => {
  it('parses a plain JSON answer', () => {
    const parsed = parseCompletionResponse('{"status":"ok","proposals":{}}');

    expect(parsed.status).toBe('ok');
  });

  it('extracts the JSON from a markdown code block', () => {
    const text = 'Aquí tienes:\n```json\n{"status":"ok","proposals":{}}\n```\nFin.';
    const json = extractCompletionJson(text);

    expect(json).toBe('{"status":"ok","proposals":{}}');
    expect(parseCompletionResponse(text).status).toBe('ok');
  });

  it('extracts the JSON object even when surrounded by prose', () => {
    const text = 'Sure, here is the answer: {"status":"insufficient_data","proposals":{}} Regards.';

    expect(parseCompletionResponse(text).status).toBe('insufficient_data');
  });

  it('keeps only the non-empty string proposals of the requested fields', () => {
    const parsed = {
      status: 'ok',
      proposals: {
        description_short: { value: 'Descripción corta', reason: 'ok' },
        description: { value: null, reason: 'no hay datos' },
        meta_title: { value: '   ', reason: 'en blanco' },
        meta_description: { value: 'Meta descripción', reason: 'ok' }
      }
    };

    const proposals = extractCompletionProposals(parsed, AUTOCOMPLETE_FIELDS);

    expect(proposals).toEqual({ description_short: 'Descripción corta', meta_description: 'Meta descripción' });
  });

  it('returns an empty map when the answer has no proposals object', () => {
    expect(extractCompletionProposals({ status: 'ok' }, AUTOCOMPLETE_FIELDS)).toEqual({});
  });

  it('appends the fixed response contract to the prompt message', () => {
    expect(AI_COMPLETION_RESPONSE_INSTRUCTIONS).toContain('DEVUELVE EXCLUSIVAMENTE JSON VÁLIDO CON ESTA ESTRUCTURA');
    expect(AI_COMPLETION_RESPONSE_INSTRUCTIONS).toContain('"proposals"');
    expect(AI_COMPLETION_RESPONSE_INSTRUCTIONS).toContain('No incluyas Markdown, comentarios ni texto fuera del JSON.');
  });
});
