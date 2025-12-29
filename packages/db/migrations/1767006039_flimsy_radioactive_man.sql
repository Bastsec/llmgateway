ALTER TABLE "organization" ADD COLUMN "paystack_customer_id" text;--> statement-breakpoint
ALTER TABLE "payment_method" ADD COLUMN "provider" text DEFAULT 'stripe' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_method" ADD COLUMN "paystack_authorization_code" text;--> statement-breakpoint
ALTER TABLE "payment_method" ADD COLUMN "card_brand" text;--> statement-breakpoint
ALTER TABLE "payment_method" ADD COLUMN "card_last4" text;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "provider" text DEFAULT 'stripe' NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "paystack_reference" text;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "paystack_invoice_id" text;--> statement-breakpoint
ALTER TABLE "payment_method" ALTER COLUMN "stripe_payment_method_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_paystack_customer_id_key" UNIQUE("paystack_customer_id");