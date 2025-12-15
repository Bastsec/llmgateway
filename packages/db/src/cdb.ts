import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { redisClient } from "@llmgateway/cache";
import { logger } from "@llmgateway/logger";

import { getPoolConfig } from "./pg.js";
import { RedisCache } from "./redis-cache.js";
import { relations } from "./relations.js";

const cachedPool = new Pool(getPoolConfig());

export const cdb = drizzle({
	client: cachedPool,
	casing: "snake_case",
	relations,
	cache: new RedisCache(redisClient),
});

export async function closeCachedDatabase(): Promise<void> {
	try {
		await cachedPool.end();
		logger.info("Cached database connection pool closed");
	} catch (error) {
		logger.error(
			"Error closing cached database connection pool",
			error instanceof Error ? error : new Error(String(error)),
		);
		throw error;
	}
}
