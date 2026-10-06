// Maps OpenMapTiles POI classes onto the filter chips and label icons.

export type CategoryId = 'cafe' | 'food' | 'bar' | 'shop' | 'hotel' | 'park' | 'sight';

export interface Category {
  id: CategoryId;
  label: string;
  /** Inner SVG markup on a 24×24 grid, drawn in currentColor. */
  icon: string;
  /** Higher wins label collisions. */
  weight: number;
}

const stroke = (d: string) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;

export const CATEGORIES: Category[] = [
  { id: 'cafe', label: 'Cafés', weight: 3, icon: stroke('M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5zM16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3c0 1.5 1 1.5 1 3M12 3c0 1.5 1 1.5 1 3') },
  { id: 'food', label: 'Restaurants', weight: 3, icon: stroke('M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 21V3c-2 1-3 4-3 8h3') },
  { id: 'bar', label: 'Bars', weight: 2, icon: stroke('M5 4h14l-7 8zM12 12v8M8 20h8') },
  { id: 'shop', label: 'Shops', weight: 2, icon: stroke('M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2') },
  { id: 'hotel', label: 'Hotels', weight: 2, icon: stroke('M3 18V7M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5M7 11.5a1.5 1.5 0 1 0 0-.01') },
  { id: 'park', label: 'Parks', weight: 2, icon: stroke('M12 21v-6M12 3l-6 9h4l-3 4h10l-3-4h4z') },
  { id: 'sight', label: 'Sights', weight: 4, icon: stroke('M3 21h18M5 21v-9M9 21v-9M15 21v-9M19 21v-9M3 10l9-6 9 6z') },
];

export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c])) as Record<CategoryId, Category>;

const CLASS_TO_CATEGORY: Record<string, CategoryId> = {
  cafe: 'cafe', ice_cream: 'cafe',
  restaurant: 'food', fast_food: 'food', food_court: 'food',
  bar: 'bar', beer: 'bar', pub: 'bar', nightclub: 'bar',
  shop: 'shop', clothing_store: 'shop', grocery: 'shop', bakery: 'shop', alcohol_shop: 'shop', jewelry: 'shop',
  books: 'shop', music: 'shop', mobile_phone: 'shop', shoes: 'shop', florist: 'shop', gift: 'shop', furniture: 'shop',
  lodging: 'hotel',
  park: 'park', garden: 'park', playground: 'park',
  attraction: 'sight', museum: 'sight', art_gallery: 'sight', castle: 'sight', monument: 'sight', theatre: 'sight',
  cinema: 'sight', place_of_worship: 'sight', stadium: 'sight', zoo: 'sight', aquarium: 'sight', town_hall: 'sight',
};

export function categoryOf(cls: string, sub: string): CategoryId | null {
  if (sub === 'pub' || sub === 'bar') return 'bar';
  if (sub === 'bakery' || sub === 'coffee') return sub === 'coffee' ? 'cafe' : 'shop';
  return CLASS_TO_CATEGORY[cls] ?? null;
}

const SUB_LABEL: Record<string, string> = {
  cafe: 'Café', coffee: 'Coffee Shop', ice_cream: 'Ice Cream', restaurant: 'Restaurant', fast_food: 'Fast Food',
  pub: 'Pub', bar: 'Bar', biergarten: 'Beer Garden', nightclub: 'Nightclub', hotel: 'Hotel', hostel: 'Hostel',
  guest_house: 'Guest House', apartment: 'Apartments', clothes: 'Clothing', supermarket: 'Supermarket',
  convenience: 'Convenience Store', bakery: 'Bakery', museum: 'Museum', gallery: 'Gallery', artwork: 'Artwork',
  attraction: 'Attraction', castle: 'Castle', monument: 'Monument', memorial: 'Memorial', theatre: 'Theatre',
  cinema: 'Cinema', park: 'Park', garden: 'Garden', playground: 'Playground', place_of_worship: 'Place of Worship',
  viewpoint: 'Viewpoint', books: 'Bookshop', jewelry: 'Jeweller', confectionery: 'Sweet Shop', deli: 'Deli',
};

/** Human-readable subtitle, e.g. "Coffee Shop", "Bakery". */
export function subtitleOf(cls: string, sub: string): string {
  const key = sub || cls;
  return SUB_LABEL[key] ?? SUB_LABEL[cls] ?? key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
