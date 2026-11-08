import type { AppDatabase } from './connection.js';
import { aedToFils } from '../services/money.js';

export interface OfficialMenuCategorySeed {
  name: string;
  slug: string;
  description: string;
  icon: string;
  items: Array<{
    name: string;
    priceAed: number;
    description?: string;
    imageUrl: string;
    isVegetarian: boolean;
    isAvailable?: boolean;
  }>;
}

/**
 * Verbatim Official Bright Riders School Canteen Menu
 * (ADFSA & ADEK-Compliant • SEHHI صحّي • Al Thabiah Catering)
 * Preserves exact original item names, spelling, capitalization, and AED pricing.
 */
export const OFFICIAL_BRIGHT_RIDERS_MENU: OfficialMenuCategorySeed[] = [
  {
    name: 'BREAKFAST',
    slug: 'breakfast',
    description: 'ADFSA & ADEK-Compliant SEHHI breakfast items, wraps, sandwiches & baked fatayer',
    icon: 'sunrise',
    items: [
      {
        name: 'Mini Veg pizza',
        priceAed: 3,
        description: 'ADFSA & ADEK-Compliant SEHHI baked mini vegetable pizza.',
        imageUrl: '/menu-photos/pizza-fatayer.jpg',
        isVegetarian: true,
      },
      {
        name: 'Baked Samosa (Veg / Chicken)',
        priceAed: 3,
        description: 'Oven-baked crispy samosa. Specify Veg or Chicken in special instructions.',
        imageUrl: '/menu-photos/croissant-samosa.jpg',
        isVegetarian: false,
      },
      {
        name: 'Mini sandwich (Labneh Cucumber, Chicken tikka, Paneer Tikka, Sweet Corn)',
        priceAed: 3,
        description:
          'Specify filling choice in special instructions: Labneh Cucumber, Chicken tikka, Paneer Tikka, or Sweet Corn.',
        imageUrl: '/menu-photos/sandwiches-wraps.jpg',
        isVegetarian: false,
      },
      {
        name: 'Fresh Fruit Cup',
        priceAed: 6,
        description: 'Chilled cup of freshly cut seasonal fruits.',
        imageUrl: '/menu-photos/fruit-cup-dessert.jpg',
        isVegetarian: true,
      },
      {
        name: 'Plain Croissant',
        priceAed: 5,
        description: 'Freshly baked golden flaky croissant.',
        imageUrl: '/menu-photos/croissant-samosa.jpg',
        isVegetarian: true,
      },
      {
        name: 'Chicken Club Sandwich',
        priceAed: 5,
        description: '5 AED/pc • Wholesome layered chicken club sandwich.',
        imageUrl: '/menu-photos/sandwiches-wraps.jpg',
        isVegetarian: false,
      },
      {
        name: 'Fatayer (Cheese / Zaatar)',
        priceAed: 5,
        description: 'Baked soft pastry. Specify Cheese or Zaatar in special instructions.',
        imageUrl: '/menu-photos/pizza-fatayer.jpg',
        isVegetarian: true,
      },
      {
        name: 'Fatayer (Chicken Cheese / Labneh Zaatar, Zaatar Cheese)',
        priceAed: 6,
        description:
          'Specify preferred variety in special instructions: Chicken Cheese, Labneh Zaatar, or Zaatar Cheese.',
        imageUrl: '/menu-photos/pizza-fatayer.jpg',
        isVegetarian: false,
      },
      {
        name: 'Pizza Fatayer',
        priceAed: 7,
        description: 'Oven-baked pizza-style fatayer topped with tomato sauce and cheese.',
        imageUrl: '/menu-photos/pizza-fatayer.jpg',
        isVegetarian: true,
      },
      {
        name: 'Tacos (Veg / Non Veg)',
        priceAed: 7,
        description: 'Specify Veg or Non Veg in special instructions.',
        imageUrl: '/menu-photos/sandwiches-wraps.jpg',
        isVegetarian: false,
      },
      {
        name: 'Veg club Toast',
        priceAed: 7,
        description: '7 AED/pc • Toasted wholesome vegetable club sandwich.',
        imageUrl: '/menu-photos/sandwiches-wraps.jpg',
        isVegetarian: true,
      },
      {
        name: 'Labneh Falafel wraps',
        priceAed: 9,
        description: 'Baked falafel wrap with creamy labneh and fresh greens.',
        imageUrl: '/menu-photos/sandwiches-wraps.jpg',
        isVegetarian: true,
      },
      {
        name: 'Paneer Tikka Wrap',
        priceAed: 9,
        description: 'Soft tortilla wrap filled with spiced grilled paneer tikka.',
        imageUrl: '/menu-photos/sandwiches-wraps.jpg',
        isVegetarian: true,
      },
      {
        name: 'Chicken Tikka (Sandwich / Wrap)',
        priceAed: 9,
        description: 'Specify Sandwich or Wrap preference in special instructions.',
        imageUrl: '/menu-photos/sandwiches-wraps.jpg',
        isVegetarian: false,
      },
    ],
  },
  {
    name: 'HOT MEALS',
    slug: 'hot-meals',
    description: 'Freshly prepared baked burgers, rice bowls, pasta & SEHHI hot lunch entrees',
    icon: 'flame',
    items: [
      {
        name: 'Veg Burger (Baked)',
        priceAed: 10,
        description: 'Oven-baked vegetable patty served in a soft burger bun.',
        imageUrl: '/menu-photos/burgers-nuggets.jpg',
        isVegetarian: true,
      },
      {
        name: 'Grilled Chicken Burger',
        priceAed: 10,
        description: 'Tender grilled chicken breast burger prepared to SEHHI standards.',
        imageUrl: '/menu-photos/burgers-nuggets.jpg',
        isVegetarian: false,
      },
      {
        name: 'Nuggets Baked (4 PCS)',
        priceAed: 8,
        description: '4 pieces of golden oven-baked chicken nuggets.',
        imageUrl: '/menu-photos/burgers-nuggets.jpg',
        isVegetarian: false,
      },
      {
        name: 'Veg Fried Rice',
        priceAed: 12,
        description: 'Lightly seasoned wok-tossed rice with mixed garden vegetables.',
        imageUrl: '/menu-photos/rice-pasta-biriyani.jpg',
        isVegetarian: true,
      },
      {
        name: 'Plain Pasta (white / mix sauce)',
        priceAed: 12,
        description: 'Specify white sauce or mix sauce in special instructions.',
        imageUrl: '/menu-photos/rice-pasta-biriyani.jpg',
        isVegetarian: true,
      },
      {
        name: 'Chicken /Paneer Curry and Steam Rice',
        priceAed: 0,
        isAvailable: false,
        description:
          'Price pending confirmation (obscured by camera flash on menu photo). Specify Chicken or Paneer Curry.',
        imageUrl: '/menu-photos/rice-pasta-biriyani.jpg',
        isVegetarian: false,
      },
      {
        name: 'Chicken biriyani (less oil)',
        priceAed: 13,
        description: 'Aromatic spiced chicken biriyani prepared with reduced oil.',
        imageUrl: '/menu-photos/rice-pasta-biriyani.jpg',
        isVegetarian: false,
      },
    ],
  },
  {
    name: 'SNACKS & DESSERT',
    slug: 'snacks-dessert',
    description: 'Light air-popped snacks, low-fat fruit desserts & reduced-sugar cakes',
    icon: 'sparkles',
    items: [
      {
        name: 'Plain Air-Popped Popcorn',
        priceAed: 3,
        description: 'Light, oil-free air-popped wholegrain popcorn.',
        imageUrl: '/menu-photos/popcorn-cakes.jpg',
        isVegetarian: true,
      },
      {
        name: 'Fruit Dessert (Low Fat)',
        priceAed: 9,
        description: 'Wholesome low-fat chilled fruit dessert.',
        imageUrl: '/menu-photos/fruit-cup-dessert.jpg',
        isVegetarian: true,
      },
      {
        name: 'English cake Slice (Saffron / Vanilla)',
        priceAed: 2,
        description: 'Soft baked cake slice. Specify Saffron or Vanilla in special instructions.',
        imageUrl: '/menu-photos/popcorn-cakes.jpg',
        isVegetarian: true,
      },
      {
        name: 'Low Fat Milk cake (Sugar less)',
        priceAed: 9,
        description: 'Light sugar-free low-fat milk sponge cake.',
        imageUrl: '/menu-photos/popcorn-cakes.jpg',
        isVegetarian: true,
      },
    ],
  },
  {
    name: 'DRINKS',
    slug: 'drinks',
    description: 'Refreshing SEHHI-approved beverages, water, milk & laban',
    icon: 'cup-soda',
    items: [
      {
        name: 'Fruit Juice / Milk',
        priceAed: 3,
        description: 'Specify Fruit Juice or Milk in special instructions.',
        imageUrl: '/menu-photos/drinks-laban.jpg',
        isVegetarian: true,
      },
      {
        name: 'Water',
        priceAed: 1.5,
        description: 'Chilled bottled drinking water.',
        imageUrl: '/menu-photos/drinks-laban.jpg',
        isVegetarian: true,
      },
      {
        name: 'Laben - up',
        priceAed: 3,
        description: 'Chilled refreshing traditional laban yogurt drink.',
        imageUrl: '/menu-photos/drinks-laban.jpg',
        isVegetarian: true,
      },
    ],
  },
];

export function seedOfficialBrightRidersMenu(db: AppDatabase, forceReplace = false): {
  categoriesCount: number;
  itemsCount: number;
} {
  if (!forceReplace) {
    const existing = db.get<{ cnt: number }>('SELECT COUNT(*) as cnt FROM menu_items');
    if (existing && existing.cnt > 0) {
      const catCnt = db.get<{ cnt: number }>('SELECT COUNT(*) as cnt FROM food_categories');
      return { categoriesCount: catCnt?.cnt || 0, itemsCount: existing.cnt };
    }
  }

  let categoriesCount = 0;
  let itemsCount = 0;

  db.transaction(() => {
    if (forceReplace) {
      db.run('DELETE FROM shopping_cart_items');
      db.run('DELETE FROM menu_availability_schedules');
      db.run('DELETE FROM menu_items');
      db.run('DELETE FROM food_categories');
    }

    OFFICIAL_BRIGHT_RIDERS_MENU.forEach((cat, catIdx) => {
      const insCat = db.run(
        `INSERT INTO food_categories (name, slug, description, icon, display_order, is_active)
         VALUES (?, ?, ?, ?, ?, 1)`,
        cat.name,
        cat.slug,
        cat.description,
        cat.icon,
        catIdx
      );
      const categoryId = insCat.lastInsertRowid;
      categoriesCount++;

      cat.items.forEach((item, itemIdx) => {
        db.run(
          `INSERT INTO menu_items (
            category_id, name, description, price_fils, image_url,
            is_available, is_vegetarian, display_order
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          categoryId,
          item.name,
          item.description || null,
          aedToFils(item.priceAed),
          item.imageUrl,
          item.isAvailable === undefined ? 1 : item.isAvailable ? 1 : 0,
          item.isVegetarian ? 1 : 0,
          itemIdx
        );
        itemsCount++;
      });
    });
  });

  return { categoriesCount, itemsCount };
}
