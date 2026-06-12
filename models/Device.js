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
  owner:             { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

  serialNumber:      { type: String, required: true },
  modelType:         { type: String },
  purchaseDate:      { type: Date },
  activationDate:    { type: Date },
  batchNumber:       { type: String },
  supplier:          { type: String },
  cost:              { type: Number },
  warrantyExpiry:    { type: Date },
  status:            { type: String, enum: DEVICE_STATUSES, default: 'In Warehouse' },
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
      delete ret.owner;

      if (ret.client) {
        if (typeof ret.client === 'object' && ret.client._id) {
          ret.client = {
            id:       ret.client._id.toString(),
            name:     ret.client.name,
            location: ret.client.location,
          };
        } else {
          ret.client = ret.client.toString();
        }
      }

      if (ret.linkedContractIds) {
        ret.linkedContractIds = ret.linkedContractIds.map(id =>
          typeof id === 'object' && id._id ? id._id.toString() : id.toString()
        );
      }

      return ret;
    },
  },
});

deviceSchema.index({ owner: 1, serialNumber: 1 }, { unique: true });

deviceSchema.index({ owner: 1, status: 1 });
deviceSchema.index({ owner: 1, currentLocation: 1 });
deviceSchema.index({ owner: 1, modelType: 1 });
deviceSchema.index({ owner: 1, batchNumber: 1 });
deviceSchema.index({ owner: 1, deletedAt: 1 });

export { DEVICE_STATUSES };
export default model('Device', deviceSchema);