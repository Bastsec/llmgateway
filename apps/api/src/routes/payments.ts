import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import Stripe from "stripe";
import { z } from "zod";

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
						baseAmount: z.number(),
							providerFee: z.number(),
							internationalFee: z.number(),
							planFee: z.number(),
							totalFees: z.number(),
							totalAmount: z.number(),
							bonusAmount: z.number().optional(),
							finalCreditAmount: z.number().optional(),
							bonusEnabled: z.boolean(),
							bonusEligible: z.boolean(),
							bonusIneligibilityReason: z.string().optional(),
							paymentProvider: z.enum(["stripe", "paystack"]),
						}),
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
	}: { amount: number; paymentMethodId?: string } = c.req.valid("json");

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

	let cardCountry: string | undefined;
	let paymentProvider: "stripe" | "paystack" = "stripe";

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
		}
	}

	const feeBreakdown = calculateFees({
		amount,
		organizationPlan: userOrganization.organization.plan,
		cardCountry,
		paymentProvider,
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
		if (!userOrganization.user || !userOrganization.user.emailVerified) {
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
