import { Schema, model } from 'mongoose';

const lifecycleEventSchema = new Schema({
  eventType:            { type: String, required: true },
  timestamp:            { type: Date,   required: true },
  description:          { type: String },
  associatedLocation:   { type: String },
  responsibleParty:     { type: String },
  relatedReference:     { type: String },
  durationSinceLastEvent: { type: Number },
});

const DEVICE_STATUSES = [
  'InStock',
  'In Warehouse',
  'Deployed',
  'Under Repair',
  'Repaired',
  'Spare Deployed',
  'Returned',
  'Retired',
];

const deviceSchema = new Schema({
  serialNumber:      { type: String, required: true, unique: true },
  modelType:         { type: String },
  purchaseDate:      { type: Date },
  activationDate:    { type: Date },
  batchNumber:       { type: String },
  supplier:          { type: String },
  cost:              { type: Number },
  warrantyExpiry:    { type: Date },
  status:            { type: String, enum: DEVICE_STATUSES, default: 'InStock' },
  currentLocation:   { type: String },
  client:            { type: Schema.Types.ObjectId, ref: 'Client' },
  linkedContractIds: [{ type: Schema.Types.ObjectId, ref: 'Contract' }],
  lifecycleEvents:   [lifecycleEventSchema],
  repairIncidents:   [{ type: Schema.Types.ObjectId, ref: 'RepairIncident' }],
  createdBy:         { type: String },
  updatedBy:         { type: String },
  deletedAt:         { type: Date },
}, {
  timestamps: true,
  toJSON: {
    transform: (_doc, ret) => {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      if (ret.client)            ret.client = ret.client.toString();
      if (ret.linkedContractIds) ret.linkedContractIds = ret.linkedContractIds.map(id => id.toString());
      return ret;
    },
  },
});

deviceSchema.index({ status: 1 });
deviceSchema.index({ currentLocation: 1 });
deviceSchema.index({ modelType: 1 });
deviceSchema.index({ batchNumber: 1 });
deviceSchema.index({ deletedAt: 1 });  

export { DEVICE_STATUSES };
export default model('Device', deviceSchema);