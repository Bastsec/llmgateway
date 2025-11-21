#!/usr/bin/env ts-node
/* eslint-disable no-console */
import { Client } from "pg";

async function main() {
	const databaseUrl = process.env.DATABASE_URL;

	if (!databaseUrl) {
		console.error("DATABASE_URL is not set.");
		process.exitCode = 1;
		return;
	}

	const client = new Client({
		connectionString: databaseUrl,
		ssl: { rejectUnauthorized: false },
	});

	try {
		console.log("Connecting to database...");
		await client.connect();
		const result = await client.query("SELECT NOW() as current_time");
		console.log("Connection successful.");
		console.log("Database time:", result.rows[0].current_time);
	} catch (error) {
		console.error("Failed to connect to database.");
		console.error(error);
		process.exitCode = 1;
	} finally {
		await client.end().catch(() => undefined);
	}
}

main().catch((error) => {
	console.error("Unexpected error.");
	console.error(error);
	process.exitCode = 1;
});
