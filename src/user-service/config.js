module.exports = {
  jwt: {
    accessTokenSecret: process.env.JWT_ACCESS_SECRET || 'your-access-secret-key-here',
    refreshTokenSecret: process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-key-here',
    accessTokenExpiry: '2h',  // 2 hours
    refreshTokenExpiry: '7d',  // 7 days
  },
  // Add other configuration settings here
};
