import mongoose from "mongoose";

const sequenceSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  value: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

sequenceSchema.statics.getNextValue = async function(name) {
  const sequence = await this.findOneAndUpdate(
    { name },
    { $inc: { value: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return sequence.value;
};

sequenceSchema.statics.peekNextValue = async function(name) {
  const sequence = await this.findOne({ name });
  return (sequence?.value || 0) + 1;
};

const Sequence = mongoose.model("Sequence", sequenceSchema);

export default Sequence;

