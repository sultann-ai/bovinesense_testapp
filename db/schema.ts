import {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  boolean,
  real,
  timestamp,
  customType,
  index,
  uniqueIndex,
  pgEnum,
} from "drizzle-orm/pg-core";

// ─── PostGIS geometry custom type ────────────────────────────────────────────
// Drizzle does not ship a PostGIS type; we declare one so DDL is correct.
// All spatial predicates (ST_Contains, ST_Distance, etc.) use raw SQL.
const geometry = customType<{ data: string }>({
  dataType() {
    return "geometry(Geometry, 4326)";
  },
});

const geography = customType<{ data: string }>({
  dataType() {
    return "geography(Geometry, 4326)";
  },
});

// ─── Enums ────────────────────────────────────────────────────────────────────
export const userRoleEnum = pgEnum("user_role", [
  "hq_admin",
  "regional_manager",
  "branch_officer",
  "auditor",
]);

export const fenceTypeEnum = pgEnum("fence_type", [
  "district",
  "polygon",
  "radius",
]);

export const alertTypeEnum = pgEnum("alert_type", [
  "breach",
  "near_boundary",
  "fast_movement",
  "tag_offline",
  "low_battery",
  "returned",
]);

export const alertSeverityEnum = pgEnum("alert_severity", [
  "critical",
  "warning",
  "info",
]);

export const alertStatusEnum = pgEnum("alert_status", [
  "new",
  "acknowledged",
  "assigned",
  "resolved",
]);

export const resolutionReasonEnum = pgEnum("resolution_reason", [
  "returned_home",
  "false_alarm",
  "moved_with_bank_consent",
  "escalated_to_recovery",
]);

export const animalStatusEnum = pgEnum("animal_status", [
  "inside",
  "near",
  "breach",
  "fast",
  "stale",
]);

// ─── regions ─────────────────────────────────────────────────────────────────
export const regions = pgTable("regions", {
  id:   serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  code: varchar("code", { length: 20 }).notNull().unique(),
});

// ─── branches ────────────────────────────────────────────────────────────────
export const branches = pgTable("branches", {
  id:        serial("id").primaryKey(),
  name:      varchar("name", { length: 100 }).notNull(),
  code:      varchar("code", { length: 20 }).notNull().unique(),
  regionId:  integer("region_id").notNull().references(() => regions.id),
  district:  varchar("district", { length: 100 }),
});

// ─── users ────────────────────────────────────────────────────────────────────
export const users = pgTable("users", {
  id:        serial("id").primaryKey(),
  name:      varchar("name", { length: 150 }).notNull(),
  email:     varchar("email", { length: 150 }).notNull().unique(),
  role:      userRoleEnum("role").notNull().default("branch_officer"),
  branchId:  integer("branch_id").references(() => branches.id),
  regionId:  integer("region_id").references(() => regions.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ─── borrowers ───────────────────────────────────────────────────────────────
export const borrowers = pgTable("borrowers", {
  id:        serial("id").primaryKey(),
  name:      varchar("name", { length: 150 }).notNull(),
  cnic:      varchar("cnic", { length: 15 }).unique(),
  phone:     varchar("phone", { length: 20 }),
  address:   text("address"),
  district:  varchar("district", { length: 100 }),
  branchId:  integer("branch_id").notNull().references(() => branches.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ─── loans ───────────────────────────────────────────────────────────────────
export const loans = pgTable("loans", {
  id:           serial("id").primaryKey(),
  loanNumber:   varchar("loan_number", { length: 50 }).notNull().unique(),
  borrowerId:   integer("borrower_id").notNull().references(() => borrowers.id),
  branchId:     integer("branch_id").notNull().references(() => branches.id),
  amountPkr:    integer("amount_pkr").notNull(),
  disbursedAt:  timestamp("disbursed_at"),
  status:       varchar("status", { length: 20 }).notNull().default("active"),
});

// ─── district_boundaries  (imported from GADM/HDX GeoJSON) ───────────────────
export const districtBoundaries = pgTable(
  "district_boundaries",
  {
    id:           serial("id").primaryKey(),
    districtName: varchar("district_name", { length: 150 }).notNull(),
    province:     varchar("province", { length: 100 }),
    gadmGid:      varchar("gadm_gid", { length: 50 }),
    geom:         geometry("geom").notNull(),
  },
  (t) => [index("district_boundaries_geom_idx").using("gist", t.geom)]
);

// ─── geofences ───────────────────────────────────────────────────────────────
export const geofences = pgTable(
  "geofences",
  {
    id:              serial("id").primaryKey(),
    name:            varchar("name", { length: 150 }).notNull(),
    type:            fenceTypeEnum("type").notNull(),
    geom:            geometry("geom").notNull(),
    warningBufferM:  integer("warning_buffer_m").notNull().default(500),
    districtName:    varchar("district_name", { length: 150 }),
    createdAt:       timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("geofences_geom_idx").using("gist", t.geom)]
);

// ─── tags ─────────────────────────────────────────────────────────────────────
export const tags = pgTable("tags", {
  id:          serial("id").primaryKey(),
  serialNumber: varchar("serial_number", { length: 50 }).notNull().unique(),
  isSimulated: boolean("is_simulated").notNull().default(false),
  lastSeenAt:  timestamp("last_seen_at"),
});

// ─── animals ─────────────────────────────────────────────────────────────────
export const animals = pgTable("animals", {
  id:         serial("id").primaryKey(),
  name:       varchar("name", { length: 100 }),
  species:    varchar("species", { length: 50 }).notNull().default("cattle"),
  sex:        varchar("sex", { length: 10 }),
  ageYears:   real("age_years"),
  tagId:      integer("tag_id").references(() => tags.id),
  borrowerId: integer("borrower_id").notNull().references(() => borrowers.id),
  loanId:     integer("loan_id").references(() => loans.id),
  branchId:   integer("branch_id").notNull().references(() => branches.id),
  district:   varchar("district", { length: 100 }),
  status:     animalStatusEnum("status").notNull().default("inside"),
  createdAt:  timestamp("created_at").notNull().defaultNow(),
});

// ─── animal_geofence  (active fence assignment; one active per animal) ────────
export const animalGeofence = pgTable(
  "animal_geofence",
  {
    id:          serial("id").primaryKey(),
    animalId:    integer("animal_id").notNull().references(() => animals.id),
    geofenceId:  integer("geofence_id").notNull().references(() => geofences.id),
    assignedAt:  timestamp("assigned_at").notNull().defaultNow(),
    isActive:    boolean("is_active").notNull().default(true),
  },
  (t) => [index("animal_geofence_animal_idx").on(t.animalId)]
);

// ─── fixes ────────────────────────────────────────────────────────────────────
export const fixes = pgTable(
  "fixes",
  {
    id:          serial("id").primaryKey(),
    tagId:       integer("tag_id").notNull().references(() => tags.id),
    animalId:    integer("animal_id").references(() => animals.id),
    // PostGIS point — raw SQL used for spatial ops
    geom:        geometry("geom").notNull(),
    lat:         real("lat").notNull(),
    lon:         real("lon").notNull(),
    fixedAt:     timestamp("fixed_at").notNull(),
    speedKmh:    real("speed_kmh"),
    batteryPct:  integer("battery_pct"),
    signalBars:  integer("signal_bars"),
    isSimulated: boolean("is_simulated").notNull().default(false),
    createdAt:   timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("fixes_geom_idx").using("gist", t.geom),
    index("fixes_tag_time_idx").on(t.tagId, t.fixedAt),
    index("fixes_animal_time_idx").on(t.animalId, t.fixedAt),
  ]
);

// ─── alerts ───────────────────────────────────────────────────────────────────
export const alerts = pgTable("alerts", {
  id:               serial("id").primaryKey(),
  animalId:         integer("animal_id").notNull().references(() => animals.id),
  tagId:            integer("tag_id").references(() => tags.id),
  type:             alertTypeEnum("type").notNull(),
  severity:         alertSeverityEnum("severity").notNull(),
  status:           alertStatusEnum("status").notNull().default("new"),
  title:            varchar("title", { length: 255 }).notNull(),
  detail:           text("detail"),
  distanceKm:       real("distance_km"),
  assigneeId:       integer("assignee_id").references(() => users.id),
  createdAt:        timestamp("created_at").notNull().defaultNow(),
  acknowledgedAt:   timestamp("acknowledged_at"),
  assignedAt:       timestamp("assigned_at"),
  resolvedAt:       timestamp("resolved_at"),
  resolutionReason: resolutionReasonEnum("resolution_reason"),
  resolutionNote:   text("resolution_note"),
});

// ─── alert_events  (audit log for every state change) ────────────────────────
export const alertEvents = pgTable("alert_events", {
  id:          serial("id").primaryKey(),
  alertId:     integer("alert_id").notNull().references(() => alerts.id),
  fromStatus:  alertStatusEnum("from_status"),
  toStatus:    alertStatusEnum("to_status").notNull(),
  userId:      integer("user_id").references(() => users.id),
  note:        text("note"),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
});
