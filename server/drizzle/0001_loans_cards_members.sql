CREATE TABLE `card_statements` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`account_id` text NOT NULL,
	`statement_date` text NOT NULL,
	`due_date` text NOT NULL,
	`amount` integer NOT NULL,
	`minimum_payment` integer DEFAULT 0 NOT NULL,
	`interest` integer DEFAULT 0 NOT NULL,
	`paid_amount` integer DEFAULT 0 NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `card_statements_account_idx` ON `card_statements` (`account_id`,`due_date`);--> statement-breakpoint
CREATE TABLE `loan_installments` (
	`id` text PRIMARY KEY NOT NULL,
	`loan_id` text NOT NULL,
	`number` integer NOT NULL,
	`due_date` text NOT NULL,
	`amount` integer NOT NULL,
	`paid_date` text,
	`transaction_id` text,
	FOREIGN KEY (`loan_id`) REFERENCES `loans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `loan_installments_loan_number_idx` ON `loan_installments` (`loan_id`,`number`);--> statement-breakpoint
CREATE INDEX `loan_installments_due_idx` ON `loan_installments` (`due_date`);--> statement-breakpoint
CREATE TABLE `loans` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`lender` text DEFAULT '' NOT NULL,
	`currency` text NOT NULL,
	`principal` integer NOT NULL,
	`installment_amount` integer NOT NULL,
	`installment_count` integer NOT NULL,
	`first_due_date` text NOT NULL,
	`account_id` text,
	`category_id` text,
	`member_id` text,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`currency`) REFERENCES `currencies`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `loans_workspace_idx` ON `loans` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '#64748b' NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `members_workspace_idx` ON `members` (`workspace_id`);--> statement-breakpoint
ALTER TABLE `accounts` ADD `credit_limit` integer;--> statement-breakpoint
ALTER TABLE `accounts` ADD `interest_rate` real;--> statement-breakpoint
ALTER TABLE `accounts` ADD `statement_day` integer;--> statement-breakpoint
ALTER TABLE `accounts` ADD `due_day` integer;--> statement-breakpoint
ALTER TABLE `accounts` ADD `last4` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `member_id` text REFERENCES members(id);