var express = require('express');
var router = express.Router();
const { authenticateUser, redirectIfAuthenticated } = require('../middleware/auth');

router.get('/', redirectIfAuthenticated, function(req, res, next) {
  res.render('login', { title: 'Login' });
});

router.post('/', redirectIfAuthenticated, async function(req, res, next) {
  try {
    const { email, password } = req.body;
    const result = await authenticateUser(email, password);

    if (result.success) {
      // Set the access token in session
      req.session.accessToken = result.token;
      req.session.user = result.user;

      // Set the refresh token in an HTTP-only cookie
      res.cookie('refreshToken', result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
      });
      res.redirect('/');
    } else {
      res.render('login', {
        title: 'Login',
        error: result.error || 'Invalid email or password'
      });
    }
  } catch (error) {
    next(error);
  }
});

module.exports = router;
