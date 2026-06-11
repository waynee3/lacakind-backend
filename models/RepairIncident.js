import { Schema, model } from 'mongoose';

const repairIncidentSchema = new Schema({
  owner:                { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  id:                   { type: String, required: true },
  deviceSerial:         { type: String, required: true },
  issueType:            { type: String, required: true },
  issueSummary:         { type: String, required: true },
  dateReported:         { type: Date,   required: true },
  clientRef:            { type: String },
  status:               { type: String, required: true, default: 'Awaiting Pickup' },
  createdBy:            { type: String, required: true },
  assignedTo:           { type: String },
  pickupDate:           { type: Date },
  diagnosticNotes:      { type: String },
  repairActions:        { type: String },
  repairCompletedDate:  { type: Date },
  retestStatus:         { type: String },
  spareUsed:            { type: Boolean, default: false },
  spareSerial:          { type: String },
  spareDeploymentDate:  { type: Date },
  spareReturnDate:      { type: Date },
  linkedRepairId:       { type: String },
  spareNote:            { type: String },
}, { timestamps: true });

repairIncidentSchema.index({ owner: 1, id: 1 }, { unique: true });

export default model('RepairIncident', repairIncidentSchema);