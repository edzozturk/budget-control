ALTER TABLE `accounts` ADD `bank_code` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `branch_name` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `branch_code` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `account_number` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `account_suffix` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `iban` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `customer_number` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `owner_member_id` text REFERENCES members(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `accounts` ADD `joint` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `accounts` ADD `opened_on` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `closed_on` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `interest_day` integer;--> statement-breakpoint
ALTER TABLE `accounts` ADD `term_start` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `term_end` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `auto_renew` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `accounts` ADD `note` text;