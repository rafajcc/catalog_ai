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
    'upload.prestashopBrandPlaceholder': 'Ej. Adidas',
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
    'view.aiAutocomplete': 'Autocompletado IA',
    'view.aiAutocompleteRunning': 'Autocompletando…',
    'view.aiAutocompleteSuccess': 'Autocompletado IA finalizado: {completed} de {total} productos completados',
    'view.aiAutocompletePartial': 'Autocompletado IA parcial: {completed} de {total} completados, {failed} con errores',
    'view.aiAutocompleteError': 'Autocompletado IA falló: {error}',
    'view.aiAutocompleteAllFailed': 'Autocompletado IA falló: ningún producto pudo ser procesado ({total} errores)',
    'view.aiAutocompleteNoProposals': 'El proveedor de IA no devolvió propuestas para este producto',
    'view.aiAutocompleteErrorsTitle': 'Errores ({count}):',
    'config.title': 'Configuración',
    'config.marketplaces': 'Marketplaces',
    'config.aiSection': 'Proveedores de IA',
    'config.prestashopSection': 'PrestaShop',
    'config.baseUrl': 'URL base',
    'config.baseUrlPlaceholder': 'https://tienda.ejemplo.com',
    'config.psApiKey': 'Clave API de PrestaShop',
    'config.version': 'Versión',
    'config.languageId': 'Id de idioma',
    'config.testPrestashop': 'Probar conexión PrestaShop',
    'config.prestashopOk': 'Conexión PrestaShop correcta',
    'config.provider': 'Proveedor',
    'config.activeProvider': 'Proveedor activo',
    'config.aiBaseUrl': 'URL del proveedor IA',
    'config.model': 'Modelo',
    'config.aiLanguage': 'Idioma',
    'config.aiApiKey': 'Clave API de IA',
    'config.defaultPrompt': 'Prompt',
    'config.useDefaultPrompt': 'Usar prompt por defecto',
    'config.defaultPromptOverwriteWarning':
      'El texto personalizado será sobrescrito con el prompt por defecto del sistema. ¿Continuar?',
    'config.testAi': 'Probar conexión IA',
    'config.aiOk': 'Conexión IA correcta',
    'config.save': 'Guardar configuración',
    'config.saved': 'Configuración guardada',
    'config.back': 'Volver',
    'auth.login': 'Iniciar sesión',
    'auth.logout': 'Cerrar sesión',
    'auth.username': 'Usuario',
    'auth.password': 'Contraseña',
    'auth.comercio': 'Comercio',
    'auth.comercioPlaceholder': 'Selecciona tu comercio',
    'auth.loginError': 'Credenciales incorrectas',
    'auth.registerLink': 'Registrar nuevo comercio',
    'auth.registerTitle': 'Registrar nuevo comercio',
    'auth.registerComercioName': 'Nombre del comercio',
    'auth.registerComercioNamePlaceholder': 'Mi Comercio',
    'auth.registerAdminUser': 'Usuario administrador',
    'auth.registerAdminPassword': 'Contraseña del administrador',
    'auth.registerUsernameHint': '3-30 caracteres: letras, números o guiones bajos',
    'auth.registerPasswordHint': 'Mínimo 8 caracteres con mayúscula, minúscula y número',
    'auth.registerSubmit': 'Crear comercio',
    'auth.registerSuccess': 'Comercio registrado correctamente',
    'auth.registerError': 'Error al registrar el comercio',
    'auth.registerSlugConflict': 'Ya existe un comercio con un nombre similar',
    'auth.backToLogin': 'Volver al inicio de sesión',
    'users.title': 'Gestión de usuarios',
    'users.subtitle': 'Administra los usuarios de tu comercio',
    'users.username': 'Usuario',
    'users.role': 'Rol',
    'users.roleAdmin': 'Administrador',
    'users.roleUser': 'Usuario',
    'users.createdAt': 'Creado',
    'users.addUser': 'Añadir usuario',
    'users.newUsername': 'Nuevo usuario',
    'users.newPassword': 'Contraseña',
    'users.newRole': 'Rol',
    'users.createUser': 'Crear usuario',
    'users.cancel': 'Cancelar',
    'users.delete': 'Eliminar',
    'users.deleteConfirm': '¿Eliminar al usuario "{username}"?',
    'users.cannotDeleteSelf': 'No puedes eliminar tu propia cuenta',
    'users.usernameHint': '3-30 caracteres: letras, números o guiones bajos',
    'users.passwordHint': 'Mínimo 8 caracteres con mayúscula, minúscula y número',
    'users.created': 'Usuario creado correctamente',
    'users.deleted': 'Usuario eliminado',
    'users.error': 'Error al gestionar usuarios',
    'users.back': 'Volver'
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
    'upload.prestashopBrandPlaceholder': 'e.g. Adidas',
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
    'view.aiAutocomplete': 'AI Autocomplete',
    'view.aiAutocompleteRunning': 'Autocompleting…',
    'view.aiAutocompleteSuccess': 'AI autocomplete finished: {completed} of {total} products completed',
    'view.aiAutocompletePartial': 'Partial AI autocomplete: {completed} of {total} completed, {failed} with errors',
    'view.aiAutocompleteError': 'AI autocomplete failed: {error}',
    'view.aiAutocompleteAllFailed': 'AI autocomplete failed: no products could be processed ({total} errors)',
    'view.aiAutocompleteNoProposals': 'The AI provider returned no proposals for this product',
    'view.aiAutocompleteErrorsTitle': 'Errors ({count}):',
    'config.title': 'Configuration',
    'config.marketplaces': 'Marketplaces',
    'config.aiSection': 'AI providers',
    'config.prestashopSection': 'PrestaShop',
    'config.baseUrl': 'Base URL',
    'config.baseUrlPlaceholder': 'https://shop.example.com',
    'config.psApiKey': 'PrestaShop API key',
    'config.version': 'Version',
    'config.languageId': 'Language ID',
    'config.testPrestashop': 'Test PrestaShop connection',
    'config.prestashopOk': 'PrestaShop connection OK',
    'config.provider': 'Provider',
    'config.activeProvider': 'Active provider',
    'config.aiBaseUrl': 'AI provider URL',
    'config.model': 'Model',
    'config.aiLanguage': 'Language',
    'config.aiApiKey': 'AI API key',
    'config.defaultPrompt': 'Prompt',
    'config.useDefaultPrompt': 'Use default prompt',
    'config.defaultPromptOverwriteWarning':
      'The custom text will be overwritten with the system default prompt. Continue?',
    'config.testAi': 'Test AI connection',
    'config.aiOk': 'AI connection OK',
    'config.save': 'Save configuration',
    'config.saved': 'Configuration saved',
    'config.back': 'Back',
    'auth.login': 'Sign in',
    'auth.logout': 'Sign out',
    'auth.username': 'Username',
    'auth.password': 'Password',
    'auth.comercio': 'Business',
    'auth.comercioPlaceholder': 'Select your business',
    'auth.loginError': 'Invalid credentials',
    'auth.registerLink': 'Register new business',
    'auth.registerTitle': 'Register new business',
    'auth.registerComercioName': 'Business name',
    'auth.registerComercioNamePlaceholder': 'My Business',
    'auth.registerAdminUser': 'Admin username',
    'auth.registerAdminPassword': 'Admin password',
    'auth.registerUsernameHint': '3-30 characters: letters, numbers or underscores',
    'auth.registerPasswordHint': 'Min 8 characters with uppercase, lowercase and number',
    'auth.registerSubmit': 'Create business',
    'auth.registerSuccess': 'Business registered successfully',
    'auth.registerError': 'Error registering business',
    'auth.registerSlugConflict': 'A business with a similar name already exists',
    'auth.backToLogin': 'Back to sign in',
    'users.title': 'User Management',
    'users.subtitle': 'Manage your business users',
    'users.username': 'Username',
    'users.role': 'Role',
    'users.roleAdmin': 'Admin',
    'users.roleUser': 'User',
    'users.createdAt': 'Created',
    'users.addUser': 'Add user',
    'users.newUsername': 'New username',
    'users.newPassword': 'Password',
    'users.newRole': 'Role',
    'users.createUser': 'Create user',
    'users.cancel': 'Cancel',
    'users.delete': 'Delete',
    'users.deleteConfirm': 'Delete user "{username}"?',
    'users.cannotDeleteSelf': 'You cannot delete your own account',
    'users.usernameHint': '3-30 characters: letters, numbers or underscores',
    'users.passwordHint': 'Min 8 characters with uppercase, lowercase and number',
    'users.created': 'User created successfully',
    'users.deleted': 'User deleted',
    'users.error': 'Error managing users',
    'users.back': 'Back'
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
