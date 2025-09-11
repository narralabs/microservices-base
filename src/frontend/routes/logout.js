var express = require('express');
var router = express.Router();

/* GET logout page */
router.get('/', function(req, res, next) {
  // Clear the session
  req.session = null;
  
  // Redirect to login page
  res.redirect('/login');
});

module.exports = router;
