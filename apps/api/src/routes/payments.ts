import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import Stripe from "stripe";
import { z } from "zod";

import {
	ensurePaystackCustomer,
	initializePaystackTransaction,
	chargePaystackAuthorization,
	recordSuccessfulPaystackCharge,
	recordFailedPaystackCharge,
	coercePaystackMetadata,
	type PaystackChargeMetadata,
} from "@/lib/paystack.js";
import { ensureStripeCustomer } from "@/stripe.js";

import { db, eq, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import { calculateFees } from "@llmgateway/shared";

import type { ServerTypes } from "@/vars.js";

export const stripe = new Stripe(
	process.env.STRIPE_SECRET_KEY || "sk_test_123",
	{
		apiVersion: "2025-04-30.basil",
	},
);

export const payments = new OpenAPIHono<ServerTypes>();

const feeBreakdownSchema = z.object({
	baseAmount: z.number(),
	providerFee: z.number(),
	internationalFee: z.number(),
	planFee: z.number(),
	totalFees: z.number(),
	totalAmount: z.number(),
	paymentProvider: z.enum(["stripe", "paystack"]),
});

const createPaymentIntent = createRoute({
	method: "post",
	path: "/create-payment-intent",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						amount: z.number().int().min(5),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						clientSecret: z.string(),
					}),
				},
			},
			description: "Payment intent created successfully",
		},
	},
});

payments.openapi(createPaymentIntent, async (c) => {
	const user = c.get("user");

	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}
	const { amount } = c.req.valid("json");

	const userOrganization = await db.query.userOrganization.findFirst({
		where: {
			userId: user.id,
		},
		with: {
			organization: true,
			user: true,
		},
	});

	if (!userOrganization || !userOrganization.organization) {
		throw new HTTPException(404, {
			message: "Organization not found",
		});
	}

	const organizationId = userOrganization.organization.id;

	const stripeCustomerId = await ensureStripeCustomer(organizationId);

	const feeBreakdown = calculateFees({
		amount,
		organizationPlan: userOrganization.organization.plan,
		paymentProvider: "stripe",
	});

	const paymentIntent = await stripe.paymentIntents.create({
		amount: Math.round(feeBreakdown.totalAmount * 100),
		currency: "usd",
		description: `Credit purchase for ${amount} USD (including fees)`,
		customer: stripeCustomerId,
		metadata: {
			organizationId,
			baseAmount: amount.toString(),
			totalFees: feeBreakdown.totalFees.toString(),
			userEmail: user.email,
			userId: user.id,
		},
	});

	return c.json({
		clientSecret: paymentIntent.client_secret || "",
	});
});

const createSetupIntent = createRoute({
	method: "post",
	path: "/create-setup-intent",
	request: {},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						clientSecret: z.string(),
					}),
				},
			},
			description: "Setup intent created successfully",
		},
	},
});

payments.openapi(createSetupIntent, async (c) => {
	const user = c.get("user");

	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const userOrganization = await db.query.userOrganization.findFirst({
		where: {
			userId: user.id,
		},
		with: {
			organization: true,
			user: true,
		},
	});

	if (!userOrganization || !userOrganization.organization) {
		throw new HTTPException(404, {
			message: "Organization not found",
		});
	}

	const organizationId = userOrganization.organization.id;

	const setupIntent = await stripe.setupIntents.create({
		usage: "off_session",
		metadata: {
			organizationId,
		},
	});

	return c.json({
		clientSecret: setupIntent.client_secret || "",
	});
});

const getPaymentMethods = createRoute({
	method: "get",
	path: "/payment-methods",
	request: {},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						paymentMethods: z.array(
							z.object({
								id: z.string(),
								provider: z.enum(["stripe", "paystack"]),
								stripePaymentMethodId: z.string().nullable(),
								paystackAuthorizationCode: z.string().nullable(),
								type: z.string(),
								isDefault: z.boolean(),
								cardBrand: z.string().nullable(),
								cardLast4: z.string().nullable(),
								expiryMonth: z.number().nullable(),
								expiryYear: z.number().nullable(),
							}),
						),
					}),
				},
			},
			description: "Payment methods retrieved successfully",
		},
	},
});

payments.openapi(getPaymentMethods, async (c) => {
	const user = c.get("user");

	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const userOrganization = await db.query.userOrganization.findFirst({
		where: {
			userId: user.id,
		},
		with: {
			organization: true,
		},
	});

	if (!userOrganization || !userOrganization.organization) {
		throw new HTTPException(404, {
			message: "Organization not found",
		});
	}

	const organizationId = userOrganization.organization.id;

	const paymentMethods = await db.query.paymentMethod.findMany({
		where: {
			organizationId,
		},
	});

	const enhancedPaymentMethods = await Promise.all(
		paymentMethods.map(async (pm) => {
			if (pm.provider === "stripe" && pm.stripePaymentMethodId) {
				try {
					const stripePaymentMethod = await stripe.paymentMethods.retrieve(
						pm.stripePaymentMethodId,
					);

					const stripeCard =
						stripePaymentMethod.type === "card"
							? stripePaymentMethod.card
							: null;

					return {
						id: pm.id,
						provider: pm.provider,
						stripePaymentMethodId: pm.stripePaymentMethodId,
						paystackAuthorizationCode: null,
						type: pm.type,
						isDefault: pm.isDefault,
						cardBrand: stripeCard?.brand ?? pm.cardBrand ?? null,
						cardLast4: stripeCard?.last4 ?? pm.cardLast4 ?? null,
						expiryMonth: stripeCard?.exp_month ?? null,
						expiryYear: stripeCard?.exp_year ?? null,
					};
				} catch (error) {
					logger.warn(
						"Failed to retrieve Stripe payment method",
						error as Error,
					);
					return {
						id: pm.id,
						provider: pm.provider,
						stripePaymentMethodId: pm.stripePaymentMethodId,
						paystackAuthorizationCode: null,
						type: pm.type,
						isDefault: pm.isDefault,
						cardBrand: pm.cardBrand ?? null,
						cardLast4: pm.cardLast4 ?? null,
						expiryMonth: null,
						expiryYear: null,
					};
				}
			}

			const fallbackBrand =
				pm.cardBrand ||
				(pm.type === "mobile_money" ? "Mobile Money" : pm.type.toUpperCase());

			return {
				id: pm.id,
				provider: pm.provider,
				stripePaymentMethodId: pm.stripePaymentMethodId ?? null,
				paystackAuthorizationCode: pm.paystackAuthorizationCode ?? null,
				type: pm.type,
				isDefault: pm.isDefault,
				cardBrand: fallbackBrand ?? null,
				cardLast4: pm.cardLast4 ?? null,
				expiryMonth: null,
				expiryYear: null,
			};
		}),
	);

	return c.json({
		paymentMethods: enhancedPaymentMethods,
	});
});

const setDefaultPaymentMethod = createRoute({
	method: "post",
	path: "/payment-methods/default",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						paymentMethodId: z.string(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
					}),
				},
			},
			description: "Default payment method set successfully",
		},
	},
});

payments.openapi(setDefaultPaymentMethod, async (c) => {
	const user = c.get("user");

	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { paymentMethodId } = c.req.valid("json");

	const userOrganization = await db.query.userOrganization.findFirst({
		where: {
			userId: user.id,
		},
		with: {
			organization: true,
		},
	});

	if (!userOrganization || !userOrganization.organization) {
		throw new HTTPException(404, {
			message: "Organization not found",
		});
	}

	const organizationId = userOrganization.organization.id;

	const paymentMethod = await db.query.paymentMethod.findFirst({
		where: {
			id: paymentMethodId,
			organizationId,
		},
	});

	if (!paymentMethod) {
		throw new HTTPException(404, {
			message: "Payment method not found",
		});
	}

	if (paymentMethod.provider !== "stripe") {
		throw new HTTPException(400, {
			message: "Only Stripe payment methods are supported for saved top-ups",
		});
	}

	if (!paymentMethod.stripePaymentMethodId) {
		throw new HTTPException(400, {
			message: "Stripe payment method identifier missing",
		});
	}

	await db
		.update(tables.paymentMethod)
		.set({
			isDefault: false,
		})
		.where(eq(tables.paymentMethod.organizationId, organizationId));

	await db
		.update(tables.paymentMethod)
		.set({
			isDefault: true,
		})
		.where(eq(tables.paymentMethod.id, paymentMethodId));

	return c.json({
		success: true,
	});
});

const deletePaymentMethod = createRoute({
	method: "delete",
	path: "/payment-methods/{id}",
	request: {
		params: z.object({
			id: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
					}),
				},
			},
			description: "Payment method deleted successfully",
		},
	},
});

payments.openapi(deletePaymentMethod, async (c) => {
	const user = c.get("user");

	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { id } = c.req.param();

	const userOrganization = await db.query.userOrganization.findFirst({
		where: {
			userId: user.id,
		},
		with: {
			organization: true,
		},
	});

	if (!userOrganization || !userOrganization.organization) {
		throw new HTTPException(404, {
			message: "Organization not found",
		});
	}

	const organizationId = userOrganization.organization.id;

	const paymentMethod = await db.query.paymentMethod.findFirst({
		where: {
			id,
			organizationId,
		},
	});

	if (!paymentMethod) {
		throw new HTTPException(404, {
			message: "Payment method not found",
		});
	}

	if (
		paymentMethod.provider === "stripe" &&
		paymentMethod.stripePaymentMethodId
	) {
		await stripe.paymentMethods.detach(paymentMethod.stripePaymentMethodId);
	}

	await db.delete(tables.paymentMethod).where(eq(tables.paymentMethod.id, id));

	return c.json({
		success: true,
	});
});

const topUpWithSavedMethod = createRoute({
	method: "post",
	path: "/top-up-with-saved-method",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						amount: z.number().int().min(5),
						paymentMethodId: z.string(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
					}),
				},
			},
			description: "Payment processed successfully",
		},
	},
});

payments.openapi(topUpWithSavedMethod, async (c) => {
	const user = c.get("user");

	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const {
		amount,
		paymentMethodId,
	}: { amount: number; paymentMethodId: string } = c.req.valid("json");

	const paymentMethod = await db.query.paymentMethod.findFirst({
		where: {
			id: paymentMethodId,
		},
	});

	if (!paymentMethod) {
		throw new HTTPException(404, {
			message: "Payment method not found",
		});
	}

	if (
		paymentMethod.provider !== "stripe" ||
		!paymentMethod.stripePaymentMethodId
	) {
		throw new HTTPException(400, {
			message: "Only Stripe payment methods are supported for saved top-ups",
		});
	}

	const userOrganization = await db.query.userOrganization.findFirst({
		where: {
			userId: user.id,
		},
		with: {
			organization: true,
		},
	});

	if (
		!userOrganization ||
		!userOrganization.organization ||
		userOrganization.organization.id !== paymentMethod.organizationId
	) {
		throw new HTTPException(403, {
			message: "Unauthorized access to payment method",
		});
	}

	const stripeCustomerId = userOrganization.organization.stripeCustomerId;

	if (!stripeCustomerId) {
		throw new HTTPException(400, {
			message: "No Stripe customer ID found for this organization",
		});
	}

	const stripePaymentMethod = await stripe.paymentMethods.retrieve(
		paymentMethod.stripePaymentMethodId,
	);

	const cardCountry = stripePaymentMethod.card?.country || undefined;

	const feeBreakdown = calculateFees({
		amount,
		organizationPlan: userOrganization.organization.plan,
		cardCountry,
		paymentProvider: "stripe",
	});

	const paymentIntent = await stripe.paymentIntents.create({
		amount: Math.round(feeBreakdown.totalAmount * 100),
		currency: "usd",
		description: `Credit purchase for ${amount} USD (including fees)`,
		payment_method: paymentMethod.stripePaymentMethodId,
		customer: stripeCustomerId,
		confirm: true,
		off_session: true,
		metadata: {
			organizationId: userOrganization.organization.id,
			baseAmount: amount.toString(),
			totalFees: feeBreakdown.totalFees.toString(),
			userEmail: user.email,
			userId: user.id,
		},
	});

	if (paymentIntent.status !== "succeeded") {
		throw new HTTPException(400, {
			message: `Payment failed: ${paymentIntent.status}`,
		});
	}

	return c.json({
		success: true,
	});
});

const initializePaystackTopUp = createRoute({
	method: "post",
	path: "/paystack/initialize-topup",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						amount: z.number().int().min(5),
						channel: z.enum(["card", "mobile_money"]).optional(),
						savePaymentMethod: z.boolean().optional(),
						makeDefault: z.boolean().optional(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						authorizationUrl: z.string().url(),
						reference: z.string(),
						accessCode: z.string(),
						feeBreakdown: feeBreakdownSchema,
					}),
				},
			},
			description: "Initialized Paystack transaction",
		},
	},
});

payments.openapi(initializePaystackTopUp, async (c) => {
	const user = c.get("user");

	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	if (!process.env.PAYSTACK_SECRET_KEY) {
		throw new HTTPException(400, {
			message: "Paystack is not configured",
		});
	}

	const {
		amount,
		channel,
		savePaymentMethod = false,
		makeDefault = false,
	} = c.req.valid("json");

	const userOrganization = await db.query.userOrganization.findFirst({
		where: {
			userId: user.id,
		},
		with: {
			organization: true,
		},
	});

	if (!userOrganization || !userOrganization.organization) {
		throw new HTTPException(404, {
			message: "Organization not found",
		});
	}

	const organization = userOrganization.organization;

	const feeBreakdown = calculateFees({
		amount,
		organizationPlan: organization.plan,
		paymentProvider: "paystack",
		channel,
	});

	const paystackCustomerCode = await ensurePaystackCustomer(organization.id, {
		email: organization.billingEmail ?? user.email,
		name: organization.name,
	});

	const [transaction] = await db
		.insert(tables.transaction)
		.values({
			organizationId: organization.id,
			type: "credit_topup",
			amount: feeBreakdown.totalAmount.toString(),
			creditAmount: feeBreakdown.baseAmount.toString(),
			currency: "USD",
			provider: "paystack",
			status: "pending",
			description: `Paystack top-up initialization by ${user.email}`,
		})
		.returning({
			id: tables.transaction.id,
		});

	const metadata: PaystackChargeMetadata = {
		organizationId: organization.id,
		transactionId: transaction.id,
		baseAmount: feeBreakdown.baseAmount,
		feeBreakdown,
		savePaymentMethod,
		makeDefault,
		channel,
		userId: user.id,
		initiatedBy: user.email,
	};

	try {
		const initialization = await initializePaystackTransaction({
			amount,
			feeBreakdown,
			email: user.email,
			organizationId: organization.id,
			transactionId: transaction.id,
			metadata,
			channel,
			customerCode: paystackCustomerCode,
			currency: "USD",
		});

		await db
			.update(tables.transaction)
			.set({
				paystackReference: initialization.reference,
				description: `Paystack top-up pending (${initialization.reference})`,
			})
			.where(eq(tables.transaction.id, transaction.id));

		return c.json({
			authorizationUrl: initialization.authorization_url,
			reference: initialization.reference,
			accessCode: initialization.access_code,
			feeBreakdown,
		});
	} catch (error) {
		await recordFailedPaystackCharge(organization.id, transaction.id, "");
		logger.error("Failed to initialize Paystack transaction", error as Error);
		throw new HTTPException(400, {
			message: "Failed to initialize Paystack transaction",
		});
	}
});

const paystackTopUpWithSavedMethod = createRoute({
	method: "post",
	path: "/paystack/top-up-with-saved-method",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						amount: z.number().int().min(5),
						paymentMethodId: z.string(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						reference: z.string(),
						feeBreakdown: feeBreakdownSchema,
					}),
				},
			},
			description: "Charged Paystack saved payment method",
		},
	},
});

payments.openapi(paystackTopUpWithSavedMethod, async (c) => {
	const user = c.get("user");

	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	if (!process.env.PAYSTACK_SECRET_KEY) {
		throw new HTTPException(400, {
			message: "Paystack is not configured",
		});
	}

	const { amount, paymentMethodId } = c.req.valid("json");

	const userOrganization = await db.query.userOrganization.findFirst({
		where: {
			userId: user.id,
		},
		with: {
			organization: true,
			user: true,
		},
	});

	if (!userOrganization || !userOrganization.organization) {
		throw new HTTPException(404, {
			message: "Organization not found",
		});
	}

	const organization = userOrganization.organization;

	const paymentMethod = await db.query.paymentMethod.findFirst({
		where: {
			id: paymentMethodId,
			organizationId: organization.id,
		},
	});

	if (!paymentMethod) {
		throw new HTTPException(404, {
			message: "Payment method not found",
		});
	}

	if (
		paymentMethod.provider !== "paystack" ||
		!paymentMethod.paystackAuthorizationCode
	) {
		throw new HTTPException(400, {
			message: "Only Paystack payment methods are supported by this route",
		});
	}

	const feeBreakdown = calculateFees({
		amount,
		organizationPlan: organization.plan,
		paymentProvider: "paystack",
		channel: paymentMethod.type === "mobile_money" ? "mobile_money" : "card",
	});

	const [transaction] = await db
		.insert(tables.transaction)
		.values({
			organizationId: organization.id,
			type: "credit_topup",
			amount: feeBreakdown.totalAmount.toString(),
			creditAmount: feeBreakdown.baseAmount.toString(),
			currency: "USD",
			provider: "paystack",
			status: "pending",
			description: `Paystack saved method top-up by ${user.email}`,
		})
		.returning({
			id: tables.transaction.id,
		});

	const metadata: PaystackChargeMetadata = {
		organizationId: organization.id,
		transactionId: transaction.id,
		baseAmount: feeBreakdown.baseAmount,
		feeBreakdown,
		paymentMethodId,
		channel: paymentMethod.type === "mobile_money" ? "mobile_money" : "card",
		userId: user.id,
		initiatedBy: user.email,
	};

	try {
		const charge = await chargePaystackAuthorization({
			amount,
			feeBreakdown,
			email: user.email,
			authorizationCode: paymentMethod.paystackAuthorizationCode,
			organizationId: organization.id,
			transactionId: transaction.id,
			metadata,
			currency: "USD",
		});

		const mergedMetadata = {
			...metadata,
			...coercePaystackMetadata(charge.metadata),
		} as PaystackChargeMetadata;

		await recordSuccessfulPaystackCharge({
			organizationId: organization.id,
			transactionId: transaction.id,
			amountPaid: feeBreakdown.totalAmount,
			creditAmount: feeBreakdown.baseAmount,
			currency: (charge.currency || "USD").toUpperCase(),
			reference: charge.reference,
			authorization: charge.authorization,
			metadata: mergedMetadata,
		});

		return c.json({
			success: true,
			reference: charge.reference,
			feeBreakdown,
		});
	} catch (error) {
		await recordFailedPaystackCharge(organization.id, transaction.id, "");
		logger.error("Paystack saved method charge failed", error as Error);
		throw new HTTPException(400, {
			message: "Failed to charge saved Paystack payment method",
		});
	}
});

const calculateFeesRoute = createRoute({
	method: "post",
	path: "/calculate-fees",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						amount: z.number().int().min(5),
						paymentMethodId: z.string().optional(),
						paymentProvider: z.enum(["stripe", "paystack"]).optional(),
						channel: z.enum(["card", "mobile_money"]).optional(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: feeBreakdownSchema,
				},
			},
			description: "Fee calculation completed successfully",
		},
	},
});

payments.openapi(calculateFeesRoute, async (c) => {
	const user = c.get("user");

	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const {
		amount,
		paymentMethodId,
		paymentProvider: paymentProviderOverride,
		channel: channelOverride,
	} = c.req.valid("json");

	const userOrganization = await db.query.userOrganization.findFirst({
		where: {
			userId: user.id,
		},
		with: {
			organization: true,
		},
	});

	if (!userOrganization || !userOrganization.organization) {
		throw new HTTPException(404, {
			message: "Organization not found",
		});
	}

	let cardCountry: string | undefined;
	let paymentProvider: "stripe" | "paystack" =
		paymentProviderOverride ?? "stripe";
	let feeChannel = channelOverride;

	if (paymentMethodId) {
		const paymentMethod = await db.query.paymentMethod.findFirst({
			where: {
				id: paymentMethodId,
				organizationId: userOrganization.organization.id,
			},
		});

		if (
			paymentMethod &&
			paymentMethod.provider === "stripe" &&
			paymentMethod.stripePaymentMethodId
		) {
			try {
				const stripePaymentMethod = await stripe.paymentMethods.retrieve(
					paymentMethod.stripePaymentMethodId,
				);
				cardCountry = stripePaymentMethod.card?.country || undefined;
			} catch {}
		} else if (paymentMethod) {
			paymentProvider = paymentMethod.provider as "stripe" | "paystack";
			if (!feeChannel && paymentMethod.provider === "paystack") {
				feeChannel =
					paymentMethod.type === "mobile_money" ? "mobile_money" : "card";
			}
		}
	}

	const feeBreakdown = calculateFees({
		amount,
		organizationPlan: userOrganization.organization.plan,
		cardCountry,
		paymentProvider,
		channel: feeChannel,
	});

	// Calculate bonus for first-time credit purchases
	let bonusAmount = 0;
	let finalCreditAmount = amount;
	let bonusEnabled = false;
	let bonusEligible = false;
	let bonusIneligibilityReason: string | undefined;

	const bonusMultiplier = process.env.FIRST_TIME_CREDIT_BONUS_MULTIPLIER
		? parseFloat(process.env.FIRST_TIME_CREDIT_BONUS_MULTIPLIER)
		: 0;

	bonusEnabled = bonusMultiplier > 1;

	if (bonusEnabled) {
		// Check email verification
		const dbUser = await db.query.user.findFirst({
			where: {
				id: user.id,
			},
		});

		if (!dbUser?.emailVerified) {
			bonusIneligibilityReason = "email_not_verified";
		} else {
			// Check if this is the first credit purchase
			const previousPurchases = await db.query.transaction.findFirst({
				where: {
					organizationId: { eq: userOrganization.organization.id },
					type: { eq: "credit_topup" },
					status: { eq: "completed" },
				},
			});

			if (previousPurchases) {
				bonusIneligibilityReason = "already_purchased";
			} else {
				// This is the first credit purchase, apply bonus
				bonusEligible = true;
				const potentialBonus = amount * (bonusMultiplier - 1);
				const maxBonus = 50; // Max $50 bonus

				bonusAmount = Math.min(potentialBonus, maxBonus);
				finalCreditAmount = amount + bonusAmount;
			}
		}
	}

	return c.json({
		...feeBreakdown,
		bonusAmount: bonusAmount > 0 ? bonusAmount : undefined,
		finalCreditAmount: bonusAmount > 0 ? finalCreditAmount : undefined,
		bonusEnabled,
		bonusEligible,
		bonusIneligibilityReason,
	});
});
