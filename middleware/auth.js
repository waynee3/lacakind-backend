const admin = require('firebase-admin');

const authMiddleware = async (req, res, next) => {
  console.log('Incoming Request Headers:', req.headers);

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('Missing or invalid Authorization header:', authHeader);
    return res.status(401).json({ message: 'Unauthorized: Missing or invalid token' });
  }

  const token = authHeader.split('Bearer ')[1];

  if (!token || token === 'null') {
    console.log('Token is null or invalid:', token);
    return res.status(401).json({ message: 'Unauthorized: Token is null' });
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    console.log('Decoded Token:', decodedToken);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Error verifying token:', error);
    return res.status(401).json({ message: 'Unauthorized: Invalid token', error: error.message });
  }
};

module.exports = authMiddleware;