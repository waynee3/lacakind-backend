const mongoose = require('mongoose');

const repairIncidentSchema = new mongoose.Schema({
  id:                   { type: String, required: true, unique: true },
  kioskSerial:          { type: String, required: true },
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

module.exports = mongoose.model('RepairIncident', repairIncidentSchema);
