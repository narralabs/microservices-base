const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const jwt = require('jsonwebtoken');

const PROTO_PATH = __dirname + '/../proto/app.proto';
const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'localhost:7000';

// Load proto file
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
const userService = new protoDescriptor.app.UserService(
  USER_SERVICE_URL,
  grpc.credentials.createInsecure()
);

// Promisify gRPC methods
const validateTokenAsync = (token) => {
  return new Promise((resolve, reject) => {
    userService.validateToken({ token }, (error, response) => {
      if (error) reject(error);
      else resolve(response);
    });
  });
};

const refreshTokenAsync = (token) => {
  return new Promise((resolve, reject) => {
    userService.refreshToken({ refresh_token: token }, (error, response) => {
      if (error) reject(error);
      else resolve(response);
    });
  });
};

// Middleware to check if user is authenticated
const isAuthenticated = async (req, res, next) => {
  try {
    const accessToken = req.session.accessToken;

    if (!accessToken) {
      return res.redirect('/login');
    }

    try {
      // Verify token with userservice
      const result = await validateTokenAsync(accessToken);

      if (!result.valid) {
        req.session = null;
        throw new Error('Invalid token');
      }

      // Update user info in session
      req.session.user = result.user;
      return next();

    } catch (error) {
      // Token is invalid, try to refresh
      const refreshToken = req.cookies.refreshToken;

      if (!refreshToken) {
        req.session = null;
        return res.redirect('/login');
      }

      try {
        // Get new tokens
        const tokens = await refreshTokenAsync(refreshToken);

        // Update session and cookies
        req.session.accessToken = tokens.access_token;
        req.session.user = tokens.user;

        res.cookie('refreshToken', tokens.refresh_token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        });

        return next();
      } catch (refreshError) {
        // Refresh token is invalid
        req.session = null;
        return res.redirect('/login');
      }
    }
  } catch (error) {
    console.error('Auth middleware error:', error);
    req.session = null;
    return res.redirect('/login');
  }
};

// Middleware to check user role
const hasRole = (role) => {
  return (req, res, next) => {
    if (!req.session.user || req.session.user.role !== role) {
      return res.status(403).render('error', {
        message: 'Access Denied',
        error: { status: 403, stack: 'You do not have permission to access this resource' }
      });
    }
    next();
  };
};

// Authenticate user with email and password
const authenticateUser = (email, password) => {
  return new Promise((resolve, reject) => {
    userService.login({ email, password }, (error, response) => {
      if (error) {
        resolve({ success: false, error: error.message });
      } else {
        resolve({
          success: true,
          token: response.access_token,
          refreshToken: response.refresh_token,
          user: response.user
        });
      }
    });
  });
};

// Middleware to redirect authenticated users from auth pages
const redirectIfAuthenticated = (req, res, next) => {
  if (req.session.user && req.session.accessToken) {
    return res.redirect('/');
  }
  next();
};

module.exports = {
  isAuthenticated,
  hasRole,
  redirectIfAuthenticated,
  authenticateUser
};
