import { Schema, model } from 'mongoose';

const choiceSchema = new Schema({
  type:  { type: String, enum: ['status', 'model', 'location', 'eventType', 'contract'], required: true },
  value: { type: String, required: true },
  name:  { type: String, required: true },
}, { timestamps: true });

export default model('Choice', choiceSchema);
