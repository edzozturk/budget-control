CREATE TABLE `cost_centers` (
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
CREATE INDEX `cost_centers_workspace_idx` ON `cost_centers` (`workspace_id`);--> statement-breakpoint
ALTER TABLE `category_rules` ADD `cost_center_id` text REFERENCES cost_centers(id);--> statement-breakpoint
ALTER TABLE `transactions` ADD `cost_center_id` text REFERENCES cost_centers(id);