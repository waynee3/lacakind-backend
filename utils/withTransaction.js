const mongoose = require('mongoose');

/**
 * Runs `fn(session)` inside a mongoose transaction.
 * Commits on success, aborts on error, always ends the session.
 *
 * Usage:
 *   const result = await withTransaction(async (session) => {
 *     await Device.updateMany(..., { session });
 *     return something;
 *   });
 */
async function withTransaction(fn) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const result = await fn(session);
    await session.commitTransaction();
    return result;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}

module.exports = { withTransaction };
