import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';

const authMiddleware = (req, res, next) => {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Unauthorized: Missing or invalid token' });
  }

  const token = header.split('Bearer ')[1];

  if (!token || token === 'null') {
    return res.status(401).json({ message: 'Unauthorized: Token is null' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET); 
    if (!decoded.id) {
      return res
        .status(401)
        .json({ message: 'Unauthorized: token missing user id, please log in again' });
    }
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Unauthorized: Invalid token', error: error.message });
  }
};

export default authMiddleware;