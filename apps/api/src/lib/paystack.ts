import crypto from "node:crypto";

import { and, eq, ne, sql, tables, db } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

import { httpClient } from "./http-client.js";

import type { FeeBreakdown, PaymentChannel } from "@llmgateway/shared";

const DEFAULT_PAYSTACK_BASE_URL = "https://api.paystack.co";

const PAYSTACK_BASE_URL =
	process.env.PAYSTACK_API_URL ?? DEFAULT_PAYSTACK_BASE_URL;
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_WEBHOOK_SECRET =
	process.env.PAYSTACK_WEBHOOK_SECRET ?? PAYSTACK_SECRET_KEY;

if (!PAYSTACK_BASE_URL.startsWith("http")) {
	throw new Error("PAYSTACK_API_URL must be a valid http(s) URL");
}

interface PaystackResponse<T> {
	status: boolean;
	message: string;
	data: T;
}

interface PaystackCustomer {
	customer_code: string;
	email: string;
	first_name?: string;
	last_name?: string;
	id: number;
}

interface PaystackInitializeData {
	authorization_url: string;
	access_code: string;
	reference: string;
	status: string;
}

interface PaystackChargeResponse {
	status: string;
	message: string;
	reference: string;
	amount: number;
	currency: string;
	metadata?: Record<string, unknown> | string | null;
	authorization?: PaystackAuthorization;
	customer?: {
		email?: string;
		customer_code?: string;
		id: number;
	};
}

export interface PaystackAuthorization {
	authorization_code?: string;
	bin?: string;
	last4?: string;
	exp_month?: string;
	exp_year?: string;
	channel?: string;
	card_type?: string;
	bank?: string;
	country_code?: string;
	signature?: string;
	reusable?: boolean;
	brand?: string;
}

export interface PaystackChargeMetadata {
	organizationId: string;
	transactionId: string;
	baseAmount?: number;
	feeBreakdown?: FeeBreakdown;
	savePaymentMethod?: boolean;
	makeDefault?: boolean;
	paymentMethodId?: string;
	channel?: PaymentChannel;
	userId?: string;
	initiatedBy?: string;
	[topLevel: string]: unknown;
}

export interface PaystackEvent<T = any> {
	event: string;
	data: T;
}

interface PaystackRequestOptions {
	method?: string;
	body?: Record<string, unknown>;
	timeout?: number;
}

async function paystackRequest<T>(
	path: string,
	{ method = "GET", body, timeout }: PaystackRequestOptions = {},
): Promise<T> {
	if (!PAYSTACK_SECRET_KEY) {
		throw new Error(
			"PAYSTACK_SECRET_KEY is not configured. Set it in the environment before attempting Paystack requests.",
		);
	}

	const url = new URL(path, PAYSTACK_BASE_URL).toString();

	const response = await httpClient(url, {
		method,
		timeout,
		headers: {
			Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
			Accept: "application/json",
		},
		body,
	});

	let payload: PaystackResponse<T>;
	try {
		payload = (await response.json()) as PaystackResponse<T>;
	} catch (error) {
		logger.error("Failed to parse Paystack response", error as Error);
		throw new Error("Unable to parse Paystack response body");
	}

	if (!response.ok || !payload.status) {
		const message =
			payload?.message || `Paystack request failed (${response.status})`;
		logger.error("Paystack request failed", {
			status: response.status,
			message,
			path,
			body,
		});
		throw new Error(message);
	}

	return payload.data;
}

function normaliseMetadata(
	metadata: Record<string, unknown> | string | null | undefined,
): PaystackChargeMetadata | Record<string, unknown> {
	if (!metadata) {
		return {};
	}

	if (typeof metadata === "string") {
		try {
			return JSON.parse(metadata) as Record<string, unknown>;
		} catch (error) {
			logger.warn("Failed to parse Paystack metadata", error as Error);
			return {};
		}
	}

	return metadata;
}

export async function ensurePaystackCustomer(
	organizationId: string,
	options: { email?: string; name?: string } = {},
): Promise<string> {
	const organization = await db.query.organization.findFirst({
		where: {
			id: organizationId,
		},
	});

	if (!organization) {
		throw new Error(`Organization not found: ${organizationId}`);
	}

	let paystackCustomerId = organization.paystackCustomerId ?? undefined;
	const customerEmail = options.email ?? organization.billingEmail;
	const customerName = options.name ?? organization.name;

	if (!paystackCustomerId) {
		const [firstName, ...rest] = customerName.split(" ");
		const lastName = rest.join(" ") || undefined;

		const data = await paystackRequest<PaystackCustomer>("/customer", {
			method: "POST",
			body: {
				email: customerEmail,
				first_name: firstName,
				last_name: lastName,
				metadata: {
					organizationId,
				},
			},
		});

		paystackCustomerId = data.customer_code;

		await db
			.update(tables.organization)
			.set({
				paystackCustomerId,
			})
			.where(eq(tables.organization.id, organizationId));
	} else {
		try {
			await paystackRequest(`/customer/${paystackCustomerId}`, {
				method: "PUT",
				body: {
					email: customerEmail,
					metadata: {
						organizationId,
					},
				},
			});
		} catch (error) {
			logger.warn("Failed to update Paystack customer", error as Error);
		}
	}

	return paystackCustomerId;
}

interface InitializeTransactionParams {
	amount: number;
	feeBreakdown: FeeBreakdown;
	email: string;
	organizationId: string;
	transactionId: string;
	metadata: PaystackChargeMetadata;
	channel?: PaymentChannel;
	customerCode?: string;
	currency?: string;
}

export async function initializePaystackTransaction({
	amount: _amount,
	feeBreakdown,
	email,
	organizationId,
	transactionId,
	metadata,
	channel,
	customerCode,
	currency = "USD",
}: InitializeTransactionParams): Promise<PaystackInitializeData> {
	const totalAmountMinor = Math.round(feeBreakdown.totalAmount * 100);

	const payload: Record<string, unknown> = {
		email,
		amount: totalAmountMinor,
		currency,
		metadata: {
			...metadata,
			organizationId,
			transactionId,
			baseAmount: feeBreakdown.baseAmount,
			feeBreakdown,
		},
		reference: metadata.transactionId ?? transactionId,
	};

	if (channel) {
		payload.channels = [channel];
	}

	if (customerCode) {
		payload.customer = customerCode;
	}

	return await paystackRequest<PaystackInitializeData>(
		"/transaction/initialize",
		{
			method: "POST",
			body: payload,
		},
	);
}

interface ChargeAuthorizationParams {
	amount: number;
	feeBreakdown: FeeBreakdown;
	email: string;
	authorizationCode: string;
	organizationId: string;
	transactionId: string;
	metadata: PaystackChargeMetadata;
	currency?: string;
}

export async function chargePaystackAuthorization({
	amount: _amount,
	feeBreakdown,
	email,
	authorizationCode,
	organizationId,
	transactionId,
	metadata,
	currency = "USD",
}: ChargeAuthorizationParams): Promise<PaystackChargeResponse> {
	const totalAmountMinor = Math.round(feeBreakdown.totalAmount * 100);

	const payload: Record<string, unknown> = {
		email,
		amount: totalAmountMinor,
		currency,
		authorization_code: authorizationCode,
		metadata: {
			...metadata,
			organizationId,
			transactionId,
			baseAmount: feeBreakdown.baseAmount,
			feeBreakdown,
		},
		reference: metadata.transactionId ?? transactionId,
	};

	return await paystackRequest<PaystackChargeResponse>(
		"/transaction/charge_authorization",
		{
			method: "POST",
			body: payload,
		},
	);
}

export function verifyPaystackSignature(
	signature: string | null,
	rawBody: string,
): boolean {
	if (!PAYSTACK_WEBHOOK_SECRET) {
		logger.warn(
			"PAYSTACK_WEBHOOK_SECRET is not configured; webhook verification skipped.",
		);
		return true;
	}

	if (!signature) {
		logger.warn("Missing Paystack signature header");
		return false;
	}

	const expected = crypto
		.createHmac("sha512", PAYSTACK_WEBHOOK_SECRET)
		.update(rawBody)
		.digest("hex");

	return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

interface SuccessfulChargeParams {
	organizationId: string;
	transactionId: string;
	amountPaid: number;
	creditAmount: number;
	currency: string;
	reference: string;
	authorization?: PaystackAuthorization;
	metadata: PaystackChargeMetadata;
}

export async function recordSuccessfulPaystackCharge({
	organizationId,
	transactionId,
	amountPaid,
	creditAmount,
	currency,
	reference,
	authorization,
	metadata,
}: SuccessfulChargeParams): Promise<void> {
	await db.transaction(async (tx) => {
		const updated = await tx
			.update(tables.transaction)
			.set({
				status: "completed",
				amount: amountPaid.toString(),
				creditAmount: creditAmount.toString(),
				currency,
				paystackReference: reference,
				provider: "paystack",
			})
			.where(
				and(
					eq(tables.transaction.id, transactionId),
					ne(tables.transaction.status, "completed"),
				),
			)
			.returning({
				id: tables.transaction.id,
			});

		if (updated.length === 0) {
			logger.info("Paystack charge already recorded; skipping", {
				organizationId,
				transactionId,
				reference,
			});
			return;
		}

		await tx
			.update(tables.organization)
			.set({
				credits: sql`${tables.organization.credits} + ${creditAmount}`,
			})
			.where(eq(tables.organization.id, organizationId));

		const saveMethod = Boolean(metadata.savePaymentMethod);
		const authCode = authorization?.authorization_code;

		if (saveMethod && authCode) {
			const existing = await tx.query.paymentMethod.findFirst({
				where: {
					organizationId,
					paystackAuthorizationCode: authCode,
				},
			});

			const cardBrand =
				authorization?.brand || authorization?.card_type || authorization?.bank;
			const last4 = authorization?.last4 ?? null;
			const paymentType = authorization?.channel ?? "card";

			const makeDefault = Boolean(metadata.makeDefault);

			if (existing) {
				await tx
					.update(tables.paymentMethod)
					.set({
						cardBrand,
						cardLast4: last4,
						isDefault: makeDefault ? true : existing.isDefault,
						updatedAt: new Date(),
					})
					.where(eq(tables.paymentMethod.id, existing.id));
			} else {
				if (makeDefault) {
					await tx
						.update(tables.paymentMethod)
						.set({ isDefault: false })
						.where(eq(tables.paymentMethod.organizationId, organizationId));
				}

				await tx.insert(tables.paymentMethod).values({
					organizationId,
					provider: "paystack",
					type: paymentType,
					paystackAuthorizationCode: authCode,
					cardBrand,
					cardLast4: last4,
					isDefault: makeDefault,
				});
			}
		}
	});
}

export async function recordFailedPaystackCharge(
	organizationId: string,
	transactionId: string,
	reference: string,
): Promise<void> {
	await db
		.update(tables.transaction)
		.set({
			status: "failed",
			paystackReference: reference,
			provider: "paystack",
		})
		.where(
			and(
				eq(tables.transaction.id, transactionId),
				ne(tables.transaction.status, "completed"),
			),
		);
}

export function coercePaystackMetadata(
	metadata: Record<string, unknown> | string | null | undefined,
): PaystackChargeMetadata {
	const raw = normaliseMetadata(metadata);
	return raw as PaystackChargeMetadata;
}
