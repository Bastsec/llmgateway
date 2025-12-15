import type { PoolConfig } from "pg";

type PgSslMode =
	| "disable"
	| "allow"
	| "prefer"
	| "require"
	| "verify-ca"
	| "verify-full";

const getUrlParam = (databaseUrl: string, key: string): string | null => {
	try {
		return new URL(databaseUrl).searchParams.get(key);
	} catch {
		return null;
	}
};

const shouldEnableSsl = (databaseUrl: string): boolean => {
	const sslMode =
		(process.env.PGSSLMODE as PgSslMode | undefined) ||
		(getUrlParam(databaseUrl, "sslmode") as PgSslMode | null) ||
		null;

	if (process.env.DATABASE_SSL === "true") {
		return true;
	}

	if (getUrlParam(databaseUrl, "ssl") === "true") {
		return true;
	}

	return (
		sslMode === "require" ||
		sslMode === "verify-ca" ||
		sslMode === "verify-full"
	);
};

const getSslConfig = (databaseUrl: string): PoolConfig["ssl"] | undefined => {
	if (!shouldEnableSsl(databaseUrl)) {
		return undefined;
	}

	const rejectUnauthorized = process.env.PGSSL_REJECT_UNAUTHORIZED !== "false";

	return { rejectUnauthorized };
};

export const getPoolConfig = (): PoolConfig => {
	const databaseUrl =
		process.env.DATABASE_URL || "postgres://postgres:pw@localhost:5432/db";

	const ssl = getSslConfig(databaseUrl);

	return {
		connectionString: databaseUrl,
		...(ssl ? { ssl } : {}),
	};
};
