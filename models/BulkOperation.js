import { Schema, model } from 'mongoose';

const clientSnapshotSchema = new Schema({
  id:       String,
  name:     String,
  location: String,
}, { _id: false });

const deviceChangeSchema = new Schema({
  serialNumber: String,
  fromStatus:   String,
  toStatus:     String,
  fromLocation: String,
  toLocation:   String,
  fromClient:   { id: String, name: String },
  toClient:     { id: String, name: String },
}, { _id: false });

const bulkOperationSchema = new Schema({
  owner:    { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

  bulkOpId: { type: String, required: true },
  action:   { type: String, required: true },

  affectedDevices: [{ type: String, required: true }],

  createdBy:   { type: String, required: true },
  timestamp:   { type: Date,   required: true, default: Date.now },
  description: { type: String, default: '' },

  associatedLocation: { type: String, default: '' },
  relatedReference:   { type: String, default: '' },

  totalRecords:      { type: Number },
  successfulRecords: { type: Number },
  failedRecords:     { type: Number },
  importErrors:      [{ type: String }],

  details: {
    originalDevice: {
      serialNumber:    String,
      previousStatus:  String,
      previousLocation:String,
      previousClient:  clientSnapshotSchema,
      newStatus:       String,
      newLocation:     String,
    },
    spareDevice: {
      serialNumber:    String,
      previousStatus:  String,
      previousLocation:String,
      newStatus:       String,
      newLocation:     String,
      newClient:       clientSnapshotSchema,
    },
    client:   clientSnapshotSchema,
    contract: { id: String, contractId: String, clientName: String },
    statusChanges:   [deviceChangeSchema],
    locationChanges: [deviceChangeSchema],
    clientChanges:   [deviceChangeSchema],
  },
}, { timestamps: true });

bulkOperationSchema.index({ owner: 1, bulkOpId: 1 }, { unique: true });

export default model('BulkOperation', bulkOperationSchema);