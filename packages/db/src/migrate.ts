import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import { logger } from "@llmgateway/logger";

import { getPoolConfig } from "./pg.js";

/**
 * Run database migrations using drizzle-orm
 * This function connects to the database and applies all pending migrations
 */
export async function runMigrations(): Promise<void> {
	logger.info("Starting database migrations");

	const pool = new Pool(getPoolConfig());
	const migrationDb = drizzle({ client: pool });

	try {
		// Run migrations from the migrations folder
		await migrate(migrationDb, {
			migrationsFolder: "./migrations", // we copy this in the dockerfile
		});
		logger.info("Database migrations completed successfully");
	} catch (error) {
		logger.error(
			"Database migration failed",
			error instanceof Error ? error : new Error(String(error)),
		);
		throw error;
	} finally {
		try {
			await pool.end();
		} catch (error) {
			logger.error(
				"Failed to close migration pool",
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}
}
