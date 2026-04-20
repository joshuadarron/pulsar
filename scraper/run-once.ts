import "dotenv/config";
import { scrape } from "./index.js";
import { closeDriver } from "@/lib/db/neo4j";
import pool from "@/lib/db/postgres";

const args = process.argv.slice(2);
let sourceFilter: string | undefined;
for (const arg of args) {
  if (arg.startsWith("--source=")) {
    sourceFilter = arg.split("=")[1];
  }
}

scrape(sourceFilter)
  .catch((err) => {
    console.error("Fatal scrape error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await closeDriver();
    await pool.end();
  });
