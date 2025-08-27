var express = require('express');
var router = express.Router();

/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('index', { 
    title: 'AI Café',
    description: 'Welcome to our innovative AI-powered café experience',
    menu: [
      { name: 'Espresso', description: 'Rich and bold classic espresso', price: '$3.50' },
      { name: 'Cappuccino', description: 'Espresso topped with foamy milk and a sprinkle of cocoa', price: '$4.50' },
      { name: 'Cafe Latte', description: 'Espresso with steamed milk and a light layer of foam', price: '$4.50' },
      { name: 'Macchiato', description: 'Espresso "marked" with a small amount of foamed milk', price: '$4.00' }
    ]
  });
});

module.exports = router;
