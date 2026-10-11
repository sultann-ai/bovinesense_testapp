/**
 * The scope selector's logic: which region and branch the whole app is narrowed to. Pure and
 * client-safe. Region and branch names are tenant data, loaded from the database, never constants.
 *
 * This only narrows what the user chooses to LOOK at. What they are allowed to see is decided by the
 * database (Row Level Security and the membership's own region / branch), whatever is selected here.
 */
export interface Region {
  id: number;
  name: string;
}

export interface Branch {
  id: number;
  name: string;
  region_id: number;
}

export interface ScopeSelection {
  regionId: number | null;
  branchId: number | null;
}

export const NO_SCOPE: ScopeSelection = { regionId: null, branchId: null };

export interface ScopeLists {
  regions: readonly Region[];
  branches: readonly Branch[];
  /** What the user's membership fixes. */
  locked: ScopeSelection;
}

/** Make a selection consistent with the lists and with what is locked. */
export function reconcileScope(selection: ScopeSelection, lists: ScopeLists): ScopeSelection {
  let { regionId, branchId } = selection;

  if (lists.locked.branchId !== null) {
    const b = lists.branches.find((x) => x.id === lists.locked.branchId);
    return { regionId: b?.region_id ?? lists.locked.regionId, branchId: lists.locked.branchId };
  }
  if (lists.locked.regionId !== null) regionId = lists.locked.regionId;

  if (regionId !== null && !lists.regions.some((r) => r.id === regionId)) regionId = null;
  if (branchId !== null) {
    const b = lists.branches.find((x) => x.id === branchId);
    if (!b) branchId = null;
    else if (regionId !== null && b.region_id !== regionId) branchId = null;
  }
  return { regionId, branchId };
}

/** The branches to offer for a region (all of them when no region is chosen). */
export function branchesFor(regionId: number | null, branches: readonly Branch[]): Branch[] {
  return regionId === null ? [...branches] : branches.filter((b) => b.region_id === regionId);
}

/** The query-string parameters the API routes understand. */
export function scopeParams(selection: ScopeSelection): Record<string, string> {
  const out: Record<string, string> = {};
  if (selection.regionId !== null) out.region_id = String(selection.regionId);
  if (selection.branchId !== null) out.branch_id = String(selection.branchId);
  return out;
}

/** Appends the scope to a URL path that may already have a query string. */
export function withScope(path: string, selection: ScopeSelection): string {
  const params = scopeParams(selection);
  const entries = Object.entries(params);
  if (entries.length === 0) return path;
  const sep = path.includes("?") ? "&" : "?";
  return path + sep + entries.map(([k, v]) => `${k}=${v}`).join("&");
}

/** A stable string for effect dependencies. */
export function scopeKey(selection: ScopeSelection): string {
  return `${selection.regionId ?? "all"}:${selection.branchId ?? "all"}`;
}

/** Parse what was saved in localStorage; anything unexpected means "everything". */
export function parseStoredScope(raw: string | null): ScopeSelection {
  if (!raw) return NO_SCOPE;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const id = (x: unknown) => (typeof x === "number" && Number.isInteger(x) && x > 0 ? x : null);
    return { regionId: id(v.regionId), branchId: id(v.branchId) };
  } catch {
    return NO_SCOPE;
  }
}

export function describeScope(selection: ScopeSelection, lists: Pick<ScopeLists, "regions" | "branches">): string {
  const branch = lists.branches.find((b) => b.id === selection.branchId);
  if (branch) return branch.name;
  const region = lists.regions.find((r) => r.id === selection.regionId);
  return region ? region.name : "All";
}
