var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var cookieSession = require('cookie-session');

var indexRouter = require('./routes/index');
var loginRouter = require('./routes/login');
var signupRouter = require('./routes/signup');
var logoutRouter = require('./routes/logout');
var chatRouter = require('./routes/chat');
var cartRouter = require('./routes/cart');
var audioRouter = require('./routes/audio');
var { isAuthenticated } = require('./middleware/auth');

var app = express();

let SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  console.warn('SESSION_SECRET environment variable is not set. Using default value.');
  SESSION_SECRET = 'your-super-secret-key-change-in-production';
}

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser(SESSION_SECRET));
app.use(express.static(path.join(__dirname, 'public')));

// Session configuration
app.use(cookieSession({
  name: 'session',
  keys: [SESSION_SECRET],
  maxAge: 24 * 60 * 60 * 1000, // 24 hours
  secure: process.env.NODE_ENV === 'production',
  httpOnly: true
}));

// Make user available in templates
app.use((req, res, next) => {
  res.locals.user = req.session.user;
  res.locals.gaTrackingId = process.env.GOOGLE_ANALYTICS_ID || null;
  next();
});

// Generate anonymous user ID for unauthenticated users
app.use((req, res, next) => {
  // If user is not authenticated and doesn't have an anonymous ID, generate one
  if (!req.session.user && !req.session.anonymousId) {
    req.session.anonymousId = 'anon_' + Date.now() + '_' + Math.random().toString(36).substring(2, 15);
  }
  next();
});

// Public routes
app.use('/login', loginRouter);
app.use('/signup', signupRouter);
app.use('/logout', logoutRouter);
app.use('/chat', chatRouter);
app.use('/audio', audioRouter);

// Protected routes
app.use('/', indexRouter);
app.use('/cart', cartRouter); // Cart is now accessible without authentication

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
