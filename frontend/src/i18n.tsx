import { createContext, useCallback, useContext, useMemo, useState, ReactNode } from 'react';

export type Language = 'es' | 'en';

export const STORAGE_KEY = 'catalogai_lang';

export const translations: Record<Language, Record<string, string>> = {
  es: {
    'header.statusLabel': 'Estado:',
    'header.language': 'Idioma',
    'header.settings': 'Ajustes',
    'header.home': 'Ir al inicio',
    'status.online': 'En línea',
    'status.offline': 'Sin conexión',
    'status.degraded': 'Degradado',
    'status.checking': 'Comprobando…',
    'dashboard.importHint':
      'Importa los productos que quieras actualizar desde tu tienda PrestaShop para empezar.',
    'upload.prestashopTitle': 'Importar desde PrestaShop',
    'upload.prestashopIntro':
      'Descarga productos directamente desde tu tienda PrestaShop (Webservice). Sin referencia ni marca se importan los primeros productos de la tienda.',
    'upload.prestashopReferencesLabel': 'Referencias (opcional, una por línea o separadas por comas)',
    'upload.prestashopReferencesPlaceholder': 'REF-001, REF-002',
    'upload.prestashopBrandLabel': 'Marca (opcional, vacío importa todas las marcas)',
    'upload.prestashopBrandPlaceholder': 'Ej. Sony',
    'upload.prestashopDescriptionFilter': 'Descripción',
    'upload.prestashopImagesFilter': 'Imágenes',
    'upload.prestashopDescWith': 'Con descripción',
    'upload.prestashopDescWithout': 'Sin descripción',
    'upload.prestashopDescAll': 'Todos',
    'upload.prestashopImgWith': 'Con imágenes',
    'upload.prestashopImgWithout': 'Sin imágenes',
    'upload.prestashopImgAll': 'Todos',
    'upload.prestashopFilterOperator': 'Combinar criterios',
    'upload.prestashopFilterAnd': 'Y (deben cumplirse todos)',
    'upload.prestashopFilterOr': 'O (basta con uno)',
    'upload.prestashopLimitNote': 'Se importarán como máximo los primeros {limit} productos que coincidan.',
    'upload.prestashopFetchButton': 'Llamar a PrestaShop',
    'upload.prestashopFetching': 'Llamando a PrestaShop…',
    'upload.prestashopSuccess': 'Datos importados desde PrestaShop: {count} productos',
    'upload.prestashopNotConfigured': 'Configura PrestaShop en la pestaña Configuración para poder importar productos.',
    'upload.prestashopNoMatch': 'Ningún producto coincide con los criterios indicados.',
    'upload.prestashopClear': 'Eliminar datos importados',
    'upload.prestashopView': 'Ver',
    'upload.prestashopCleared': 'Datos importados desde PrestaShop eliminados',
    'upload.prestashopLoaded': '{count} productos importados desde PrestaShop',
    'upload.prestashopEditedWarning':
      'Hay productos con ediciones guardadas en memoria. Si vuelves a llamar a PrestaShop se perderán las ediciones. ¿Continuar?',
    'view.title': 'Productos importados',
    'view.back': 'Volver',
    'view.loading': 'Cargando productos…',
    'view.loadError': 'No se pudieron cargar los productos importados.',
    'view.empty': 'No hay productos importados.',
    'view.count': '{count} productos',
    'view.reference': 'Referencia',
    'view.name': 'Nombre',
    'view.brand': 'Marca',
    'view.descriptionShort': 'Descripción corta',
    'view.description': 'Descripción',
    'view.metaTitle': 'Meta título',
    'view.metaDescription': 'Meta descripción',
    'view.images': 'Imágenes',
    'view.noImages': 'Sin imágenes',
    'view.viewImage': 'Ver imagen',
    'view.close': 'Cerrar',
    'view.edit': 'Editar',
    'view.editTitle': 'Editar producto',
    'view.edited': 'Editado',
    'view.undo': 'Deshacer',
    'view.save': 'Guardar',
    'view.cancel': 'Cancelar',
    'view.saveToPrestashop': 'Guardar en PrestaShop',
    'view.saving': 'Guardando…',
    'view.saved': '{count} productos actualizados en PrestaShop',
    'config.title': 'Configuración',
    'config.prestashopSection': 'PrestaShop',
    'config.baseUrl': 'URL base',
    'config.baseUrlPlaceholder': 'https://tienda.ejemplo.com',
    'config.psApiKey': 'Clave API de PrestaShop',
    'config.version': 'Versión',
    'config.languageId': 'Id de idioma',
    'config.testPrestashop': 'Probar conexión PrestaShop',
    'config.prestashopOk': 'Conexión PrestaShop correcta',
    'config.aiSection': 'Contenido IA',
    'config.provider': 'Proveedor',
    'config.model': 'Modelo',
    'config.aiLanguage': 'Idioma',
    'config.aiApiKey': 'Clave API de IA',
    'config.testAi': 'Probar conexión IA',
    'config.aiOk': 'Conexión IA correcta',
    'config.save': 'Guardar configuración',
    'config.saved': 'Configuración guardada'
  },
  en: {
    'header.statusLabel': 'Status:',
    'header.language': 'Language',
    'header.settings': 'Settings',
    'header.home': 'Go to home',
    'status.online': 'Online',
    'status.offline': 'Offline',
    'status.degraded': 'Degraded',
    'status.checking': 'Checking…',
    'dashboard.importHint':
      'Import the products you want to update from your PrestaShop store to get started.',
    'upload.prestashopTitle': 'Import from PrestaShop',
    'upload.prestashopIntro':
      'Fetch products directly from your PrestaShop store (Webservice). Without references or a brand, the first products of the store are imported.',
    'upload.prestashopReferencesLabel': 'References (optional, one per line or comma-separated)',
    'upload.prestashopReferencesPlaceholder': 'REF-001, REF-002',
    'upload.prestashopBrandLabel': 'Brand (optional, empty imports every brand)',
    'upload.prestashopBrandPlaceholder': 'e.g. Sony',
    'upload.prestashopDescriptionFilter': 'Description',
    'upload.prestashopImagesFilter': 'Images',
    'upload.prestashopDescWith': 'With description',
    'upload.prestashopDescWithout': 'Without description',
    'upload.prestashopDescAll': 'All',
    'upload.prestashopImgWith': 'With images',
    'upload.prestashopImgWithout': 'Without images',
    'upload.prestashopImgAll': 'All',
    'upload.prestashopFilterOperator': 'Combine filters',
    'upload.prestashopFilterAnd': 'AND (all criteria must match)',
    'upload.prestashopFilterOr': 'OR (any criterion matches)',
    'upload.prestashopLimitNote': 'At most the first {limit} matching products will be imported.',
    'upload.prestashopFetchButton': 'Fetch from PrestaShop',
    'upload.prestashopFetching': 'Fetching from PrestaShop…',
    'upload.prestashopSuccess': 'Imported {count} products from PrestaShop',
    'upload.prestashopNotConfigured': 'Configure PrestaShop in the Configuration tab to import products.',
    'upload.prestashopNoMatch': 'No products matched the given criteria.',
    'upload.prestashopClear': 'Remove imported data',
    'upload.prestashopView': 'View',
    'upload.prestashopCleared': 'PrestaShop data removed',
    'upload.prestashopLoaded': '{count} products imported from PrestaShop',
    'upload.prestashopEditedWarning':
      'Some products have edits stored in memory. Fetching from PrestaShop again will discard them. Continue?',
    'view.title': 'Imported products',
    'view.back': 'Back',
    'view.loading': 'Loading products…',
    'view.loadError': 'Could not load the imported products.',
    'view.empty': 'There are no imported products.',
    'view.count': '{count} products',
    'view.reference': 'Reference',
    'view.name': 'Name',
    'view.brand': 'Brand',
    'view.descriptionShort': 'Short description',
    'view.description': 'Description',
    'view.metaTitle': 'Meta title',
    'view.metaDescription': 'Meta description',
    'view.images': 'Images',
    'view.noImages': 'No images',
    'view.viewImage': 'View image',
    'view.close': 'Close',
    'view.edit': 'Edit',
    'view.editTitle': 'Edit product',
    'view.edited': 'Edited',
    'view.undo': 'Undo',
    'view.save': 'Save',
    'view.cancel': 'Cancel',
    'view.saveToPrestashop': 'Save to PrestaShop',
    'view.saving': 'Saving…',
    'view.saved': '{count} products updated in PrestaShop',
    'config.title': 'Configuration',
    'config.prestashopSection': 'PrestaShop',
    'config.baseUrl': 'Base URL',
    'config.baseUrlPlaceholder': 'https://shop.example.com',
    'config.psApiKey': 'PrestaShop API key',
    'config.version': 'Version',
    'config.languageId': 'Language ID',
    'config.testPrestashop': 'Test PrestaShop connection',
    'config.prestashopOk': 'PrestaShop connection OK',
    'config.aiSection': 'AI content',
    'config.provider': 'Provider',
    'config.model': 'Model',
    'config.aiLanguage': 'Language',
    'config.aiApiKey': 'AI API key',
    'config.testAi': 'Test AI connection',
    'config.aiOk': 'AI connection OK',
    'config.save': 'Save configuration',
    'config.saved': 'Configuration saved'
  }
};

export type TranslateParams = Record<string, string | number>;

interface I18nContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: string, params?: TranslateParams) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function getInitialLanguage(): Language {
  if (typeof window === 'undefined') {
    return 'es';
  }
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'en' || stored === 'es' ? stored : 'es';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(getInitialLanguage);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
  }, []);

  const t = useCallback(
    (key: string, params?: TranslateParams) => {
      let template = translations[language][key] ?? translations.en[key] ?? key;
      if (params) {
        Object.entries(params).forEach(([name, value]) => {
          template = template.split(`{${name}}`).join(String(value));
        });
      }
      return template;
    },
    [language]
  );

  const value = useMemo<I18nContextValue>(
    () => ({ language, setLanguage, t }),
    [language, setLanguage, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return context;
}
