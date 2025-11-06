document.addEventListener('DOMContentLoaded', () => {
  const cartPanel = document.getElementById('cartPanel');
  const cartItemsList = document.getElementById('cartItemsList');
  const cartSubtotal = document.getElementById('cartSubtotal');
  const cartCheckoutButton = document.getElementById('cartCheckoutButton');
  const cartCloseButton = document.getElementById('cartCloseButton');
  const cartIconButton = document.getElementById('cartIconButton');
  const cartBadge = document.getElementById('cartBadge');

  // Check if required elements exist
  if (!cartPanel || !cartItemsList || !cartSubtotal || !cartCheckoutButton) {
    console.error('Cart panel elements not found');
    return;
  }

  // Price mapping for items (you can extend this or fetch from API)
  const itemPrices = {
    'Espresso': 4.50,
    'Cappuccino': 5.40,
    'Cafe Latte': 5.20,
    'Macchiato': 5.90,
    'Americano': 4.80,
    'Mocha': 6.20,
    'Latte': 5.20,
    // Add more items as needed
  };

  // Cache cart state
  let cachedCartItems = [];

  // Fetch and display cart
  async function loadCart() {
    try {
      const response = await fetch('/cart');
      if (!response.ok) {
        throw new Error('Failed to fetch cart');
      }

      const cart = await response.json();
      displayCart(cart);
    } catch (error) {
      console.error('Error loading cart:', error);
      showEmptyCart();
    }
  }

  // Display cart items
  function displayCart(cart) {
    // Cache cart items
    cachedCartItems = cart.items || [];

    if (!cart.items || cart.items.length === 0) {
      showEmptyCart();
      return;
    }

    if (cartItemsList) {
      cartItemsList.innerHTML = '';
      
      cart.items.forEach(item => {
        const cartItem = createCartItemElement(item);
        cartItemsList.appendChild(cartItem);
      });
    }

    // Update subtotal
    const subtotal = calculateSubtotal(cart.items);
    if (cartSubtotal) {
      cartSubtotal.textContent = `$${subtotal.toFixed(2)}`;
    }
    
    // Enable/disable checkout button
    if (cartCheckoutButton) {
      cartCheckoutButton.disabled = false;
    }
    
    // Update cart badge
    updateCartBadge(cart.total_items || cart.items.reduce((sum, item) => sum + item.quantity, 0));
  }

  // Create cart item element matching Figma design
  function createCartItemElement(item) {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'cart-item-card';
    
    const price = itemPrices[item.item] || 0;
    const totalPrice = price * item.quantity;
    
    itemDiv.innerHTML = `
      <div class="cart-item-image" style="width: 72px; height: 72px; border-radius: 8px; background-color: #eae0d8; flex-shrink: 0;"></div>
      <div class="cart-item-details">
        <div class="cart-item-header">
          <p class="cart-item-name">${escapeHtml(item.item)}</p>
          <p class="cart-item-price">$${totalPrice.toFixed(2)}</p>
        </div>
        <div class="cart-item-quantity-controls">
          <button class="quantity-button decrease-quantity" data-item="${escapeHtml(item.item)}" type="button">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M4 8H12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <span class="quantity-value">${item.quantity}</span>
          <button class="quantity-button increase-quantity" data-item="${escapeHtml(item.item)}" type="button">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8 4V12M4 8H12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
      </div>
    `;

    // Add quantity button handlers
    const decreaseButton = itemDiv.querySelector('.decrease-quantity');
    const increaseButton = itemDiv.querySelector('.increase-quantity');
    
    decreaseButton.addEventListener('click', () => {
      if (item.quantity > 1) {
        updateQuantity(item.item, item.quantity - 1);
      } else {
        removeItem(item.item, item.quantity);
      }
    });
    
    increaseButton.addEventListener('click', () => {
      updateQuantity(item.item, item.quantity + 1);
    });

    return itemDiv;
  }

  // Show empty cart message
  function showEmptyCart() {
    cachedCartItems = [];
    if (cartItemsList) {
      cartItemsList.innerHTML = '<div class="cart-empty-state">your cart is empty</div>';
    }
    if (cartSubtotal) {
      cartSubtotal.textContent = '$0.00';
    }
    if (cartCheckoutButton) {
      cartCheckoutButton.disabled = true;
    }
    
    // Update cart badge
    updateCartBadge(0);
  }

  // Update cart badge
  function updateCartBadge(count) {
    if (cartBadge) {
      if (count > 0) {
        cartBadge.textContent = count;
        cartBadge.style.display = 'flex';
      } else {
        cartBadge.style.display = 'none';
      }
    }
  }

  // Toggle cart panel
  function toggleCart() {
    if (cartPanel && cartIconButton) {
      const isVisible = cartPanel.classList.contains('cart-panel-visible');
      
      if (isVisible) {
        // Hide cart panel
        cartPanel.classList.remove('cart-panel-visible');
        cartIconButton.classList.remove('cart-icon-hidden');
        // Wait for animation to complete before hiding
        setTimeout(() => {
          cartPanel.style.display = 'none';
        }, 300);
      } else {
        // Show cart panel
        cartPanel.style.display = 'flex';
        // Trigger animation on next frame
        requestAnimationFrame(() => {
          cartPanel.classList.add('cart-panel-visible');
          cartIconButton.classList.add('cart-icon-hidden');
        });
      }
    }
  }

  // Calculate subtotal
  function calculateSubtotal(items) {
    return items.reduce((total, item) => {
      const price = itemPrices[item.item] || 0;
      return total + (price * item.quantity);
    }, 0);
  }

  // Update item quantity
  async function updateQuantity(itemName, newQuantity) {
    if (newQuantity <= 0) {
      removeItem(itemName, 1);
      return;
    }

    try {
      const currentItem = cachedCartItems.find(i => i.item === itemName);
      if (!currentItem) return;

      const quantityChange = newQuantity - currentItem.quantity;
      
      if (quantityChange > 0) {
        // Add items
        const response = await fetch('/cart/add', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            item: itemName,
            quantity: quantityChange
          })
        });

        if (!response.ok) {
          throw new Error('Failed to update quantity');
        }

        const updatedCart = await response.json();
        displayCart(updatedCart);
      } else {
        // Remove items
        const response = await fetch('/cart/remove', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            item: itemName,
            quantity: Math.abs(quantityChange)
          })
        });

        if (!response.ok) {
          throw new Error('Failed to update quantity');
        }

        const updatedCart = await response.json();
        displayCart(updatedCart);
      }
    } catch (error) {
      console.error('Error updating quantity:', error);
      alert('Failed to update quantity');
    }
  }

  // Remove item from cart
  async function removeItem(itemName, quantity) {
    try {
      const response = await fetch('/cart/remove', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          item: itemName,
          quantity: quantity
        })
      });

      if (!response.ok) {
        throw new Error('Failed to remove item');
      }

      const updatedCart = await response.json();
      displayCart(updatedCart);
    } catch (error) {
      console.error('Error removing item:', error);
      alert('Failed to remove item from cart');
    }
  }

  // Handle checkout
  function handleCheckout() {
    alert('Checkout functionality coming soon!');
  }

  // Handle close button
  function handleCloseCart() {
    toggleCart();
  }

  // Escape HTML to prevent XSS
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Event listeners
  if (cartCheckoutButton) {
    cartCheckoutButton.addEventListener('click', handleCheckout);
  }
  
  if (cartCloseButton) {
    cartCloseButton.addEventListener('click', handleCloseCart);
  }

  if (cartIconButton) {
    cartIconButton.addEventListener('click', toggleCart);
  }

  // Load cart on page load
  loadCart();

  // Export functions for external use
  window.refreshCart = loadCart;
  window.getCartItems = function() {
    // Return cached cart items (no fetch needed)
    return cachedCartItems;
  };
  
  window.showCart = function() {
    if (cartPanel && cachedCartItems.length > 0 && cartIconButton) {
      cartPanel.style.display = 'flex';
      requestAnimationFrame(() => {
        cartPanel.classList.add('cart-panel-visible');
        cartIconButton.classList.add('cart-icon-hidden');
      });
    }
  };

  window.toggleCart = toggleCart;
});

