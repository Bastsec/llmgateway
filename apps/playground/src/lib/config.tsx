"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import type { AppConfig } from "./config-server";

const AppConfigContext = createContext<AppConfig | null>(null);

interface AppConfigProviderProps {
	children: ReactNode;
	config: AppConfig;
}

export function AppConfigProvider({
	children,
	config,
}: AppConfigProviderProps) {
	const memoizedConfig = useMemo(() => {
		return {
			apiUrl: config.apiUrl,
			apiBackendUrl: config.apiBackendUrl,
			hosted: config.hosted,
			githubUrl: config.githubUrl,
			discordUrl: config.discordUrl,
			twitterUrl: config.twitterUrl,
			docsUrl: config.docsUrl,
			posthogKey: config.posthogKey,
			posthogHost: config.posthogHost,
			crispId: config.crispId,
		};
	}, [
		config.apiUrl,
		config.apiBackendUrl,
		config.hosted,
		config.githubUrl,
		config.discordUrl,
		config.twitterUrl,
		config.docsUrl,
		config.posthogKey,
		config.posthogHost,
		config.crispId,
	]);

	return (
		<AppConfigContext.Provider value={memoizedConfig}>
			{children}
		</AppConfigContext.Provider>
	);
}

export function useAppConfig(): AppConfig {
	const config = useContext(AppConfigContext);
	if (!config) {
		throw new Error("useAppConfig must be used within an AppConfigProvider");
	}
	return config;
}
