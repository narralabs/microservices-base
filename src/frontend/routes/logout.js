var express = require('express');
var router = express.Router();

/* GET logout page */
router.get('/', function(req, res, next) {
  // Clear the session (a new anonymous ID will be generated on next request)
  req.session = null;
  
  // Redirect to home page (now accessible without login)
  res.redirect('/');
});

module.exports = router;
