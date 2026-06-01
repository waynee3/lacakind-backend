/**
 * errorHandler.js
 * Central Express error-handling middleware.
 * Controllers call next(err) instead of writing their own res.status(500) blocks.
 */

const errorHandler = (err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(`[${req.method}] ${req.originalUrl} —`, err.message);
  if (process.env.NODE_ENV === 'development') {
    console.error(err.stack);
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map(e => e.message);
    return res.status(400).json({ error: 'Validation failed', details: messages });
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return res.status(409).json({ error: `Duplicate value for ${field}` });
  }

  // Mongoose cast error (bad ObjectId, etc.)
  if (err.name === 'CastError') {
    return res.status(400).json({ error: `Invalid value for ${err.path}` });
  }

  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: err.message || 'Internal server error',
  });
};

/**
 * Small helper so controllers can throw with an HTTP status attached.
 *   throw createError(404, 'Device not found');
 */
const createError = (status, message) => {
  const err = new Error(message);
  err.status = status;
  return err;
};

export default { errorHandler, createError };
