import { getDb } from '../db/connection.js';
import { seedOfficialBrightRidersMenu } from '../db/official-menu.js';

const db = getDb();
const res = seedOfficialBrightRidersMenu(db, true);
console.log(
  `Seeded Official Bright Riders School Menu: ${res.itemsCount} exact items across ${res.categoriesCount} categories.`
);
