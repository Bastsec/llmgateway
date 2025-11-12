export interface FeeBreakdown {
	baseAmount: number;
	providerFee: number;
	internationalFee: number;
	planFee: number;
	totalFees: number;
	totalAmount: number;
	paymentProvider: PaymentProvider;
}

export type PaymentProvider = "stripe" | "paystack";
export type PaymentChannel = "card" | "mobile_money";

export interface FeeCalculationInput {
	amount: number;
	organizationPlan: "free" | "pro";
	paymentProvider?: PaymentProvider;
	cardCountry?: string;
	channel?: PaymentChannel;
}

const STRIPE_FIXED_FEE = 0.35;
const STRIPE_PERCENTAGE_FEE = 0.029;
const STRIPE_INTERNATIONAL_FEE_PERCENTAGE = 0.015;

const PAYSTACK_CARD_FIXED_FEE = 10;
const PAYSTACK_CARD_PERCENTAGE_FEE = 0.035;
const PAYSTACK_MOBILE_MONEY_PERCENTAGE_FEE = 0.015;

const FREE_PLAN_FEE_PERCENTAGE = 0.05;

const roundToCents = (value: number) => Math.round(value * 100) / 100;

export function calculateFees(input: FeeCalculationInput): FeeBreakdown {
	const {
		amount,
		organizationPlan,
		paymentProvider = "stripe",
		cardCountry,
		channel = "card",
	} = input;

	let providerFee = 0;
	let internationalFee = 0;

	if (paymentProvider === "stripe") {
		providerFee = STRIPE_FIXED_FEE + amount * STRIPE_PERCENTAGE_FEE;

		const isInternationalCard = cardCountry && cardCountry !== "US";
		internationalFee = isInternationalCard
			? amount * STRIPE_INTERNATIONAL_FEE_PERCENTAGE
			: 0;
	} else if (paymentProvider === "paystack") {
		if (channel === "mobile_money") {
			providerFee = amount * PAYSTACK_MOBILE_MONEY_PERCENTAGE_FEE;
		} else {
			providerFee =
				PAYSTACK_CARD_FIXED_FEE + amount * PAYSTACK_CARD_PERCENTAGE_FEE;
		}
	}

	const planFee =
		organizationPlan === "free" ? amount * FREE_PLAN_FEE_PERCENTAGE : 0;

	const totalFees = providerFee + internationalFee + planFee;
	const totalAmount = amount + totalFees;

	return {
		baseAmount: amount,
		providerFee: roundToCents(providerFee),
		internationalFee: roundToCents(internationalFee),
		planFee: roundToCents(planFee),
		totalFees: roundToCents(totalFees),
		totalAmount: roundToCents(totalAmount),
		paymentProvider,
	};
}
