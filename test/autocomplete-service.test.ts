// Unit tests for the transport-agnostic autocomplete service.
//
// Unlike autocomplete-quota.test.ts (which drives the whole HTTP app), these
// tests call `runAutocomplete` / `validateAutocompleteInput` directly, with the
// AI suggester and the quota functions mocked. The point is to pin the service
// contract both callers (the web route and the public API) depend on, without
// booting express.

import { AIConfig, ProductData } from '../backend/src/types';
import { AppError } from '../backend/src/utils/error-handler';
import { runAutocomplete, validateAutocompleteInput } from '../backend/src/modules/autocomplete/autocomplete-service';

const completeMock = jest.fn();
const reserveMock = jest.fn();
const releaseMock = jest.fn();
const auditMock = jest.fn();

jest.mock('../backend/src/modules/ai-text-suggester/ai-text-suggester', () => {
  const actual = jest.requireActual('../backend/src/modules/ai-text-suggester/ai-text-suggester');
  return {
    ...actual,
    AITextSuggester: class {
      complete = completeMock;
    }
  };
});

jest.mock('../backend/src/modules/autocomplete-quota/quota', () => {
  const actual = jest.requireActual('../backend/src/modules/autocomplete-quota/quota');
  return {
    ...actual,
    reserveAutocompleteCall: (...args: unknown[]) => reserveMock(...args),
    releaseAutocompleteCall: (...args: unknown[]) => releaseMock(...args),
    recordAutocompleteAudit: (...args: unknown[]) => auditMock(...args)
  };
});

const mockAI: AIConfig = { provider: 'mock', enabled: true, enabled_fields: [] };

function emptyProduct(reference = 'REF-1'): ProductData {
  return {
    id: 'p1',
    status: 'pending',
    source_file: 'PrestaShop',
    validation_errors: [],
    warnings: [],
    name: 'Camiseta',
    reference,
    brand: 'Nike',
    description: '',
    description_short: '',
    meta_title: '',
    meta_description: ''
  };
}

const noImages = jest.fn().mockResolvedValue({ urls: [], source: null, attempts: [] });

const validJson = JSON.stringify({
  status: 'ok',
  confidence: 0.9,
  warnings: [],
  proposals: { description: { value: 'Nueva descripción' } }
});

beforeEach(() => {
  completeMock.mockReset();
  reserveMock.mockReset();
  releaseMock.mockReset();
  auditMock.mockReset();
  noImages.mockClear();
});

describe('validateAutocompleteInput', () => {
  it('accepts a product with a reference', () => {
    const result = validateAutocompleteInput({ product: { reference: 'REF-1' } });
    expect(result.product.reference).toBe('REF-1');
  });

  it('accepts a product identified only by id', () => {
    const result = validateAutocompleteInput({ product: { id: '42' } });
    expect(result.product.id).toBe('42');
  });

  it('rejects a missing, non-object or array product with invalid_product', () => {
    for (const product of [undefined, null, 'x', 42, []]) {
      expect(() => validateAutocompleteInput({ product })).toThrow(AppError);
      try {
        validateAutocompleteInput({ product });
      } catch (err) {
        expect((err as AppError).statusCode).toBe(400);
        expect((err as AppError).code).toBe('invalid_product');
      }
    }
  });

  it('rejects a product with neither reference nor id, and blank ones', () => {
    for (const product of [{ brand: 'Nike' }, { reference: '  ', id: '' }]) {
      try {
        validateAutocompleteInput({ product });
        throw new Error('should have thrown');
      } catch (err) {
        expect((err as AppError).code).toBe('invalid_product');
      }
    }
  });

  it('rejects a non-string language with invalid_language', () => {
    try {
      validateAutocompleteInput({ product: { reference: 'REF-1' }, language: 42 });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as AppError).statusCode).toBe(400);
      expect((err as AppError).code).toBe('invalid_language');
    }
  });

  it('lets an undefined language through', () => {
    expect(validateAutocompleteInput({ product: { reference: 'REF-1' } }).language).toBeUndefined();
  });
});

describe('runAutocomplete', () => {
  it('throws a 503 ai_provider_not_configured before touching the quota', async () => {
    await expect(
      runAutocomplete({ product: emptyProduct(), ai: undefined, searchImages: noImages, origin: 'http://x', comercioId: 5 })
    ).rejects.toMatchObject({ statusCode: 503, code: 'ai_provider_not_configured' });
    expect(reserveMock).not.toHaveBeenCalled();
  });

  it('rejects a malformed product even though the callers also validate', async () => {
    await expect(
      runAutocomplete({ product: { brand: 'Nike' } as ProductData, ai: mockAI, searchImages: noImages, origin: 'http://x' })
    ).rejects.toMatchObject({ code: 'invalid_product' });
  });

  it('propagates the 429 when the quota is disabled', async () => {
    reserveMock.mockReturnValue({ allowed: false, reason: 'disabled', limit: 0, used: 0, remaining: 0 });
    await expect(
      runAutocomplete({ product: emptyProduct(), ai: mockAI, searchImages: noImages, origin: 'http://x', comercioId: 5 })
    ).rejects.toMatchObject({ statusCode: 429, code: 'autocomplete_quota_exceeded' });
    expect(completeMock).not.toHaveBeenCalled();
  });

  it('propagates the 429 when the quota is exhausted', async () => {
    reserveMock.mockReturnValue({ allowed: false, reason: 'exhausted', limit: 2, used: 2, remaining: 0 });
    await expect(
      runAutocomplete({ product: emptyProduct(), ai: mockAI, searchImages: noImages, origin: 'http://x', comercioId: 5 })
    ).rejects.toMatchObject({ statusCode: 429, code: 'autocomplete_quota_exceeded' });
  });

  it('reserves, consumes and audits on a valid AI answer', async () => {
    reserveMock.mockReturnValue({ allowed: true, cycleStart: '2026-01-01', limit: 10, used: 1, remaining: 9 });
    completeMock.mockResolvedValue(validJson);

    const result = await runAutocomplete({
      product: emptyProduct('REF-OK'),
      ai: mockAI,
      searchImages: noImages,
      origin: 'http://x',
      comercioId: 5,
      userId: 3
    });

    expect(reserveMock).toHaveBeenCalledWith(5);
    expect(result.proposals.description).toBe('Nueva descripción');
    expect(result.status).toBe('ok');
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ comercioId: 5, userId: 3, status: 'ok', reference: 'REF-OK' }));
    expect(releaseMock).not.toHaveBeenCalled();
  });

  it('refunds the reserved slot when the AI returns invalid JSON', async () => {
    reserveMock.mockReturnValue({ allowed: true, cycleStart: '2026-01-01', limit: 10, used: 1, remaining: 9 });
    completeMock.mockResolvedValue('not json');

    const result = await runAutocomplete({
      product: emptyProduct('REF-BAD'),
      ai: mockAI,
      searchImages: noImages,
      origin: 'http://x',
      comercioId: 5
    });

    expect(result.ai_error).toBeTruthy();
    expect(auditMock).not.toHaveBeenCalled();
    expect(releaseMock).toHaveBeenCalledWith(5, '2026-01-01');
  });

  it('does not reserve quota when the product already has every text field', async () => {
    const full = emptyProduct();
    full.description = 'd';
    full.description_short = 's';
    full.meta_title = 't';
    full.meta_description = 'm';

    const result = await runAutocomplete({ product: full, ai: mockAI, searchImages: noImages, origin: 'http://x', comercioId: 5 });

    expect(reserveMock).not.toHaveBeenCalled();
    expect(completeMock).not.toHaveBeenCalled();
    expect(result.proposals).toEqual({});
  });

  it('never reserves quota for the super admin (comercioId 0)', async () => {
    completeMock.mockResolvedValue(validJson);
    await runAutocomplete({ product: emptyProduct(), ai: mockAI, searchImages: noImages, origin: 'http://x', comercioId: 0 });
    expect(reserveMock).not.toHaveBeenCalled();
  });

  it('returns images even when the AI call fails, without consuming quota', async () => {
    reserveMock.mockReturnValue({ allowed: true, cycleStart: '2026-01-01', limit: 10, used: 1, remaining: 9 });
    completeMock.mockRejectedValue(new Error('500 boom'));
    const search = jest.fn().mockResolvedValue({ urls: ['http://img/1.jpg'], source: 'feeds', attempts: [] });

    const result = await runAutocomplete({ product: emptyProduct('REF-IMG'), ai: mockAI, searchImages: search, origin: 'http://x', comercioId: 5 });

    expect(result.image_urls).toEqual(['http://img/1.jpg']);
    expect(result.ai_error).toBeTruthy();
    expect(search).toHaveBeenCalledTimes(1);
    expect(releaseMock).toHaveBeenCalledWith(5, '2026-01-01');
  });

  it('returns the AI proposals even when the image search never answers', async () => {
    reserveMock.mockReturnValue({ allowed: true, cycleStart: '2026-01-01', limit: 10, used: 1, remaining: 9 });
    completeMock.mockResolvedValue(validJson);
    // An image provider that hangs: the exchange must not wait for it forever.
    const search = jest.fn(() => new Promise(() => {}));

    const result = await runAutocomplete({
      product: emptyProduct('REF-HANG'),
      ai: mockAI,
      searchImages: search as never,
      origin: 'http://x',
      comercioId: 5,
      imageTimeoutMs: 50
    });

    expect(result.proposals.description).toBe('Nueva descripción');
    expect(result.status).toBe('ok');
    expect(result.image_urls).toEqual([]);
    expect(result.image_source).toBeNull();
    expect(auditMock).toHaveBeenCalledTimes(1);
  });

  it('gives the image search the same budget as the AI provider timeout', async () => {
    reserveMock.mockReturnValue({ allowed: true, cycleStart: '2026-01-01', limit: 10, used: 1, remaining: 9 });
    completeMock.mockResolvedValue(validJson);
    const search = jest.fn().mockResolvedValue({ urls: [], source: null, attempts: [] });

    const before = Date.now();
    await runAutocomplete({
      product: emptyProduct('REF-BUDGET'),
      ai: { ...mockAI, timeout: 45 } as AIConfig,
      searchImages: search,
      origin: 'http://x',
      comercioId: 5
    });
    const after = Date.now();

    // The budget comes from the provider timeout (45s), not from a fixed value:
    // the image search gets a deadline, so it stops on its own when the budget
    // is spent instead of holding the answer back.
    expect(search).toHaveBeenCalledTimes(1);
    const request = search.mock.calls[0][0] as { deadline?: number };
    expect(request.deadline).toBeGreaterThanOrEqual(before + 45_000);
    expect(request.deadline).toBeLessThanOrEqual(after + 45_000);
  });

  it('skips the image search when the product already has the maximum images', async () => {
    reserveMock.mockReturnValue({ allowed: true, cycleStart: '2026-01-01', limit: 10, used: 1, remaining: 9 });
    completeMock.mockResolvedValue(validJson);
    const product = emptyProduct();
    product.images = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, product_id: 'p1', url: `http://img/${id}.jpg` }));

    await runAutocomplete({ product, ai: mockAI, searchImages: noImages, origin: 'http://x', comercioId: 5 });
    expect(noImages).not.toHaveBeenCalled();
  });
});
