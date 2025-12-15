import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { logger } from "@llmgateway/logger";

import {
	coercePaystackMetadata,
	recordFailedPaystackCharge,
	recordSuccessfulPaystackCharge,
	verifyPaystackSignature,
	type PaystackAuthorization,
	type PaystackChargeMetadata,
	type PaystackEvent,
} from "./lib/paystack.js";

import type { ServerTypes } from "./vars.js";

export const paystackRoutes = new OpenAPIHono<ServerTypes>();

const webhookRoute = createRoute({
	method: "post",
	path: "/webhook",
	request: {},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						received: z.boolean(),
					}),
				},
			},
			description: "Webhook receipt acknowledgement",
		},
	},
});

paystackRoutes.openapi(webhookRoute, async (c) => {
	const signature = c.req.header("x-paystack-signature") ?? null;
	const rawBody = await c.req.raw.text();

	if (!verifyPaystackSignature(signature, rawBody)) {
		throw new HTTPException(400, {
			message: "Invalid Paystack signature",
		});
	}

	let event: PaystackEvent;
	try {
		event = JSON.parse(rawBody) as PaystackEvent;
	} catch (error) {
		logger.error("Failed to parse Paystack webhook", error as Error);
		throw new HTTPException(400, {
			message: "Malformed Paystack webhook payload",
		});
	}

	switch (event.event) {
		case "charge.success":
			await handleChargeSuccess(event.data);
			break;
		case "charge.failed":
		case "charge.abandoned":
			await handleChargeFailure(event.data);
			break;
		default:
			logger.info(`Unhandled Paystack event: ${event.event}`);
	}

	return c.json({ received: true });
});

interface ChargeEventData {
	amount: number;
	reference: string;
	currency: string;
	metadata?: Record<string, unknown> | string | null;
	authorization?: PaystackAuthorization;
}

async function handleChargeSuccess(data: ChargeEventData) {
	const metadata = coercePaystackMetadata(
		data.metadata,
	) as PaystackChargeMetadata;
	const organizationId = metadata.organizationId;
	const transactionId = metadata.transactionId;

	if (!organizationId || !transactionId) {
		logger.error(
			"Paystack charge success missing organizationId or transactionId",
			{
				metadata,
			},
		);
		return;
	}

	const feeBreakdown = metadata.feeBreakdown;
	const amountPaid = feeBreakdown?.totalAmount ?? data.amount / 100;
	const creditAmount =
		metadata.baseAmount ??
		feeBreakdown?.baseAmount ??
		feeBreakdown?.totalAmount ??
		amountPaid;

	await recordSuccessfulPaystackCharge({
		organizationId,
		transactionId,
		amountPaid,
		creditAmount,
		currency: (data.currency || "USD").toUpperCase(),
		reference: data.reference,
		authorization: data.authorization,
		metadata,
	});
}

async function handleChargeFailure(data: ChargeEventData) {
	const metadata = coercePaystackMetadata(
		data.metadata,
	) as PaystackChargeMetadata;
	const organizationId = metadata.organizationId;
	const transactionId = metadata.transactionId;

	if (!organizationId || !transactionId) {
		logger.error(
			"Paystack charge failure missing organizationId or transactionId",
			{
				metadata,
			},
		);
		return;
	}

	await recordFailedPaystackCharge(
		organizationId,
		transactionId,
		data.reference,
	);
}
