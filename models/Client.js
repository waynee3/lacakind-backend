import { Schema, model } from 'mongoose';

const clientSchema = new Schema({
  owner:         { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name:          { type: String, required: true },
  location:      { type: String, required: true },
  contactPerson: { type: String, default: '' },
  email:         { type: String, default: '' },
  phone:         { type: String, default: '' },
  address:       { type: String, default: '' },
  notes:         { type: String },
  createdAt:     { type: Date, default: Date.now },
}, {
  toJSON: {
    transform: (_doc, ret) => {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      delete ret.owner;
      return ret;
    },
  },
});

clientSchema.index({ owner: 1, name: 1 }, { unique: true });

export default model('Client', clientSchema);