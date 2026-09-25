export function formatPrice(amount: number, locale: 'en' | 'fr') {
  return new Intl.NumberFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { maximumFractionDigits: 0 }).format(amount);
}

export function formatPropertyType(type: string, locale: 'en' | 'fr') {
  if (locale !== 'fr') return type;
  return type === 'Apartment' ? 'Appartement' : type === 'House' ? 'Maison' : type === 'Studio' ? 'Studio' : type;
}
