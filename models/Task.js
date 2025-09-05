import mongoose from 'mongoose';

const TaskSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Title is required'],
    trim: true,
    maxlength: [100, 'Title cannot exceed 100 characters']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  status: {
    type: String,
    enum: ['pending', 'in-progress', 'completed'],
    default: 'pending'
  },
  isDeleted: {
    type: Boolean,
    default: false,
    index: true
  },
  deletedAt: {
    type: Date,
    default: null
  },
  completedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Add indexes for better search performance
TaskSchema.index({ title: 'text', description: 'text' });
TaskSchema.index({ status: 1 });

// Maintain completedAt timestamp when status changes to completed
TaskSchema.pre('save', function(next) {
  if (this.isModified('status')) {
    if (this.status === 'completed' && !this.completedAt) {
      this.completedAt = new Date();
    }
    if (this.status !== 'completed') {
      this.completedAt = null;
    }
  }
  next();
});

TaskSchema.pre('findOneAndUpdate', function(next) {
  const update = this.getUpdate() || {};
  if (update.status !== undefined) {
    if (update.status === 'completed') {
      update.completedAt = new Date();
    } else {
      update.completedAt = null;
    }
    this.setUpdate(update);
  }
  next();
});

export default mongoose.model('Task', TaskSchema);

