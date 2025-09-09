module.exports = {
  jwt: {
    accessTokenSecret: process.env.JWT_ACCESS_SECRET || 'your-access-secret-key-here',
    refreshTokenSecret: process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-key-here',
    accessTokenExpiry: '15m',  // 15 minutes
    refreshTokenExpiry: '7d',  // 7 days
  },
  // Add other configuration settings here
};
