const mongoose = require('mongoose');

/**
 * BulkOperation — records every bulk action for auditing.
 * The `details` sub-document captures before/after state so the UI
 * can display a meaningful history without re-querying devices.
 */
const clientSnapshotSchema = new mongoose.Schema({
  id:       String,
  name:     String,
  location: String,
}, { _id: false });

const kioskChangeSchema = new mongoose.Schema({
  serialNumber: String,
  fromStatus:   String,
  toStatus:     String,
  fromLocation: String,
  toLocation:   String,
  fromClient:   { id: String, name: String },
  toClient:     { id: String, name: String },
}, { _id: false });

const bulkOperationSchema = new mongoose.Schema({
  bulkOpId: { type: String, required: true, unique: true },
  action:   { type: String, required: true },

  affectedKiosks: [{ type: String, required: true }],

  createdBy:   { type: String, required: true },
  timestamp:   { type: Date,   required: true, default: Date.now },
  description: { type: String, default: '' },

  associatedLocation: { type: String, default: '' },
  relatedReference:   { type: String, default: '' },

  // Summary counts (populated by bulk-import operations)
  totalRecords:      { type: Number },
  successfulRecords: { type: Number },
  failedRecords:     { type: Number },
  importErrors:      [{ type: String }],

  details: {
    // swap-deployment specifics
    originalKiosk: {
      serialNumber:    String,
      previousStatus:  String,
      previousLocation:String,
      previousClient:  clientSnapshotSchema,
      newStatus:       String,
      newLocation:     String,
    },
    spareKiosk: {
      serialNumber:    String,
      previousStatus:  String,
      previousLocation:String,
      newStatus:       String,
      newLocation:     String,
      newClient:       clientSnapshotSchema,
    },
    // deployment specifics
    client:   clientSnapshotSchema,
    contract: { id: String, contractId: String, clientName: String },
    // general change arrays
    statusChanges:   [kioskChangeSchema],
    locationChanges: [kioskChangeSchema],
    clientChanges:   [kioskChangeSchema],
  },
}, { timestamps: true });

module.exports = mongoose.model('BulkOperation', bulkOperationSchema);
