import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProductsViewPage from './ProductsViewPage';
import { renderWithI18n } from '../../test-utils';

var mockApi: any;

jest.mock('../../services/api-service', () => ({
  getApiService: () => mockApi
}));

const product = {
  id: 'ps_p7',
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
});
