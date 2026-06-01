const mongoose = require('mongoose');

const clientSchema = new mongoose.Schema({
  name:          { type: String, required: true },
  contactPerson: { type: String, required: true },
  email:         { type: String, required: true },
  phone:         { type: String, required: true },
  address:       { type: String, required: true },
  location:      { type: String, required: true },
  notes:         { type: String },
  createdAt:     { type: Date, default: Date.now },
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

module.exports = mongoose.model('Client', clientSchema);
