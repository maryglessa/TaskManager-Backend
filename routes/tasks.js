import express from 'express';
import Task from '../models/Task.js';

const router = express.Router();

// Create a new task
router.post('/', async (req, res) => {
  try {
    const { title, description, status } = req.body;

    // Validate required fields
    if (!title || title.trim() === '') {
      return res.status(400).json({ error: 'Title is required' });
    }

    // Always enforce 'pending' for new tasks regardless of client input
    const task = new Task({
      title: title.trim(),
      description: description ? description.trim() : '',
      status: 'pending'
    });

    const savedTask = await task.save();
    res.status(201).json(savedTask);
  } catch (error) {
    console.error('Error creating task:', error);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// Get all tasks with search and filter
router.get('/', async (req, res) => {
  try {
    const { keyword, status, page = 1, limit = 10, includeDeleted = 'false' } = req.query;
    
    // Build filter object
    let filter = {};
    // Exclude soft-deleted by default
    if (includeDeleted !== 'true') {
      filter.isDeleted = false;
    }
    
    // Status filter
    if (status && ['pending', 'in-progress', 'completed'].includes(status)) {
      filter.status = status;
    }
    
    // Keyword search with priority for starting matches
    if (keyword && keyword.trim() !== '') {
      const searchTerm = keyword.trim();
      
      // Create search conditions with priority
      const searchConditions = [
        // Priority 1: Title starts with search term
        { title: { $regex: `^${searchTerm}`, $options: 'i' } },
        // Priority 2: Description starts with search term
        { description: { $regex: `^${searchTerm}`, $options: 'i' } },
        // Priority 3: Title contains search term
        { title: { $regex: searchTerm, $options: 'i' } },
        // Priority 4: Description contains search term
        { description: { $regex: searchTerm, $options: 'i' } }
      ];
      
      filter.$or = searchConditions;
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Build sort criteria
    let sortCriteria = { createdAt: -1 };
    
    // If searching, we'll use aggregation for better sorting
    if (keyword && keyword.trim() !== '') {
      const searchTerm = keyword.trim();
      
      // Use aggregation pipeline for better search results
      const pipeline = [
        { $match: filter },
        {
          $addFields: {
            // Add priority score for sorting
            priority: {
              $cond: [
                { $regexMatch: { input: "$title", regex: `^${searchTerm}`, options: "i" } },
                3, // Highest priority for title starting with search term
                {
                  $cond: [
                    { $regexMatch: { input: "$description", regex: `^${searchTerm}`, options: "i" } },
                    2, // Second priority for description starting with search term
                    {
                      $cond: [
                        { $regexMatch: { input: "$title", regex: searchTerm, options: "i" } },
                        1, // Third priority for title containing search term
                        0  // Lowest priority for description containing search term
                      ]
                    }
                  ]
                }
              ]
            }
          }
        },
        { $sort: { priority: -1, createdAt: -1 } },
        { $skip: skip },
        { $limit: parseInt(limit) }
      ];
      
      const tasks = await Task.aggregate(pipeline);
      const total = await Task.countDocuments(filter);
      
      return res.json({
        tasks,
        pagination: {
          current: parseInt(page),
          pages: Math.ceil(total / parseInt(limit)),
          total
        }
      });
    }

    const tasks = await Task.find(filter)
      .sort(sortCriteria)
      .skip(skip)
      .limit(parseInt(limit));
    
    const total = await Task.countDocuments(filter);
    
    res.json({
      tasks,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / parseInt(limit)),
        total
      }
    });
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// Get trashed (soft-deleted) tasks
router.get('/trash/list', async (req, res) => {
  try {
    const { keyword, status, page = 1, limit = 10 } = req.query;

    let filter = { isDeleted: true };
    if (status && ['pending', 'in-progress', 'completed'].includes(status)) {
      filter.status = status;
    }
    if (keyword && keyword.trim() !== '') {
      const searchTerm = keyword.trim();
      filter.$or = [
        { title: { $regex: `^${searchTerm}`, $options: 'i' } },
        { description: { $regex: `^${searchTerm}`, $options: 'i' } },
        { title: { $regex: searchTerm, $options: 'i' } },
        { description: { $regex: searchTerm, $options: 'i' } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const tasks = await Task.find(filter)
      .sort({ deletedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    const total = await Task.countDocuments(filter);

    res.json({
      tasks,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / parseInt(limit)),
        total
      }
    });
  } catch (error) {
    console.error('Error fetching trash:', error);
    res.status(500).json({ error: 'Failed to fetch trash' });
  }
});

// Get a single task by ID
router.get('/:id', async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    res.json(task);
  } catch (error) {
    console.error('Error fetching task:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid task ID' });
    }
    res.status(500).json({ error: 'Failed to fetch task' });
  }
});

// Update a task
router.put('/:id', async (req, res) => {
  try {
    const { title, description, status } = req.body;
    
    // Build update data object
    const updateData = {};
    
    // Only update fields that are provided
    if (title !== undefined) {
      if (!title || title.trim() === '') {
        return res.status(400).json({ error: 'Title cannot be empty' });
      }
      updateData.title = title.trim();
    }
    
    if (description !== undefined) {
      updateData.description = description ? description.trim() : '';
    }
    
    if (status !== undefined) {
      if (!['pending', 'in-progress', 'completed'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status value' });
      }
      updateData.status = status;
    }

    // Enforce rules similar to PATCH
    const existing = await Task.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Task not found' });
    }
    if (existing.status === 'completed') {
      if (status === 'in-progress') {
        updateData.status = 'in-progress';
        // Prevent overwriting title/description accidentally
        delete updateData.title;
        delete updateData.description;
      } else if (status && status !== 'in-progress') {
        return res.status(400).json({ error: 'Completed tasks can only be reverted to in-progress' });
      } else {
        return res.status(400).json({ error: 'Completed tasks cannot be edited' });
      }
    }

    const task = await Task.findByIdAndUpdate(req.params.id, updateData, { new: true, runValidators: true });
    
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    res.json(task);
  } catch (error) {
    console.error('Error updating task:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid task ID' });
    }
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// Partial update a task (PATCH method)
router.patch('/:id', async (req, res) => {
  try {
    const { title, description, status } = req.body;
    
    // Build update data object
    const updateData = {};
    
    // Only update fields that are provided
    if (title !== undefined) {
      if (!title || title.trim() === '') {
        return res.status(400).json({ error: 'Title cannot be empty' });
      }
      updateData.title = title.trim();
    }
    
    if (description !== undefined) {
      updateData.description = description ? description.trim() : '';
    }
    
    if (status !== undefined) {
      if (!['pending', 'in-progress', 'completed'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status value' });
      }
      updateData.status = status;
    }

    // Check if any fields were provided
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'No fields provided for update' });
    }

    // Enforce rules: completed tasks are locked except reverting to in-progress
    const existing = await Task.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Task not found' });
    }
    if (existing.status === 'completed') {
      if (status === 'in-progress') {
        updateData.status = 'in-progress';
      } else if (status && status !== 'in-progress') {
        return res.status(400).json({ error: 'Completed tasks can only be reverted to in-progress' });
      }
      // Block title/description edits when completed
      delete updateData.title;
      delete updateData.description;
    }

    const task = await Task.findByIdAndUpdate(req.params.id, updateData, { new: true, runValidators: true });
    
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    res.json(task);
  } catch (error) {
    console.error('Error updating task:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid task ID' });
    }
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// Delete a task
router.delete('/:id', async (req, res) => {
  try {
    const task = await Task.findByIdAndUpdate(
      req.params.id,
      { isDeleted: true, deletedAt: new Date() },
      { new: true }
    );
    
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    res.json({ message: 'Task moved to trash', task });
  } catch (error) {
    console.error('Error deleting task:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid task ID' });
    }
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

// Restore a soft-deleted task
router.patch('/:id/restore', async (req, res) => {
  try {
    const task = await Task.findByIdAndUpdate(
      req.params.id,
      { isDeleted: false, deletedAt: null },
      { new: true }
    );
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(task);
  } catch (error) {
    console.error('Error restoring task:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid task ID' });
    }
    res.status(500).json({ error: 'Failed to restore task' });
  }
});

// Hard delete (permanent)
router.delete('/:id/hard', async (req, res) => {
  try {
    const task = await Task.findByIdAndDelete(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json({ message: 'Task permanently deleted' });
  } catch (error) {
    console.error('Error hard-deleting task:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid task ID' });
    }
    res.status(500).json({ error: 'Failed to permanently delete task' });
  }
});

// Search suggestions endpoint
router.get('/search/suggestions', async (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q || q.trim() === '') {
      return res.json({ suggestions: [] });
    }
    
    const searchTerm = q.trim();
    
    // Get suggestions for titles and descriptions that start with the search term
    const suggestions = await Task.aggregate([
      {
        $match: {
          $or: [
            { title: { $regex: `^${searchTerm}`, $options: 'i' } },
            { description: { $regex: `^${searchTerm}`, $options: 'i' } }
          ]
        }
      },
      {
        $project: {
          title: 1,
          description: 1,
          status: 1,
          // Add a field to indicate if it's a title or description match
          matchType: {
            $cond: [
              { $regexMatch: { input: "$title", regex: `^${searchTerm}`, options: "i" } },
              "title",
              "description"
            ]
          }
        }
      },
      { $limit: 10 }
    ]);
    
    res.json({ suggestions });
  } catch (error) {
    console.error('Error fetching search suggestions:', error);
    res.status(500).json({ error: 'Failed to fetch search suggestions' });
  }
});

// Get task statistics
router.get('/stats/summary', async (req, res) => {
  try {
    const stats = await Task.aggregate([
      { $match: { isDeleted: false } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);
    
    const summary = {
      pending: 0,
      'in-progress': 0,
      completed: 0,
      total: 0
    };
    
    stats.forEach(stat => {
      summary[stat._id] = stat.count;
      summary.total += stat.count;
    });
    
    res.json(summary);
  } catch (error) {
    console.error('Error fetching task stats:', error);
    res.status(500).json({ error: 'Failed to fetch task statistics' });
  }
});

export default router;
