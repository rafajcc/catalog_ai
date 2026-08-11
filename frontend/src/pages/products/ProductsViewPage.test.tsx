import { useState } from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProductsViewPage from './ProductsViewPage';
import { renderWithI18n } from '../../test-utils';
import { ProductEdits, ProductEditsMap } from '../../types';

var mockApi: any;

jest.mock('../../services/api-service', () => ({
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
    { id: '31', product_id: '7', url: '/api/fetch/prestashop/images/7/31' }
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
      onBack={jest.fn()}
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
      getPrestashopData: jest.fn().mockResolvedValue({
        success: true,
        data: { data_id: 'ps-1', summary: { total: 1 }, products: [product] }
      })
    };
  });

  it('renders the imported product fields and its images', async () => {
    renderWithI18n(<ProductsViewPage onBack={jest.fn()} />, 'en');

    expect(await screen.findByText('Camiseta Algodón')).toBeInTheDocument();
    expect(screen.getByText('REF-001')).toBeInTheDocument();
    expect(screen.getByText('Algodón')).toBeInTheDocument();
    expect(screen.getByText('Corta')).toBeInTheDocument();
    expect(screen.getByText('Descripción larga del producto')).toBeInTheDocument();
    expect(screen.getByText('Título SEO')).toBeInTheDocument();
    expect(screen.getByText('Meta descripción SEO')).toBeInTheDocument();

    const thumbnails = screen.getAllByRole('button', { name: 'View image' });
    expect(thumbnails).toHaveLength(2);
    expect(thumbnails[0].querySelector('img')).toHaveAttribute('src', '/api/fetch/prestashop/images/7/30');
  });

  it('shows the reference and name in bold', async () => {
    renderWithI18n(<ProductsViewPage onBack={jest.fn()} />, 'en');

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
    renderWithI18n(<ProductsViewPage onBack={jest.fn()} />, 'en');

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
    renderWithI18n(<ProductsViewPage onBack={jest.fn()} />, 'en');

    const user = userEvent.setup();
    const thumbnail = (await screen.findAllByRole('button', { name: 'View image' }))[1];
    await user.click(thumbnail);

    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelector('img')).toHaveAttribute('src', '/api/fetch/prestashop/images/7/31');

    await user.click(dialog);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('returns to the dashboard through the back button', async () => {
    const onBack = jest.fn();
    renderWithI18n(<ProductsViewPage onBack={onBack} />, 'en');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Back' }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('shows an empty state when no products have been imported', async () => {
    mockApi.getPrestashopData.mockResolvedValue({ success: true, data: null });
    renderWithI18n(<ProductsViewPage onBack={jest.fn()} />, 'en');

    expect(await screen.findByText('There are no imported products.')).toBeInTheDocument();
  });

  it('shows an error message when the data cannot be loaded', async () => {
    mockApi.getPrestashopData.mockRejectedValue(new Error('down'));
    renderWithI18n(<ProductsViewPage onBack={jest.fn()} />, 'en');

    expect(await screen.findByText('Could not load the imported products.')).toBeInTheDocument();
  });

  it('opens the product editor when a product card is clicked', async () => {
    renderWithI18n(<ProductsViewPage onBack={jest.fn()} />, 'en');
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
    renderWithI18n(<ProductsViewPage onBack={jest.fn()} />, 'en');
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
    renderWithI18n(<ProductsViewPage onBack={jest.fn()} />, 'en');
    const user = userEvent.setup();
    const card = (await screen.findByText('Camiseta Algodón')).closest('.product-card')!;
    await user.click(card);

    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('REF-001 · Camiseta Algodón');
    expect(screen.getByRole('heading', { name: 'REF-001 · Camiseta Algodón' })).toBeInTheDocument();
  });

  it('opens the image viewer from the editor thumbnails and closes it with Escape', async () => {
    renderWithI18n(<ProductsViewPage onBack={jest.fn()} />, 'en');
    const user = userEvent.setup();
    const card = (await screen.findByText('Camiseta Algodón')).closest('.product-card')!;
    await user.click(card);

    const editor = screen.getByRole('dialog', { name: 'REF-001 · Camiseta Algodón' });
    const thumbs = within(editor).getAllByRole('button', { name: 'View image' });
    expect(thumbs).toHaveLength(2);
    await user.click(thumbs[1]);

    const viewer = screen.getByRole('dialog', { name: 'View image' });
    expect(viewer.querySelector('img')).toHaveAttribute('src', '/api/fetch/prestashop/images/7/31');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'View image' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'REF-001 · Camiseta Algodón' })).toBeInTheDocument();
  });

  it('shows the images field label above the editor thumbnails', async () => {
    renderWithI18n(<ProductsViewPage onBack={jest.fn()} />, 'en');
    const user = userEvent.setup();
    const card = (await screen.findByText('Camiseta Algodón')).closest('.product-card')!;
    await user.click(card);

    const editor = screen.getByRole('dialog', { name: 'REF-001 · Camiseta Algodón' });
    const label = within(editor).getByText('Images');
    expect(label).toHaveClass('product-field-label');
    expect(within(editor).getAllByRole('button', { name: 'View image' })).toHaveLength(2);
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
    renderWithI18n(<ProductsViewPage onBack={jest.fn()} />, 'en');

    expect(await screen.findByText('Camiseta Algodón')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save to PrestaShop' })).not.toBeInTheDocument();
  });

  it('saves pending edits to PrestaShop with the raw product id and marks them as saved', async () => {
    mockApi.savePrestashopEdits = jest.fn().mockResolvedValue({ success: true, message: '1 product updated' });
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
    mockApi.savePrestashopEdits = jest.fn().mockRejectedValue(new Error('ps down'));
    renderWithI18n(<EditsHarness initialEdits={{ ps_p7: { meta_title: 'Nuevo' } }} />, 'en');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Save to PrestaShop' }));

    expect(await screen.findByText('ps down')).toBeInTheDocument();
    expect(screen.getByText('Edited')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save to PrestaShop' })).toBeInTheDocument();
  });
});
