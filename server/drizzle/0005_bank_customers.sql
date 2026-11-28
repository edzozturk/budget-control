CREATE TABLE `bank_customers` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`bank_code` text NOT NULL,
	`member_id` text,
	`customer_number` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `bank_customers_workspace_idx` ON `bank_customers` (`workspace_id`);--> statement-breakpoint
INSERT INTO `bank_customers` (`id`, `workspace_id`, `bank_code`, `member_id`, `customer_number`)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
  `workspace_id`, `bank_code`, `owner_member_id`, max(`customer_number`)
FROM `accounts`
WHERE `bank_code` IS NOT NULL AND `customer_number` IS NOT NULL AND `customer_number` <> ''
GROUP BY `workspace_id`, `bank_code`, `owner_member_id`;--> statement-breakpoint
ALTER TABLE `accounts` DROP COLUMN `customer_number`;