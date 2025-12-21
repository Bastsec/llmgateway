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

const STRIPE_FIXED_FEE = 0.3;
const STRIPE_PERCENTAGE_FEE = 0.029;
const STRIPE_INTERNATIONAL_FEE_PERCENTAGE = 0.015;

const PAYSTACK_CARD_FIXED_FEE = 10;
const PAYSTACK_CARD_PERCENTAGE_FEE = 0.035;
const PAYSTACK_MOBILE_MONEY_PERCENTAGE_FEE = 0.015;

const FREE_PLAN_FEE_PERCENTAGE = 0.05;
const PRO_PLAN_FEE_PERCENTAGE = 0.01;

const roundToCents = (value: number) => Math.round(value * 100) / 100;

export function calculateFees(input: FeeCalculationInput): FeeBreakdown {
	const {
		amount,
		organizationPlan,
		paymentProvider = "stripe",
		cardCountry,
		channel = "card",
	} = input;

	const isInternationalCard = cardCountry && cardCountry !== "US";
	const planFeePercentage =
		organizationPlan === "free"
			? FREE_PLAN_FEE_PERCENTAGE
			: PRO_PLAN_FEE_PERCENTAGE;

	let providerFixedFee = 0;
	let providerPercentageFee = 0;
	let internationalPercentageFee = 0;

	if (paymentProvider === "stripe") {
		providerFixedFee = STRIPE_FIXED_FEE;
		providerPercentageFee = STRIPE_PERCENTAGE_FEE;
		internationalPercentageFee = isInternationalCard
			? STRIPE_INTERNATIONAL_FEE_PERCENTAGE
			: 0;
	} else {
		if (channel === "mobile_money") {
			providerFixedFee = 0;
			providerPercentageFee = PAYSTACK_MOBILE_MONEY_PERCENTAGE_FEE;
		} else {
			providerFixedFee = PAYSTACK_CARD_FIXED_FEE;
			providerPercentageFee = PAYSTACK_CARD_PERCENTAGE_FEE;
		}
		internationalPercentageFee = 0;
	}

	const totalPercentageFees =
		providerPercentageFee + internationalPercentageFee + planFeePercentage;

	const totalAmount = (amount + providerFixedFee) / (1 - totalPercentageFees);

	const providerFee = totalAmount * providerPercentageFee + providerFixedFee;
	const internationalFee = totalAmount * internationalPercentageFee;
	const planFee = totalAmount * planFeePercentage;
	const totalFees = providerFee + internationalFee + planFee;

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
