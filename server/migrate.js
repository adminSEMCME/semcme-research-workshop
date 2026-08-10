import { applySchema } from "./schema.js";
import { pool } from "./db.js";

try {
  await applySchema();
  console.log("Research Workshop Series database schema is up to date.");
} finally {
  await pool.end();
}
