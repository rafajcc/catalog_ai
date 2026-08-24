import { useState } from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProductsViewPage from './ProductsViewPage';
import { renderWithI18n } from '../../test-utils';
import { ProductEdits, ProductEditsMap } from '../../types';

var mockApi: any;

vi.mock('../../services/api-service', () => ({
  getApiService: () => mockApi
}));

const product = {
  id: 'ps_p7',
  prestashop_id: '7',
  name: 'Camiseta Algodón',
  reference: 'REF-001',
  brand: 'Algodón',
  description_short: 'Corta',
  description: '<p>Descripción larga del producto</p>',
  meta_title: 'Título SEO',
  meta_description: 'Meta descripción SEO',
  images: [
    { id: '30', product_id: '7', url: '/api/fetch/prestashop/images/7/30' },
    { id: '31', product_id: '7', url: '/api/fetch/prestashop/images/7/31' },
    { id: '32', product_id: '7', url: '/api/fetch/prestashop/images/7/32' },
    { id: '33', product_id: '7', url: '/api/fetch/prestashop/images/7/33' },
    { id: '34', product_id: '7', url: '/api/fetch/prestashop/images/7/34' }
  ]
};

// Mirrors the DashboardPage: keeps edits and saved edits in memory and merges
// them into the grid.
function EditsHarness({ initialEdits = {} }: { initialEdits?: ProductEditsMap }) {
  const [edits, setEdits] = useState<ProductEditsMap>(initialEdits);
  const [savedEdits, setSavedEdits] = useState<ProductEditsMap>({});
  function handleSave(productId: string, productEdits: ProductEdits) {
    setEdits((prev) => {
      const next = { ...prev };
      if (Object.keys(productEdits).length === 0) delete next[productId];
      else next[productId] = productEdits;
      return next;
    });
  }
  function handleUndo(productId: string) {
    setEdits((prev) => {
      if (!(productId in prev)) return prev;
      const next = { ...prev };
      delete next[productId];
      return next;
    });
  }
  function handleSavedToPrestashop(saved: ProductEditsMap) {
    setSavedEdits((prev) => ({ ...prev, ...saved }));
    setEdits({});
  }
  return (
    <ProductsViewPage
      onBack={vi.fn()}
      edits={edits}
      savedEdits={savedEdits}
      onSaveProduct={handleSave}
      onUndoProduct={handleUndo}
      onSavedToPrestashop={handleSavedToPrestashop}
    />
  );
}

describe('ProductsViewPage', () => {
  beforeEach(() => {
    mockApi = {
      getPrestashopData: vi.fn().mockResolvedValue({
        success: true,
        data: { data_id: 'ps-1', summary: { total: 1 }, products: [product] }
      }),
      proxyImageUrl: (url: string) => url
    };
  });

  it('renders the imported product fields and its images', async () => {
    renderWithI18n(<ProductsViewPage onBack={vi.fn()} />, 'en');

    expect(await screen.findByText('Camiseta Algodón')).toBeInTheDocument();
    expect(screen.getByText('REF-001')).toBeInTheDocument();
    expect(screen.getByText('Algodón')).toBeInTheDocument();
    expect(screen.getByText('Corta')).toBeInTheDocument();
    expect(screen.getByText('Descripción larga del producto')).toBeInTheDocument();
    expect(screen.getByText('Título SEO')).toBeInTheDocument();
    expect(screen.getByText('Meta descripción SEO')).toBeInTheDocument();

    const thumbnails = screen.getAllByRole('button', { name: 'View image' });
    expect(thumbnails).toHaveLength(5);
    expect(thumbnails[0].querySelector('img')).toHaveAttribute('src', '/api/fetch/prestashop/images/7/30');
  });

  it('shows the reference and name in bold', async () => {
    renderWithI18n(<ProductsViewPage onBack={vi.fn()} />, 'en');

    const reference = await screen.findByText('REF-001');
    const name = screen.getByText('Camiseta Algodón');
    expect(reference.closest('.product-field-value')).toHaveClass('bold');
    expect(name.closest('.product-field-value')).toHaveClass('bold');
  });

  it('always shows every field label, even when its value is empty', async () => {
    mockApi.getPrestashopData.mockResolvedValue({
      success: true,
      data: {
        data_id: 'ps-1',
        summary: { total: 1 },
        products: [
          {
            ...product,
            reference: '',
            name: '',
            brand: '',
            description_short: '',
            description: '',
            meta_title: '',
            meta_description: '',
            images: []
          }
        ]
      }
    });
    renderWithI18n(<ProductsViewPage onBack={vi.fn()} />, 'en');

    expect(await screen.findByText('Reference')).toBeInTheDocument();
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Brand')).toBeInTheDocument();
    expect(screen.getByText('Short description')).toBeInTheDocument();
    expect(screen.getByText('Description')).toBeInTheDocument();
    expect(screen.getByText('Meta title')).toBeInTheDocument();
    expect(screen.getByText('Meta description')).toBeInTheDocument();
    expect(screen.getByText('Images')).toBeInTheDocument();
    expect(screen.getByText('No images')).toBeInTheDocument();

    expect(screen.getAllByText('\u2014')).toHaveLength(7);
  });

  it('shows a larger view of an image when its thumbnail is clicked and closes it', async () => {
    renderWithI18n(<ProductsViewPage onBack={vi.fn()} />, 'en');

    const user = userEvent.setup();
    const thumbnail = (await screen.findAllByRole('button', { name: 'View image' }))[1];
    await user.click(thumbnail);

    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelector('img')).toHaveAttribute('src', '/api/fetch/prestashop/images/7/31');

    await user.click(dialog);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('returns to the dashboard through the back button', async () => {
    const onBack = vi.fn();
    renderWithI18n(<ProductsViewPage onBack={onBack} />, 'en');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Back' }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('shows an empty state when no products have been imported', async () => {
    mockApi.getPrestashopData.mockResolvedValue({ success: true, data: null });
    renderWithI18n(<ProductsViewPage onBack={vi.fn()} />, 'en');

    expect(await screen.findByText('There are no imported products.')).toBeInTheDocument();
  });

  it('shows an error message when the data cannot be loaded', async () => {
    mockApi.getPrestashopData.mockRejectedValue(new Error('down'));
    renderWithI18n(<ProductsViewPage onBack={vi.fn()} />, 'en');

    expect(await screen.findByText('Could not load the imported products.')).toBeInTheDocument();
  });

  it('opens the product editor when a product card is clicked', async () => {
    renderWithI18n(<ProductsViewPage onBack={vi.fn()} />, 'en');
    const user = userEvent.setup();
    const card = (await screen.findByText('Camiseta Algodón')).closest('.product-card')!;
    await user.click(card);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Short description')).toBeInTheDocument();
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
    expect(screen.getByLabelText('Meta title')).toBeInTheDocument();
    expect(screen.getByLabelText('Meta description')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('opens the image viewer instead of the editor when a thumbnail is clicked', async () => {
    renderWithI18n(<ProductsViewPage onBack={vi.fn()} />, 'en');
    const user = userEvent.setup();
    const thumbnail = (await screen.findAllByRole('button', { name: 'View image' }))[0];
    await user.click(thumbnail);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByLabelText('Meta title')).not.toBeInTheDocument();
  });

  it('saves edits, reflects them in the grid and marks the edited field', async () => {
    renderWithI18n(<EditsHarness />, 'en');
    const user = userEvent.setup();
    const card = (await screen.findByText('Camiseta Algodón')).closest('.product-card')!;
    await user.click(card);

    const metaTitle = screen.getByLabelText('Meta title');
    await user.clear(metaTitle);
    await user.type(metaTitle, 'Nuevo título SEO');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByText('Nuevo título SEO')).toBeInTheDocument();
    expect(screen.getByText('Edited')).toBeInTheDocument();
    expect(screen.getByText('Meta title').closest('.product-field')).toHaveClass('edited');
    expect(screen.getByText('Description').closest('.product-field')).not.toHaveClass('edited');
    expect(screen.getByText('Meta description').closest('.product-field')).not.toHaveClass('edited');
  });

  it('marks a field as edited when its value is cleared', async () => {
    renderWithI18n(<EditsHarness />, 'en');
    const user = userEvent.setup();
    const card = (await screen.findByText('Camiseta Algodón')).closest('.product-card')!;
    await user.click(card);

    await user.clear(screen.getByLabelText('Meta description'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Edited')).toBeInTheDocument();
    expect(screen.getByText('Meta description').closest('.product-field')).toHaveClass('edited');
  });

  it('shows the edited marker for products that already have saved edits', async () => {
    renderWithI18n(<EditsHarness initialEdits={{ ps_p7: { meta_title: 'Nuevo' } }} />, 'en');

    expect(await screen.findByText('Nuevo')).toBeInTheDocument();
    expect(screen.getByText('Edited')).toBeInTheDocument();
    expect(screen.getByText('Meta title').closest('.product-field')).toHaveClass('edited');
  });

  it('discards changes when the editor is cancelled', async () => {
    renderWithI18n(<EditsHarness />, 'en');
    const user = userEvent.setup();
    const card = (await screen.findByText('Camiseta Algodón')).closest('.product-card')!;
    await user.click(card);

    await user.clear(screen.getByLabelText('Meta title'));
    await user.type(screen.getByLabelText('Meta title'), 'No guardado');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Título SEO')).toBeInTheDocument();
    expect(screen.queryByText('No guardado')).not.toBeInTheDocument();
  });

  it('shows the reference and name as the editor title', async () => {
    renderWithI18n(<ProductsViewPage onBack={vi.fn()} />, 'en');
    const user = userEvent.setup();
    const card = (await screen.findByText('Camiseta Algodón')).closest('.product-card')!;
    await user.click(card);

    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('REF-001 · Camiseta Algodón');
    expect(screen.getByRole('heading', { name: 'REF-001 · Camiseta Algodón' })).toBeInTheDocument();
  });

  it('opens the image viewer from the editor thumbnails and closes it with Escape', async () => {
    renderWithI18n(<ProductsViewPage onBack={vi.fn()} />, 'en');
    const user = userEvent.setup();
    const card = (await screen.findByText('Camiseta Algodón')).closest('.product-card')!;
    await user.click(card);

    const editor = screen.getByRole('dialog', { name: 'REF-001 · Camiseta Algodón' });
    const thumbs = within(editor).getAllByRole('button', { name: 'View image' });
    expect(thumbs).toHaveLength(5);
    await user.click(thumbs[1]);

    const viewer = screen.getByRole('dialog', { name: 'View image' });
    expect(viewer.querySelector('img')).toHaveAttribute('src', '/api/fetch/prestashop/images/7/31');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'View image' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'REF-001 · Camiseta Algodón' })).toBeInTheDocument();
  });

  it('shows the images field label above the editor thumbnails', async () => {
    renderWithI18n(<ProductsViewPage onBack={vi.fn()} />, 'en');
    const user = userEvent.setup();
    const card = (await screen.findByText('Camiseta Algodón')).closest('.product-card')!;
    await user.click(card);

    const editor = screen.getByRole('dialog', { name: 'REF-001 · Camiseta Algodón' });
    const label = within(editor).getByText('Images');
    expect(label).toHaveClass('product-field-label');
    expect(within(editor).getAllByRole('button', { name: 'View image' })).toHaveLength(5);
  });

  it('undoes the edits of a product and restores its original values', async () => {
    renderWithI18n(<EditsHarness />, 'en');
    const user = userEvent.setup();
    const card = (await screen.findByText('Camiseta Algodón')).closest('.product-card')!;
    await user.click(card);

    const metaTitle = screen.getByLabelText('Meta title');
    await user.clear(metaTitle);
    await user.type(metaTitle, 'Nuevo título SEO');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Nuevo título SEO')).toBeInTheDocument();
    expect(screen.getByText('Edited')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Undo' }));

    expect(screen.getByText('Título SEO')).toBeInTheDocument();
    expect(screen.queryByText('Nuevo título SEO')).not.toBeInTheDocument();
    expect(screen.queryByText('Edited')).not.toBeInTheDocument();
    expect(screen.getByText('Meta title').closest('.product-field')).not.toHaveClass('edited');
  });

  it('does not open the editor when the undo button is clicked', async () => {
    renderWithI18n(<EditsHarness initialEdits={{ ps_p7: { meta_title: 'Nuevo' } }} />, 'en');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Undo' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Título SEO')).toBeInTheDocument();
  });

  it('closes the editor with Escape without saving', async () => {
    renderWithI18n(<EditsHarness />, 'en');
    const user = userEvent.setup();
    const card = (await screen.findByText('Camiseta Algodón')).closest('.product-card')!;
    await user.click(card);

    await user.type(screen.getByLabelText('Meta title'), 'extra');
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Título SEO')).toBeInTheDocument();
  });

  it('only shows the save to PrestaShop button when there are pending edits', async () => {
    renderWithI18n(<ProductsViewPage onBack={vi.fn()} />, 'en');

    expect(await screen.findByText('Camiseta Algodón')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save to PrestaShop' })).not.toBeInTheDocument();
  });

  it('saves pending edits to PrestaShop with the raw product id and marks them as saved', async () => {
    mockApi.savePrestashopEdits = vi.fn().mockResolvedValue({ success: true, message: '1 product updated' });
    renderWithI18n(<EditsHarness initialEdits={{ ps_p7: { meta_title: 'Nuevo' } }} />, 'en');
    const user = userEvent.setup();

    const saveButton = await screen.findByRole('button', { name: 'Save to PrestaShop' });
    expect(screen.getByText('Edited')).toBeInTheDocument();
    await user.click(saveButton);

    expect(mockApi.savePrestashopEdits).toHaveBeenCalledWith({ '7': { meta_title: 'Nuevo' } });
    expect(await screen.findByText('1 product updated')).toBeInTheDocument();
    expect(screen.getByText('Nuevo')).toBeInTheDocument();
    expect(screen.queryByText('Edited')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save to PrestaShop' })).not.toBeInTheDocument();
  });

  it('shows an error message and keeps the edits pending when saving fails', async () => {
    mockApi.savePrestashopEdits = vi.fn().mockRejectedValue(new Error('ps down'));
    renderWithI18n(<EditsHarness initialEdits={{ ps_p7: { meta_title: 'Nuevo' } }} />, 'en');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Save to PrestaShop' }));

    expect(await screen.findByText('ps down')).toBeInTheDocument();
    expect(screen.getByText('Edited')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save to PrestaShop' })).toBeInTheDocument();
  });

  it('shows the AI autocomplete button only when a product has empty fields', async () => {
    mockApi.getPrestashopData.mockResolvedValue({
      success: true,
      data: { data_id: 'ps-1', summary: { total: 1 }, products: [product] }
    });
    renderWithI18n(<ProductsViewPage onBack={vi.fn()} />, 'en');

    expect(await screen.findByText('Camiseta Algodón')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'AI Autocomplete' })).not.toBeInTheDocument();
  });

  it('autocompletes the empty fields of every product that needs it', async () => {
    const needsAi = {
      id: 'ps_p8',
      prestashop_id: '8',
      name: 'Vaso Térmico',
      reference: 'REF-008',
      brand: 'Termos',
      description_short: '',
      description: '<p></p>',
      meta_title: '',
      meta_description: '',
      images: []
    };
    mockApi.getPrestashopData.mockResolvedValue({
      success: true,
      data: { data_id: 'ps-1', summary: { total: 1 }, products: [needsAi] }
    });
    mockApi.autocompleteProduct = vi.fn().mockResolvedValue({
      success: true,
      data: {
        reference: 'REF-008',
        status: 'ok',
        confidence: 0.9,
        proposals: {
          description_short: 'Vaso térmico de acero inoxidable.',
          description: '<p>Vaso térmico de 500 ml.</p>',
          meta_title: 'Vaso Térmico 500 ml',
          meta_description: 'Vaso térmico de acero inoxidable de 500 ml.'
        },
        image_urls: ['https://img.example.com/vaso1.jpg', 'https://img.example.com/vaso2.jpg', 'https://img.example.com/vaso3.jpg', 'https://img.example.com/vaso4.jpg', 'https://img.example.com/vaso5.jpg']
      }
    });

    renderWithI18n(<EditsHarness />, 'en');
    const user = userEvent.setup();
    const button = await screen.findByRole('button', { name: 'AI Autocomplete' });
    await user.click(button);

    expect(await screen.findByText('Vaso térmico de acero inoxidable.')).toBeInTheDocument();
    expect(screen.getByText('Vaso térmico de acero inoxidable de 500 ml.')).toBeInTheDocument();
    expect(screen.getByText('Vaso Térmico 500 ml')).toBeInTheDocument();
    expect(mockApi.autocompleteProduct).toHaveBeenCalledTimes(1);
    expect(mockApi.autocompleteProduct).toHaveBeenCalledWith(needsAi, 'en', 'mock');
    expect(await screen.findByText('AI autocomplete finished: 1 of 1 products completed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'AI Autocomplete' })).not.toBeInTheDocument();
  });

  it('shows a counter while autocompleting and an error message when it fails', async () => {
    const needsAi = {
      id: 'ps_p8',
      prestashop_id: '8',
      name: 'Vaso Térmico',
      reference: 'REF-008',
      brand: 'Termos',
      description_short: '',
      description: '',
      meta_title: '',
      meta_description: '',
      images: []
    };
    mockApi.getPrestashopData.mockResolvedValue({
      success: true,
      data: { data_id: 'ps-1', summary: { total: 1 }, products: [needsAi] }
    });
    mockApi.autocompleteProduct = vi
      .fn()
      .mockRejectedValue(new Error('ai down'));

    renderWithI18n(<ProductsViewPage onBack={vi.fn()} />, 'en');
    const user = userEvent.setup();
    const button = await screen.findByRole('button', { name: 'AI Autocomplete' });
    await user.click(button);

    expect(
      await screen.findByText('AI autocomplete failed: no products could be processed (1 errors)')
    ).toBeInTheDocument();
    expect(mockApi.autocompleteProduct).toHaveBeenCalledTimes(1);
  });

  it('reports partial success when some products fail', async () => {
    const needsAi1 = { ...product, id: 'ps_p8', reference: 'REF-008', name: 'Vaso Térmico', description_short: '', description: '', meta_title: '', meta_description: '', images: [] };
    const needsAi2 = { ...product, id: 'ps_p9', reference: 'REF-009', name: 'Botella', description_short: '', description: '', meta_title: '', meta_description: '', images: [] };
    mockApi.getPrestashopData.mockResolvedValue({
      success: true,
      data: { data_id: 'ps-1', summary: { total: 2 }, products: [needsAi1, needsAi2] }
    });
    mockApi.autocompleteProduct = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        data: { reference: 'REF-008', status: 'ok', proposals: { description_short: 'Vaso térmico.' } }
      })
      .mockRejectedValueOnce(new Error('ai down'));

    renderWithI18n(<EditsHarness />, 'en');
    const user = userEvent.setup();
    const button = await screen.findByRole('button', { name: 'AI Autocomplete' });
    await user.click(button);

    expect(
      await screen.findByText('Partial AI autocomplete: 1 of 2 completed, 1 with errors')
    ).toBeInTheDocument();
    expect(mockApi.autocompleteProduct).toHaveBeenCalledTimes(2);
  });
});
