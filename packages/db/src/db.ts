import { instrumentDrizzle } from "@kubiks/otel-drizzle";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { logger } from "@llmgateway/logger";

import { getPoolConfig } from "./pg.js";
import { relations } from "./relations.js";

const pool = new Pool(getPoolConfig());

const instrumentedPool = instrumentDrizzle(pool, {
	dbSystem: "postgresql",
	dbName: "llmgateway",
	captureQueryText: true,
	maxQueryTextLength: 5000,
});

export const db = drizzle({
	client: instrumentedPool,
	casing: "snake_case",
	relations,
});

export async function closeDatabase(): Promise<void> {
	try {
		await pool.end();
		logger.info("Database connection pool closed");
	} catch (error) {
		logger.error(
			"Error closing database connection pool",
			error instanceof Error ? error : new Error(String(error)),
		);
		throw error;
	}
}
