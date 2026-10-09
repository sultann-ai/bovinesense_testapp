CREATE TYPE "public"."alert_severity" AS ENUM('critical', 'warning', 'info');--> statement-breakpoint
CREATE TYPE "public"."alert_status" AS ENUM('new', 'acknowledged', 'assigned', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."alert_type" AS ENUM('breach', 'near_boundary', 'fast_movement', 'tag_offline', 'low_battery', 'returned');--> statement-breakpoint
CREATE TYPE "public"."animal_status" AS ENUM('inside', 'near', 'breach', 'fast', 'stale');--> statement-breakpoint
CREATE TYPE "public"."fence_type" AS ENUM('district', 'polygon', 'radius');--> statement-breakpoint
CREATE TYPE "public"."resolution_reason" AS ENUM('returned_home', 'false_alarm', 'moved_with_bank_consent', 'escalated_to_recovery');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('hq_admin', 'regional_manager', 'branch_officer', 'auditor');--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"animal_id" integer NOT NULL,
	"tag_id" integer,
	"type" "alert_type" NOT NULL,
	"severity" "alert_severity" NOT NULL,
	"status" "alert_status" DEFAULT 'new' NOT NULL,
	"title" varchar(255) NOT NULL,
	"detail" text,
	"assignee_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp,
	"assigned_at" timestamp,
	"resolved_at" timestamp,
	"resolution_reason" "resolution_reason",
	"resolution_note" text
);
--> statement-breakpoint
CREATE TABLE "animal_geofence" (
	"id" serial PRIMARY KEY NOT NULL,
	"animal_id" integer NOT NULL,
	"geofence_id" integer NOT NULL,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "animals" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100),
	"species" varchar(50) DEFAULT 'cattle' NOT NULL,
	"sex" varchar(10),
	"age_years" real,
	"tag_id" integer,
	"borrower_id" integer NOT NULL,
	"loan_id" integer,
	"branch_id" integer NOT NULL,
	"district" varchar(100),
	"status" "animal_status" DEFAULT 'inside' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "borrowers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(150) NOT NULL,
	"cnic" varchar(15),
	"phone" varchar(20),
	"address" text,
	"district" varchar(100),
	"branch_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "borrowers_cnic_unique" UNIQUE("cnic")
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"code" varchar(20) NOT NULL,
	"region_id" integer NOT NULL,
	"district" varchar(100),
	CONSTRAINT "branches_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "district_boundaries" (
	"id" serial PRIMARY KEY NOT NULL,
	"district_name" varchar(150) NOT NULL,
	"province" varchar(100),
	"gadm_gid" varchar(50),
	"geom" geometry(Geometry, 4326) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fixes" (
	"id" serial PRIMARY KEY NOT NULL,
	"tag_id" integer NOT NULL,
	"animal_id" integer,
	"geom" geometry(Geometry, 4326) NOT NULL,
	"lat" real NOT NULL,
	"lon" real NOT NULL,
	"fixed_at" timestamp NOT NULL,
	"speed_kmh" real,
	"battery_pct" integer,
	"signal_bars" integer,
	"is_simulated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "geofences" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(150) NOT NULL,
	"type" "fence_type" NOT NULL,
	"geom" geometry(Geometry, 4326) NOT NULL,
	"warning_buffer_m" integer DEFAULT 500 NOT NULL,
	"district_name" varchar(150),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loans" (
	"id" serial PRIMARY KEY NOT NULL,
	"loan_number" varchar(50) NOT NULL,
	"borrower_id" integer NOT NULL,
	"branch_id" integer NOT NULL,
	"amount_pkr" integer NOT NULL,
	"disbursed_at" timestamp,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	CONSTRAINT "loans_loan_number_unique" UNIQUE("loan_number")
);
--> statement-breakpoint
CREATE TABLE "regions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"code" varchar(20) NOT NULL,
	CONSTRAINT "regions_name_unique" UNIQUE("name"),
	CONSTRAINT "regions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"serial_number" varchar(50) NOT NULL,
	"is_simulated" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp,
	CONSTRAINT "tags_serial_number_unique" UNIQUE("serial_number")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(150) NOT NULL,
	"email" varchar(150) NOT NULL,
	"role" "user_role" DEFAULT 'branch_officer' NOT NULL,
	"branch_id" integer,
	"region_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_animal_id_animals_id_fk" FOREIGN KEY ("animal_id") REFERENCES "public"."animals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "animal_geofence" ADD CONSTRAINT "animal_geofence_animal_id_animals_id_fk" FOREIGN KEY ("animal_id") REFERENCES "public"."animals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "animal_geofence" ADD CONSTRAINT "animal_geofence_geofence_id_geofences_id_fk" FOREIGN KEY ("geofence_id") REFERENCES "public"."geofences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "animals" ADD CONSTRAINT "animals_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "animals" ADD CONSTRAINT "animals_borrower_id_borrowers_id_fk" FOREIGN KEY ("borrower_id") REFERENCES "public"."borrowers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "animals" ADD CONSTRAINT "animals_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "animals" ADD CONSTRAINT "animals_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "borrowers" ADD CONSTRAINT "borrowers_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixes" ADD CONSTRAINT "fixes_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixes" ADD CONSTRAINT "fixes_animal_id_animals_id_fk" FOREIGN KEY ("animal_id") REFERENCES "public"."animals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_borrower_id_borrowers_id_fk" FOREIGN KEY ("borrower_id") REFERENCES "public"."borrowers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "animal_geofence_animal_idx" ON "animal_geofence" USING btree ("animal_id");--> statement-breakpoint
CREATE INDEX "district_boundaries_geom_idx" ON "district_boundaries" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "fixes_geom_idx" ON "fixes" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "fixes_tag_time_idx" ON "fixes" USING btree ("tag_id","fixed_at");--> statement-breakpoint
CREATE INDEX "fixes_animal_time_idx" ON "fixes" USING btree ("animal_id","fixed_at");--> statement-breakpoint
CREATE INDEX "geofences_geom_idx" ON "geofences" USING gist ("geom");