import { getDb } from '../db/connection.js';
import { config } from '../config.js';

const db = getDb();
const count = db.get<{ cnt: number }>('SELECT COUNT(*) as cnt FROM users');
console.log(
  `Database initialized at ${config.databasePath} (${count?.cnt || 0} registered user accounts).`
);
