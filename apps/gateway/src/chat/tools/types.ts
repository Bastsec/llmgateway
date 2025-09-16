export const DEFAULT_TOKENIZER_MODEL = "gpt-4";

// Define ChatMessage type to match what gpt-tokenizer expects
export interface ChatMessage {
	role: "user" | "system" | "assistant" | undefined;
	content: string;
	name?: string;
}

// Define OpenAI-compatible image object type
export interface ImageObject {
	type: "image_url";
	image_url: {
		url: string;
	};
}

// Define streaming delta object type
export interface StreamingDelta {
	role?: "assistant";
	content?: string;
	images?: ImageObject[];
}
