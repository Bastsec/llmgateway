/**
 * Helper function to transform standard OpenAI streaming format
 */
export function transformOpenaiStreaming(data: any, usedModel: string): any {
	// Helper to transform delta and normalize reasoning_content to reasoning
	const transformDelta = (delta: any): any => {
		if (!delta) {
			return delta;
		}

		const newDelta = {
			...delta,
			role: delta.role || "assistant",
		};

		// Normalize reasoning_content field to reasoning for OpenAI compatibility
		if (newDelta.reasoning_content) {
			const { reasoning_content, ...rest } = newDelta;
			return {
				...rest,
				reasoning: reasoning_content,
			};
		}

		return newDelta;
	};

	// Transform choices if they exist
	const transformedChoices = data.choices
		? data.choices.map((choice: any) => ({
				...choice,
				delta: transformDelta(choice.delta),
			}))
		: null;

	// If we don't have proper structure, build it
	if (!data.id || !transformedChoices) {
		const delta = data.delta
			? transformDelta(data.delta)
			: transformDelta({
					content: data.content || "",
					tool_calls: data.tool_calls || null,
				});

		return {
			id: data.id || `chatcmpl-${Date.now()}`,
			object: "chat.completion.chunk",
			created: data.created || Math.floor(Date.now() / 1000),
			model: data.model || usedModel,
			choices: [
				{
					index: 0,
					delta,
					finish_reason: data.finish_reason || null,
				},
			],
			usage: data.usage || null,
		};
	}

	// Return with transformed choices and ensure object field is set
	return {
		...data,
		object: "chat.completion.chunk",
		choices: transformedChoices,
	};
}
