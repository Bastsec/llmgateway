import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
	models as modelsList,
	providers,
	type ProviderModelMapping,
	type ModelDefinition,
} from "@llmgateway/models";
import { HTTPException } from "hono/http-exception";

import type { ServerTypes } from "../vars";

export const modelsApi = new OpenAPIHono<ServerTypes>();

const modelSchema = z.object({
	id: z.string(),
	name: z.string(),
	created: z.number(),
	description: z.string().optional(),
	family: z.string(),
	architecture: z.object({
		input_modalities: z.array(z.enum(["text", "image"])),
		output_modalities: z.array(z.enum(["text", "image"])),
		tokenizer: z.string().optional(),
	}),
	top_provider: z.object({
		is_moderated: z.boolean(),
	}),
	providers: z.array(
		z.object({
			providerId: z.string(),
			modelName: z.string(),
			pricing: z
				.object({
					prompt: z.string(),
					completion: z.string(),
					image: z.string().optional(),
				})
				.optional(),
			streaming: z.boolean(),
			vision: z.boolean(),
			cancellation: z.boolean(),
			tools: z.boolean(),
			parallelToolCalls: z.boolean(),
			reasoning: z.boolean(),
		}),
	),
	pricing: z.object({
		prompt: z.string(),
		completion: z.string(),
		image: z.string().optional(),
		request: z.string().optional(),
		input_cache_read: z.string().optional(),
		input_cache_write: z.string().optional(),
		web_search: z.string().optional(),
		internal_reasoning: z.string().optional(),
	}),
	context_length: z.number().optional(),
	per_request_limits: z.record(z.string()).optional(),
	supported_parameters: z.array(z.string()).optional(),
	json_output: z.boolean(),
	free: z.boolean().optional(),
	deprecated_at: z.string().optional(),
	deactivated_at: z.string().optional(),
});

const listModelsResponseSchema = z.object({
	data: z.array(modelSchema),
});

const listModels = createRoute({
	operationId: "v1_models",
	summary: "Models",
	description: "List all available models",
	method: "get",
	path: "/",
	request: {
		query: z.object({
			include_deactivated: z
				.string()
				.optional()
				.transform((val) => val === "true")
				.describe("Include deactivated models in the response"),
			exclude_deprecated: z
				.string()
				.optional()
				.transform((val) => val === "true")
				.describe("Exclude deprecated models from the response"),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: listModelsResponseSchema,
				},
			},
			description: "List of available models",
		},
	},
});

modelsApi.openapi(listModels, async (c) => {
	try {
		const query = c.req.valid("query");
		const includeDeactivated = query.include_deactivated || false;
		const excludeDeprecated = query.exclude_deprecated || false;
		const currentDate = new Date();

		// Filter models based on deactivation and deprecation status
		const filteredModels = modelsList.filter((model: ModelDefinition) => {
			// Filter out deactivated models by default (unless explicitly included)
			if (
				!includeDeactivated &&
				model.deactivatedAt &&
				currentDate > model.deactivatedAt
			) {
				return false;
			}

			// Filter out deprecated models if requested
			if (
				excludeDeprecated &&
				model.deprecatedAt &&
				currentDate > model.deprecatedAt
			) {
				return false;
			}

			return true;
		});

		const modelData = filteredModels.map((model: ModelDefinition) => {
			// Determine input modalities (if model supports images)
			const inputModalities: ("text" | "image")[] = ["text"];

			// Check if any provider has vision support
			if (model.providers.some((p) => p.vision)) {
				inputModalities.push("image");
			}

			// Determine output modalities from model definition or default to text only
			const outputModalities: ("text" | "image")[] = model.output || ["text"];

			const firstProviderWithPricing = model.providers.find(
				(p: ProviderModelMapping) =>
					p.inputPrice !== undefined ||
					p.outputPrice !== undefined ||
					p.imageInputPrice !== undefined,
			);

			const inputPrice =
				firstProviderWithPricing?.inputPrice?.toString() || "0";
			const outputPrice =
				firstProviderWithPricing?.outputPrice?.toString() || "0";
			const imagePrice =
				firstProviderWithPricing?.imageInputPrice?.toString() || "0";

			return {
				id: model.id,
				name: model.name || model.id,
				created: Math.floor(Date.now() / 1000), // Current timestamp in seconds
				description: `${model.id} provided by ${model.providers.map((p) => p.providerId).join(", ")}`,
				family: model.family,
				architecture: {
					input_modalities: inputModalities,
					output_modalities: outputModalities,
					tokenizer: "GPT", // TODO: Should come from model definitions when available
				},
				top_provider: {
					is_moderated: true,
				},
				providers: model.providers.map((provider: ProviderModelMapping) => {
					// Find the provider definition to get cancellation support
					const providerDef = providers.find(
						(p) => p.id === provider.providerId,
					);

					return {
						providerId: provider.providerId,
						modelName: provider.modelName,
						pricing:
							provider.inputPrice !== undefined ||
							provider.outputPrice !== undefined ||
							provider.imageInputPrice !== undefined
								? {
										prompt: provider.inputPrice?.toString() || "0",
										completion: provider.outputPrice?.toString() || "0",
										image: provider.imageInputPrice?.toString() || "0",
									}
								: undefined,
						streaming: provider.streaming,
						vision: provider.vision || false,
						cancellation: providerDef?.cancellation || false,
						tools: provider.tools || false,
						parallelToolCalls: provider.parallelToolCalls || false,
						reasoning: provider.reasoning || false,
					};
				}),
				pricing: {
					prompt: inputPrice,
					completion: outputPrice,
					image: imagePrice,
					request: firstProviderWithPricing?.requestPrice?.toString() || "0",
					input_cache_read:
						firstProviderWithPricing?.cachedInputPrice?.toString() || "0",
					input_cache_write: "0", // Not defined in model definitions yet
					web_search: "0", // Not defined in model definitions yet
					internal_reasoning: "0", // Not defined in model definitions yet
				},
				// Use context length from model definition (take the largest from all providers)
				context_length:
					Math.max(...model.providers.map((p) => p.contextSize || 0)) ||
					undefined,
				// Get supported parameters from model definitions with fallback to defaults
				supported_parameters: getSupportedParametersFromModel(model),
				// Add model-level capabilities
				json_output: model.jsonOutput || false,
				free: model.free || false,
				deprecated_at: model.deprecatedAt?.toISOString(),
				deactivated_at: model.deactivatedAt?.toISOString(),
			};
		});

		return c.json({ data: modelData });
	} catch (error) {
		console.error("Error in models endpoint:", error);
		throw new HTTPException(500, { message: "Internal server error" });
	}
});

// Helper function to determine supported parameters from model definitions
// Falls back to common default parameters if not explicitly defined
function getSupportedParametersFromModel(model: ModelDefinition): string[] {
	// Default common parameters that most models support
	const defaultCommonParams = [
		"temperature",
		"max_tokens",
		"top_p",
		"frequency_penalty",
		"presence_penalty",
		"response_format",
		"tools",
		"tool_choice",
	];

	// Start with explicit supported parameters if any provider defines them
	for (const provider of model.providers) {
		const supportedParameters = (provider as any)?.supportedParameters as
			| string[]
			| undefined;
		if (supportedParameters && supportedParameters.length > 0) {
			const params = [...supportedParameters];
			// If any provider supports reasoning, expose the reasoning parameter
			if (model.providers.some((p: any) => p?.reasoning)) {
				if (!params.includes("reasoning")) {
					params.push("reasoning");
				}
			}
			return params;
		}
	}

	// If no provider has explicit supported parameters, return defaults
	const params = [...defaultCommonParams];
	if (model.providers.some((p: any) => p?.reasoning)) {
		params.push("reasoning");
	}
	return params;
}
