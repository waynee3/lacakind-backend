const mongoose = require('mongoose');

const contractSchema = new mongoose.Schema({
  contractId:  { type: String, required: true, unique: true },
  contractRef: { type: String, required: true, unique: true },
  clientId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  clientName:  { type: String },
  contractType:{ type: String, enum: ['Rental', 'Lease', 'Sale'], required: true },
  startDate:   { type: Date, required: true },
  endDate:     { type: Date },
  kioskSerials:[{ type: String }],
  sla: {
    uptimeGuarantee: { type: String, default: '99%' },
    repairTimeLimit: { type: String, default: '48h' },
  },
  financialTerms: {
    monthlyFee:      { type: Number, default: 0 },
    paymentSchedule: { type: String, default: 'Monthly' },
    penaltyClause:   { type: String },
  },
  status:        { type: String, enum: ['Active', 'Expired', 'Terminated'], default: 'Active' },
  paymentStatus: { type: String, default: 'Not Paid' },
  documents:     [{ type: String }],
  createdAt:     { type: Date, default: Date.now },
  createdBy:     { type: String, required: true },
  notes:         { type: String },
}, {
  toJSON: {
    transform: (_doc, ret) => {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
});

// Keep contractRef in sync with contractId
contractSchema.pre('save', function (next) {
  if (this.isModified('contractId') || !this.contractRef) {
    this.contractRef = this.contractId;
  }
  next();
});

module.exports = mongoose.model('Contract', contractSchema);
