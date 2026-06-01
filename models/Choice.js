const mongoose = require('mongoose');

const choiceSchema = new mongoose.Schema({
  type:  { type: String, enum: ['status', 'model', 'location', 'eventType', 'contract'], required: true },
  value: { type: String, required: true },
  name:  { type: String, required: true },
}, { timestamps: true });

module.exports = mongoose.model('Choice', choiceSchema);
