/**
 * eventRules.js
 * Single source of truth for lifecycle event types, their status transitions,
 * and location rules. Previously duplicated across deviceController,
 * utilityController, and logController.
 */

// Maps human-readable event names → internal action keys
const EVENT_TYPE_MAP = {
  "Procurement & Arrival": "procurementarrival",
  "Warehouse Storage": "warehousestorage",
  "Deployment to Client": "deployment",
  Deployment: "deployment",
  "Maintenance/Repair Start": "maintenancestart",
  "Maintenance/Repair Complete": "maintenancecomplete",
  "Swap/Spare Deployment": "swapdeployment",
  "Return from Client/End of Use": "return",
  "Retirement/Decommission": "retirement",
};

// Maps action key → status/location rules
const EVENT_RULES = {
  procurementarrival: {
    status: "In Warehouse",
    location: "Main Warehouse",
  },
  warehousestorage: {
    status: "In Warehouse",
    location: "Regional Warehouse",
  },
  deployment: {
    status: "Deployed",
    locationFromInput: true,
  },
  maintenancestart: {
    status: "Under Repair",
    location: "Repair Center",
  },
  maintenancecomplete: {
    status: "In Warehouse",
    locationFromInput: true,
  },
  swapdeployment: {
    status: "Deployed",
    locationFromInput: true,
  },
  return: {
    status: "In Warehouse",
    location: "Main Warehouse",
  },
  retirement: {
    status: "Retired",
    location: "Archived",
  },
};

/**
 * Normalise an incoming event type string to an action key.
 * Accepts both human-readable names and already-normalised keys.
 */
function normaliseEventType(raw) {
  if (!raw) return null;
  // Already a valid key
  if (EVENT_RULES[raw]) return raw;
  // Human-readable name
  const mapped = EVENT_TYPE_MAP[raw];
  if (mapped) return mapped;
  // Last-resort: strip spaces/slashes and lowercase
  const slug = raw.toLowerCase().replace(/[\s/&]+/g, "");
  return EVENT_RULES[slug] ? slug : null;
}

/**
 * Derive the new status and location for a device given an event.
 * @param {string} actionKey   - normalised event key
 * @param {string} [inputLoc]  - caller-supplied location (for locationFromInput events)
 * @returns {{ status: string, location: string }}
 */
function resolveEventOutcome(actionKey, inputLoc) {
  const rule = EVENT_RULES[actionKey];
  if (!rule) throw new Error(`Unknown event type: ${actionKey}`);
  const location = rule.locationFromInput ? inputLoc || "Client Site" : rule.location;
  return { status: rule.status, location };
}

export { EVENT_TYPE_MAP, EVENT_RULES, normaliseEventType, resolveEventOutcome };
