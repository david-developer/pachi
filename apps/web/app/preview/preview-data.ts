export type PreviewListing = {
  id: string;
  title: { en: string; fr: string };
  area: string;
  city: 'Douala' | 'Buea';
  region: 'Littoral' | 'Southwest';
  purpose: 'RENT' | 'SALE' | 'SHORT_LET';
  propertyType: 'Apartment' | 'House' | 'Studio';
  bedrooms: number;
  bathrooms: number;
  areaSqm: number;
  price: number;
  period: 'monthly' | 'total' | 'nightly';
  furnished: boolean;
  status: 'available' | 'recent';
  provider: string;
  providerState: 'NOT_VERIFIED' | 'VERIFIED';
  relationship: 'DECLARED' | 'VERIFIED';
  description: { en: string; fr: string };
  images: string[];
  utilities?: boolean;
  deposit?: number;
  advance?: number;
  negotiable?: boolean;
};

const photos = {
  airy: 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1500&q=85',
  lounge: 'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=1200&q=85',
  exterior: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=85',
  kitchen: 'https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=1200&q=85',
  studio: 'https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?auto=format&fit=crop&w=1200&q=85',
  home: 'https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?auto=format&fit=crop&w=1500&q=85',
};

export const previewListings: PreviewListing[] = [
  {
    id: 'bonamoussadi-light',
    title: { en: 'A bright, cross-ventilated home near the market', fr: 'Appartement lumineux à deux pas du marché' },
    area: 'Bonamoussadi', city: 'Douala', region: 'Littoral', purpose: 'RENT', propertyType: 'Apartment', bedrooms: 2, bathrooms: 2, areaSqm: 96, price: 350000, period: 'monthly', furnished: false, status: 'available', provider: 'Mboa Habitat', providerState: 'NOT_VERIFIED', relationship: 'DECLARED',
    description: { en: 'A generous living room opens onto a shaded balcony. The home sits on a calm street with groceries, taxis and everyday services close by.', fr: 'Un grand séjour s’ouvre sur un balcon ombragé. Le logement se trouve dans une rue calme, proche des commerces, des taxis et des services du quotidien.' },
    images: [photos.airy, photos.lounge, photos.kitchen, photos.exterior], utilities: false, deposit: 350000, advance: 2,
  },
  {
    id: 'akwa-courtyard',
    title: { en: 'A quiet courtyard studio in central Akwa', fr: 'Studio calme avec cour au cœur d’Akwa' },
    area: 'Akwa', city: 'Douala', region: 'Littoral', purpose: 'RENT', propertyType: 'Studio', bedrooms: 1, bathrooms: 1, areaSqm: 42, price: 180000, period: 'monthly', furnished: true, status: 'recent', provider: 'Claudine N.', providerState: 'NOT_VERIFIED', relationship: 'DECLARED',
    description: { en: 'A furnished studio around a shared leafy courtyard, with a compact kitchen and a separate sleeping area.', fr: 'Studio meublé autour d’une cour partagée et arborée, avec cuisine compacte et espace nuit séparé.' },
    images: [photos.studio, photos.lounge, photos.exterior], utilities: true, deposit: 180000, advance: 1,
  },
  {
    id: 'molyko-family-home',
    title: { en: 'A family home with a garden in Molyko', fr: 'Maison familiale avec jardin à Molyko' },
    area: 'Molyko', city: 'Buea', region: 'Southwest', purpose: 'SALE', propertyType: 'House', bedrooms: 4, bathrooms: 3, areaSqm: 210, price: 48500000, period: 'total', furnished: false, status: 'available', provider: 'Southwest Homes', providerState: 'VERIFIED', relationship: 'VERIFIED', negotiable: true,
    description: { en: 'A set-back family house with a garden and room to gather outside. Schools and the main Molyko road are within easy reach.', fr: 'Maison familiale en retrait avec jardin et espace pour se retrouver dehors. Les écoles et la route principale de Molyko sont proches.' },
    images: [photos.home, photos.exterior, photos.lounge, photos.kitchen],
  },
  {
    id: 'bonapriso-evening',
    title: { en: 'An airy apartment on a leafy Bonapriso street', fr: 'Appartement aéré dans une rue arborée de Bonapriso' },
    area: 'Bonapriso', city: 'Douala', region: 'Littoral', purpose: 'RENT', propertyType: 'Apartment', bedrooms: 3, bathrooms: 2, areaSqm: 128, price: 590000, period: 'monthly', furnished: true, status: 'available', provider: 'Mboa Habitat', providerState: 'NOT_VERIFIED', relationship: 'DECLARED',
    description: { en: 'A well-lit apartment with a covered balcony and a small laundry area, close to local restaurants and transport.', fr: 'Appartement bien éclairé avec balcon couvert et coin buanderie, proche des restaurants et transports locaux.' },
    images: [photos.exterior, photos.airy, photos.kitchen], utilities: false, deposit: 590000, advance: 2,
  },
  {
    id: 'buea-short-stay',
    title: { en: 'A furnished weekend hideaway above Buea', fr: 'Pied-à-terre meublé au-dessus de Buea' },
    area: 'Molyko', city: 'Buea', region: 'Southwest', purpose: 'SHORT_LET', propertyType: 'House', bedrooms: 2, bathrooms: 1, areaSqm: 88, price: 45000, period: 'nightly', furnished: true, status: 'available', provider: 'Mountain View Stays', providerState: 'NOT_VERIFIED', relationship: 'DECLARED',
    description: { en: 'A small furnished home with a quiet outdoor sitting area and flexible arrival times by arrangement.', fr: 'Petite maison meublée avec coin salon extérieur calme et horaires d’arrivée flexibles sur rendez-vous.' },
    images: [photos.home, photos.studio, photos.exterior], utilities: true,
  },
];

export const imageForListing = (listing: PreviewListing, index = 0) => listing.images[index % listing.images.length] ?? photos.airy;
