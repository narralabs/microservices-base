const jwt = require('jsonwebtoken');
const config = require('../config');

function generateTokens(user) {
  // Create access token
  const accessToken = jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role
    },
    config.jwt.accessTokenSecret,
    { expiresIn: config.jwt.accessTokenExpiry }
  );

  // Create refresh token
  const refreshToken = jwt.sign(
    {
      id: user.id,
      tokenVersion: user.tokenVersion || 0 // Used for token revocation
    },
    config.jwt.refreshTokenSecret,
    { expiresIn: config.jwt.refreshTokenExpiry }
  );

  return { accessToken, refreshToken };
}

function verifyAccessToken(token) {
  try {
    const decoded = jwt.verify(token, config.jwt.accessTokenSecret);
    return { valid: true, decoded };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

function verifyRefreshToken(token) {
  try {
    const decoded = jwt.verify(token, config.jwt.refreshTokenSecret);
    return { valid: true, decoded };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

module.exports = {
  generateTokens,
  verifyAccessToken,
  verifyRefreshToken
};
