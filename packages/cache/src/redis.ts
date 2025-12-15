import { Redis } from "ioredis";

import { logger } from "@llmgateway/logger";

const redisUrl = process.env.REDIS_URL;
const redisPort = Number(process.env.REDIS_PORT) || 6379;
const useTls = process.env.REDIS_TLS === "true" || redisPort === 6380;

export const redisClient = redisUrl
	? new Redis(redisUrl)
	: new Redis({
			host: process.env.REDIS_HOST || "localhost",
			port: redisPort,
			password: process.env.REDIS_PASSWORD,
			...(useTls ? { tls: {} } : {}),
		});

redisClient.on("error", (err) =>
	logger.error(
		"Redis Client Error",
		err instanceof Error ? err : new Error(String(err)),
	),
);

export const LOG_QUEUE = "log_queue_" + process.env.NODE_ENV;

export async function publishToQueue(
	queue: string,
	message: unknown,
): Promise<void> {
	try {
		await redisClient.lpush(queue, JSON.stringify(message));
	} catch (error) {
		logger.error(
			"Error publishing to queue",
			error instanceof Error ? error : new Error(String(error)),
		);
		throw error;
	}
}

export async function consumeFromQueue(
	queue: string,
): Promise<string[] | null> {
	try {
		const result = await redisClient.lpop(queue, 10);

		if (!result) {
			return null;
		}

		return result;
	} catch (error) {
		logger.error(
			"Error consuming from queue",
			error instanceof Error ? error : new Error(String(error)),
		);
		throw error;
	}
}

export async function closeRedisClient(): Promise<void> {
	try {
		await redisClient.disconnect();
		logger.info("Redis client disconnected");
	} catch (error) {
		logger.error(
			"Error disconnecting Redis client",
			error instanceof Error ? error : new Error(String(error)),
		);
		throw error;
	}
}
